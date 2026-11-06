/**
 * tab-reopen.test.mjs — 恢复已关闭标签（⌘⇧T）+ 右键菜单的两条批量关闭（P4）
 * ============================================================================
 * 被测对象：`useTabLifecycle.reopenClosedTab` / `closeOthers` / `closeRight`。
 *
 * 【AC-62 为什么必须机检】「只恢复文件内容、位置回到文首」是 Sublime 社区的已知
 * 差评点：用户按 ⌘⇧T 是想「接着刚才干」，回到文档开头等于白恢复一次。而这条
 * 缺陷**不报错、不崩溃**，界面看起来只是「光标在开头」—— 人眼 review 抓不住。
 * 故判据必须是三个精确值：内容逐字相等、选区 from/to 相等、scrollTop 相等。
 *
 * 【批量关闭为什么必须逐个走 closeTab 而不是「一次移除 N 个」】
 * 每个被关的标签都可能是脏的、都可能弹三选一；用户中途取消就必须停下，
 * 已关的保持关闭、未关的原样留着。批量移除会一次性丢掉**未经确认**的稿子 ——
 * 静默丢稿，本仓明令禁止的形态。
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
  globalThis.window = {
    runtime: {},
    go: {
      main: {
        App: {
          WriteFile: async (path, content) => { writes.push({ path, content }) },
          SnapshotWrite: async () => {},
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
    getSessions: () => session.sessions.value,
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
  const app = { session, docState, tabs, view, writes }
  liveApps.push(app)
  return app
}

function type(ctx, text) {
  const pos = ctx.view.state.doc.length
  ctx.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
}

/** 关一个脏标签并给出答复 */
async function closeDirty(ctx, id, choice) {
  const p = ctx.tabs.closeTab(id)
  for (let i = 0; i < 100 && !ctx.tabs.confirmState.show; i++) await sleep(0)
  assert.equal(ctx.tabs.confirmState.show, true, '脏标签必须弹确认')
  ctx.tabs.resolveConfirm(choice)
  return p
}

describe('恢复已关闭标签 · AC-62（内容 / 选区 / 位置）', () => {
  test('关掉后 ⌘⇧T 恢复：内容逐字相等、选区与滚动位置一并回来', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'YYYYY' })
    await ctx.session.activateSession(a)
    type(ctx, 'Z')                                  // 内容 YYYYYZ，光标在末位
    ctx.view.dispatch({ selection: { anchor: 2 } }) // 选区故意停在中间（非 0 才可区分）
    ctx.view.scrollDOM.scrollTop = 345              // 位置同理必须非 0
    ctx.docState.markDirty()
    assert.equal(a.dirty, true)

    assert.equal(await closeDirty(ctx, a.id, 'discard'), true)
    assert.ok(!ctx.session.sessions.value.some((s) => s.id === a.id), '标签已关闭')

    ctx.view.scrollDOM.scrollTop = 0 // 抹掉现场，证明下面恢复的是快照而不是残留值
    assert.equal(await ctx.tabs.reopenClosedTab(), true)

    const back = ctx.session.activeSession.value
    assert.equal(back.path, '/a.md', '恢复出来的必须是同一个文件')
    assert.notEqual(back.id, a.id, '恢复应为新会话（旧 id 不复用，见 id 单调递增契约）')
    assert.equal(back.state.doc.toString(), 'YYYYYZ', '内容必须逐字相等（含关闭前的编辑）')
    assert.equal(
      ctx.view.state.selection.main.from, 2,
      '选区没恢复 —— 用户按 ⌘⇧T 是想接着刚才干，光标回到文首等于白恢复（AC-62）',
    )
    assert.equal(ctx.view.scrollDOM.scrollTop, 345, '滚动位置没恢复（AC-62 的另一半）')
  })

  test('关之前脏的，恢复出来仍然是脏的（磁盘从未被更新过）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    await ctx.session.activateSession(a)
    type(ctx, 'x')
    ctx.docState.markDirty()
    await closeDirty(ctx, a.id, 'discard')

    assert.equal(await ctx.tabs.reopenClosedTab(), true)
    const back = ctx.session.activeSession.value
    assert.equal(back.dirty, true, '恢复出来标成干净 = 关窗口时不再提示 = 静默丢稿')
    assert.equal(back.saveState, 'unsaved')
  })

  test('栈空时返回 false（调用方据此给轻提示，而不是静默无反应）', async () => {
    const ctx = makeApp()
    assert.deepEqual(ctx.tabs.closedStack.value, [])
    assert.equal(await ctx.tabs.reopenClosedTab(), false)
  })

  test('干净关闭的标签也能恢复（否则 ⌘⇧T 在真实使用里几乎永远是空的）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/clean.md', content: 'C' })
    assert.equal(a.dirty, false)
    assert.equal(await ctx.tabs.closeTab(a.id), true)
    assert.equal(ctx.tabs.closedStack.value.length, 1, '干净关闭也必须入栈')
    assert.equal(await ctx.tabs.reopenClosedTab(), true)
    assert.equal(ctx.session.activeSession.value.path, '/clean.md')
    assert.equal(ctx.session.activeSession.value.dirty, false, '干净恢复出来的仍是干净的')
  })

  test('同路径已在标签里 → 直接激活它，不造第二个（否则两份 state 交替写盘）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/dup.md', content: 'D' })
    await ctx.tabs.closeTab(a.id)
    const b = ctx.session.createSession({ path: '/dup.md', content: 'D' }) // 又打开了同一个文件
    await ctx.session.activateSession(ctx.session.sessions.value[0])

    assert.equal(await ctx.tabs.reopenClosedTab(), true)
    const same = ctx.session.sessions.value.filter((s) => s.path === '/dup.md')
    assert.equal(same.length, 1, '同一路径出现两个标签 —— 写盘会互相覆盖')
    assert.equal(ctx.session.activeId.value, b.id, '应激活已存在的那个')
  })
})

describe('右键菜单 · 关闭其他 / 关闭右侧（逐个走 closeTab）', () => {
  test('关闭其他：只留被右键的那个', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'A' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'B' })
    assert.equal(await ctx.tabs.closeOthers(b.id), true)
    assert.deepEqual(ctx.session.sessions.value.map((s) => s.id), [b.id], '应只剩 B')
    assert.equal(ctx.session.activeId.value, b.id, '落点必须是被保留的那个（其余都被关了）')
    assert.ok(!ctx.session.sessions.value.some((s) => s.id === a.id))
  })

  test('关闭其他中途取消 → 立即停止，取消的那个保持脏且内容不变', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })
    await ctx.session.activateSession(b)
    type(ctx, '!')
    ctx.docState.markDirty() // B 脏
    await ctx.session.activateSession(a) // 让 B 成为后台脏标签

    // 关 B 时会弹确认。注意 sessions 顺序：t1, a, b —— closeOthers(a) 会先关 t1 再关 B
    const p = ctx.tabs.closeOthers(a.id)
    for (let i = 0; i < 100 && !ctx.tabs.confirmState.show; i++) await sleep(0)
    assert.equal(ctx.tabs.confirmState.show, true, '脏标签必须弹确认')
    ctx.tabs.resolveConfirm('cancel')
    assert.equal(await p, false, '用户取消 → 整批停下')

    assert.ok(ctx.session.sessions.value.some((s) => s.id === b.id), '取消的那个必须还在')
    assert.equal(b.dirty, true)
    assert.equal(b.state.doc.toString(), 'BBB!', '内容必须原样保留')
  })

  test('关闭右侧：按显示序，只关自己右边的（自己与左边的保留）', async () => {
    const ctx = makeApp()
    const t1 = ctx.session.sessions.value[0].id
    const a = ctx.session.createSession({ path: '/a.md', content: 'A' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'B' })
    const c = ctx.session.createSession({ path: '/c.md', content: 'C' })
    // 显示序：t1, a, b, c
    assert.equal(await ctx.tabs.closeRight(a.id), true)
    assert.deepEqual(
      ctx.session.sessions.value.map((s) => s.id),
      [t1, a.id],
      '应只剩 t1 与 A（B、C 在自己右侧）',
    )
    assert.ok(!ctx.session.sessions.value.some((s) => s.id === b.id || s.id === c.id))
  })

  test('关闭右侧在最右那个上 → 无动作但也算成功（不是失败，只是没东西可关）', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'A' })
    const before = ctx.session.sessions.value.map((s) => s.id)
    assert.equal(await ctx.tabs.closeRight(a.id), true)
    assert.deepEqual(ctx.session.sessions.value.map((s) => s.id), before)
  })
})
