<script setup>
// App.vue — 装配层：声明实例槽、按依赖序装配组合式函数、铺模板。
// 业务一律在 composables/（各文件头注即职责索引）—— 有 ≤150 行门禁钉死。
// 【两条装配契约，勿动】① editorRef 槽位必须先于任何 composable 调用
// （第三类 TDZ，见 tdz-order.test.mjs）② onDocChange / refreshOutline 是
// 函数声明（提升），声明在注入点之后是刻意的。
import { ref, shallowRef } from 'vue'
import { replaceDocument } from './editor/createEditor'
import { extractOutline } from './editor/outline'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import SlashCommand from './components/SlashCommand.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import InputDialog from './components/InputDialog.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import { useToast } from './composables/useToast'
import { usePrefs } from './composables/usePrefs'
import { useWorkspace } from './composables/useWorkspace'
import { useOutline } from './composables/useOutline'
import { useEditorSession } from './composables/useEditorSession'
import { useFileAssets } from './composables/useFileAssets'
import { useDocumentState } from './composables/useDocumentState'
import { useDialog } from './composables/useDialog'
import { useFileOps } from './composables/useFileOps'
import { useCommands } from './composables/useCommands'
import { useShortcutsHelp } from './composables/useShortcutsHelp'
import { emitCommand } from './composables/useShortcuts'
import { OpenFileDialog, OpenDirectoryDialog, ReadFile } from '../wailsjs/go/main/App'
import { t } from './i18n/index.js'
import './themes/index.css'

const editorRef = shallowRef(null) // 编辑器实例槽：useEditorSession 在 onMounted 填入
const getEditor = () => editorRef.value

const prefs = usePrefs(() => editorRef.value)
const { toast, showToast } = useToast()
const workspace = useWorkspace({ getEditor, notify: showToast })
const outline = ref([])
const outlineSync = useOutline({
  getEditor, viewMode: workspace.viewMode, sidebarOpen: workspace.sidebarOpen, outline,
})
// 【顶层解包】Vue 只解包顶层 ref；composables 实例是普通对象，字段读 .value 无响应性
const { outlineActive } = outlineSync, { zoom } = prefs
const session = useEditorSession({
  editorRef, onDocChange, onOutlineRefresh: refreshOutline,
  // 惰性：粘贴 / 拖拽真实发生在 mount 之后，届时 assets 已初始化
  onImageFile: (file) => assets.saveImageFile(file),
  typewriterOn: workspace.typewriterOn, onEditorReady: () => prefs.syncZoomToEditor(),
})
const { editorEl, slashRef, filePath, folderPath, title, caret, wordCount, previewHtml } = session
const { focusOn, focusToast, viewMode, sidebarOpen, sidebarTab, showSidebarTab } = workspace
const assets = useFileAssets({ getFilePath: () => filePath.value, notify: showToast })
const docState = useDocumentState({
  getEditor, filePath, title, previewHtml, theme: prefs.resolvedTheme,
  notify: showToast, onDocReplaced: session.syncAfterDocReplace,
})
const { saveState, dirty, showHistory, snapshots, historyLoading } = docState
const { dialog, askInput, closeDialog } = useDialog()
const fileOps = useFileOps({
  getEditor, replaceDocument, syncAfterDocReplace: session.syncAfterDocReplace,
  filePath, folderPath, title, sidebarOpen, sidebarTab, docState, showToast,
  askInput, ReadFile, OpenFileDialog, OpenDirectoryDialog,
})
const { openFile, openFolder, openTreeFile, treeSignal } = fileOps
if (import.meta.env.DEV) {
  window.__inkmarkOps = { openFile, openTreeFile, newFile: fileOps.newFile, renameFile: fileOps.renameFile }
}
const help = useShortcutsHelp()
const cmds = useCommands({
  getEditor, session, docState, fileOps, workspace, prefs, outlineSync, help,
  dialog, closeDialog, askInput, notify: showToast, slashRef,
})
const { menuGroups, showSettings, closeSettings, showAbout, aboutVersion, closeAbout,
  showShortcuts, shortcutRows } = cmds
const previewEl = ref(null) // 阅读态滚动容器：喂给大纲做阅读态高亮/跳转
outlineSync.setReadingPane(() => previewEl.value)

// 下面两个是**函数声明**（提升），声明刻意晚于注入点：setup 期可安全引用，
// tdz-order.test.mjs 的「函数声明豁免」用例正是覆盖这种写法。
function refreshOutline() {
  if (!editorRef.value) return
  outline.value = extractOutline(editorRef.value.state.doc)
  outlineSync.scheduleOutlineSync()
}
function onDocChange() {
  docState.markDirty() // dirty 唯一含义：内存 ≠ 磁盘（ADR-005）
  docState.maybeSnapshot() // 有效编辑会话节流快照（与自动保存解耦）
}
</script>

<template>
  <div class="app" :class="{ reading: viewMode === 'reading', focus: focusOn }">
    <TitleBar v-show="!focusOn && viewMode !== 'reading'" :filename="title" :is-dirty="dirty"
      :groups="menuGroups" @command="emitCommand" />

    <div class="main">
      <!-- 侧栏：文件 / 大纲 双 tab。专注 / 阅读模式下整栏隐藏。 -->
      <Sidebar v-show="sidebarOpen && !focusOn && viewMode !== 'reading'"
        :inert="!sidebarOpen || focusOn || viewMode === 'reading'"
        :folder-path="folderPath" :reload-signal="treeSignal" :outline="outline"
        :active-index="outlineActive" :tab="sidebarTab"
        @select="openTreeFile" @open-folder="openFolder"
        @jump="outlineSync.jumpToHeading" @tab="showSidebarTab" />

      <!-- 编辑区：单栏居中流式布局 -->
      <section class="pane editor-pane" :inert="viewMode === 'reading'">
        <div ref="editorEl" class="editor-host"></div>
      </section>

      <section v-show="viewMode === 'reading'" ref="previewEl" class="pane preview-pane reading-pane">
        <div class="preview-body" v-html="previewHtml"></div>
      </section>

      <!-- 打印 / 导出用的隐藏预览：始终在 DOM 里，但不占布局（样式见 app-shell.css） -->
      <div v-show="viewMode !== 'reading'" class="export-preview" aria-hidden="true">
        <div class="preview-body" v-html="previewHtml"></div>
      </div>
    </div>

    <StatusBar v-show="!focusOn && viewMode !== 'reading'" :status="saveState"
      :line="caret.line" :col="caret.col" :words="wordCount" :zoom="zoom"
      @zoom="prefs.changeZoom(10)" />

    <SlashCommand ref="slashRef" />
    <HistoryPanel v-if="showHistory" :file-path="filePath" :snapshots="snapshots"
      :loading="historyLoading" @close="showHistory = false"
      @snapshot-now="docState.snapshotNow" @restore="docState.restoreSnapshot" />
    <SettingsPanel v-if="showSettings" @close="closeSettings" />
    <InputDialog :dialog="dialog" @close="closeDialog" />
    <ShortcutsDialog v-if="showShortcuts" :rows="shortcutRows" @close="showShortcuts = false" />
    <AboutDialog v-if="showAbout" :version="aboutVersion" :notify="showToast" @close="closeAbout" />

    <div v-show="focusToast" class="focus-toast" role="status">{{ t('focus.toast') }}</div>
    <div v-show="toast.show" class="focus-toast" :class="{ 'is-err': toast.isErr }" role="status">
      {{ toast.msg }}
    </div>
  </div>
</template>

<style scoped>
/* 打印：只输出 .export-preview 的正文。布局与弹层样式在 themes/app-shell.css；
   各弹层组件另有自己的 @media print（Vue scoped 打不到子组件内部，契约 3 强制两份都在）。 */
@media print {
  .titlebar, .sidebar, .editor-pane, .focus-toast, .statusbar, .history-panel { display: none !important; }
  .export-preview { position: static !important; left: auto !important; width: auto !important; display: block !important; }
}
</style>
