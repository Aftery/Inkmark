// useTabPersistence —— 标签状态持久化（MD-06）
// ============================================================================
//
// 【存什么】
//   · 已落盘标签：path / 顺序 / 激活项 / 每标签 scrollTop
//   · **未落盘标签的正文**（最近 MAX_UNSAVED 个，超出丢最旧）
// 后者是产品硬要求：崩溃后未落盘草稿全丢是明确的差评点（VS Code Hot Exit /
// Zed `session.restore_unsaved_buffers` 都做）。原方案「未落盘标签不恢复」已被
// MD-06 明确否决。
//
// 【恢复只读不写】
//   恢复出来的标签 `dirty` 一律置 `false`（内存 := 磁盘：内容就是从磁盘读的，
//   或就是上次自己存下的那份），**绝不覆盖磁盘文件**（R20 的一半）。
//   文件已被删除 / 不可读 → 跳过且不报错（R20 的另一半）。
//
// 【为什么独立成模块】App.vue 是 ≤150 行装配层且余量已用尽（契约 5）；而
// useFileOps 本来就持有 session / getEditor / ReadFile，接线只需一行。
//
// 【localStorage 里存未落盘正文的隐私考量】这些内容只落在用户自己的机器上，
// 与既有的偏好存储（prefs.js）同源同权限；不联网、不进任何日志。
import { watch, onMounted } from 'vue'

const TABS_KEY = 'inkmark-tabs'
const MAX_UNSAVED = 10

/**
 * @param {Object} deps
 * @param {Object}   deps.session   useEditorSession 的实例（sessions / activeId / …）
 * @param {Function} deps.getEditor () => EditorView|null（取激活标签的实时 scrollTop）
 * @param {Function} deps.ReadFile  (path) => Promise<string>
 */
export function useTabPersistence({ session, getEditor, ReadFile }) {
  // 会话注册表是必需的。最小构造（例如 watcher-wiring 里只测 fs:changed 订阅的
  // 用例）可能不带它 —— 此时没有标签可持久化，直接不接线，而不是抛错把整条
  // 装配链打掉。真实装配里 session 恒在。
  if (!session?.sessions) {
    return { persistTabs: () => {}, restoreTabs: async () => {} }
  }
  let persistTimer = null

  function persistTabs() {
    try {
      const liveTop = getEditor()?.scrollDOM?.scrollTop
      const tabs = session.sessions.value.map((s) => ({
        p: s.path,
        // 激活标签的滚动位置是「活的」（在 view 上），切走时才写进会话
        t: s.id === session.activeId.value ? (liveTop ?? s.scrollTop) : s.scrollTop,
        c: s.path ? undefined : s.state.doc.toString(),
      }))
      // 未落盘标签只留最近 MAX_UNSAVED 个：超出丢最旧（session 数组越靠前越旧）
      const unsavedTotal = tabs.filter((x) => !x.p).length
      let unsavedSeen = 0
      const kept = tabs.filter((x) => {
        if (x.p) return true
        unsavedSeen += 1
        return unsavedSeen > unsavedTotal - MAX_UNSAVED
      })
      const activeIndex = session.sessions.value.findIndex((x) => x.id === session.activeId.value)
      localStorage.setItem(TABS_KEY, JSON.stringify({ v: 1, active: activeIndex, tabs: kept }))
    } catch {
      /* 隐私模式 / 配额满：持久化失败不该影响写作 */
    }
  }

  function schedulePersist() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persistTabs, 600)
  }

  // 签名里带未落盘标签的正文长度：否则用户在未落盘标签里持续输入时签名不再变，
  // localStorage 里的内容会停在第一次改动那一版。
  watch(
    () =>
      session.sessions.value
        .map((s) => `${s.id}:${s.path}:${s.dirty ? 1 : 0}:${s.scrollTop}:${s.path ? '' : s.state.doc.length}`)
        .join('|') + `#${session.activeId.value}`,
    schedulePersist,
  )

  /** 启动时恢复上次的标签；没有可恢复的就什么都不做（保持示例文档）。 */
  async function restoreTabs() {
    let raw
    try {
      raw = localStorage.getItem(TABS_KEY)
    } catch {
      return
    }
    if (!raw) return
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    if (!data || data.v !== 1 || !Array.isArray(data.tabs) || data.tabs.length === 0) return

    const initialIds = new Set(session.sessions.value.map((x) => x.id))
    const created = []
    for (const tab of data.tabs) {
      try {
        if (tab.p) {
          const content = await ReadFile(tab.p)
          const s = session.createSession({ path: tab.p, content })
          s.scrollTop = Number(tab.t) || 0
          created.push(s)
        } else if (typeof tab.c === 'string') {
          const s = session.createSession({ path: '', content: tab.c })
          // 内容就是上次存下的那份 ⇒ 内存 := 磁盘，故不标脏（MD-06）
          s.dirty = false
          s.saveState = 'saved'
          s.scrollTop = Number(tab.t) || 0
          created.push(s)
        }
      } catch {
        /* 文件已被删除 / 不可读：跳过且不报错（R20） */
      }
    }
    if (created.length === 0) return

    // 激活被记下的那个；激活**之后**再摘掉启动时的初始会话
    // （顺序反了会先掉进「零标签」态，与 MD-08 相悖）
    const idx = Math.min(Math.max(0, Number(data.active) || 0), created.length - 1)
    await session.activateSession(created[idx])
    for (const id of initialIds) session.removeSession(id)
  }

  onMounted(() => {
    void restoreTabs()
  })

  return { persistTabs, restoreTabs }
}
