/**
 * tab-autosave.test.mjs — 写盘必须「目标与内容同源」（P2，QA §5.2 ④ 的最高优先级项）
 * ============================================================================
 * 被测对象：`useDocumentState` 的 `writeAndSettle` / `autoSave` / `saveSession`
 * 在**多会话**下的写盘行为。
 *
 * 【为什么这是整个 P2 最危险的一类缺陷】
 * 单文档时代，`autoSave` 的**目标**读全局 `filePath.value`、**内容**读
 * `getEditor().state.doc` —— 两个独立来源。单文档下两者必然指向同一份文档，
 * 所以怎么看都对。多标签下后台标签的定时器一到，就会**把激活标签的正文写进
 * 后台标签的文件**：文件被覆盖、零报错、日志里只有一次「成功的保存」。
 * 这类错误不可撤销（用户的稿子被另一份稿子覆盖），且任何「写盘次数」类断言
 * 都恰好成立 —— 故判据只能打在 **(path, content) 二元组配对**上。
 *
 * 【判据的区分性要求】
 * 每个用例都让两个会话的 path 与 content **都不同**，否则「写对了」与「写串了」
 * 结果相同（等价变异，见 MD-14 的教训）。
 */
import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { useEditorSession } from '../src/composables/useEditorSession.js'
import { useDocumentState } from '../src/composables/useDocumentState.js'

globalThis.requestAnimationFrame ??= (fn) => fn()

const realWarn = console.warn.bind(console)
console.warn = (msg, ...rest) => {
  if (typeof msg === 'string' && /is called when there is no active component instance/.test(msg)) return
  realWarn(msg, ...rest)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * [注意] 每例结束清掉它排的自动保存定时器：定时器闭包持有会话对象，会在**后续用例**
 * 里触发写盘，被算到下一条用例的记录器上（跨用例污染）。本仓
 * `image-paste.test.mjs` 覆盖 `globalThis.window` 不还原就是这种形态的反面教材。
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

/**
 * Wails 绑定的记录型替身。
 * `wailsjs/go/main/App.js` 的每个导出都是「调用时」读 `window.go.main.App.X`，
 * 故这里在调用前装好即可拦到（与 image-paste.test.mjs 同一手法）。
 */
function installGoStub({ writeDelay = 0 } = {}) {
  const writes = []   // [{ path, content }]  ← 判据的载体
  const snaps = []
  globalThis.window = {
    runtime: {},
    go: {
      main: {
        App: {
          WriteFile: async (path, content) => {
            if (writeDelay) await sleep(writeDelay)
            writes.push({ path, content })
          },
          SnapshotWrite: async (path, content) => { snaps.push({ path, content }) },
          SaveFileDialog: async () => '', // 另存为：用户点取消
          SetDirty: () => {},
        },
      },
    },
  }
  return { writes, snaps }
}

/** 视图替身：只复刻 activateSession / 事务派发真正用到的成员 */
function makeView(initialState) {
  const view = {
    state: initialState,
    composing: false,
    focused: false,
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
    focus() { this.focused = true },
  }
  return view
}

function makeApp(goOpts) {
  const go = installGoStub(goOpts)
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
  const view = makeView(session.getActiveSession().state)
  editorRef.value = view
  const app = { ...go, session, docState, editorRef, view }
  liveApps.push(app)
  return app
}

/** 在光标处插入（走真实事务，会让 updateListener 回写 session.state） */
function type(ctx, text) {
  const pos = ctx.view.state.doc.length
  ctx.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
}

describe('写盘同源 · 自动保存（MD-01 后台标签也保存）', () => {
  test('后台标签的定时器写它自己的 path 与自己的内容（不是激活标签的）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })

    await ctx.session.activateSession(a)
    type(ctx, 'x')          // A 里输入 → A 脏，定时器（800ms）挂在 A 上
    ctx.docState.markDirty() // App.vue 的 onDocChange 干的就是这一句
    assert.equal(a.dirty, true)

    await ctx.session.activateSession(b)  // 切到 B：A 变成后台标签，定时器仍在
    assert.equal(a.dirty, true, '切走不应把 A 的脏标记清掉（MD-07 只要求留底快照）')

    await sleep(1000) // 等 A 的 800ms 防抖到点

    assert.deepEqual(
      ctx.writes,
      [{ path: '/a.md', content: 'AAAx' }],
      '后台标签的自动保存必须写 A 的 path 与 A 的内容。' +
        `实际写盘：${JSON.stringify(ctx.writes)}。` +
        '若出现 /b.md，就是「目标读全局 filePath、内容读激活会话」的串写 — 用户稿子被覆盖且不报错。',
    )
  })

  test('两个标签各自保存：每条写盘记录的 content 就是那条 path 对应会话的内容', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/one.md', content: 'ONE' })
    const b = ctx.session.createSession({ path: '/two.md', content: 'TWO' })

    await ctx.session.activateSession(a)
    ctx.docState.markDirty()
    await ctx.docState.saveSession(a)
    await ctx.session.activateSession(b)
    ctx.docState.markDirty()
    await ctx.docState.saveSession(b)

    assert.deepEqual(ctx.writes, [
      { path: '/one.md', content: 'ONE' },
      { path: '/two.md', content: 'TWO' },
    ], 'path 与 content 必须成对匹配')
  })
})

describe('写盘同源 · 「是否仍是最新」按会话比对（不按激活标签）', () => {
  test('保存后台标签 A：A 转干净，激活标签 B 的脏标记不受影响', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })

    await ctx.session.activateSession(a)
    ctx.docState.markDirty()
    await ctx.session.activateSession(b)
    ctx.docState.markDirty() // 现在 B 是激活且脏的
    assert.equal(b.dirty, true)

    const ok = await ctx.docState.saveSession(a)
    assert.equal(ok, true)
    assert.deepEqual(ctx.writes.at(-1), { path: '/a.md', content: 'AAA' }, '写的是 A 的路径与内容')
    assert.equal(a.dirty, false, 'A 已落盘 → A 必须转干净')
    assert.equal(
      b.dirty, true,
      'B 的脏标记被 A 的落盘清掉了 —— 这是「按全局 dirty / 全局 filePath 比对」的症状：' +
        '后台落盘把激活标签的未保存改动当成了「已保存」，用户以为存了，其实没有。',
    )
  })

  /**
   * 【契约级判据：比对的主体必须是**传入的那个 session**，不是「当时激活的那个」】
   * 这条构造的是「被存的文档在写盘期间内容又变了」：`writeAndSettle` 的比对若落到
   * 激活标签上，就会把「改了」误判成「没改」，于是把一份已经过时的落盘当成最新、
   * 清掉脏标记 —— 用户后续关窗口不弹确认，改动丢失。
   *
   * 为什么这里要手工换 a.state：后台标签的正文平时不会自己变（用户改不到它），
   * 故这条**不是**用户流程用例，而是把 `writeAndSettle` 的合同钉死：判据只认入参。
   * 若将来出现「后台同步 / 恢复快照 / 文件被外部改动后回灌」这类路径，它就是第一道网。
   */
  test('被存的会话在写盘期间内容变了 → 仍保持脏（比对主体是入参，不是激活标签）', async () => {
    const ctx = makeApp({ writeDelay: 40 })
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })
    await ctx.session.activateSession(b) // 激活的是 B；A 是后台
    a.dirty = true

    const saving = ctx.docState.saveSession(a)
    await sleep(10) // 让 WriteFile 停在「进行中」
    // 写盘期间 A 的文档变了（t0 写出去的是 'AAA'，内存已是 'AAANEW'）
    a.state = a.state.update({ changes: { from: 3, insert: 'NEW' } }).state
    await saving

    assert.deepEqual(ctx.writes.at(-1), { path: '/a.md', content: 'AAA' }, '落盘的是发起那一刻的内容')
    assert.equal(
      a.dirty, true,
      '写盘期间内容变了 → 必须保持脏。若比对落在激活标签（B）上，就会误判「没变」→ 清脏 → ' +
        '下一次关窗口认为已保存 → 这段改动静默丢失。',
    )
    assert.equal(b.dirty, false, 'B 全程没被改过')
  })
})

describe('写盘同源 · 落盘期间继续输入（ADR-005 的忠实实现）', () => {
  test('保存 A 期间 A 又被改 → 写完后 A 仍为脏（不静默丢 t1）', async () => {
    // WriteFile 故意慢，制造「写入期间用户继续输入」的窗口
    const ctx = makeApp({ writeDelay: 30 })
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    await ctx.session.activateSession(a)
    ctx.docState.markDirty()

    const saving = ctx.docState.saveSession(a)
    type(ctx, 'LATE')               // 写入还没回来，A 的内存内容已经变了
    await saving

    assert.deepEqual(ctx.writes.at(-1), { path: '/a.md', content: 'AAA' }, '落盘的是发起时那一刻的内容')
    assert.equal(a.dirty, true, '写入期间又被改 → 必须保持脏，否则 LATE 这段改动被静默丢弃')
    assert.equal(a.saveState, 'unsaved')
  })
})
