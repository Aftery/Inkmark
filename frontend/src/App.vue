<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { createEditor } from './editor/createEditor'
import { createRenderer, render } from './preview/markdown'
import { buildHtmlDocument } from './export/exporters'
import FileTree from './components/FileTree.vue'
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
  // 预览 DOM 要到 nextTick 才更新完，那时才能重建标题锚点
  nextTick(() => invalidateAnchors())
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
    if (editor && previewEl.value) {
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

function onEditorScroll(top) {
  if (syncingScroll || !editor || !previewEl.value) return
  syncingScroll = true
  const pane = previewEl.value
  const a = getAnchors()
  if (a) {
    pane.scrollTop = mapByAnchors(top, a.ed, a.pv)
  } else {
    const cm = editor.scrollDOM
    const ratio = top / Math.max(1, cm.scrollHeight - cm.clientHeight)
    pane.scrollTop = ratio * (pane.scrollHeight - pane.clientHeight)
  }
  requestAnimationFrame(() => (syncingScroll = false))
}

function onPreviewScroll() {
  if (syncingScroll || !editor || !previewEl.value) return
  syncingScroll = true
  const pane = previewEl.value
  const cm = editor.scrollDOM
  const a = getAnchors()
  if (a) {
    cm.scrollTop = mapByAnchors(pane.scrollTop, a.pv, a.ed)
  } else {
    const ratio = pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight)
    cm.scrollTop = ratio * (cm.scrollHeight - cm.clientHeight)
  }
  requestAnimationFrame(() => (syncingScroll = false))
}

onMounted(() => {
  editor = createEditor(editorEl.value, {
    doc: DEFAULT_DOC,
    onDocChange,
    onScroll: onEditorScroll,
  })
  markdown.value = DEFAULT_DOC
})

// 窗口尺寸变化会重排两栏，锚点 y 全部失效
window.addEventListener('resize', invalidateAnchors)
onBeforeUnmount(() => {
  window.removeEventListener('resize', invalidateAnchors)
  editor?.destroy()
})

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
EventsOn('menu:open-file', openFile)
EventsOn('menu:open-folder', openFolder)
EventsOn('menu:save', saveFile)
EventsOn('menu:save-as', saveFileAs)
EventsOn('menu:export-html', exportHtml)
EventsOn('menu:export-pdf', exportPdf)
EventsOn('menu:toggle-theme', toggleTheme)

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
         背景与页面同色、无分隔线，整条都是窗口拖拽区（Wails 用 --wails-draggable）。 -->
    <header class="toolbar">
      <div class="toolbar-title" :title="title">{{ title }}{{ dirty ? ' •' : '' }}</div>
    </header>

    <div class="main" ref="mainEl">
      <!-- 文件树侧栏 -->
      <aside v-if="folderPath" ref="sidebarEl" class="sidebar">
        <div class="sidebar-title" :title="folderPath">{{ folderPath.split('/').pop() }}</div>
        <FileTree :root="folderPath" @select="openTreeFile" />
      </aside>

      <!-- 编辑区 -->
      <section class="pane editor-pane" :style="{ width: editorWidth + '%' }">
        <div ref="editorEl" class="editor-host"></div>
      </section>

      <!-- 分割条：拖动调宽，双击复位。
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

      <!-- 预览区：滚动事件必须绑在真正滚动的元素上（.preview-body 不滚动） -->
      <section class="pane preview-pane" ref="previewEl" @scroll="onPreviewScroll">
        <div class="preview-body" v-html="previewHtml"></div>
      </section>
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

/* PDF 打印：只输出预览区，并放开限宽 */
@media print {
  .toolbar, .sidebar, .editor-pane, .divider { display: none; }
  .preview-pane { overflow: visible; }
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
