/**
 * useFileOps — 文件打开 / 新建 / 重命名 / 目录
 * ---------------------------------------------------------------------------
 * 从 App.vue 原样抽出，**行为零变更**。所有依赖都由调用方注入，
 * 本模块【不引入】任何新的全局状态或副作用。
 *
 * 【为什么依赖是注入的而不是在这里 import】
 * 这几件事要碰到编辑器实例、文档替换、预览同步、自动保存会话…
 * 那些都是装配层的职责（且单栏重构已把视图收敛为两态，本轮不許再动布局）。
 * 若本模块直接 import 它们，会把装配层反向依赖进来，形成循环依赖，
 * 且任何一方改动都可能悄悄影响对方——在**没有 App.vue 行为测试**的前提下，
 * 这种耦合是净风险。
 *
 * 【时序契约，勿改】
 *   - 每个破坏性边界（打开文件 / 切换树节点 / 新建）之前必须先
 *     `docState.switchFile()`：脏文档先强行快照留底，且快照与自动保存**解耦**，
 *     顺序反了会丢旧稿（此刻旧稿还在编辑器里，错过就永远写不回去）。
 *   - loadDocument 必须走 `replaceDocument`（setState 全量重绘）
 *     而非 dispatch —— 原因见 createEditor.js 中对 CM6 tile 增量崩溃的
 *     说明，那正是「编辑器停在旧文件、预览已是新文件」的成因。
 *   - （原此处有 AddRecent 登记「最近打开」的步骤，随原生菜单下线一并删除：
 *     它的唯一消费方是菜单里的「最近打开」子菜单，前端自绘标题栏不含该列表。）
 *
 * 【i18n】用户可见文案走 i18n 的 t()。本模块不持有语言状态 —— t() 读的是
 * i18n/index.js 的模块级 ref，故切语言后这些文案自动跟着变，无需重新注入。
 */
import { ref, watch } from 'vue'
import { t } from '../i18n/index.js'
export function useFileOps(deps) {
  const {
    // 编辑器与文档
    getEditor, replaceDocument, syncAfterDocReplace,
    // 路径状态（owner 是 useEditorSession —— 文档会话的一部分）
    filePath, folderPath, title,
    // 侧栏（打开文件夹后自动展开文件 tab）
    sidebarOpen, sidebarTab,
    // 文档状态机（保存 / 快照 / 会话边界）
    docState, showToast, askInput,
    // Wails 绑定
    ReadFile, OpenFileDialog, OpenDirectoryDialog,
  } = deps

  // 文件树外部变更信号：watch(folderPath) 的副产物，传给 FileTree 触发重载。
  // 注：Go 侧的 WatchDir 目前未在 app.go 暴露（treeSignal 因此从不自增），
  // 保留它是给后续 fsnotify 接线留位；去掉它 FileTree 的 reload-signal prop 就空了。
  const treeSignal = ref(0)
  watch(folderPath, (p) => {
    try { window.go?.main?.App?.WatchDir?.(p || '') } catch { /* 浏览器预览无绑定 */ }
  })

  /** 打开 / 切换文件的唯一落点：整份替换文档 + 同步全部派生状态。 */
  function loadDocument(content, path) {
    replaceDocument(getEditor(), content)
    syncAfterDocReplace(content)
    filePath.value = path
    docState.resetSession()
  }

  async function openFile() {
    const path = await OpenFileDialog()
    if (!path) return
    await docState.switchFile() // 破坏性边界：脏则先留快照
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
    await docState.switchFile()
    const content = await ReadFile(path)
    loadDocument(content, path)
  }

  async function newFile() {
    await docState.switchFile() // 破坏性边界：脏则先留快照
    loadDocument('', '')
    showToast(t('toast.newFile'))
  }

  async function renameFile() {
    if (!filePath.value) {
      showToast(t('toast.saveBeforeRename'), true)
      return
    }
    const api = window.go?.main?.App
    if (!api?.RenameFile) {
      showToast(t('toast.renameUnsupported'), true)
      return
    }
    const name = await askInput({ title: t('dialog.rename'), value: title.value })
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === title.value) return
    try {
      const newPath = await api.RenameFile(filePath.value, trimmed)
      filePath.value = newPath
      showToast(t('toast.renamed'))
    } catch (err) {
      showToast(t('toast.renameFailed', { error: err?.message || err }), true)
    }
  }

  return { loadDocument, openFile, openFolder, openTreeFile, newFile, renameFile, treeSignal }
}
