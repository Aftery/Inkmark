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
import './themes/preview.css'

// ---------- 状态 ----------
const markdown = ref('')
const filePath = ref('')
const folderPath = ref('')
const dirty = ref(false)
const theme = ref(document.documentElement.dataset.theme || 'light')

const renderer = createRenderer()
const previewHtml = computed(() => render(renderer, markdown.value))
const title = computed(() => filePath.value ? filePath.value.split('/').pop() : '未命名')

const DEFAULT_DOC = `# 欢迎使用 Inkmark 👋

左侧 **编辑**，右侧 **实时预览**。

## 支持的能力

- ✅ Markdown 语法高亮（CodeMirror 6）
- ✅ 预览代码块高亮（highlight.js）
- 🌗 明暗主题切换（右上角）
- 📤 导出 HTML / PDF（打印）
- 📁 打开本地文件夹管理文件

\`\`\`js
function hello(name) {
  console.log(\`你好, \${name}!\`)
}
hello('Inkmark')
\`\`\`

> 编辑器与预览的滚动是联动的。
`

// ---------- 编辑器 ----------
const editorEl = ref(null)
const previewEl = ref(null)
let editor = null
let syncingScroll = false

function onDocChange(doc) {
  markdown.value = doc
  dirty.value = true
}

// 滚动联动：编辑区滚动 → 按相同比例滚动预览区（带互斥锁防止循环）
function onEditorScroll(top, maxScroll) {
  if (syncingScroll || !previewEl.value || maxScroll <= 0) return
  syncingScroll = true
  const el = previewEl.value
  el.scrollTop = (top / maxScroll) * (el.scrollHeight - el.clientHeight)
  requestAnimationFrame(() => (syncingScroll = false))
}

function onPreviewScroll() {
  if (syncingScroll || !editor) return
  syncingScroll = true
  const el = previewEl.value
  const ratio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)
  const cm = editor.scrollDOM
  cm.scrollTop = ratio * (cm.scrollHeight - cm.clientHeight)
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

onBeforeUnmount(() => editor?.destroy())

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
  if (!path) {
    path = await SaveFileDialog('未命名.md')
    if (!path) return
    if (!path.endsWith('.md')) path += '.md'
  }
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

// Cmd/Ctrl+S 保存
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    saveFile()
  }
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <!-- 工具栏（macOS 隐藏式标题栏：留出左侧交通灯区域） -->
    <header class="toolbar">
      <div class="toolbar-group left">
        <button @click="openFile">📂 打开文件</button>
        <button @click="openFolder">🗂 打开文件夹</button>
        <button @click="saveFile">💾 保存</button>
      </div>
      <div class="toolbar-title">{{ title }}{{ dirty ? ' •' : '' }}</div>
      <div class="toolbar-group right">
        <button @click="exportHtml">⬇ HTML</button>
        <button @click="exportPdf">🖨 PDF</button>
        <button class="theme-btn" @click="toggleTheme">
          {{ theme === 'light' ? '🌙' : '☀️' }}
        </button>
      </div>
    </header>

    <div class="main">
      <!-- 文件树侧栏 -->
      <aside v-if="folderPath" class="sidebar">
        <div class="sidebar-title" :title="folderPath">{{ folderPath.split('/').pop() }}</div>
        <FileTree :root="folderPath" @select="openTreeFile" />
      </aside>

      <!-- 编辑区 -->
      <section class="pane editor-pane">
        <div ref="editorEl" class="editor-host"></div>
      </section>

      <!-- 预览区 -->
      <section class="pane preview-pane">
        <div class="preview-body" v-html="previewHtml" @scroll="onPreviewScroll"></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }

.toolbar {
  display: flex; align-items: center; height: 44px;
  padding: 0 12px 0 78px; /* 左侧给 macOS 红绿灯留位 */
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag; /* 工具栏可拖动窗口 */
}
.toolbar button { -webkit-app-region: no-drag; }

.toolbar-group { display: flex; gap: 8px; }
.toolbar-group.right { margin-left: auto; }
.toolbar-title {
  position: absolute; left: 50%; transform: translateX(-50%);
  color: var(--text-secondary); font-size: 13px;
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

button {
  border: 1px solid var(--border); background: var(--bg-primary);
  color: var(--text-primary); border-radius: 6px;
  padding: 5px 10px; font-size: 13px; cursor: pointer;
}
button:hover { background: var(--bg-tertiary); }

.main { display: flex; flex: 1; min-height: 0; }

.sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
}
.sidebar-title {
  padding: 10px 12px 6px; font-weight: 600; font-size: 13px;
  border-bottom: 1px solid var(--border);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.pane { flex: 1; min-width: 0; overflow: hidden; }
.editor-pane { border-right: 1px solid var(--border); }
.editor-host { height: 100%; }
.preview-pane { overflow-y: auto; background: var(--bg-primary); }

/* PDF 打印：只输出预览区 */
@media print {
  .toolbar, .sidebar, .editor-pane { display: none; }
  .preview-pane { overflow: visible; }
  .preview-body { padding: 0; }
}
</style>
