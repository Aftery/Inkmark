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
import { ref, reactive } from 'vue'

export function useTabLifecycle({ session, docState, getEditor }) {
  /** 已关闭标签的栈；元素 = { path, title, content, scrollTop, selection } */
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
  async function closeTab(id) {
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
      if (choice === 'discard') {
        closedStack.value = [...closedStack.value, snapshotOf(target)]
      }
    }

    // ③ 停掉该标签的自动保存定时器
    clearTimeout(target.saveTimer)
    target.saveTimer = null

    // ④ 落点 —— 只在关的是激活标签时才动
    if (wasActive) {
      const next = pickLandingSession(id)
      // MD-08：一个都不剩 → 补一份空文档并激活，应用保持运行、不进入零标签态
      await session.activateSession(next || session.createSession({ path: '', content: '' }))
    }

    // ⑤ 从注册表移除
    session.removeSession(id)
    return true
  }

  return { closedStack, confirmState, resolveConfirm, confirmDiscard, pickLandingSession, closeTab }
}
