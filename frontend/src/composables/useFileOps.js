/**
 * useFileOps — 文件打开 / 新建 / 重命名 / 目录
 * ---------------------------------------------------------------------------
 * 从 App.vue 原样抽出，**行为零变更**。所有依赖都由调用方注入，
 * 本模块【不引入】任何新的全局状态或副作用。
 *
 * 【为什么依赖是注入的而不是在这里 import】
 * 这几件事要碰到编辑器实例、文档替换、预览同步、自动保存会话…
 * 那些都是 App.vue 的编排层职责（且分栏拖拽 / 滚动联动 / 视图四态
 * 本轮明确不许动）。若本模块直接 import 它们，会把编排层反向依赖进来，
 * 形成循环依赖，且任何一方改动都可能悄悄影响对方——在**没有 App.vue
 * 行为测试**的前提下，这种耦合是净风险。
 *
 * 【时序契约，勿改】
 *   - 每个破坏性边界（打开文件 / 切换树节点 / 新建）之前必须先
 *     `persistence.snapshotBoundary()`：快照与自动保存是解耦的，
 *     先落快照再改文档，顺序反了会丢旧稿。
 *   - loadDocument 必须走 `replaceDocument`（setState 全量重绘）
 *     而非 dispatch —— 原因见 createEditor.js 中对 CM6 tile 增量崩溃的
 *     说明，那正是「编辑器停在旧文件、预览已是新文件」的成因。
 *   - AddRecent 放在 loadDocument 内、且包 try/catch：浏览器预览没有
 *     Wails 绑定，不能因此让整个打开流程失败。
 *
 * 【i18n】用户可见文案走 i18n 的 t()。本模块不持有语言状态 —— t() 读的是
 * i18n/index.js 的模块级 ref，故切语言后这些文案自动跟着变，无需重新注入。
 */
import { t } from '../i18n/index.js'
export function useFileOps(deps) {
  const {
    // 编辑器与文档
    getEditor, replaceDocument, syncAfterDocReplace,
    // 路径状态
    filePath, folderPath, title,
    // 侧栏（打开文件夹后自动展开文件 tab）
    sidebarOpen, sidebarTab,
    // 持久化编排
    persistence, showToast, askInput,
    // Wails 绑定
    ReadFile, OpenFileDialog, OpenDirectoryDialog,
  } = deps

  /** 打开 / 切换文件的唯一落点：整份替换文档 + 同步全部派生状态。 */
  function loadDocument(content, path) {
    replaceDocument(getEditor(), content)
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

  async function newFile() {
    await persistence.snapshotBoundary() // 破坏性边界前先留一份快照
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
      api.AddRecent?.(newPath)
      showToast(t('toast.renamed'))
    } catch (err) {
      showToast(t('toast.renameFailed', { error: err?.message || err }), true)
    }
  }

  return { loadDocument, openFile, openFolder, openTreeFile, newFile, renameFile }
}
