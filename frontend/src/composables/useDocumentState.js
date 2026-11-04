// useDocumentState — 文档状态机：dirty / 自动保存 / 快照 / 导出 / 历史
// ----------------------------------------------------------------------------
// 【2026-10-06 由 useDocumentPersistence.js 演化更名（第五轮架构闭环）】
// 【2026-10-28 P2 改为 per-session（架构 §4.4）】四件状态全部从「全局单值」搬到
// 「会话自己的字段」：`dirty` / `saveState` / `saveTimer` / `lastSnapshotAt`。
// 对外仍暴露同名 `dirty` / `saveState`，但它们是**激活会话的派生值**（computed），
// 故 App.vue 与 TitleBar 零改动。
//
// 职责边界（四块，全部只关乎「这一个标签的这份文档」）：
//   - dirty 语义：唯一含义 = 内存内容 ≠ 磁盘内容（含从未落盘的新文档）。
//     真源在会话上；Go 侧（app.go 的 App.dirty / SetDirty）只是镜像。
//     ADR-005 §一（含 MD-13 的修订：未落盘**且内容为空**视为一致）。
//   - 自动保存：800ms 防抖覆盖原文件（AC-13；间隔由 prefs.autosave 驱动，
//     0 = 关闭）。未落盘（path 为空）不自动保存 —— 无处可写。**后台标签也保存**
//     （MD-01）：定时器挂在会话上，写的是那个会话自己的 path 与 state。
//   - 历史快照：与自动保存**解耦**（AC-14）——触发源只有 ①有效编辑会话节流
//     ②显式保存 ③切走 / 关闭等破坏性边界 ④手动。轮转 / 去重归 Go 侧。
//   - 导出：HTML（46rem 屏幕行宽）与 PDF 一键直出（AC-16~AC-19c，
//     含 dark→light 主题映射与 467px 版心）；window.go 不可用时退 window.print()。
//
// 【本文件最重要的一条：写盘必须「目标与内容同源」】
// 旧实现（单文档）里，`autoSave` 的**目标**读全局 `filePath.value`、**内容**读
// `getEditor().state.doc` —— 两个独立来源。单文档下两者必然指向同一份文档，
// 所以看不出问题。多标签下后台标签的定时器一到，就会**把激活标签的正文写进
// 后台标签的文件**：数据损坏、零报错、事后无法从日志复现。
// 故 P2 起：目标 = `session.path`，内容 = `session.state.doc.toString()`，
// 「是否仍是最新」的比对也按 session。判据只能打在「(path, content) 二元组配对」上，
// **不能**打在「写盘次数」上（次数对任何错配都成立，是典型的假绿灯形态）。
//
// editor 以 getter 注入：编辑器实例在 onMounted 才创建，
// 本模块需在 setup 同步实例化（状态栏初始态先于编辑器存在）。

import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { SaveFileDialog, WriteFile } from '../../wailsjs/go/main/App.js'
import { buildHtmlDocument, PDF_EXPORT_MEASURE, PDF_EXPORT_MEASURE_GTK } from '../export/exporters.js'
import { platform } from './usePlatform.js'
import { replaceDocument } from '../editor/createEditor.js'
import { getPref, onPrefsChange } from '../themes/prefs.js'
import { t, getLocale } from '../i18n/index.js'

// ---------- 快照元数据展示格式化（历史面板 / 恢复提示共用） ----------

export function formatSnapTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatSnapSize(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

// 错误文案兜底：空 message（如 new Error()）会让 toast 变成「保存失败：」这种空洞结尾
function errText(err) {
  const s = typeof err === 'string' ? err : err?.message || ''
  return s.slice(0, 120) || t('toast.unknownError')
}

/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor         () => EditorView|null（onMounted 后才有值）
 * @param {Function} deps.getActiveSession  () => DocSession|null
 * @param {Function} deps.getSessions       () => DocSession[] 全部会话（逐文档镜像的遍历源）
 * @param {Function} deps.setActivePath     (path) => void 路径的**唯一写入入口**
 * @param {import('vue').Ref<string>} deps.renderedHtml 激活会话渲染好的 HTML（导出用）
 * @param {import('vue').Ref<string>} deps.theme     当前已解析主题（theme.js 真源）
 * @param {Function} deps.notify            (msg, isErr?) => void 轻提示（UI 归 App.vue）
 * @param {Function} deps.onDocReplaced     (content) => void 整份替换文档后的外部状态同步
 *                    （replaceDocument 走 setState，不触发 updateListener）
 */
export function useDocumentState({
  getEditor, getActiveSession, getSessions, setActivePath, renderedHtml, theme, notify, onDocReplaced,
}) {
  // 状态机：unsaved（有改动未落盘）→ saving（写入中）→ saved；写入失败 → error。
  // 四态在状态栏用「图标形状 + 文案 + 颜色」三重表达（AC-20）。
  // 【名字不变、口径变了】P2 起它们是「激活会话」的派生值（§4.4）。
  const dirty = computed(() => getActiveSession()?.dirty ?? false)
  const saveState = computed(() => getActiveSession()?.saveState ?? 'saved')
  const showHistory = ref(false)
  const snapshots = ref([])
  const historyLoading = ref(false)

  // ---------- dirty → Go 逐文档镜像（ADR-005 §四 的 docKey→dirty 映射，P3）----------
  //
  // 【为什么必须逐文档、不能只推一个布尔值】Go 侧 OnBeforeClose 经 anyDirty() 判定，
  // 但 map 的键是逐文档的。若前端只推聚合值，Go 就等于又退回一个布尔量，两份文档的
  // 落盘状态挤进同一个字段 —— ADR-005 §四 明确禁止的那一类错误。
  //
  // 【身份口径（与 Go 的 dirtyKeyOf 对齐）】已落盘传绝对路径（Go 侧走 docKeyOf），
  // 未落盘传 "u:"+<tabId>（独立命名空间，与 16 位 hex 不相交）。**前端不实现 sha1**
  // —— snapshot.go:89 明文规定 docKeyOf 是唯一派生，派生留在 Go 侧一份。
  //
  // 【为什么全量重推而不是做 diff】这是「出错代价 = 静默丢稿」的地方，正确性优先于
  // 少发几次 IPC。SetDirty / ForgetDoc 都是幂等的，多推无害；而 diff 逻辑漏掉一条
  // 就是脏标记丢失。try/catch 是浏览器预览无绑定的正常降级，不掩盖代码错误。
  const goApi = () => window.go?.main?.App
  function docIdentity(s) {
    return s.path || `u:${s.id}`
  }
  function pushDirty(s, d) {
    try { goApi()?.SetDirty?.(docIdentity(s), Boolean(d)) } catch { /* 预览环境无绑定 */ }
  }
  /** 标签关闭后摘掉 Go 侧的映射条目（不摘会被「已不存在的文档」拦住关窗口）。 */
  function forgetDoc(s) {
    try { goApi()?.ForgetDoc?.(docIdentity(s)) } catch { /* 预览环境无绑定 */ }
  }
  // 只在 dirty 变化时触发（字符串签名只含身份与 dirty，不含内容/标题）。
  // 【会话列表必须由装配层注入】本模块拿不到 sessions（它在 useEditorSession 里），
  // 用 getSessions() 惰性取，避免把它变成对会话注册表的反向依赖。
  watch(
    () => getSessions().map((s) => `${docIdentity(s)}=${s.dirty ? 1 : 0}`).join('|'),
    () => {
      for (const s of getSessions()) pushDirty(s, s.dirty)
    },
  )

  // 自动保存延时 / 快照间隔改由用户偏好驱动（themes/prefs.js 唯一真源）。
  // 0 = 关闭对应自动行为（AC-10）；手动「立即快照」走 writeSnapshot(s, true) 绕过。
  // 缓存到局部变量，避免每键都读一次 localStorage（markDirty 在每次文档变更时调用）。
  let autosaveDelay = getPref('autosave')
  let snapshotIntervalMs = getPref('snapshot')

  // 偏好实时生效：面板改动后无需重开文档即更新自动保存 / 快照节奏
  const offPrefs = onPrefsChange(() => {
    autosaveDelay = getPref('autosave')
    snapshotIntervalMs = getPref('snapshot')
  })
  onBeforeUnmount(() => offPrefs())

  // Go 绑定直调（wailsjs 生成文件，浏览器预览下不存在）
  function getAppApi() {
    return window.runtime && window.go ? window.go.main.App : null
  }

  /** 某个会话的当前正文。**不用 getEditor()**：后台标签的正文不在编辑器里。 */
  const docText = (session) => session?.state.doc.toString() ?? ''

  /**
   * 落盘一份「该会话的内容」，并只在内容确实未再变化时解除标脏（ADR-005 的忠实实现）。
   *
   * 【为什么不能写完就 dirty=false】WriteFile 是异步 IPC，期间用户完全可能继续输入：
   * 落盘的是 t0 的内容，而内存已是 t1。旧实现落盘后无条件清 dirty → 状态栏显示
   * 「已保存」、关闭时不弹确认框，**t1 的改动被静默丢弃**。
   * 【P2 追加】比对必须按 session：写盘期间用户可能改的是**别的标签**，那与本标签的
   * dirty 无关。用全局 filePath 比对会让后台落盘把激活标签的脏标记误清。
   *
   * @param {Object} session 目标会话（其 state 就是内存中的最新内容）
   * @param {string} path 目标路径（由调用方显式传入，便于断言「写的就是这个会话的路径」）
   */
  async function writeAndSettle(session, path) {
    const written = docText(session)
    await WriteFile(path, written)
    if (session.path === path && docText(session) !== written) {
      // 写入期间本文档又被改：保持脏，且不覆盖 markDirty 已排好的下一轮自动保存
      session.dirty = true
      session.saveState = 'unsaved'
    } else {
      session.dirty = false
      session.saveState = 'saved'
    }
    return true
  }

  // ---------- 自动保存（800ms 防抖，AC-13 + MD-01 后台也保存）----------

  function markDirty() {
    const s = getActiveSession()
    if (!s) return
    s.dirty = true
    s.saveState = 'unsaved'
    clearTimeout(s.saveTimer)
    s.saveTimer = null
    // 未落盘（path 空）→ 不调度定时器，仅保留脏标记与状态栏提示：无处可写
    if (s.path && autosaveDelay > 0) s.saveTimer = setTimeout(() => autoSave(s), autosaveDelay)
  }

  /** 落盘**指定会话**（不是一个全局「当前文档」，MD-01）。 */
  async function autoSave(session) {
    if (!session?.path) return
    session.saveState = 'saving'
    try {
      await writeAndSettle(session, session.path)
    } catch (err) {
      session.saveState = 'error' // 只读目录等失败：状态栏明示，不静默
      notify?.(t('toast.autoSaveFailed', { error: errText(err) }), true)
    }
  }

  // ---------- 历史快照（AC-14：与自动保存解耦）----------

  function maybeSnapshot() {
    const s = getActiveSession()
    if (!s) return
    // 间隔为 0（用户关闭）→ 不再自动快照（AC-10）
    if (snapshotIntervalMs > 0 && Date.now() - s.lastSnapshotAt >= snapshotIntervalMs) {
      writeSnapshot(s, true)
    }
  }

  async function writeSnapshot(session, force = false) {
    const api = getAppApi()
    if (!api?.SnapshotWrite || !session?.path) return
    // force = 手动「立即快照」/ 显式保存 / 破坏性边界：不受间隔约束，间隔为 0 也照写
    if (!force && (snapshotIntervalMs <= 0 || Date.now() - session.lastSnapshotAt < snapshotIntervalMs)) return
    try {
      await api.SnapshotWrite(session.path, docText(session))
      session.lastSnapshotAt = Date.now()
    } catch { /* 快照失败不打扰写作，保存主链路不受影响 */ }
  }

  /**
   * 破坏性边界（切走 / 关闭标签前的留底）：脏则强行写一份快照，并停掉该会话的
   * 自动保存定时器。取代已退役的 `switchFile()` —— 多标签下「切走 = 丢弃」不再
   * 成立，故这里**不做任何全局复位**（dirty / saveState 是会话自己的字段，
   * 谁也不用替谁归零）：
   * 旧稿此刻还在内存里，错过这一刻就永远写不回去了（MD-07）。
   */
  async function beforeDiscard(session) {
    if (!session) return
    if (session.dirty) await writeSnapshot(session, true)
    clearTimeout(session.saveTimer)
    session.saveTimer = null
  }

  // ---------- 保存 ----------

  /**
   * 保存**指定会话**。
   * @returns {Promise<boolean>} true = 已落盘；false = 用户取消 / 保存失败
   */
  async function saveSession(session) {
    if (!session) return false
    clearTimeout(session.saveTimer)
    session.saveTimer = null
    // 未落盘 → 只能走另存为。另存为对话框的默认名取自**激活会话**的 title，
    // 且成功后走的 setActivePath 也只作用于激活会话，故调用方须先把它激活
    // （关闭标签时的「保存」分支就是这么做的）。
    if (!session.path) return saveFileAs()
    session.saveState = 'saving'
    try {
      await writeAndSettle(session, session.path)
      writeSnapshot(session, true) // 显式保存 → 立即快照（Go 侧按内容哈希去重）
      return true
    } catch (err) {
      session.saveState = 'error'
      notify?.(t('toast.saveFailedWith', { error: errText(err) }), true)
      return false
    }
  }

  async function saveFile() {
    return saveSession(getActiveSession())
  }

  async function saveFileAs() {
    const s = getActiveSession()
    if (!s) return false
    const name = s.title.endsWith('.md') ? s.title : `${t('common.untitled')}.md`
    let path = await SaveFileDialog(name, getLocale())
    if (!path) return false
    if (!path.endsWith('.md')) path += '.md'
    s.saveState = 'saving'
    try {
      // 先落盘再切路径：writeAndSettle 用 session.path 判定「是否仍是本文档」，
      // 故切路径前必须完成写入，否则等于拿新路径当旧路径比对。
      await WriteFile(path, docText(s))
      setActivePath(path)
      s.dirty = false
      s.saveState = 'saved'
      s.lastSnapshotAt = Date.now()
      writeSnapshot(s, true)
      return true
    } catch (err) {
      s.saveState = 'error'
      notify?.(t('toast.saveFailedWith', { error: errText(err) }), true)
      return false
    }
  }

  // ---------- 导出 ----------

  /** 激活会话的标题（导出文件名 / PDF 页眉用）；空态退化为「未命名」 */
  const activeTitle = () => getActiveSession()?.title ?? t('common.untitled')

  async function exportHtml() {
    const path = await SaveFileDialog(`${activeTitle().replace(/\.md$/, '')}.html`, getLocale())
    if (!path) return
    const html = buildHtmlDocument(activeTitle(), renderedHtml.value, theme.value)
    await WriteFile(path.endsWith('.html') ? path : path + '.html', html)
  }

  // PDF 页眉页脚参数（视觉规格 §8）：临时切到目标主题读 token 解析值再切回，
  // 四角色字色（文档名 --muted / 日期 --meta / 当前页 --fg-2 / 总页 --muted）+ 字体 --font-body。
  function buildPdfOpts(themeName) {
    const root = document.documentElement
    const prev = root.getAttribute('data-theme')
    root.setAttribute('data-theme', themeName)
    const cs = getComputedStyle(root)
    const opts = {
      docTitle: activeTitle().replace(/\.md$/, ''),
      dateText: new Date().toISOString().slice(0, 10),
      colors: {
        docName: cs.getPropertyValue('--muted').trim(),
        date: cs.getPropertyValue('--meta').trim(),
        pageCur: cs.getPropertyValue('--fg-2').trim(),
        pageTotal: cs.getPropertyValue('--muted').trim(),
      },
      fontFamily: cs.getPropertyValue('--font-body').trim(),
    }
    if (prev) root.setAttribute('data-theme', prev)
    else root.removeAttribute('data-theme')
    return opts
  }

  // 是否退回系统打印对话框（仅 windows / 平台未知时）：
  // 这两类平台没有一键导出实现（export_pdf_other.go 返回「不支持」），
  // 退回 window.print() 至少还能出 PDF，不弹错误 toast 就结束（AC-19b）。
  // 【2026-10-26】Linux 已有一键导出（export_pdf_linux.go 的 GTK 打印到文件），
  // 失败必须如实报错 —— 再弹打印对话框正是用户抱怨的「点导出却出现打印」。
  function shouldFallbackToPrint() {
    const p = platform.value
    return p !== 'linux' && p !== 'darwin'
  }

  // PDF 一键直出（AC-16~AC-19c）：darwin 用离屏 WKWebView 分页渲染；
  // linux 用离屏 WebKitGTK「打印到文件」；两者都只弹保存对话框、不弹打印对话框。
  // 浏览器预览 / windows（window.go 不可用或后端不支持）降级 window.print()。
  async function exportPdf() {
    const api = getAppApi()
    if (!api || typeof api.ExportPDF !== 'function') return window.print()
    // AC-19c 主题映射：dark → 强制 light（PDF 是纸面产物，不出深底浅字）；light/paper 原样
    const pdfTheme = theme.value === 'dark' ? 'light' : theme.value
    // 版心宽：darwin 的离屏 WKWebView 满足 1 CSS px = 1 pt，用 467px 正好等于
    // 可打印宽；GTK 打印走 96dpi，同一物理宽度是 622px（见 exporters.js）。
    const measure = platform.value === 'linux' ? PDF_EXPORT_MEASURE_GTK : PDF_EXPORT_MEASURE
    let html = buildHtmlDocument(activeTitle(), renderedHtml.value, pdfTheme, measure)
    // 兜底：若未来模板回退为固定 46rem，这里保证 PDF 版心仍为 467px
    if (/max-width:\s*46rem/.test(html)) html = html.replace(/max-width:\s*46rem/g, 'max-width:467px')
    try {
      const savedPath = await api.ExportPDF(html, JSON.stringify(buildPdfOpts(pdfTheme)))
      // 用户在保存对话框点「取消」：后端返回 ("", nil)（空路径无错误）——
      // 按用户取消处理：静默返回，不弹 toast、不改状态栏错误态
      if (!savedPath) return
      notify?.(t('toast.exportPdfDone', { path: savedPath }))
    } catch (err) {
      // windows / 浏览器：绑定存在但后端不支持一键导出 —— 退回 window.print()，
      // ⌘P 仍能出 PDF，而不是弹一个错误 toast 就结束
      if (shouldFallbackToPrint()) return window.print()
      // darwin / linux 的真错误（含 Go 侧 500 页超限）：明示并中止，不静默
      notify?.(t('toast.exportFailed', { error: errText(err) }), true)
    }
  }

  // ---------- 历史快照面板 ----------

  function toggleHistory() {
    showHistory.value = !showHistory.value
    if (showHistory.value) loadSnapshots()
  }

  async function loadSnapshots() {
    const api = getAppApi()
    const s = getActiveSession()
    if (!api?.SnapshotList || !s?.path) { snapshots.value = []; return }
    historyLoading.value = true
    try {
      snapshots.value = (await api.SnapshotList(s.path)) || []
    } catch {
      snapshots.value = []
    }
    historyLoading.value = false
  }

  async function snapshotNow() {
    await writeSnapshot(getActiveSession(), true)
    notify?.(t('toast.snapshotDone'))
    loadSnapshots()
  }

  async function restoreSnapshot(snap) {
    const api = getAppApi()
    const s = getActiveSession()
    if (!api?.SnapshotRead || !s?.path) return
    try {
      const content = await api.SnapshotRead(s.path, snap.name)
      // 与打开文件同源：整份替换必须走 replaceDocument（setState），
      // dispatch 会命中 CM6 tile 增量崩溃，现象是编辑器停在旧内容不刷新。
      replaceDocument(getEditor(), content)
      onDocReplaced?.(content) // setState 不触发 updateListener，派生状态须手工同步
      // 恢复快照改变了文档内容 → 内存 ≠ 磁盘，按 dirty 不变量标脏（ADR-005 §三）。
      // 不可依赖 onDocReplaced：它与「打开文件」共用，而打开文件时内存 == 磁盘、不应标脏。
      // 标脏同时启动 800ms 自动保存，恢复内容按常态落盘（用户仍可 ⌘Z）。
      markDirty()
      getEditor()?.focus()
      showHistory.value = false
      notify?.(t('toast.restored', { time: formatSnapTime(snap.createdAt) }))
    } catch (err) {
      notify?.(t('toast.restoreFailed', { error: errText(err) }), true)
    }
  }

  return {
    // 状态（激活会话的派生值，名字与 P1 一致）
    saveState, dirty, showHistory, snapshots, historyLoading,
    // 自动保存 / 快照 / 破坏性边界 / Go 侧逐文档映射清理
    markDirty, maybeSnapshot, beforeDiscard, forgetDoc,
    // 保存 / 导出
    saveFile, saveFileAs, saveSession, exportHtml, exportPdf,
    // 历史面板
    toggleHistory, snapshotNow, restoreSnapshot,
    // 供 useTabLifecycle 的 closeTab 留底用（关闭时内容还在内存里）
    writeSnapshot,
  }
}
