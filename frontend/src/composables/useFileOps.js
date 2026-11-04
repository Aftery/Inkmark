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
 * 【时序契约，勿改（2026-10-28 P2 已改口径）】
 *   - 多标签下「打开文件」= **开一个标签**，不再是「替换当前文档」。破坏性边界
 *     随之消失：旧实现每次打开前要 `docState.switchFile()`（脏则留快照），
 *     现在当前文档根本不被替换，故**不再需要**。切走时的留底由
 *     `activateSession` 步骤 2 的 `beforeDiscard` 承担（MD-07）。
 *   - `openPath` 必须先查 `session.findByPath`：同路径幂等是**架构约束**而非体验
 *     偏好 —— 两个标签共享同一 docKey 会让 dirty 映射退化，破坏 ADR-005 的单义不变量。
 *   - 整份替换仍必须走 `replaceDocument`（setState 全量重绘）而非 dispatch ——
 *     原因见 createEditor.js 中对 CM6 tile 增量崩溃的说明。
 *   - （原此处有 AddRecent 登记「最近打开」的步骤，随原生菜单下线一并删除：
 *     它的唯一消费方是菜单里的「最近打开」子菜单，前端自绘标题栏不含该列表。）
 *
 * 【i18n】用户可见文案走 i18n 的 t()。本模块不持有语言状态 —— t() 读的是
 * i18n/index.js 的模块级 ref，故切语言后这些文案自动跟着变，无需重新注入。
 */
import { ref, watch } from 'vue'
import { t, getLocale } from '../i18n/index.js'

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
    // setActivePath 是路径的**唯一写入入口**（多标签页下 filePath 是
    // activeSession.path 的派生值，直接赋值写不进去，见 useEditorSession 头注）
    filePath, folderPath, title, setActivePath,
    // 会话注册表（P2：打开 = 开标签）
    session,
    // 侧栏（打开文件夹后自动展开文件 tab）
    sidebarOpen, sidebarTab,
    // 提示
    showToast, askInput,
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

  /**
   * 整份替换**当前标签**的内容 + 同步全部派生状态。
   * 多标签下只用于「语法示例」这类明确要替换当前内容的场景；
   * 「打开文件」不走这里（走 openPath 开新标签）。
   */
  function loadDocument(content, path) {
    const s = session.getActiveSession()
    replaceDocument(getEditor(), content)
    syncAfterDocReplace(content)
    setActivePath(path)
    // 载入即「未修改」：与初始会话（DEFAULT_DOC 且 dirty=false）同口径。
    // 取代已退役的 docState.resetSession()（它还会清全局定时器 —— P2 之后
    // 定时器是会话自己的字段，替别的会话归零反而是错的）。
    if (s) {
      s.dirty = false
      s.saveState = 'saved'
    }
  }

  // 【打开竞态守卫】ReadFile 是异步 IPC：用户在等待期间再点另一个文件时，
  // 先发出的读取可能后返回。单文档下的旧实现直接丢弃过期结果（防「点 A 再点 B，
  // 编辑器里是 A、标题却是 B」）；**多标签下丢弃 = 用户点的 A 永远打不开**，
  // 是功能缺失。故 P2 起改为：结果照常建标签，**只是不抢焦点**（见 openPath）。
  let openSeq = 0

  /**
   * 读取并载入 path（多标签版：打开 = 开标签）。
   *   - 路径已在某个标签里 → **切到那个标签**（同路径幂等：不新建、不覆盖内容）
   *   - 否则 → 读取并新建一个标签，激活它
   * 失败给出提示而不是让 Promise 悬空（静默失败是本仓明确要避免的形态）。
   *
   * @returns {Promise<Object|null>} 命中的 / 新建的会话；失败或取消返回 null
   */
  async function openPath(path) {
    const existing = session.findByPath(path)
    if (existing) {
      await session.activateSession(existing)
      return existing
    }
    const seq = ++openSeq
    let content
    try {
      content = await ReadFile(path)
    } catch (err) {
      showToast(t('toast.openFailed', { error: err?.message || err }), true)
      return null
    }
    const s = session.createSession({ path, content })
    // 序号已过期（用户在此期间又点了别的）→ 标签照建，但不抢焦点：
    // 用户最新的意图是后一次打开，先发起的那份也只是「另一个标签」。
    if (seq === openSeq) await session.activateSession(s)
    return s
  }

  async function openFile() {
    const path = await OpenFileDialog(getLocale())
    if (!path) return
    await openPath(path)
  }

  async function openFolder() {
    const path = await OpenDirectoryDialog(getLocale())
    if (!path) return
    folderPath.value = path
    // 打开文件夹自动展开侧栏（文件 tab）
    sidebarOpen.value = true
    sidebarTab.value = 'files'
  }

  async function openTreeFile(path) {
    // 与 openPath 同一条路：已开着的文件直接切过去（同路径幂等）。
    // 旧的 `if (path === filePath.value) return` 单文档判重已由 findByPath 承担。
    await openPath(path)
  }

  /** 新建一个未落盘标签并激活（MD-03：空白文档 dirty=false，一有输入立刻转 true） */
  async function newFile() {
    const s = session.createSession({ path: '', content: '' })
    await session.activateSession(s)
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
      setActivePath(newPath)
      showToast(t('toast.renamed'))
    } catch (err) {
      showToast(t('toast.renameFailed', { error: err?.message || err }), true)
    }
  }

  return { loadDocument, openFile, openFolder, openTreeFile, newFile, renameFile, treeSignal }
}
