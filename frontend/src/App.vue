<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick, triggerRef, watch } from 'vue'
import { createEditor, setEditorZoom, replaceDocument, centerCursor } from './editor/createEditor'
import { extractOutline } from './editor/outline'
import {
  toggleBold, toggleItalic, toggleStrike, toggleInlineCode,
  toggleLink, insertImage, toggleHeading,
  toggleBulletList, toggleOrderedList, toggleTaskList, toggleBlockquote,
  toggleCodeBlock, insertTable, insertHr, insertToc, clearFormatting, activeFormats,
} from './editor/commands'
import {
  undo, redo, selectAll,
  moveLineUp, moveLineDown, copyLineDown, deleteLine,
  indentMore, indentLess,
} from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { createRenderer, render } from './preview/markdown'
import FileTree from './components/FileTree.vue'
import Outline from './components/Outline.vue'
import Toolbar from './components/Toolbar.vue'
import StatusBar from './components/StatusBar.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import AppIcon from './components/icons/AppIcon.vue'
import { useDocumentPersistence } from './composables/useDocumentPersistence'
import { useOutlineSync } from './composables/useOutlineSync'
import { getTheme, onThemeChange } from './themes/theme.js'
import { OpenFileDialog, OpenDirectoryDialog, ReadFile } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'
import './themes/index.css'

// ---------- 状态 ----------
const markdown = ref('')
const filePath = ref('')
const folderPath = ref('')
// 主题唯一真源是 themes/theme.js（main.js 接管 menu:toggle-theme 的三主题循环 +
// 持久化）；App.vue 只订阅已解析值（导出 HTML/PDF 用），不再自己写 localStorage。
const theme = ref(getTheme())
const offThemeChange = onThemeChange((resolved) => (theme.value = resolved))

const renderer = createRenderer()
const previewHtml = computed(() => render(renderer, markdown.value))
const title = computed(() => filePath.value ? filePath.value.split('/').pop() : '未命名')

const DEFAULT_DOC = `# Inkmark

一个安静的 **Markdown** 写作工具：左边写，右边看。

所有操作都在系统菜单栏里：**文件**菜单可以打开、保存、导出（Windows / Linux 在窗口顶部）。

## 它能做什么

- 打开单个文件，或整个文件夹（左侧文件树直接点选）
- 编辑与预览实时渲染，滚动双向联动
- 标记符即写即隐：光标所在行显形源码，移开即恢复排版（即时模式）
- 明暗纸三套主题，菜单里一键切换（⌘⇧L）
- 导出 HTML / 一键导出 PDF，历史快照可回退旧稿
- 中间的分隔条可以拖动，调整左右宽度（双击回到对半）

## 代码块

\`\`\`js
// 高亮配色与预览区共用同一套 Token
function hello(name) {
  console.log(\`你好, \${name}!\`)
}
hello('Inkmark')
\`\`\`

## 引用与行内元素

> 左右两栏的字号与行高完全一致，
> 滚动时同一行文字不会上下错位。

1. 行内代码长这样：\`var(--accent)\`
2. [链接](https://daringfireball.net/projects/markdown/) 会在预览里高亮
3. ~~删除线~~、**加粗**、*斜体* 都支持
4. 任务列表：- [ ] 写完这一章

| 快捷键 | 作用 |
| --- | --- |
| ⌘O | 打开文件 |
| ⌘⇧O | 打开文件夹 |
| ⌘S | 保存 |
| ⌘F | 查找（⌘⌥F 查找替换） |
| ⌘L | 跳转到行 |
| ⌘1 / ⌘2 / ⌘3 / ⌘4 | 编辑 / 预览 / 双栏 / 阅读 |
| ⌘⇧F | 专注模式（Esc 退出） |
| ⌘B | 显示 / 隐藏大纲 |
| ⌘⇧L | 切换主题 |

> 全部键位见菜单「帮助 → 快捷键速查」（⌘/）。
`

// ---------- 编辑器 ----------
const editorEl = ref(null)
const previewEl = ref(null)
let editor = null

// 状态栏数据源
const caret = ref({ line: 1, col: 1 })
const activeFmt = ref({})
// ---------- 缩放（状态栏循环 + 视图菜单 放大/缩小/重置，80%~150%） ----------
const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150]
const zoom = ref(100)

function setZoom(level) {
  zoom.value = level
  if (editor) setEditorZoom(editor, level / 100)
}

function cycleZoom() {
  const i = ZOOM_LEVELS.indexOf(zoom.value)
  setZoom(ZOOM_LEVELS[(i + 1) % ZOOM_LEVELS.length])
}

function zoomIn() {
  setZoom(ZOOM_LEVELS.find((z) => z > zoom.value) ?? zoom.value)
}

function zoomOut() {
  setZoom([...ZOOM_LEVELS].reverse().find((z) => z < zoom.value) ?? zoom.value)
}

// 字数：CJK 按字计，西文按词计
const wordCount = computed(() => {
  const s = markdown.value
  const cjkRe = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
  const cjk = (s.match(cjkRe) || []).length
  const latin = (s.replace(cjkRe, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
  return cjk + latin
})

function onEditorUpdate(u) {
  const pos = u.state.selection.main.head
  const line = u.state.doc.lineAt(pos)
  caret.value = { line: line.number, col: pos - line.from + 1 }
  activeFmt.value = activeFormats(u.state)
  // 打字机模式：输入后把光标行滚到视口中部（rAF 避开 update 事务内再 dispatch）
  if (typewriterOn.value && u.docChanged) {
    requestAnimationFrame(() => centerCursor(editor))
  }
}

// ---------- 轻提示（导出结果 / 快照反馈） ----------
const toast = ref({ show: false, msg: '', isErr: false })
let toastTimer = null

function showToast(msg, isErr = false) {
  toast.value = { show: true, msg, isErr }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value.show = false), isErr ? 6000 : 3200)
}

// ---------- 自动保存 / 快照 / 导出（composables/useDocumentPersistence） ----------
const persistence = useDocumentPersistence({
  getEditor: () => editor,
  filePath,
  title,
  previewHtml,
  theme,
  notify: showToast,
  // 恢复快照同样是「整份替换文档」，走 replaceDocument + 该回调同步派生状态
  onDocReplaced: syncAfterDocReplace,
})
const { saveState, dirty, showHistory, snapshots, historyLoading } = persistence

// 未保存状态同步给 Go 侧：OnBeforeClose 用它决定是否弹「未保存」确认对话框。
// dirty 的唯一语义 =「内存文档是否落后于磁盘」（含从未落盘的新文档）——
// 定义、生命周期与扩展路径见 docs/architecture/ADR-005-dirty-semantics.md；
// 此处只做镜像转发，不在此处推断语义，也不得给它叠加第二种含义。
// 浏览器预览没有 window.go，可选链静默跳过，不影响 UI。
watch(dirty, (d) => {
  try { window.go?.main?.App?.SetDirty?.(d) } catch { /* 预览环境无绑定 */ }
})

// ---------- 侧栏：常驻双 tab（文件 / 大纲） ----------
// 侧栏从「打开文件夹才出现」改为可随时开关（交互 Spec 3.1）；
// 可见性不持久化：默认收起，打开文件夹自动展开。
const sidebarOpen = ref(false)
const sidebarTab = ref('files') // 'files' | 'outline'
const outline = ref([])

// ---------- 文件树外部变更监听（Go 侧 fsnotify，仅根目录一层）----------
// 根目录直接子项增删改 → Go 去抖后发 fs:changed → 递增信号让 FileTree 重新拉取列表。
// folderPath 变化（打开 / 切换文件夹）时同步重设监听；关闭时传空串停止。
const treeSignal = ref(0)
safeEventsOn('fs:changed', () => { treeSignal.value++ })
watch(folderPath, (p) => {
  try { window.go?.main?.App?.WatchDir?.(p || '') } catch { /* 浏览器预览无绑定 */ }
})

// 视图四态：'edit' | 'preview' | 'split' | 'reading'（函数见下方「视图四态」节；
// 声明须在 useOutlineSync 之前，其依赖注入引用本 ref）
const viewMode = ref('split')
let modeBeforeReading = null

// ---------- 菜单开关态（checkbox 行为本体在 App.vue，偏好持久化 localStorage） ----------
// 滚动联动 / 打字机模式的偏好真源在前端；Go 侧 checkbox 只是初始态镜像
// （挂载时经 window.go.main.App.SetScrollSync / SetTypewriter 回读同步）。
const scrollSyncOn = ref(localStorage.getItem('inkmark-scroll-sync') !== '0')
const typewriterOn = ref(localStorage.getItem('inkmark-typewriter') === '1')

function toggleScrollSync(on) {
  scrollSyncOn.value = !!on
  localStorage.setItem('inkmark-scroll-sync', scrollSyncOn.value ? '1' : '0')
}

function toggleTypewriter(on) {
  typewriterOn.value = !!on
  localStorage.setItem('inkmark-typewriter', typewriterOn.value ? '1' : '0')
}

// ---------- 滚动双向联动 + 大纲当前节高亮（composables/useOutlineSync） ----------
const sync = useOutlineSync({
  getEditor: () => editor,
  previewEl,
  viewMode,
  sidebarOpen,
  outline,
  syncEnabled: () => scrollSyncOn.value, // 关闭时保留大纲高亮、停止跨栏联动
})
const { outlineActive } = sync

// ---------- 预览渲染防抖 ----------
// markdown 只驱动预览（编辑器内容在 CM6 内，大纲取自 editor.doc）。大文档下
// 每键全量渲染会卡，故把「输入期」的 markdown 更新防抖 ~120ms；打开 / 恢复文件
// 走 syncAfterDocReplace 直接赋值（不防抖，需即时）。导出前调 flushPreview() 补齐。
const PREVIEW_DEBOUNCE_MS = 120
let previewTimer = null
let pendingDoc = null

// 立即应用待渲染内容并重建锚点（导出、以及任何需要「所见即最新」的场合）
function flushPreview() {
  if (previewTimer === null) return
  clearTimeout(previewTimer)
  previewTimer = null
  const doc = pendingDoc
  pendingDoc = null
  if (doc !== null) {
    markdown.value = doc
    triggerRef(markdown)
  }
  nextTick(() => {
    sync.invalidateAnchors()
    sync.scheduleOutlineSync()
  })
}

// 丢弃待渲染内容（切换文件等破坏性边界前调用，防止旧内容稍后覆盖新文档）
function cancelPendingPreview() {
  clearTimeout(previewTimer)
  previewTimer = null
  pendingDoc = null
}

// 图片落盘：编辑器粘贴/拖拽得到图片文件后回调（Go 侧 SaveImage 写入文档同级 assets/），
// 返回可插入 Markdown 的相对路径；未落盘文档或环境不支持时提示并返回 null。
async function onImageFile(file) {
  const api = window.go?.main?.App
  if (!api?.SaveImage) {
    showToast('当前环境不支持插入图片', true)
    return null
  }
  if (!filePath.value) {
    showToast('请先保存文档（⌘S）再插入图片', true)
    return null
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    return await api.SaveImage(filePath.value, btoa(bin), ext)
  } catch (err) {
    showToast(`插入图片失败：${err?.message || err}`, true)
    return null
  }
}

function onDocChange(doc) {
  // 诊断（预览不同步排查）：确认链路是否触发、值是否变化。定位后移除。
  console.log('[onDocChange] len=', doc.length, 'changed=', doc !== markdown.value)
  // 预览渲染防抖：停手 ~120ms 后再更新 markdown → previewHtml（见上方说明）
  pendingDoc = doc
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    const d = pendingDoc
    pendingDoc = null
    if (d === null) return
    markdown.value = d
    triggerRef(markdown) // 防御性：强制依赖 markdown 的 computed（previewHtml）重算
    // 预览 DOM 到 nextTick 才刷新，此时才能重建标题锚点；大纲同机更新
    nextTick(() => {
      sync.invalidateAnchors()
      outline.value = extractOutline(editor.state.doc)
      sync.scheduleOutlineSync()
    })
  }, PREVIEW_DEBOUNCE_MS)
  persistence.markDirty()
  persistence.maybeSnapshot() // 「有效编辑会话」节流快照（≥3 分钟，AC-14 与自动保存解耦）
}

// 整份替换文档后的外部状态同步。
// replaceDocument 走 setState 绕开 CM6 tile 增量崩溃（见 createEditor.js），
// 而 setState 不是事务更新、不会触发 updateListener，所以这里手工补上 onDocChange
// 中除「脏标记 / 快照」以外的全部派生状态（预览、行列、格式态、大纲锚点）。
function syncAfterDocReplace(content) {
  cancelPendingPreview() // 丢弃输入期待渲染内容，防止稍后覆盖刚打开/恢复的文档
  markdown.value = content
  triggerRef(markdown)
  caret.value = { line: 1, col: 1 }
  activeFmt.value = {}
  nextTick(() => {
    sync.invalidateAnchors()
    outline.value = extractOutline(editor.state.doc)
    sync.scheduleOutlineSync()
  })
}

onMounted(() => {
  editor = createEditor(editorEl.value, {
    doc: DEFAULT_DOC,
    onDocChange,
    onScroll: sync.onEditorScroll,
    onUpdate: onEditorUpdate,
    onImageFile,
  })
  markdown.value = DEFAULT_DOC
  outline.value = extractOutline(editor.state.doc)
  // 持久化的非双栏态必须延后应用：编辑器一律在可见状态下创建（CM6 在
  // display:none 里创建会把离屏块高度测成 0，恢复后长文档滚动高度全错）。
  // 延后一帧再切走，等首帧度量完成。
  const savedMode = localStorage.getItem('inkmark-view-mode')
  if (savedMode === 'edit' || savedMode === 'preview' || savedMode === 'reading') {
    requestAnimationFrame(() => setViewMode(savedMode, { persist: false }))
  }
  // 开关偏好回读给 Go：菜单 checkbox 初始态（Go 在 buildMenu 时用的默认值）
  try {
    const api = window.go?.main?.App
    api?.SetScrollSync?.(scrollSyncOn.value)
    api?.SetTypewriter?.(typewriterOn.value)
  } catch { /* 浏览器预览无绑定 */ }
})

// 开发期调试钩子：浏览器（vite dev）下没有 wails 绑定，无法走真实「打开文件」路径，
// 借此在控制台/自动化里直接驱动编辑器与文件切换。import.meta.env.DEV 为静态常量，
// 生产构建整块被剔除，不增加产物体积。
if (import.meta.env.DEV) {
  window.__inkmark = {
    get editor() { return editor },
    get markdown() { return markdown.value },
    get previewHtml() { return previewHtml.value },
    get filePath() { return filePath.value },
    openFile,
    openTreeFile,
  }
}

// 窗口尺寸变化会重排两栏，锚点 y 全部失效
window.addEventListener('resize', sync.invalidateAnchors)
window.addEventListener('keydown', onGlobalKeydown)
onBeforeUnmount(() => {
  window.removeEventListener('resize', sync.invalidateAnchors)
  window.removeEventListener('keydown', onGlobalKeydown)
  offThemeChange()
  editor?.destroy()
})

// ---------- 视图四态（编辑 / 预览 / 双栏 / 阅读） ----------
// 四态一律 v-show 保 DOM 存活：CM6 实例、预览 DOM、锚点缓存都不销毁重建。
// CM6 隐藏坑：display:none 期间度量全部失真，恢复可见必须 requestMeasure 重测。
// 阅读态（⌘4）是「第 4 视图态」，与 ⌘1/2/3 同族互斥（ADR-004 裁决），
// 不是叠加态；Esc 退出回到进入前视图态（复用专注模式 modeBeforeFocus 同一机制）。
// （viewMode / modeBeforeReading 声明在文件前部：useOutlineSync 依赖注入需要）

function setViewMode(mode, { persist = true } = {}) {
  viewMode.value = mode
  if (mode !== 'reading') modeBeforeReading = null // 用户手动切走：不再记忆
  if (persist) localStorage.setItem('inkmark-view-mode', mode)
  // 编辑器恢复可见的所有切换都要重测：display:none 期间度量失真，
  // 等 Vue 把样式落盘后 requestMeasure 一次。阅读态编辑器隐藏，无需重测。
  // 锚点失效只跟双栏态有关（锚点仅在双栏收集/使用）。
  if (mode === 'edit' || mode === 'split') {
    nextTick(() => {
      editor?.requestMeasure()
      if (mode === 'split') sync.invalidateAnchors()
    })
  }
}

function enterReading() {
  if (viewMode.value === 'reading') return
  modeBeforeReading = viewMode.value
  setViewMode('reading')
}

function exitReading() {
  const back = modeBeforeReading && modeBeforeReading !== 'reading' ? modeBeforeReading : 'split'
  modeBeforeReading = null
  setViewMode(back)
}

// ---------- 专注模式 ----------
// 叠加态：进入时若非编辑态则自动切到编辑态并记住原态，退出恢复（交互 Spec 2.1）。
// 顶栏与侧栏整体让位给内容；淡化本体在 createEditor.js（setFocusMode effect）。
const focusOn = ref(false)
let modeBeforeFocus = null
const focusToast = ref(false)
let focusToastTimer = null

function toggleFocus() {
  if (focusOn.value) {
    focusOn.value = false
    // 专注期间用户没手动切过视图态才恢复原态；手动切过则尊重现状
    if (modeBeforeFocus && viewMode.value === 'edit') setViewMode(modeBeforeFocus)
    modeBeforeFocus = null
    editor?.focus()
    return
  }
  focusOn.value = true
  modeBeforeFocus = viewMode.value !== 'edit' ? viewMode.value : null
  if (viewMode.value !== 'edit') setViewMode('edit')
  editor?.focus()
  // 首次进入给一次轻提示（之后不再打扰）
  if (localStorage.getItem('inkmark-focus-hint') !== '1') {
    localStorage.setItem('inkmark-focus-hint', '1')
    focusToast.value = true
    focusToastTimer = setTimeout(() => (focusToast.value = false), 3000)
  }
}

// Esc 退出专注 / 阅读 / 历史面板 / 对话框；⌘F / ⌘L 全局兜底
// （darwin 无「编辑」菜单入口，按键直达 WebView；编辑器内 ⌘F 由 CM searchKeymap
// 处理，此处只补编辑器外场景。⌘L 两边都没绑，统一走这里。）
function onGlobalKeydown(e) {
  if (e.isComposing) return
  if (e.key === 'Escape') {
    if (dialog.show) closeDialog(null)
    // 设置面板是模态弹层：优先级仅次于输入对话框，Esc 关闭并把焦点交还编辑器
    else if (showSettings.value) closeSettings()
    else if (showShortcuts.value) showShortcuts.value = false
    else if (focusOn.value) toggleFocus()
    else if (persistence.showHistory.value) persistence.showHistory.value = false
    else if (viewMode.value === 'reading') exitReading()
    return
  }
  if (dialog.show) return // 输入对话框打开期间不响应全局命令键
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.shiftKey) return
  const k = e.key.toLowerCase()
  if (k === 'f') {
    // 编辑器焦点内交给 CM keymap，避免双开面板抢焦点
    if (!(editor && editor.dom.contains(e.target))) {
      e.preventDefault()
      openFind()
    }
    return
  }
  if (k === 'l') {
    e.preventDefault()
    jumpToLine()
  }
}

// ---------- 侧栏 tab 切换 / 大纲开关（refs 与联动在文件前部声明） ----------

function showSidebarTab(tab) {
  sidebarTab.value = tab
}

function toggleOutline() {
  sidebarOpen.value = !sidebarOpen.value
  if (sidebarOpen.value) {
    sidebarTab.value = 'outline'
    sync.scheduleOutlineSync() // 打开面板立即算一次当前节
  }
  // 侧栏开合改变 .main 可用宽度，两栏重排，锚点 y 全部失效
  sync.invalidateAnchors()
}

// ---------- 文件操作 ----------

// 打开 / 切换文件的唯一落点：整份替换文档 + 同步全部派生状态。
// 必须走 replaceDocument（setState 全量重绘）而非 dispatch —— 原因见 createEditor.js
// 中对 CM6 tile 增量崩溃的说明，那正是「编辑器还停在旧文件、预览已是新文件」的成因。
function loadDocument(content, path) {
  replaceDocument(editor, content)
  syncAfterDocReplace(content)
  filePath.value = path
  persistence.resetSession()
  // 登记最近打开（Go 侧持久化 + 重建「最近打开」子菜单）；未落盘文档跳过
  if (path) {
    try { window.go?.main?.App?.AddRecent?.(path) } catch { /* 浏览器预览无绑定 */ }
  }
}

async function openFile() {
  const path = await OpenFileDialog()
  if (!path) return
  await persistence.snapshotBoundary() // 破坏性边界前先留一份快照
  const content = await ReadFile(path)
  loadDocument(content, path)
}

async function openFolder() {
  const path = await OpenDirectoryDialog()
  if (!path) return
  folderPath.value = path
  // 打开文件夹自动展开侧栏（文件 tab）
  sidebarOpen.value = true
  sidebarTab.value = 'files'
}

async function openTreeFile(path) {
  if (path === filePath.value) return
  await persistence.snapshotBoundary()
  const content = await ReadFile(path)
  loadDocument(content, path)
}

// ---------- 文件：新建 / 重命名 ----------

async function newFile() {
  await persistence.snapshotBoundary() // 破坏性边界前先留一份快照
  loadDocument('', '')
  showToast('已新建文件，⌘S 保存到磁盘')
}

async function renameFile() {
  if (!filePath.value) {
    showToast('请先保存文档（⌘S）再重命名', true)
    return
  }
  const api = window.go?.main?.App
  if (!api?.RenameFile) {
    showToast('当前环境不支持重命名', true)
    return
  }
  const name = await askInput({ title: '重命名', value: title.value })
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed || trimmed === title.value) return
  try {
    const newPath = await api.RenameFile(filePath.value, trimmed)
    filePath.value = newPath
    api.AddRecent?.(newPath)
    showToast('已重命名')
  } catch (err) {
    showToast(`重命名失败：${err?.message || err}`, true)
  }
}

// ---------- 查找 / 替换（CM search 面板；⌘F/⌘⌥F） ----------

function openFind() {
  if (!editor) return
  // 预览/阅读态编辑器隐藏，先回到双栏再开面板
  if (viewMode.value === 'preview' || viewMode.value === 'reading') setViewMode('split')
  nextTick(() => {
    editor.focus()
    openSearchPanel(editor)
  })
}

// ---------- 跳转到行（⌘L，输入对话框） ----------

async function jumpToLine() {
  if (!editor) return
  const v = await askInput({ title: '跳转到行', placeholder: `1 ~ ${editor.state.doc.lines}` })
  if (v === null) return
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n) || n < 1 || n > editor.state.doc.lines) {
    showToast(`行号超出范围（1 ~ ${editor.state.doc.lines}）`, true)
    return
  }
  const line = editor.state.doc.line(n)
  editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
  editor.focus()
}

// ---------- 复制选区为 HTML（非 darwin 编辑菜单入口） ----------

function copySelectionAsHtml() {
  if (!editor) return
  const r = editor.state.selection.main
  const md = r.empty ? editor.state.doc.toString() : editor.state.sliceDoc(r.from, r.to)
  const html = render(renderer, md)
  navigator.clipboard?.writeText(html).then(
    () => showToast('已复制为 HTML'),
    () => showToast('复制失败', true),
  )
}

// ---------- 帮助：快捷键速查 / Markdown 语法示例 ----------

const showShortcuts = ref(false)
// 设置面板可见性（menu:open-settings ⌘, 打开；Esc / 关闭按钮收起）
const showSettings = ref(false)
const IS_MAC = /mac/i.test(navigator.platform || '')

// 关闭设置面板并把焦点交还编辑器（AC-07）。
// 恢复默认等偏好副作用已在 prefs.js 内实时落地，这里只管可见性与焦点。
function closeSettings() {
  showSettings.value = false
  editor?.focus()
}

// 键位展示：mac 用符号，其余平台把 ⌘/⌥/⇧ 替换为 Ctrl/Alt/Shift
function fmtKey(k) {
  if (IS_MAC) return k
  return k.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+')
}

const SHORTCUTS = [
  ['⌘N', '新建文件'],
  ['⌘O / ⌘⇧O', '打开文件 / 打开文件夹'],
  ['⌘S / ⌘⇧S', '保存 / 另存为'],
  ['⌘P', '打印'],
  ['⇧⌘P', '导出 PDF'],
  ['⌘F', '查找（⌘⌥F 查找替换）'],
  ['⌘L', '跳转到行'],
  ['⌥↑ / ⌥↓', '上移 / 下移行'],
  ['⇧⌥↑ / ⇧⌥↓', '在上方 / 下方复制当前行'],
  ['⌘⇧K', '删除当前行'],
  ['⌘⇧B / ⌘I', '加粗 / 斜体'],
  ['⌘K', '插入链接'],
  ['⌘1 ~ ⌘4', '编辑 / 预览 / 双栏 / 阅读'],
  ['⌘⇧F', '专注模式（Esc 退出）'],
  ['⌘B', '显示 / 隐藏大纲'],
  ['⌘= / ⌘- / ⌘0', '放大 / 缩小 / 重置缩放'],
  ['⌘⇧L', '切换主题'],
  ['⌘,', '设置'],
  ['⌘/', '快捷键速查'],
]

const SYNTAX_DOC = `# Markdown 语法速览

一份可玩的速查表：左边是源码，右边看效果。改一改，立刻看到变化。

## 行内元素

**加粗**、*斜体*、~~删除线~~、\`行内代码\`，
[链接](https://daringfireball.net/projects/markdown/) 指向 Markdown 原文。

## 列表

1. 有序列表自动编号
2. 嵌套只需缩进两格
   - 无序子项
   - [ ] 任务列表：把 x 换成空格试试
   - [x] 已完成的事项

## 引用与代码

> 引用块适合放一段提醒或摘录。
> 可以连续多行。

\`\`\`js
// 围栏代码块，支持语言高亮
function hello(name) {
  console.log(\`你好, \${name}!\`)
}
\`\`\`

## 表格与分割线

| 语法 | 效果 |
| --- | --- |
| \`**文字**\` | 加粗 |
| \`[文字](url)\` | 链接 |

---

更多能力：菜单「格式 → 插入」可以放图片、表格、目录；「帮助 → 快捷键速查」看全部键位。
`

async function loadSyntaxSample() {
  await persistence.snapshotBoundary()
  loadDocument(SYNTAX_DOC, '')
  showToast('已载入语法示例（⌘S 可另存）')
}

// ---------- 输入对话框（跳转到行 / 重命名共用） ----------
// WKWebView 不支持 window.prompt（静默返回 null），自己搭一个最小对话框。

const dialog = ref({ show: false, title: '', placeholder: '', value: '', _resolve: null })
const dialogInputEl = ref(null)

function askInput({ title, placeholder = '', value = '' }) {
  return new Promise((resolve) => {
    dialog.value = { show: true, title, placeholder, value, _resolve: resolve }
    nextTick(() => dialogInputEl.value?.focus())
  })
}

function closeDialog(result) {
  const d = dialog.value
  if (!d.show) return
  d.show = false
  d._resolve?.(result)
  d._resolve = null
}


// ---------- 格式化命令（菜单事件 / 工具条共用） ----------

function execCmd(cmd) {
  // 诊断（格式菜单排查）：区分「没调到」「editor 为空」「命令报错」。定位后移除。
  console.log('[execCmd] editor=', !!editor)
  if (!editor) return
  try {
    cmd(editor)
  } catch (e) {
    console.error('[execCmd] command failed:', e)
  }
  editor.focus()
}

function onToolbarCommand(id) {
  const map = {
    undo: (v) => undo(v),
    redo: (v) => redo(v),
    bold: toggleBold,
    italic: toggleItalic,
    strike: toggleStrike,
    code: toggleInlineCode,
    quote: toggleBlockquote,
    ul: toggleBulletList,
    ol: toggleOrderedList,
    task: toggleTaskList,
    link: toggleLink,
    image: insertImage,
    codeblock: toggleCodeBlock,
    table: insertTable,
    hr: insertHr,
    h0: toggleHeading(0),
    h1: toggleHeading(1),
    h2: toggleHeading(2),
    h3: toggleHeading(3),
  }
  const cmd = map[id]
  if (cmd) execCmd(cmd)
}

// ---------- 缩放：见文件前部 ZOOM_LEVELS / setZoom / cycleZoom ----------

// ---------- 原生菜单事件（main.go 的 buildMenu 发出） ----------
// 快捷键由菜单 accelerator 承担（⌘O/⌘S/⌘⇧L…），菜单会先于 WebView 消费按键，
// 因此前端不再单独监听 keydown，避免同一次按键触发两次。
// EventsOn 依赖 Wails 桌面端注入的 window.runtime —— 纯浏览器预览（npm run dev）
// 里它是 undefined，会炸掉 setup 整页白屏。守卫后浏览器跳过菜单事件绑定，
// UI 照常可预览；桌面端不受影响。
// 注意：menu:toggle-theme 由 main.js 经 themes/theme.js 接管（三主题循环 + 持久化），
// 此处不得重复订阅（Wails 事件多订阅会导致点一次改两次）。
function safeEventsOn(name, handler) {
  // 诊断（格式菜单排查）：确认桌面端事件是否真的注册上。定位后移除。
  if (window.runtime?.EventsOnMultiple) {
    EventsOn(name, handler)
    console.log('[menu] bound:', name)
  } else {
    console.warn('[menu] SKIP (no runtime):', name)
  }
}
safeEventsOn('menu:open-file', openFile)
safeEventsOn('menu:open-folder', openFolder)
safeEventsOn('menu:save', persistence.saveFile)
safeEventsOn('menu:save-as', persistence.saveFileAs)
// 导出前 flush 预览，避免防抖窗口内取到旧 HTML（flushPreview 定义见「预览渲染防抖」节）
safeEventsOn('menu:export-html', () => { flushPreview(); persistence.exportHtml() })
safeEventsOn('menu:export-pdf', () => { flushPreview(); persistence.exportPdf() })
// 打印（文件 → 打印… ⌘P）：先 flush 预览补齐防抖窗口内的最新内容，再走系统打印。
// @media print（App.vue 末尾）已隐藏 chrome、只输出预览区，故无需另做打印视图。
safeEventsOn('menu:print', () => { flushPreview(); window.print() })
safeEventsOn('menu:open-settings', () => { showSettings.value = true })
safeEventsOn('menu:view-edit', () => setViewMode('edit'))
safeEventsOn('menu:view-preview', () => setViewMode('preview'))
safeEventsOn('menu:view-split', () => setViewMode('split'))
safeEventsOn('menu:view-reading', enterReading)
safeEventsOn('menu:toggle-focus', toggleFocus)
safeEventsOn('menu:toggle-outline', toggleOutline)
safeEventsOn('menu:toggle-history', persistence.toggleHistory)
// 格式菜单（AC-10/11 的 toggle 命令；事件名以 Go 侧菜单为准，不得改名）
safeEventsOn('menu:format-bold', () => execCmd(toggleBold))
safeEventsOn('menu:format-italic', () => execCmd(toggleItalic))
safeEventsOn('menu:format-strike', () => execCmd(toggleStrike))
safeEventsOn('menu:format-inline-code', () => execCmd(toggleInlineCode))
safeEventsOn('menu:format-link', () => execCmd(toggleLink))
safeEventsOn('menu:format-h1', () => execCmd(toggleHeading(1)))
safeEventsOn('menu:format-h2', () => execCmd(toggleHeading(2)))
safeEventsOn('menu:format-h3', () => execCmd(toggleHeading(3)))
safeEventsOn('menu:format-h4', () => execCmd(toggleHeading(4)))
safeEventsOn('menu:format-h5', () => execCmd(toggleHeading(5)))
safeEventsOn('menu:format-h6', () => execCmd(toggleHeading(6)))
safeEventsOn('menu:format-list-bullet', () => execCmd(toggleBulletList))
safeEventsOn('menu:format-list-ordered', () => execCmd(toggleOrderedList))
safeEventsOn('menu:format-list-todo', () => execCmd(toggleTaskList))
safeEventsOn('menu:format-quote', () => execCmd(toggleBlockquote))
safeEventsOn('menu:format-code-block', () => execCmd(toggleCodeBlock))
// ---- 新增菜单接线（结构见 main.go buildMenu；事件名与 Go 侧一一对应） ----
// 文件
safeEventsOn('menu:new-file', newFile)
safeEventsOn('menu:rename', renameFile)
safeEventsOn('menu:open-recent', async (path) => {
  // Go 侧「最近打开」子菜单点击，payload 为文件绝对路径
  if (path && path !== filePath.value) await openTreeFile(path)
})
// 查找 / 跳转 / 行操作
safeEventsOn('menu:find', openFind)
safeEventsOn('menu:find-replace', openFind) // CM 面板自带替换行，同一入口
safeEventsOn('menu:jump-line', jumpToLine)
safeEventsOn('menu:move-line-up', () => execCmd(moveLineUp))
safeEventsOn('menu:move-line-down', () => execCmd(moveLineDown))
safeEventsOn('menu:dup-line', () => execCmd(copyLineDown))
safeEventsOn('menu:delete-line', () => execCmd(deleteLine))
safeEventsOn('menu:copy-as-html', copySelectionAsHtml)
// 格式 → 插入 / 缩进 / 清除格式
safeEventsOn('menu:insert-image', () => execCmd(insertImage))
safeEventsOn('menu:insert-table', () => execCmd(insertTable))
safeEventsOn('menu:insert-hr', () => execCmd(insertHr))
safeEventsOn('menu:insert-toc', () => execCmd(insertToc))
safeEventsOn('menu:indent', () => execCmd(indentMore))
safeEventsOn('menu:outdent', () => execCmd(indentLess))
safeEventsOn('menu:clear-format', () => execCmd(clearFormatting))
// 视图：缩放 / 开关（payload 为 checkbox 勾选后的新值）
safeEventsOn('menu:zoom-in', zoomIn)
safeEventsOn('menu:zoom-out', zoomOut)
safeEventsOn('menu:zoom-reset', () => setZoom(100))
safeEventsOn('menu:toggle-scroll-sync', toggleScrollSync)
safeEventsOn('menu:toggle-typewriter', toggleTypewriter)
safeEventsOn('menu:toggle-always-on-top', () => { /* 窗口行为已在 Go 侧完成 */ })
// 帮助
safeEventsOn('menu:help-shortcuts', () => { showShortcuts.value = true })
safeEventsOn('menu:help-syntax', loadSyntaxSample)
// 非 darwin 自建「编辑」菜单（剪贴板类：按键已由 WebView 原生承接，这里只接点击）
safeEventsOn('menu:undo', () => execCmd(undo))
safeEventsOn('menu:redo', () => execCmd(redo))
safeEventsOn('menu:cut', () => document.execCommand?.('cut'))
safeEventsOn('menu:copy', () => document.execCommand?.('copy'))
safeEventsOn('menu:paste', () => showToast('请使用 Ctrl+V 粘贴（剪贴板权限由系统管理）'))
safeEventsOn('menu:select-all', () => execCmd(selectAll))

// ---------- 左右分栏拖拽 ----------
// 编辑区宽度用百分比，预览区吃剩余空间；双击分割条回到对半，宽度写入 localStorage。
// splitting 必须是 ref：分割条的激活态要靠它驱动 class，不能用模块级 let。
const mainEl = ref(null)
const sidebarEl = ref(null)
const editorWidth = ref(50)   // 编辑区占（去掉侧栏后的）可用宽度百分比
const splitting = ref(false)
const SPLIT_MIN = 20
const SPLIT_MAX = 80

// 恢复上次拖到的宽度
const savedSplit = Number(localStorage.getItem('inkmark-split'))
if (savedSplit >= SPLIT_MIN && savedSplit <= SPLIT_MAX) editorWidth.value = savedSplit

function onDividerDown(e) {
  splitting.value = true
  e.currentTarget.setPointerCapture(e.pointerId)
  document.body.classList.add('splitting')
}

function onDividerMove(e) {
  if (!splitting.value || !mainEl.value) return
  sync.invalidateAnchors() // 宽度变化会重排两栏，标题锚点 y 全部失效
  const rect = mainEl.value.getBoundingClientRect()
  // 百分比按「去掉侧栏后的可用宽度」算，侧栏出现/消失都不会让比例失真
  const sidebarW = sidebarEl.value ? sidebarEl.value.offsetWidth : 0
  const avail = rect.width - sidebarW
  if (avail <= 0) return
  const pct = ((e.clientX - rect.left - sidebarW) / avail) * 100
  editorWidth.value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct))
}

function onDividerUp(e) {
  if (!splitting.value) return
  splitting.value = false
  e.currentTarget.releasePointerCapture?.(e.pointerId)
  document.body.classList.remove('splitting')
  localStorage.setItem('inkmark-split', String(Math.round(editorWidth.value)))
}

function resetSplit() {
  editorWidth.value = 50
  localStorage.setItem('inkmark-split', '50')
}

// 分割条键盘可达（可聚焦 separator 的 aria 规范）：左右方向键 ±2% 调宽
function onDividerKeydown(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const step = e.key === 'ArrowLeft' ? -2 : 2
  editorWidth.value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, editorWidth.value + step))
  localStorage.setItem('inkmark-split', String(Math.round(editorWidth.value)))
  sync.invalidateAnchors() // 宽度变化重排两栏，锚点失效
}
</script>

<template>
  <div
    class="app"
    :class="{ reading: viewMode === 'reading' }"
    :style="{ '--zoom-scale': zoom / 100 }"
  >
    <!-- 顶栏：macOS 隐藏式标题栏，左侧留红绿灯安全区；操作全部收进系统菜单栏。
         背景与页面同色、无分隔线，整条都是窗口拖拽区（Wails 用 --wails-draggable）。
         专注 / 阅读模式下整条隐藏，把 44px 让给内容（红绿灯为系统绘制，不受影响）。 -->
    <header v-show="!focusOn && viewMode !== 'reading'" class="toolbar">
      <div class="toolbar-title" :title="title">{{ title }}{{ dirty ? ' •' : '' }}</div>
    </header>

    <div class="main" ref="mainEl">
      <!-- 侧栏：常驻双 tab（文件 / 大纲）。未开文件夹时文件 tab 显示空态引导；
           大纲 tab 与文件夹无关、始终可用。专注 / 阅读模式下整栏隐藏。 -->
      <aside
        v-show="sidebarOpen && !focusOn && viewMode !== 'reading'"
        ref="sidebarEl"
        class="sidebar"
        :inert="!sidebarOpen || focusOn || viewMode === 'reading'"
      >
        <div class="sidebar-tabs" role="tablist" aria-label="侧栏">
          <button
            class="sidebar-tab"
            :class="{ active: sidebarTab === 'files' }"
            type="button"
            role="tab"
            :aria-selected="sidebarTab === 'files'"
            @click="showSidebarTab('files')"
          >文件</button>
          <button
            class="sidebar-tab"
            :class="{ active: sidebarTab === 'outline' }"
            type="button"
            role="tab"
            :aria-selected="sidebarTab === 'outline'"
            @click="showSidebarTab('outline')"
          >大纲</button>
        </div>

        <div v-show="sidebarTab === 'files'" class="sidebar-body">
          <template v-if="folderPath">
            <div class="sidebar-title" :title="folderPath">{{ folderPath.split('/').pop() }}</div>
            <FileTree :root="folderPath" :reload-signal="treeSignal" @select="openTreeFile" />
          </template>
          <div v-else class="sidebar-empty">
            <p>打开一个文件夹，在侧栏浏览文件</p>
            <button class="sidebar-cta" type="button" @click="openFolder">打开文件夹</button>
          </div>
        </div>

        <div v-show="sidebarTab === 'outline'" class="sidebar-body">
          <Outline :items="outline" :active-index="outlineActive" @jump="sync.jumpToHeading" />
        </div>
      </aside>

      <!-- 编辑区：四态 v-show 保 CM6 实例存活；隐藏侧用 inert 阻止焦点进入。
           工具条仅编辑态显示（阅读/专注隐藏 chrome），位于编辑区顶部 38px。 -->
      <section
        v-show="viewMode === 'edit' || viewMode === 'split'"
        class="pane editor-pane"
        :inert="viewMode === 'preview' || viewMode === 'reading'"
        :style="{ width: viewMode === 'split' ? editorWidth + '%' : '100%' }"
      >
        <Toolbar
          v-show="viewMode === 'edit' && !focusOn"
          :active="activeFmt"
          @command="onToolbarCommand"
        />
        <div ref="editorEl" class="editor-host"></div>
      </section>

      <!-- 分割条：拖动调宽，双击复位。仅双栏态存在。
           激活态用组件自己的 class（.active），不要用 :global(body.splitting) 后代选择器
           —— Vue scoped 编译器会把「:global(前缀) 后代」错误拍平成前缀本身，
           声明会落到 body 上（曾导致 body 被涂成强调色、宽度 2px、整窗不可交互）。 -->
      <div
        v-show="viewMode === 'split'"
        class="divider"
        :class="{ active: splitting }"
        role="separator"
        aria-orientation="vertical"
        aria-label="编辑区宽度"
        :aria-valuenow="Math.round(editorWidth)"
        aria-valuemin="20"
        aria-valuemax="80"
        tabindex="0"
        title="拖动调整宽度，双击复位，方向键微调"
        @pointerdown="onDividerDown"
        @pointermove="onDividerMove"
        @pointerup="onDividerUp"
        @pointercancel="onDividerUp"
        @dblclick="resetSplit"
        @keydown="onDividerKeydown"
      ></div>

      <!-- 预览区：滚动事件必须绑在真正滚动的元素上（.preview-body 不滚动）。
           隐藏时保留 DOM（滚动位/渲染结果不丢），inert 阻止焦点进入。
           v-html 始终渲染：编辑态导出 PDF 也依赖这份 DOM（见 @media print）。
           阅读态（⌘4）：预览区独占，正文加宽 --reading-measure（.app.reading）。 -->
      <section
        v-show="viewMode !== 'edit'"
        class="pane preview-pane"
        ref="previewEl"
        :inert="viewMode === 'edit'"
        @scroll="sync.onPreviewScroll"
      >
        <div class="preview-body" v-html="previewHtml"></div>
      </section>
    </div>

    <!-- 状态栏：保存态 + 行列 / 字数 / 缩放；专注 / 阅读态隐藏 -->
    <StatusBar
      v-show="!focusOn && viewMode !== 'reading'"
      :status="saveState"
      :line="caret.line"
      :col="caret.col"
      :words="wordCount"
      :zoom="zoom"
      @zoom="cycleZoom"
    />

    <!-- 历史快照面板（menu:toggle-history / Esc 关闭；数据在 useDocumentPersistence） -->
    <HistoryPanel
      v-if="showHistory"
      :file-path="filePath"
      :snapshots="snapshots"
      :loading="historyLoading"
      @close="showHistory = false"
      @snapshot-now="persistence.snapshotNow"
      @restore="persistence.restoreSnapshot"
    />

    <!-- 设置面板（menu:open-settings ⌘, 打开；Esc / 关闭按钮收起，焦点回编辑器） -->
    <SettingsPanel v-if="showSettings" @close="closeSettings" />

    <!-- 一次性 / 结果提示（专注模式首次进入、导出结果、快照反馈） -->
    <div v-show="focusToast" class="focus-toast" role="status">已进入专注模式，Esc 退出</div>
    <div v-show="toast.show" class="focus-toast" :class="{ 'is-err': toast.isErr }" role="status">
      {{ toast.msg }}
    </div>

    <!-- 输入对话框：跳转到行 / 重命名共用（WKWebView 无 window.prompt） -->
    <div v-if="dialog.show" class="dialog-mask" @click.self="closeDialog(null)">
      <div class="dialog" role="dialog" aria-modal="true" :aria-label="dialog.title">
        <p class="dialog-title">{{ dialog.title }}</p>
        <input
          ref="dialogInputEl"
          v-model="dialog.value"
          class="dialog-input"
          type="text"
          :placeholder="dialog.placeholder"
          @keydown.enter.prevent="closeDialog(dialog.value)"
        />
        <div class="dialog-actions">
          <button class="dialog-btn" type="button" @click="closeDialog(null)">取消</button>
          <button class="dialog-btn primary" type="button" @click="closeDialog(dialog.value)">确定</button>
        </div>
      </div>
    </div>

    <!-- 快捷键速查（帮助菜单 ⌘/ / Esc 关闭） -->
    <div v-if="showShortcuts" class="dialog-mask" @click.self="showShortcuts = false">
      <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-label="快捷键速查">
        <p class="dialog-title">快捷键速查</p>
        <table class="shortcut-table">
          <tbody>
            <tr v-for="([keys, desc], i) in SHORTCUTS" :key="i">
              <td class="shortcut-keys">{{ fmtKey(keys) }}</td>
              <td class="shortcut-desc">{{ desc }}</td>
            </tr>
          </tbody>
        </table>
        <div class="dialog-actions">
          <button class="dialog-btn primary" type="button" @click="showShortcuts = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }

/* ---- 顶栏：与页面同色、无线框，整条都是窗口拖拽区 ---- */
/* 注意：Wails 读的是 --wails-draggable，不是 -webkit-app-region（那是 Chromium 的，
   macOS 的 WKWebView 不认）。 */
.toolbar {
  position: relative;
  display: flex; align-items: center;
  height: var(--toolbar-height);
  flex-shrink: 0;
  padding: 0 var(--space-3) 0 78px; /* 左侧给 macOS 红绿灯留位 */
  background: var(--bg);
  border-bottom: none;
  -webkit-app-region: drag;
  --wails-draggable: drag;
}

.toolbar-title {
  position: absolute; left: 50%; transform: translateX(-50%);
  color: var(--muted);
  font-size: var(--text-sm);
  letter-spacing: var(--tracking-small);
  max-width: 40%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  pointer-events: none;
}

.main { display: flex; flex: 1; min-height: 0; }

/* ---- 侧栏：无线框树，纯底色分层 ---- */
.sidebar {
  width: var(--sidebar-width); flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
}
.sidebar-title {
  padding: var(--space-3) var(--space-4) var(--space-2);
  font-weight: var(--weight-emphasize);
  font-size: var(--text-sm);
  color: var(--fg-2);
  border-bottom: 1px solid var(--border-soft);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ---- 侧栏双 tab（文件 / 大纲）：文字标签，零新增图标（交互 Spec 3.1 / 5） ---- */
.sidebar-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-soft);
}
.sidebar-tab {
  flex: 1;
  min-height: 44px; /* 触控目标约束（交互 Spec 5） */
  background: none;
  border: none;
  font: inherit;
  font-size: var(--text-sm);
  letter-spacing: var(--tracking-small);
  color: var(--muted);
  cursor: pointer;
}
/* 激活态只用字重与颜色区分，不占 --accent 预算（每屏 accent ≤ 2 处） */
.sidebar-tab.active {
  color: var(--fg);
  font-weight: var(--weight-emphasize);
}
.sidebar-tab:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring);
}
.sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 文件 tab 空态（Empty 态，DESIGN §8）：引导文案 + CTA */
.sidebar-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4);
  text-align: center;
  color: var(--meta);
  font-size: var(--text-sm);
}
.sidebar-empty p { margin: 0; }
.sidebar-cta {
  min-height: 44px;
  padding: 0 var(--space-4);
  background: var(--surface-2);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.sidebar-cta:hover { background: var(--accent-soft); border-color: var(--border-strong); }
.sidebar-cta:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* ---- 专注模式一次性提示 / 结果提示（--surface 底 + --meta 字，交互 Spec 2.2） ---- */
.focus-toast {
  position: fixed;
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  max-width: min(80vw, 560px);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  color: var(--meta);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  box-shadow: var(--elev-raised);
  font-size: var(--text-sm);
  pointer-events: none;
  z-index: 1300; /* Token z-index 阶梯：toast 层（DESIGN §6） */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-toast.is-err { color: var(--danger); border-color: var(--danger); }

/* ---- 输入对话框 / 快捷键速查（--surface 底、Token 化描边，z-index 高于 toast） ---- */
.dialog-mask {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--fg) 18%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1400; /* 高于 toast 层 1300（DESIGN §6 阶梯之上加一层） */
}
.dialog {
  width: min(360px, 86vw);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-raised);
  padding: var(--space-6) var(--space-6) var(--space-4);
}
.dialog-wide { width: min(480px, 92vw); }
.dialog-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}
.dialog-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 36px;
  padding: 0 var(--space-3);
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
}
.dialog-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
.dialog-btn {
  min-height: 32px;
  padding: 0 var(--space-4);
  background: var(--surface-2);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.dialog-btn:hover { background: var(--accent-soft); border-color: var(--border-strong); }
.dialog-btn.primary { background: var(--accent); color: var(--accent-on); border-color: var(--accent); }
.dialog-btn.primary:hover { filter: brightness(1.05); }
.dialog-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.shortcut-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.shortcut-table td { padding: 6px 0; border-bottom: 1px solid var(--border-soft); }
.shortcut-table tr:last-child td { border-bottom: none; }
.shortcut-keys {
  width: 42%;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
}
.shortcut-desc { color: var(--fg-2); }

/* ---- 分栏：编辑区宽度可拖，预览区吃剩余空间 ---- */
.pane { min-width: 0; overflow: hidden; }
.editor-pane { width: 50%; flex: none; display: flex; flex-direction: column; }
.preview-pane { flex: 1; overflow-y: auto; background: var(--bg); }

.divider {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
  touch-action: none;
  --wails-draggable: no-drag;
}
.divider::after {
  content: '';
  position: absolute; top: 0; bottom: 0; left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border);
  transition: background-color var(--motion-fast) var(--ease-standard),
              width var(--motion-fast) var(--ease-standard);
}
/* 激活态用组件内的 class，不用 :global 后代选择器（见模板注释） */
.divider:hover::after,
.divider.active::after {
  width: 2px;
  background: var(--accent);
}

/* 工具条占编辑区顶部，编辑器吃剩余高度 */
.editor-host { flex: 1; min-height: 0; }

/* ---- 缩放：正文随 --zoom-scale 缩放（编辑器侧在 createEditor.js Compartment） ---- */
.preview-body {
  font-size: calc(var(--text-md) * var(--zoom-scale, 1));
}

/* ---- 阅读模式（第 4 视图态）：预览独占，正文加宽 + 字号放大 + 行距放宽 ----
   过渡仅 220ms 平滑（视觉规格 §4.3），reduced-motion 下 Token 已归 1ms。 */
.app.reading .preview-body {
  max-width: var(--reading-measure);
  font-size: calc(var(--reading-font-size) * var(--zoom-scale, 1));
  line-height: var(--reading-leading);
  transition:
    max-width 220ms var(--ease-standard),
    font-size 220ms var(--ease-standard),
    line-height 220ms var(--ease-standard);
}

/* PDF 打印：只输出预览区，并放开限宽。
   四态后预览区在编辑态是 v-show 的内联 display:none，样式表必须用 !important
   才能覆盖内联样式——否则编辑态导出 PDF 是空白页（硬验收项）。
   预览 DOM（v-html）四态下始终渲染，打印内容总是存在。
   状态栏 / 历史面板同属 chrome，打印一律隐藏。 */
@media print {
  .toolbar, .sidebar, .editor-pane, .divider, .focus-toast,
  .statusbar, .history-panel, .dialog-mask { display: none !important; }
  .preview-pane {
    display: block !important;
    width: 100% !important;
    overflow: visible;
  }
  .preview-body { max-width: none; margin: 0; padding: 0; font-size: var(--text-md); }
}
</style>

<!-- 非 scoped：这几条挂在 body 上，必须放全局。
     千万别写成 scoped 里的 :global(body.splitting) .pane —— Vue scoped 编译器会把它
     拍平成 body.splitting，导致 body 被涂成强调色、宽度 2px、整窗不可交互。 -->
<style>
body.splitting {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}
body.splitting .pane {
  pointer-events: none;
}
</style>
