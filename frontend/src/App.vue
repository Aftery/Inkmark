<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick, triggerRef } from 'vue'
import { createEditor, setEditorZoom } from './editor/createEditor'
import { extractOutline } from './editor/outline'
import {
  toggleBold, toggleItalic, toggleStrike, toggleInlineCode,
  toggleLink, insertImage, toggleHeading,
  toggleBulletList, toggleOrderedList, toggleTaskList, toggleBlockquote,
  toggleCodeBlock, insertTable, insertHr, activeFormats,
} from './editor/commands'
import { undo, redo } from '@codemirror/commands'
import { createRenderer, render } from './preview/markdown'
import FileTree from './components/FileTree.vue'
import Outline from './components/Outline.vue'
import Toolbar from './components/Toolbar.vue'
import StatusBar from './components/StatusBar.vue'
import HistoryPanel from './components/HistoryPanel.vue'
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
| ⌘1 / ⌘2 / ⌘3 / ⌘4 | 编辑 / 预览 / 双栏 / 阅读 |
| ⌘⇧F | 专注模式（Esc 退出） |
| ⌘B | 显示 / 隐藏大纲 |
| ⌘⇧L | 切换主题 |
`

// ---------- 编辑器 ----------
const editorEl = ref(null)
const previewEl = ref(null)
let editor = null

// 状态栏数据源
const caret = ref({ line: 1, col: 1 })
const activeFmt = ref({})
const ZOOM_LEVELS = [90, 100, 110, 125]
const zoom = ref(100)

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
})
const { saveState, dirty, showHistory, snapshots, historyLoading } = persistence

// ---------- 侧栏：常驻双 tab（文件 / 大纲） ----------
// 侧栏从「打开文件夹才出现」改为可随时开关（交互 Spec 3.1）；
// 可见性不持久化：默认收起，打开文件夹自动展开。
const sidebarOpen = ref(false)
const sidebarTab = ref('files') // 'files' | 'outline'
const outline = ref([])

// 视图四态：'edit' | 'preview' | 'split' | 'reading'（函数见下方「视图四态」节；
// 声明须在 useOutlineSync 之前，其依赖注入引用本 ref）
const viewMode = ref('split')
let modeBeforeReading = null

// ---------- 滚动双向联动 + 大纲当前节高亮（composables/useOutlineSync） ----------
const sync = useOutlineSync({ getEditor: () => editor, previewEl, viewMode, sidebarOpen, outline })
const { outlineActive } = sync

function onDocChange(doc) {
  // 诊断（预览不同步排查）：确认链路是否触发、值是否变化。定位后移除。
  console.log('[onDocChange] len=', doc.length, 'changed=', doc !== markdown.value)
  markdown.value = doc
  triggerRef(markdown) // 防御性：强制依赖 markdown 的 computed（previewHtml）重算
  persistence.markDirty()
  persistence.maybeSnapshot() // 「有效编辑会话」节流快照（≥3 分钟，AC-14 与自动保存解耦）
  // 预览 DOM 要到 nextTick 才更新完，那时才能重建标题锚点；大纲同机更新
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
})

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

// Esc 退出专注 / 阅读 / 历史面板（Esc 不在菜单 accelerator 里，无「菜单先消费按键」冲突）
function onGlobalKeydown(e) {
  if (e.key !== 'Escape' || e.isComposing) return
  if (focusOn.value) toggleFocus()
  else if (persistence.showHistory.value) persistence.showHistory.value = false
  else if (viewMode.value === 'reading') exitReading()
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

async function openFile() {
  const path = await OpenFileDialog()
  if (!path) return
  await persistence.snapshotBoundary() // 破坏性边界前先留一份快照
  const content = await ReadFile(path)
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
  filePath.value = path
  persistence.resetSession()
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
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
  filePath.value = path
  persistence.resetSession()
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

// ---------- 缩放（状态栏，90/100/110/125% 循环） ----------

function cycleZoom() {
  const i = ZOOM_LEVELS.indexOf(zoom.value)
  const next = ZOOM_LEVELS[(i + 1) % ZOOM_LEVELS.length]
  zoom.value = next
  if (editor) setEditorZoom(editor, next / 100)
}

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
safeEventsOn('menu:export-html', persistence.exportHtml)
safeEventsOn('menu:export-pdf', persistence.exportPdf)
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
            <FileTree :root="folderPath" @select="openTreeFile" />
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

    <!-- 一次性 / 结果提示（专注模式首次进入、导出结果、快照反馈） -->
    <div v-show="focusToast" class="focus-toast" role="status">已进入专注模式，Esc 退出</div>
    <div v-show="toast.show" class="focus-toast" :class="{ 'is-err': toast.isErr }" role="status">
      {{ toast.msg }}
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
  .statusbar, .history-panel { display: none !important; }
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
