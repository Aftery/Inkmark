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

/**
 * fs:changed 到来时是否该重载文件树（纯函数，导出供测试直接 import）。
 *
 * 语义：**严格相等，不做任何归一化**。payload 是 watcher.go watchLoop 推送的
 * 「被监听根目录」原样字符串，folderPath 是前端当初传给 WatchDir 的同一个
 * 字符串 —— 两者同源，严格相等即正确；尾部斜杠差异在这种同源关系下不可能
 * 出现，容忍它只会把别的目录的事件放进来。
 *
 * 空串一律 false：WatchDir('') 是停机态，不会有事件带空 payload 回来；
 * folderPath 为空说明没开文件夹，无所谓重载。非字符串（Go 侧契约漂移）
 * 同样 false —— 宁可漏一次刷新，不可错刷。
 */
export function shouldReloadTree(payload, folderPath) {
  return (
    typeof payload === 'string' && payload !== '' &&
    typeof folderPath === 'string' && folderPath !== '' &&
    payload === folderPath
  )
}

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
  // （早期注释称「WatchDir 未在 app.go 暴露、treeSignal 从不自增」是看漏了：
  //   watcher.go 与 app.go 同包，方法早已暴露；缺的只是下面的 fs:changed 订阅。）
  const treeSignal = ref(0)
  watch(folderPath, (p) => {
    try { window.go?.main?.App?.WatchDir?.(p || '') } catch { /* 浏览器预览无绑定 */ }
  })

  // 订阅 Go 侧 fsnotify 去抖后推送的 fs:changed（watcher.go watchLoop：
  // 250ms 去抖、payload 为被监听根目录）。仅当 payload 就是当前文件夹时才
  // 自增 treeSignal —— 守卫语义与边界见 shouldReloadTree。
  //
  // 为什么不 import wailsjs/runtime 的 EventsOn：那个绑定展开是
  // `window.runtime.EventsOnMultiple(...)` 直取，浏览器预览（vite dev 无
  // Wails runtime）下会抛 Cannot read properties of undefined。这里用与
  // 上一行 WatchDir 相同的可选链形态，预览环境下静默不订阅。
  //
  // 为什么不退订：本 composable 随 App setup 创建一次、与 app 同生命周期；
  // 且 runtime 的 EventsOff(eventName) 会摘掉该事件名的**全部**回调，
  // 将来若有第二个订阅者会被误伤 —— 两害相权，不退订。
  window.runtime?.EventsOn?.('fs:changed', (payload) => {
    if (!shouldReloadTree(payload, folderPath.value)) return
    treeSignal.value++
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
