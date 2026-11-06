// useTabLifecycle — 标签页生命周期：关闭 / 落点 / 已关闭栈
// ----------------------------------------------------------------------------
// 【为什么单独成模块（架构 §4.5）】关闭一个标签要串四件事，缺一件就是一次静默丢稿：
//   ① 该标签脏 → 先写快照留底（此刻内容还在内存里，错过就永远写不回去）
//   ② 该标签脏 → 弹确认（保存 / 不保存 / 取消）
//   ③ 停掉该标签的自动保存定时器（不停就会在标签消失后再写一次盘）
//   ④ 决定关闭后激活谁（MD-09 的 history 策略）
// 这四件事横跨 useEditorSession（会话注册表）与 useDocumentState（持久化），
// 放哪一边都会让另一边反向依赖。故独立成第三层，两边都只被它调用。
//
// 【关闭确认框为什么由本模块持有】
// `confirmDiscard(session)` 要「弹一个框并等用户点」。若把这段编排放到 App.vue：
// ① App.vue 是 ≤150 行的装配层，余量已用尽（见架构 §4.11）；
// ② 确认框的状态与「哪一个会话在等着被关闭」是同一个生命周期，拆两处必然漂移。
// 故本模块持有 `confirmState`（供 ConfirmDialog.vue 渲染）与 `resolveConfirm`
// （供组件回传选择），把 `confirmDiscard` 实现成一个可 await 的 Promise。
//
// 【P2 的范围】`closedStack` 本轮**只入栈、不出栈** —— 「恢复已关闭标签」（⌘⇧T）
// 属 P4。这里先按最终形态存全（含位置），P4 才有东西可恢复。
//
// 【P4 补齐：出栈 + 右键菜单的批量关闭】
//   ① `reopenClosedTab()` 消费 `closedStack`（AC-62：选区与滚动位置一并恢复）；
//   ② `closeOthers()` / `closeRight()` **逐个走 `closeTab`**，遇用户取消就停；
//   ③ 入栈口径从「只有被丢弃的脏标签」放宽到「**每个**关闭的标签」——
//      自动保存开着时绝大多数关闭都是干净关闭，若只在丢弃时入栈，⌘⇧T 在真实
//      使用里几乎永远「没东西可恢复」，等于一条废命令。
import { ref, reactive } from 'vue'

/** 已关闭栈上限。每条记录含**整份正文**，无上限就是内存泄漏（大文档尤甚） */
const CLOSED_STACK_LIMIT = 20

export function useTabLifecycle({ session, docState, getEditor }) {
  /** 已关闭标签的栈；元素 = { path, title, content, scrollTop, selection, dirty } */
  const closedStack = ref([])

  // ---------- 关闭确认（三选一：save / discard / cancel）----------

  /** 供 ConfirmDialog.vue 渲染；`title` 是**文档名**，正文文案在组件里走 i18n */
  const confirmState = reactive({ show: false, title: '' })
  let pendingResolve = null

  /**
   * 弹确认框并等待用户选择。
   * @returns {Promise<'save'|'discard'|'cancel'>}
   */
  function confirmDiscard(target) {
    confirmState.title = target.title
    confirmState.show = true
    return new Promise((resolve) => { pendingResolve = resolve })
  }

  /** 由 ConfirmDialog.vue 的 @choose 调用（Esc 与遮罩点击都归到 'cancel'） */
  function resolveConfirm(choice) {
    confirmState.show = false
    const resolve = pendingResolve
    pendingResolve = null
    if (resolve) resolve(choice)
  }

  /**
   * 已关闭标签的快照。
   * 【为什么连位置一起存】AC-62：恢复出来的标签若回到文档开头，用户还得再滚回去
   * （Sublime 社区的已知差评形态）。滚动位置**不在 EditorState 里**，故必须在这里
   * 抓一次；激活标签的实时位置在 view 上（会话里存的是上次切走时的值），
   * 后台标签则用它自己记的 scrollTop。
   */
  function snapshotOf(target) {
    const sel = target.state.selection.main
    const isActive = target.id === session.activeId.value
    const liveTop = isActive ? getEditor()?.scrollDOM?.scrollTop : undefined
    return {
      path: target.path,
      title: target.title,
      content: target.state.doc.toString(),
      scrollTop: liveTop ?? target.scrollTop,
      selection: { from: sel.from, to: sel.to },
    }
  }

  /**
   * 关闭后激活谁 —— MD-09 的 `activate_on_close = history`：回到「上一个访问过的
   * 标签」，而不是「左边那个」。
   *
   * 【MD-14 的回退规则】history 无候选时（只剩一个标签 / MRU 里没有别的了）
   * → 回退到「显示序里的第一个剩余标签」。
   * 三档策略（history / neighbour / left_neighbour）**统一回退到 history**，
   * 拒绝 neighbour 的两级回退（有右邻取右邻、否则取左邻）：它创造了一个
   * **等价变异** —— 「切走顺序 == 排列顺序」时 history 与 neighbour 行为完全相同，
   * 落点判据会假绿（两种实现都过，测不出真实差异）。
   */
  function pickLandingSession(closedId) {
    for (const id of session.mru.value) {
      if (id === closedId) continue
      const found = session.sessions.value.find((x) => x.id === id)
      if (found) return found
    }
    return session.sessions.value.find((x) => x.id !== closedId) || null
  }

  /**
   * 关闭一个标签。步骤编号对应架构 §5.3，**顺序即契约**。
   * @returns {Promise<boolean>} true = 已关闭；false = 用户取消 / 保存失败
   */
  async function closeTab(idOrSession) {
    // 入口归一：UI 层历史上传过**对象**（P2 的 × 按钮就是 emit('close', s)，而
    // 本函数按 id 匹配 → 点了没反应、也不报错，是本仓最典型的静默失败形态）。
    // 统一接受 id 或 session 对象，比要求每个调用点都记得传 id 更稳。
    const id = idOrSession && typeof idOrSession === 'object' ? idOrSession.id : idOrSession
    const target = session.sessions.value.find((x) => x.id === id)
    if (!target) return false
    // MD-15：关**后台**标签不得把用户从正在编辑的文档里拽走 —— 故先记下，
    // 只有「关的确实是激活标签」时第 ④ 步才动 activeId。
    const wasActive = session.activeId.value === id

    // ① 脏 → 先留底（与 MD-07 同口径：宁多留一份，不静默丢稿）
    if (target.dirty) await docState.writeSnapshot(target, true)

    // ② 脏 → 问用户三选一
    if (target.dirty) {
      const choice = await confirmDiscard(target)
      if (choice === 'cancel') return false
      if (choice === 'save') {
        // 未落盘的文档只能另存为，而另存为需要一个「当前文档」（对话框默认名取自
        // 激活会话的 title，成功后走的 setActivePath 也只作用于激活会话）。
        // 用户已显式选择「保存」，先把目标激活是预期行为 —— MD-15 约束的是
        // **关闭动作本身**不改变 activeId，不是「用户选了保存也不许切」。
        if (!target.path) await session.activateSession(target)
        const ok = await docState.saveSession(target)
        if (!ok) return false // 保存失败 / 用户取消另存为 → 不关闭
      }
      // 'discard' 不再在这里入栈：P4 起**每个**关闭的标签都入栈（见下方 ②′），
      // 若两处都写，被丢弃的脏标签会被压两次 → ⌘⇧T 连按两下出来同一个标签两遍。
    }

    // ②′ 入「已关闭栈」（P4：**每个**关闭的标签都入栈，见文件头注 ③）。
    // 必须在第 ④ 步之前 —— 落点会把 view 切到别的 state，届时 `snapshotOf` 里
    // 「激活标签的实时滚动位置」已经不属于这份被关的文档了。
    pushClosed(target)

    // ③ 停掉该标签的自动保存定时器
    clearTimeout(target.saveTimer)
    target.saveTimer = null

    // ④ 落点 —— 只在关的是激活标签时才动
    if (wasActive) {
      const next = pickLandingSession(id)
      // MD-08：一个都不剩 → 补一份空文档并激活，应用保持运行、不进入零标签态
      await session.activateSession(next || session.createSession({ path: '', content: '' }))
    }

    // ⑤ 从注册表移除，并让 Go 侧摘掉该文档的 dirty 映射条目
    //    （ADR-005 §四：不摘的话，用户关掉一个脏标签（已确认不保存）后，它的脏标记
    //      还留在映射里，关窗口会被一个**已经不存在的文档**拦住 —— 既误拦，
    //      又掩盖了真正还脏着的文档）
    session.removeSession(id)
    docState.forgetDoc?.(target)
    return true
  }

  /**
   * 入「已关闭栈」。带上 `dirty` —— 恢复时要用它决定恢复出来的标签是不是脏的：
   * 关闭时磁盘从未被更新，所以「关之前脏」⇒「恢复后仍脏」（内存 ≠ 磁盘这件事
   * 不会因为关一次标签就变成相等）。
   */
  function pushClosed(target) {
    const rec = { ...snapshotOf(target), dirty: Boolean(target.dirty) }
    const next = [...closedStack.value, rec]
    closedStack.value = next.length > CLOSED_STACK_LIMIT
      ? next.slice(next.length - CLOSED_STACK_LIMIT)
      : next
  }

  /**
   * 恢复最近关闭的标签（⌘⇧T）。
   *
   * 【AC-62：选区与滚动位置必须一并回来】只恢复文件内容是 Sublime 社区的已知
   * 差评点 —— 用户按 ⌘⇧T 是想「接着刚才干」，回到文首等于白恢复一次。
   *
   * 【同一路径已在标签里 → 直接激活，不再造第二个】两个标签指向同一个文件 =
   * 两份 state 交替写盘（后写覆盖先写），且 dirty 互相打架。幂等口径与
   * `useFileOps.openPath` 的 `findByPath` 一致。
   *
   * @returns {Promise<boolean>} false = 栈空（调用方给轻提示，不静默无反应）
   */
  async function reopenClosedTab() {
    const stack = closedStack.value
    if (stack.length === 0) return false
    const rec = stack[stack.length - 1]
    closedStack.value = stack.slice(0, stack.length - 1)

    const existing = session.findByPath(rec.path)
    if (existing) {
      await session.activateSession(existing)
      return true
    }

    const target = session.createSession({ path: rec.path, content: rec.content })
    // 位置与脏标记必须在**激活前**写好：激活的第 ⑨ 步会把 target.scrollTop
    // 贴回视图（rAF 内），脏标记则决定状态栏与 Go 镜像的首帧取值。
    target.scrollTop = rec.scrollTop || 0
    if (rec.dirty) {
      target.dirty = true
      target.saveState = 'unsaved'
    }
    await session.activateSession(target)

    // 选区：激活后经**一笔事务**写进视图（不在 state 上直接改 —— 视图与注册表
    // 必须是同一个 state 对象）。`scrollIntoView: false` 保证不把刚恢复的滚动
    // 位置又拽走。IME 守卫把激活挂起时不写（此时视图里还是上一份文档）。
    const view = getEditor()
    const sel = rec.selection
    if (view && session.activeId.value === target.id && sel
      && Number.isInteger(sel.from) && Number.isInteger(sel.to) && sel.to <= rec.content.length) {
      view.dispatch({ selection: { anchor: sel.from, head: sel.to } })
    }
    return true
  }

  /**
   * 右键「关闭其他」。**逐个走 closeTab**，不用批量移除 ——
   * 每个被关的标签都可能是脏的、都可能弹确认；用户中途取消就必须停下，
   * 已关的保持关闭、未关的原样留在标签栏（批量移除会一次性丢掉未确认的稿子）。
   * @returns {Promise<boolean>} false = 中途被取消
   */
  async function closeOthers(keepId) {
    const ids = session.sessions.value.filter((s) => s.id !== keepId).map((s) => s.id)
    for (const id of ids) if (!(await closeTab(id))) return false
    return true
  }

  /**
   * 右键「关闭右侧」（按**显示序**，不含自己）。同样逐个走 closeTab。
   * 关到激活标签时落点仍归 closeTab / pickLandingSession（MD-09 + MD-14），
   * 这里不另立一套。
   */
  async function closeRight(fromId) {
    const list = session.sessions.value
    const i = list.findIndex((s) => s.id === fromId)
    if (i < 0) return false
    const ids = list.slice(i + 1).map((s) => s.id)
    for (const id of ids) if (!(await closeTab(id))) return false
    return true
  }

  return {
    closedStack, confirmState, resolveConfirm, confirmDiscard, pickLandingSession,
    closeTab, reopenClosedTab, closeOthers, closeRight,
  }
}
