/**
 * tab-close.test.mjs — 关闭标签：落点 / 不丢稿 / MD-15 / MD-08 / 已关闭栈
 * ============================================================================
 * 被测对象：`useTabLifecycle.closeTab`（架构 §5.3 的六步）。
 *
 * 【落点判据为什么必须专门构造，而且不能照抄「3 标签 A–B–C，按 C→A→B 点击」】
 * MD-14 记过一次代价很高的教训：**等价变异是系统性的**。落点判据最容易假绿的形态是
 * 「切走顺序 == 排列顺序」—— 那时 `history` 与 `neighbour` 行为**完全相同**，
 * 两种实现都过，判据零信息量。
 * 而 MD-15 又规定：关闭**非激活**标签不得改变 activeId ⇒ 会走落点分支的只有
 * 「关的正好是激活标签」这一种，而 activeId 恒等于 `mru[0]`。故「被关的那个在
 * MRU 头部、但它在排列上不与落点相邻」才是可区分构造：
 *
 *   排列（显示序）：t1, A, B, C
 *   点击序：A → C → B        ⇒  MRU = [B, C, A, t1]
 *   关 B（激活标签）⇒  history 落点 = C
 *                    neighbour/left_neighbour 实现 = A（排列上 B 的左邻）
 *   ⇒ 断言落点是 C，按排列取左邻的实现会报红。
 *
 * 【每个用例的 dirty 初值】未落盘空文档 dirty=false（MD-03），故干净的标签
 * 关闭时不弹确认 —— 只有脏标签才走三选一。
 */
import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { useEditorSession } from '../src/composables/useEditorSession.js'
import { useDocumentState } from '../src/composables/useDocumentState.js'
import { useTabLifecycle } from '../src/composables/useTabLifecycle.js'

globalThis.requestAnimationFrame ??= (fn) => fn()

const realWarn = console.warn.bind(console)
console.warn = (msg, ...rest) => {
  if (typeof msg === 'string' && /is called when there is no active component instance/.test(msg)) return
  realWarn(msg, ...rest)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * [注意] 每个用例结束必须清掉它排的**自动保存定时器**。
 * 定时器闭包持有会话对象，会在**后续用例**里触发写盘；而后续用例的 `WriteFile`
 * 替身是它自己的记录器 —— 于是「前一条用例的写盘」被算到后一条头上，得到
 * 「关闭后仍写了两次盘」这种假红（实测踩过）。这正是我在 review 里指出
 * `image-paste.test.mjs` 的那个跨用例污染形态（它覆盖 globalThis.window
 * 从不还原），不能自己再犯一次。
 */
const liveApps = []
afterEach(() => {
  for (const app of liveApps) {
    for (const s of app.session.sessions.value) {
      clearTimeout(s.saveTimer)
      s.saveTimer = null
    }
  }
  liveApps.length = 0
})

function makeApp() {
  const writes = []
  const snaps = []
  globalThis.window = {
    runtime: {},
    go: {
      main: {
        App: {
          WriteFile: async (path, content) => { writes.push({ path, content }) },
          SnapshotWrite: async (path, content) => { snaps.push({ path, content }) },
          SaveFileDialog: async () => '',
          SetDirty: () => {},
        },
      },
    },
  }
  const editorRef = shallowRef(null)
  const session = useEditorSession({
    editorRef,
    onDocChange: () => {},
    onImageFile: () => {},
    onClipboardImage: () => {},
    typewriterOn: shallowRef(false),
    onOutlineRefresh: () => {},
    onEditorReady: () => {},
    zoom: shallowRef(100),
    focusOn: shallowRef(false),
    invalidateOutline: () => {},
  })
  const docState = useDocumentState({
    getEditor: () => editorRef.value,
    getActiveSession: session.getActiveSession,
    anyDirty: session.anyDirty,
    setActivePath: session.setActivePath,
    renderedHtml: { value: '' },
    theme: { value: 'light' },
    notify: () => {},
    onDocReplaced: session.syncAfterDocReplace,
  })
  session.bindDocState(docState)
  const tabs = useTabLifecycle({ session, docState, getEditor: () => editorRef.value })

  const view = {
    state: session.getActiveSession().state,
    composing: false,
    scrollDOM: { scrollTop: 0 },
    setState(next) { this.state = next },
    dispatch(spec) {
      const tr = spec instanceof Transaction ? spec : this.state.update(spec)
      this.state = tr.state
      const update = {
        view, state: tr.state, startState: tr.startState, transactions: [tr],
        docChanged: tr.docChanged, selectionSet: tr.selection !== undefined,
      }
      for (const fn of tr.state.facet(EditorView.updateListener)) fn(update)
      return tr
    },
    focus() {},
  }
  editorRef.value = view
  const app = { session, docState, tabs, editorRef, view, writes, snaps }
  liveApps.push(app)
  return app
}

function type(ctx, text) {
  const pos = ctx.view.state.doc.length
  ctx.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
}

/** 关一个**脏**标签并给出三选一的答复；返回 closeTab 的结果 */
async function closeDirty(ctx, id, choice) {
  const p = ctx.tabs.closeTab(id)
  for (let i = 0; i < 100 && !ctx.tabs.confirmState.show; i++) await sleep(0)
  assert.equal(ctx.tabs.confirmState.show, true, '脏标签必须弹确认（静默丢弃是本仓明令禁止的形态）')
  ctx.tabs.resolveConfirm(choice)
  return p
}

/** 把某标签改成「脏」：激活它、输入一个字（走真实事务）、标脏 */
async function makeDirty(ctx, s) {
  await ctx.session.activateSession(s)
  type(ctx, 'x')
  ctx.docState.markDirty()
  assert.equal(s.dirty, true)
}

describe('落点策略 · history（MD-09 + MD-14）', () => {
  test('关激活标签后落到「上一个访问过的」，而不是排列上的左邻', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'A' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'B' })
    const c = ctx.session.createSession({ path: '/c.md', content: 'C' })

    // 点击序 A → C → B（不是按排列顺序打开，否则 MRU 与排列同序 = 等价变异）
    await ctx.session.activateSession(a)
    await ctx.session.activateSession(c)
    await ctx.session.activateSession(b)
    assert.deepEqual(ctx.session.mru.value.slice(0, 3), [b.id, c.id, a.id], 'MRU 应为 [B, C, A]')

    assert.equal(await ctx.tabs.closeTab(b.id), true) // B 干净 → 不弹确认
    assert.equal(
      ctx.session.activeId.value, c.id,
      '落点必须是 MRU 里上一个访问过的 C；若为 A 说明实现按「排列相邻」取左邻（等价变异，判据本就没区分力）',
    )
  })

  test('history 无候选时回退到「显示序里的第一个剩余标签」（MD-14）', async () => {
    const ctx = makeApp()
    // 初始会话 t1 已存在且为排列第一个；再造一个 A 并激活，然后关掉 A。
    const a = ctx.session.createSession({ path: '/a.md', content: 'A' })
    await ctx.session.activateSession(a)
    // 手工把 MRU 压成只剩 A（模拟「MRU 里没有别的候选」）
    ctx.session.mru.value = [a.id]
    const first = ctx.session.sessions.value.find((s) => s.id !== a.id)
    assert.ok(first, '应还有别的会话可回退')

    assert.equal(await ctx.tabs.closeTab(a.id), true)
    assert.equal(ctx.session.activeId.value, first.id, 'MRU 无候选 → 回退到显示序第一个剩余标签')
  })
})

describe('关闭脏标签 · 三选一', () => {
  test('选「取消」→ 不关闭、内容与脏标记都保住', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    await makeDirty(ctx, a)

    const closed = await closeDirty(ctx, a.id, 'cancel')
    assert.equal(closed, false, '用户取消 → closeTab 返回 false')
    assert.ok(ctx.session.sessions.value.some((s) => s.id === a.id), '标签仍在注册表里')
    assert.equal(a.dirty, true, '取消后仍应是脏的（否则关窗口时不再提示）')
    assert.equal(a.state.doc.toString(), 'AAAx', '内容必须原样保留')
  })

  test('选「不保存」→ 关闭，且已关闭栈里存下内容与位置', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    await makeDirty(ctx, a)
    ctx.view.scrollDOM.scrollTop = 345 // 位置必须非 0，否则「存了位置」与「位置恒 0」不可区分
    ctx.view.dispatch({ selection: { anchor: 2 } })

    assert.equal(await closeDirty(ctx, a.id, 'discard'), true)
    assert.ok(!ctx.session.sessions.value.some((s) => s.id === a.id), '标签已移除')

    const rec = ctx.tabs.closedStack.value.at(-1)
    assert.ok(rec, '应压入已关闭栈（P4 的「恢复已关闭标签」要用）')
    assert.equal(rec.path, '/a.md')
    assert.equal(rec.content, 'AAAx', '存的是关闭那一刻的内容')
    assert.equal(rec.scrollTop, 345, '位置必须一起存（AC-62：恢复后不该回到文档开头）')
    assert.deepEqual(rec.selection, { from: 2, to: 2 })
  })

  test('脏标签关闭前先留底快照（内容此刻还在内存里，MD-07 同一口径）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    await makeDirty(ctx, a)
    await closeDirty(ctx, a.id, 'cancel') // 即使取消，也先留底
    assert.deepEqual(ctx.snaps, [{ path: '/a.md', content: 'AAAx' }], '关闭边界必须先写快照')
  })
})

describe('MD-15 · 关闭非激活标签不得改变 activeId', () => {
  test('关掉后台的脏标签（选不保存）→ 仍停在原文档', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })
    await makeDirty(ctx, b)              // B 脏
    await ctx.session.activateSession(a) // 切到 A：B 成为后台脏标签
    assert.equal(ctx.session.activeId.value, a.id)

    assert.equal(await closeDirty(ctx, b.id, 'discard'), true)
    assert.equal(
      ctx.session.activeId.value, a.id,
      '关后台标签把用户从正在编辑的文档里拽走了 —— 这是最反直觉的缺陷形态：' +
        '功能「生效」了，但用户感知为「点了别的东西」。',
    )
  })
})

describe('MD-08 · 关掉最后一个标签', () => {
  test('补一份空文档并激活，应用不退出、不进入零标签态', async () => {
    const ctx = makeApp()
    const only = ctx.session.activeSession.value
    assert.equal(ctx.session.sessions.value.length, 1)

    assert.equal(await ctx.tabs.closeTab(only.id), true)
    assert.equal(ctx.session.sessions.value.length, 1, '关掉最后一个 → 仍是「一个空文档」，不是零标签')
    assert.ok(ctx.session.activeSession.value, 'activeSession 不得为 null')
    assert.notEqual(ctx.session.activeSession.value.id, only.id, '应是新建的那个会话')
    assert.equal(ctx.session.activeSession.value.path, '')
    assert.equal(ctx.session.activeSession.value.state.doc.toString(), '')
  })
})

describe('关闭时停掉该标签的自动保存定时器', () => {
  test('关闭后不得再为它写盘（定时器若没清，删掉的标签仍会写一次）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    await makeDirty(ctx, a) // markDirty 会排一个 800ms 的自动保存
    assert.ok(a.saveTimer, '前提：定时器确实排上了')

    assert.equal(await closeDirty(ctx, a.id, 'discard'), true)
    await sleep(1000) // 越过 800ms 防抖
    assert.deepEqual(
      ctx.writes, [],
      '关掉的标签在 800ms 后仍写了一次盘 —— clearTimeout(s.saveTimer) 丢了。' +
        '用户已经丢弃这份内容，却仍被写进文件（覆盖磁盘上更新的版本）。',
    )
  })
})
