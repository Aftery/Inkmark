<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { createEditor } from './editor/createEditor'
import { extractOutline } from './editor/outline'
import { createRenderer, render } from './preview/markdown'
import { buildHtmlDocument } from './export/exporters'
import FileTree from './components/FileTree.vue'
import Outline from './components/Outline.vue'
import {
  OpenFileDialog, OpenDirectoryDialog, SaveFileDialog,
  ReadFile, WriteFile,
} from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'
import './themes/index.css'

// ---------- 状态 ----------
const markdown = ref('')
const filePath = ref('')
const folderPath = ref('')
const dirty = ref(false)
const theme = ref(document.documentElement.dataset.theme || 'light') // 导出 HTML 要用

const renderer = createRenderer()
const previewHtml = computed(() => render(renderer, markdown.value))
const title = computed(() => filePath.value ? filePath.value.split('/').pop() : '未命名')

const DEFAULT_DOC = `# Inkmark

一个安静的 **Markdown** 写作工具：左边写，右边看。

所有操作都在系统菜单栏里：**文件**菜单可以打开、保存、导出（Windows / Linux 在窗口顶部）。

## 它能做什么

- 打开单个文件，或整个文件夹（左侧文件树直接点选）
- 编辑与预览实时渲染，滚动双向联动
- 明暗两套主题，菜单里一键切换（⌘⇧L）
- 导出 HTML，或走系统打印对话框存成 PDF
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

| 快捷键 | 作用 |
| --- | --- |
| ⌘O | 打开文件 |
| ⌘⇧O | 打开文件夹 |
| ⌘S | 保存 |
| ⌘1 / ⌘2 / ⌘3 | 编辑 / 预览 / 双栏 |
| ⌘⇧F | 专注模式（Esc 退出） |
| ⌘B | 显示 / 隐藏大纲 |
| ⌘⇧L | 切换主题 |
`

// ---------- 编辑器 ----------
const editorEl = ref(null)
const previewEl = ref(null)
let editor = null
let syncingScroll = false

function onDocChange(doc) {
  markdown.value = doc
  dirty.value = true
  // 预览 DOM 要到 nextTick 才更新完，那时才能重建标题锚点；大纲同机更新
  nextTick(() => {
    invalidateAnchors()
    outline.value = extractOutline(editor.state.doc)
    scheduleOutlineSync()
  })
}

// 滚动联动（双向）：标题锚点映射 + 互斥锁防循环。
// 原理：收集两栏中每个标题的「文档坐标 y」（首尾补上 0 和最大滚动位），
// 得到两条一一对应的锚点序列；滚动时先定位当前所处的标题区间，
// 再把区间内的偏移线性插值到对侧 —— 标题对标题对齐，比整体比例映射准确得多。
// 回退：两边锚点数不等（setext 下划线标题扫不到、渲染时差）时退回整体比例映射。
// 静默失效的两个前提仍须守住：
//   1) 监听必须挂在真正滚动的元素上 —— 编辑区是 editor.scrollDOM，
//      预览区是 .preview-pane（.preview-body 不滚动，且 scroll 事件不冒泡）
//   2) 锚点必须在文档/布局变化后重建（anchorsDirty），否则映射错位：
//      文档变化 → onDocChange 的 nextTick；分栏拖动 → onDividerMove；
//      窗口尺寸 → resize 监听
let anchorsCache = null
let anchorsDirty = true
const HEADING_SEL = '.preview-body h1,.preview-body h2,.preview-body h3,.preview-body h4,.preview-body h5,.preview-body h6'

function invalidateAnchors() {
  anchorsDirty = true
  outlineYsDirty = true // 大纲当前节高亮的 y 缓存同点失效
}

// 编辑器侧锚点：扫描标题行的行首位置并转成文档坐标 y。
// 围栏代码块（``` / ~~~）内的 # 不算标题，用简单的开关状态机跳过。
function collectEditorAnchors() {
  const doc = editor.state.doc
  const scroll = editor.scrollDOM
  const base = scroll.getBoundingClientRect().top - scroll.scrollTop
  const ys = [0]
  let inCode = false
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text.trim()
    if (text.startsWith('```') || text.startsWith('~~~')) inCode = !inCode
    if (!inCode && /^#{1,6}\s/.test(line.text)) {
      const c = editor.coordsAtPos(line.from)
      if (c) ys.push(c.top - base)
    }
  }
  // 尾锚点必须 >= 最后一个标题 y，否则序列可能非递增（末尾标题贴底时）
  ys.push(Math.max(ys[ys.length - 1], scroll.scrollHeight - scroll.clientHeight))
  return ys
}

// 预览侧锚点：querySelectorAll 天然按 DOM 顺序返回，与编辑器侧行序一致
function collectPreviewAnchors() {
  const pane = previewEl.value
  if (!pane) return null
  const base = pane.getBoundingClientRect().top - pane.scrollTop
  const ys = [0]
  for (const h of pane.querySelectorAll(HEADING_SEL)) {
    ys.push(h.getBoundingClientRect().top - base)
  }
  ys.push(Math.max(ys[ys.length - 1], pane.scrollHeight - pane.clientHeight))
  return ys
}

// 惰性重建：首次滚动/锚点失效后的第一次滚动事件才收集（一次性 layout 开销）
function getAnchors() {
  if (anchorsDirty || !anchorsCache) {
    anchorsDirty = false
    anchorsCache = null
    // 锚点收集依赖两栏可见且度量有效（coordsAtPos / DOM 位置）：
    // 编辑/预览单栏态下另一侧 display:none，度量全是废值，直接拒绝收集
    if (viewMode.value === 'split' && editor && previewEl.value) {
      const ed = collectEditorAnchors()
      const pv = collectPreviewAnchors()
      if (pv && ed.length === pv.length) anchorsCache = { ed, pv }
    }
  }
  return anchorsCache
}

// 在 src 锚点序列中定位 srcTop 所处区间，线性插值到 dst 对应区间
function mapByAnchors(srcTop, src, dst) {
  const last = src.length - 1
  const t = Math.min(Math.max(srcTop, 0), src[last])
  let i = 1
  while (i < last && src[i] < t) i++
  const s0 = src[i - 1], s1 = src[i]
  if (s1 <= s0) return dst[i]
  return dst[i - 1] + ((t - s0) / (s1 - s0)) * (dst[i] - dst[i - 1])
}

// 联动写入记录：识别「联动引发的回声滚动」，断掉 编辑→预览→编辑 的放大循环。
// 为什么 rAF 互斥锁不够：scroll 事件的派发晚于 rAF 回调（锁已释放）。
// 正常位置锚点映射可逆（来回映射值相同、不触发事件、自然收敛），所以平时没事；
// 但拖到底部时 CM6 的高度估计随实测逐步修正，锚点序列与真实高度短暂不符，
// 映射不再可逆，每轮循环把对侧往上拉一点、修正量递减 —— 表现为「页面自己慢慢往上滑」。
// 解法：联动写入前把目标 clamp 到对侧真实 maxScroll，并记录写入值；
// 事件到达时 scrollTop ≈ 写入值即为本方写入的回声，直接忽略。
let lastSyncWrite = null // { el, value }

function isSyncEcho(el) {
  if (!lastSyncWrite || lastSyncWrite.el !== el) return false
  const echo = Math.abs(el.scrollTop - lastSyncWrite.value) <= 1
  lastSyncWrite = null
  return echo
}

function onEditorScroll() {
  scheduleOutlineSync() // 滚动驱动大纲当前节高亮（rAF 节流）
  // 单栏态守卫（交互 Spec §1.4）：对侧 display:none，联动无意义
  if (viewMode.value !== 'split' || syncingScroll || !editor || !previewEl.value) return
  const cm = editor.scrollDOM
  if (isSyncEcho(cm)) return // 本方写入引发的回声，不反向联动
  syncingScroll = true
  const pane = previewEl.value
  const a = getAnchors()
  const pvMax = pane.scrollHeight - pane.clientHeight
  const target = a
    ? mapByAnchors(cm.scrollTop, a.ed, a.pv)
    : (cm.scrollTop / Math.max(1, cm.scrollHeight - cm.clientHeight)) * pvMax
  // clamp 到真实可达值：写入被钳制会让「写入值 ≠ 实际值」，回声识别失效
  lastSyncWrite = { el: pane, value: Math.max(0, Math.min(target, pvMax)) }
  pane.scrollTop = lastSyncWrite.value
  requestAnimationFrame(() => (syncingScroll = false))
}

function onPreviewScroll() {
  scheduleOutlineSync() // 预览态下以预览滚动驱动高亮
  if (viewMode.value !== 'split' || syncingScroll || !editor || !previewEl.value) return
  const pane = previewEl.value
  if (isSyncEcho(pane)) return
  syncingScroll = true
  const cm = editor.scrollDOM
  const a = getAnchors()
  const edMax = cm.scrollHeight - cm.clientHeight
  const target = a
    ? mapByAnchors(pane.scrollTop, a.pv, a.ed)
    : (pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight)) * edMax
  lastSyncWrite = { el: cm, value: Math.max(0, Math.min(target, edMax)) }
  cm.scrollTop = lastSyncWrite.value
  requestAnimationFrame(() => (syncingScroll = false))
}

onMounted(() => {
  editor = createEditor(editorEl.value, {
    doc: DEFAULT_DOC,
    onDocChange,
    onScroll: onEditorScroll,
  })
  markdown.value = DEFAULT_DOC
  outline.value = extractOutline(editor.state.doc)
  // 持久化的非双栏态必须延后应用：编辑器一律在可见状态下创建（CM6 在
  // display:none 里创建会把离屏块高度测成 0，恢复后长文档滚动高度全错）。
  // 延后一帧再切走，等首帧度量完成。
  const savedMode = localStorage.getItem('inkmark-view-mode')
  if (savedMode === 'edit' || savedMode === 'preview') {
    requestAnimationFrame(() => setViewMode(savedMode, { persist: false }))
  }
})

// 窗口尺寸变化会重排两栏，锚点 y 全部失效
window.addEventListener('resize', invalidateAnchors)
window.addEventListener('keydown', onGlobalKeydown)
onBeforeUnmount(() => {
  window.removeEventListener('resize', invalidateAnchors)
  window.removeEventListener('keydown', onGlobalKeydown)
  editor?.destroy()
})

// ---------- 视图三态（编辑 / 预览 / 双栏） ----------
// 三态一律 v-show 保 DOM 存活：CM6 实例、预览 DOM、锚点缓存都不销毁重建。
// CM6 隐藏坑：display:none 期间度量全部失真，恢复可见必须 requestMeasure 重测。
const viewMode = ref('split') // 'edit' | 'preview' | 'split'

function setViewMode(mode, { persist = true } = {}) {
  viewMode.value = mode
  if (persist) localStorage.setItem('inkmark-view-mode', mode)
  // 编辑器恢复可见的所有切换（split/edit，含专注模式从预览态切入）都要重测：
  // display:none 期间度量失真，等 Vue 把样式落盘后 requestMeasure 一次。
  // 锚点失效只跟双栏态有关（锚点仅在双栏收集/使用）。
  if (mode !== 'preview') {
    nextTick(() => {
      editor?.requestMeasure()
      if (mode === 'split') invalidateAnchors()
    })
  }
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

// Esc 退出专注（Esc 不在菜单 accelerator 里，无「菜单先消费按键」冲突）
function onGlobalKeydown(e) {
  if (e.key === 'Escape' && !e.isComposing && focusOn.value) toggleFocus()
}

// ---------- 侧栏：常驻双 tab（文件 / 大纲） ----------
// 侧栏从「打开文件夹才出现」改为可随时开关（交互 Spec 3.1）；
// 可见性不持久化：默认收起，打开文件夹自动展开。
const sidebarOpen = ref(false)
const sidebarTab = ref('files') // 'files' | 'outline'
const outline = ref([])
const outlineActive = ref(-1) // 当前节在大纲里的下标，-1 = 首个标题之前

// ---- 当前节高亮（交互 Spec 3.2/3.4）----
// 数据驱动：编辑/双栏态用编辑器滚动位置、预览态用预览滚动位置，
// 在标题 y 序列（collectEditor/PreviewAnchors，首尾带哨兵）里反查
// 「视口顶部所处标题区间」。标题 y 依赖当前视图态下的实际布局（单栏全宽与
// 双栏分宽不同），所以缓存按视图态分别有效；失效点与锚点缓存共用
// invalidateAnchors（不能用 anchorsDirty 本身——它在编辑态无人重置，
// 会让高亮缓存每帧重算全文档扫描）。
let outlineYsCache = null // { mode, ys }
let outlineYsDirty = true
let outlineSyncQueued = false

function getOutlineYs() {
  const mode = viewMode.value
  if (outlineYsDirty || !outlineYsCache || outlineYsCache.mode !== mode) {
    outlineYsCache = null
    if (mode === 'preview') {
      const pv = collectPreviewAnchors() // 预览态预览区可见，度量有效
      if (pv) outlineYsCache = { mode, ys: pv }
    } else if (editor) {
      // 编辑/双栏态编辑器可见，coordsAtPos 有效（预览隐藏不影响编辑器侧）
      outlineYsCache = { mode, ys: collectEditorAnchors() }
    }
    outlineYsDirty = false
  }
  return outlineYsCache ? outlineYsCache.ys : null
}

// ys = [0, y1..yn, tail]：返回视口顶部所处区间的标题下标（0 基），首个标题之前为 -1
function headingIndexAt(ys, top) {
  let i = ys.length - 1
  while (i > 0 && ys[i] > top) i--
  return i - 1
}

// 滚动事件高频触发，反查用 requestAnimationFrame 节流（与互斥锁同量级）
function scheduleOutlineSync() {
  if (outlineSyncQueued || !sidebarOpen.value) return
  outlineSyncQueued = true
  requestAnimationFrame(() => {
    outlineSyncQueued = false
    updateOutlineHighlight()
  })
}

function updateOutlineHighlight() {
  if (!sidebarOpen.value || !outline.value.length) return
  const ys = getOutlineYs()
  if (!ys) return // 两侧都不可用的极端态：不高亮
  const top =
    viewMode.value === 'preview'
      ? (previewEl.value?.scrollTop ?? 0)
      : (editor?.scrollDOM.scrollTop ?? 0)
  const index = headingIndexAt(ys, top)
  if (index !== outlineActive.value) outlineActive.value = index
}

function showSidebarTab(tab) {
  sidebarTab.value = tab
}

function toggleOutline() {
  sidebarOpen.value = !sidebarOpen.value
  if (sidebarOpen.value) {
    sidebarTab.value = 'outline'
    scheduleOutlineSync() // 打开面板立即算一次当前节
  }
  // 侧栏开合改变 .main 可用宽度，两栏重排，锚点 y 全部失效
  invalidateAnchors()
}

// 大纲点击跳转：按视图态分流。
// 预览态编辑器隐藏，scrollIntoView 无效，走预览 DOM 按序号跳；
// 编辑/双栏态用编辑器 dispatch（scrollIntoView 让 CM6 保证目标行进视口）。
function jumpToHeading(item, index) {
  if (viewMode.value === 'preview') {
    const headings = previewEl.value?.querySelectorAll(HEADING_SEL)
    // 编辑器与预览的标题数可能不等（setext 下划线标题扫不到），
    // 数量对不上就静默放弃——错误跳转比不跳更糟
    if (headings && headings.length === outline.value.length) {
      headings[index].scrollIntoView({ block: 'start' })
    }
    return
  }
  editor.dispatch({
    selection: { anchor: item.pos },
    scrollIntoView: true,
  })
  editor.focus()
}

// ---------- 文件操作 ----------

async function openFile() {
  const path = await OpenFileDialog()
  if (!path) return
  const content = await ReadFile(path)
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
  filePath.value = path
  dirty.value = false
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
  const content = await ReadFile(path)
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
  filePath.value = path
  dirty.value = false
}

async function saveFile() {
  let path = filePath.value
  if (!path) return saveFileAs()
  await WriteFile(path, editor.state.doc.toString())
  dirty.value = false
}

async function saveFileAs() {
  let path = await SaveFileDialog(title.value.endsWith('.md') ? title.value : '未命名.md')
  if (!path) return
  if (!path.endsWith('.md')) path += '.md'
  await WriteFile(path, editor.state.doc.toString())
  filePath.value = path
  dirty.value = false
}

async function exportHtml() {
  const path = await SaveFileDialog(`${title.value.replace(/\.md$/, '')}.html`)
  if (!path) return
  const html = buildHtmlDocument(title.value, previewHtml.value, theme.value)
  await WriteFile(path.endsWith('.html') ? path : path + '.html', html)
}

// PDF：走系统打印对话框（可存 PDF）
function exportPdf() {
  window.print()
}

// ---------- 主题 ----------

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('inkmark-theme', theme.value)
}

// ---------- 原生菜单事件（main.go 的 buildMenu 发出） ----------
// 快捷键由菜单 accelerator 承担（⌘O/⌘S/⌘⇧L…），菜单会先于 WebView 消费按键，
// 因此前端不再单独监听 keydown，避免同一次按键触发两次。
// EventsOn 依赖 Wails 桌面端注入的 window.runtime —— 纯浏览器预览（npm run dev）
// 里它是 undefined，会炸掉 setup 整页白屏。守卫后浏览器跳过菜单事件绑定，
// UI 照常可预览；桌面端不受影响。
function safeEventsOn(name, handler) {
  if (window.runtime?.EventsOnMultiple) EventsOn(name, handler)
}
safeEventsOn('menu:open-file', openFile)
safeEventsOn('menu:open-folder', openFolder)
safeEventsOn('menu:save', saveFile)
safeEventsOn('menu:save-as', saveFileAs)
safeEventsOn('menu:export-html', exportHtml)
safeEventsOn('menu:export-pdf', exportPdf)
safeEventsOn('menu:toggle-theme', toggleTheme)
safeEventsOn('menu:view-edit', () => setViewMode('edit'))
safeEventsOn('menu:view-preview', () => setViewMode('preview'))
safeEventsOn('menu:view-split', () => setViewMode('split'))
safeEventsOn('menu:toggle-focus', toggleFocus)
safeEventsOn('menu:toggle-outline', toggleOutline)

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
  anchorsDirty = true // 宽度变化会重排两栏，标题锚点 y 全部失效
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
</script>

<template>
  <div class="app">
    <!-- 顶栏：macOS 隐藏式标题栏，左侧留红绿灯安全区；操作全部收进系统菜单栏。
         背景与页面同色、无分隔线，整条都是窗口拖拽区（Wails 用 --wails-draggable）。
         专注模式下整条隐藏，把 44px 让给内容（红绿灯为系统绘制，不受影响）。 -->
    <header v-show="!focusOn" class="toolbar">
      <div class="toolbar-title" :title="title">{{ title }}{{ dirty ? ' •' : '' }}</div>
    </header>

    <div class="main" ref="mainEl">
      <!-- 侧栏：常驻双 tab（文件 / 大纲）。未开文件夹时文件 tab 显示空态引导；
           大纲 tab 与文件夹无关、始终可用。专注模式下整栏隐藏。 -->
      <aside
        v-show="sidebarOpen && !focusOn"
        ref="sidebarEl"
        class="sidebar"
        :inert="!sidebarOpen || focusOn"
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
          <Outline :items="outline" :active-index="outlineActive" @jump="jumpToHeading" />
        </div>
      </aside>

      <!-- 编辑区：三态 v-show 保 CM6 实例存活；隐藏侧用 inert 阻止焦点进入 -->
      <section
        v-show="viewMode !== 'preview'"
        class="pane editor-pane"
        :inert="viewMode === 'preview'"
        :style="{ width: viewMode === 'split' ? editorWidth + '%' : '100%' }"
      >
        <div ref="editorEl" class="editor-host"></div>
      </section>

      <!-- 分割条：拖动调宽，双击复位。仅双栏态存在。
           激活态用组件自己的 class（.active），不要用 :global(body.splitting) 后代选择器
           —— Vue scoped 编译器会把「:global(前缀) 后代」错误拍平成前缀本身，
           声明会落到 body 上（曾导致 body 被涂成强调色、宽度 2px、整窗不可交互）。 -->
      <div
        class="divider"
        :class="{ active: splitting }"
        role="separator"
        aria-orientation="vertical"
        title="拖动调整宽度，双击复位"
        @pointerdown="onDividerDown"
        @pointermove="onDividerMove"
        @pointerup="onDividerUp"
        @pointercancel="onDividerUp"
        @dblclick="resetSplit"
      ></div>

      <!-- 预览区：滚动事件必须绑在真正滚动的元素上（.preview-body 不滚动）。
           隐藏时保留 DOM（滚动位/渲染结果不丢），inert 阻止焦点进入。
           v-html 始终渲染：编辑态导出 PDF 也依赖这份 DOM（见 @media print）。 -->
      <section
        v-show="viewMode !== 'edit'"
        class="pane preview-pane"
        ref="previewEl"
        :inert="viewMode === 'edit'"
        @scroll="onPreviewScroll"
      >
        <div class="preview-body" v-html="previewHtml"></div>
      </section>
    </div>

    <!-- 专注模式首次进入的一次性提示 -->
    <div v-show="focusToast" class="focus-toast" role="status">已进入专注模式，Esc 退出</div>
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

/* ---- 专注模式一次性提示（--surface 底 + --meta 字，交互 Spec 2.2） ---- */
.focus-toast {
  position: fixed;
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  color: var(--meta);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  box-shadow: var(--elev-raised);
  font-size: var(--text-sm);
  pointer-events: none;
  z-index: 1300; /* Token z-index 阶梯：toast 层（DESIGN §6） */
}

/* ---- 分栏：编辑区宽度可拖，预览区吃剩余空间 ---- */
.pane { min-width: 0; overflow: hidden; }
.editor-pane { width: 50%; flex: none; }
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

.editor-host { height: 100%; }

/* PDF 打印：只输出预览区，并放开限宽。
   三态后预览区在编辑态是 v-show 的内联 display:none，样式表必须用 !important
   才能覆盖内联样式——否则编辑态导出 PDF 是空白页（硬验收项）。
   预览 DOM（v-html）三态下始终渲染，打印内容总是存在。 */
@media print {
  .toolbar, .sidebar, .editor-pane, .divider, .focus-toast { display: none !important; }
  .preview-pane {
    display: block !important;
    width: 100% !important;
    overflow: visible;
  }
  .preview-body { max-width: none; margin: 0; padding: 0; }
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
