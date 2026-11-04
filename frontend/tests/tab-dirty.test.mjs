/**
 * tab-dirty.test.mjs — per-session 的 dirty / saveState，以及「Go 侧镜像必须盯聚合」
 * ============================================================================
 * 被测对象：`useDocumentState` 的 `dirty` / `saveState`（P2 起是**激活会话的派生值**）
 * 与它的 `SetDirty` 镜像。
 *
 * 【本文件最重要的一条：Go 侧那面镜子必须盯 anyDirty，不能盯 dirty】
 * `OnBeforeClose` / `CloseWindow` 的未保存确认读的是 Go 侧镜像。P2 之后 `dirty`
 * 只反映**激活标签**。若镜像仍盯着它，就会出现最坏的一类静默丢稿：
 *   ① A 有未保存改动（Go 收到 true）
 *   ② 用户切到干净的 B → `dirty` 由 true 变 **false** → Go 收到 false → 以为全干净
 *   ③ 用户关窗口 → 不弹确认 → **A 的稿子直接没了**，全程无报错
 * 故本文件的核心判据是「切到干净标签**不得**把 Go 的镜像翻成 false」。
 *
 * 【判据的区分性】只断言「SetDirty 被调用过」是假绿灯（两种实现都会调用）。
 * 必须断言**调用序列里的具体值**，且构造出「激活标签干净、后台标签脏」的状态。
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
 * 里触发写盘 / SetDirty，被算到下一条用例头上（跨用例污染，本仓
 * `image-paste.test.mjs` 就是这种形态的反面教材）。
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
  const setDirtyCalls = []
  const goDirtyMap = new Map()
  const forgetCalls = []
  globalThis.window = {
    runtime: {},
    go: {
      main: {
        App: {
          WriteFile: async () => {},
          SnapshotWrite: async () => {},
          SaveFileDialog: async () => '',
          // 复刻 Go 侧 App.dirtyByDoc 的行为（app.go），而不是只记调用序列：
          // 判据要打在「Go 侧映射里的状态」上，那才是关闭守卫真正读的东西。
          SetDirty: (id, d) => {
            setDirtyCalls.push([id, d])
            if (d) goDirtyMap.set(id, true)
            else goDirtyMap.delete(id)
          },
          ForgetDoc: (id) => { forgetCalls.push(id); goDirtyMap.delete(id) },
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
  // 环引用：让 view 参与 update 对象
  editorRef.value = view
  const app = { session, docState, editorRef, view, setDirtyCalls, forgetCalls,
    goDirty: (id) => goDirtyMap.has(id),
    goAnyDirty: () => goDirtyMap.size > 0 }
  liveApps.push(app)
  return app
}

function type(ctx, text) {
  const pos = ctx.view.state.doc.length
  ctx.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
}

describe('per-session dirty · 各标签独立', () => {
  test('A 脏不影响 B；切换后 dirty 跟着激活会话走', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })

    await ctx.session.activateSession(a)
    type(ctx, 'x')
    ctx.docState.markDirty()
    assert.equal(ctx.docState.dirty.value, true, 'A 是激活标签且脏 → dirty 为 true')
    assert.equal(b.dirty, false, 'B 未被编辑 → 必须仍是干净的')

    await ctx.session.activateSession(b)
    assert.equal(ctx.docState.dirty.value, false, '切到干净的 B → 激活会话的 dirty 为 false')
    assert.equal(a.dirty, true, 'A 在后台仍是脏的（dirty 是会话自己的字段）')
  })

  test('两个标签都脏 → 切来切去 dirty 恒为 true', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })

    await ctx.session.activateSession(a)
    ctx.docState.markDirty()
    await ctx.session.activateSession(b)
    ctx.docState.markDirty()
    await ctx.session.activateSession(a)
    assert.equal(ctx.docState.dirty.value, true)
    await ctx.session.activateSession(b)
    assert.equal(ctx.docState.dirty.value, true)
  })

  test('saveState 按会话：A 保存成功不改变 B 的保存态', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })

    await ctx.session.activateSession(a)
    ctx.docState.markDirty()
    await ctx.session.activateSession(b)
    ctx.docState.markDirty()
    assert.equal(b.saveState, 'unsaved')

    await ctx.docState.saveSession(a)          // 保存后台的 A
    assert.equal(a.saveState, 'saved', 'A 已保存')
    assert.equal(b.saveState, 'unsaved', 'B 的保存态不得被 A 的保存影响')
    assert.equal(ctx.docState.saveState.value, 'unsaved', '状态栏显示的是激活会话（B）的保存态')
  })
})

describe('MD-03 · 未落盘【空】文档的 dirty 初值', () => {
  test('新建的空白标签 dirty=false；一有输入立刻转 true', async () => {
    const ctx = makeApp()
    const s = ctx.session.createSession({ path: '', content: '' })
    assert.equal(s.dirty, false, '空文档无内容可丢（MD-03）')
    await ctx.session.activateSession(s)
    type(ctx, 'a')
    ctx.docState.markDirty()
    assert.equal(s.dirty, true, '一旦有输入立即转为脏（MD-03 的后半句）')
  })
})

describe('Go 侧镜像逐文档（ADR-005 §四 的 docKey→dirty 映射）', () => {
  test('切到干净的标签**不得**抹掉后台标签在 Go 侧的脏标记', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })
    const b = ctx.session.createSession({ path: '/b.md', content: 'BBB' })

    await ctx.session.activateSession(a)
    type(ctx, 'x')
    ctx.docState.markDirty()
    await sleep(0)
    assert.equal(ctx.goDirty('/a.md'), true, 'A 变脏 → Go 侧 /a.md 条目为 true')

    await ctx.session.activateSession(b)
    await sleep(0)
    assert.equal(
      ctx.goDirty('/a.md'), true,
      '切到干净的 B 后，Go 侧 /a.md 的脏标记**必须仍在**。' +
        '若被抹掉，关闭守卫就会读到「全都存好了」：用户关窗口不弹确认，A 的稿子静默丢失。' +
        `实际调用序列：${JSON.stringify(ctx.setDirtyCalls)}`,
    )
    assert.equal(ctx.goDirty('/b.md'), false, 'B 自己是干净的，不该有条目')
    assert.equal(ctx.goAnyDirty(), true, '聚合判定（关闭守卫的唯一输入）仍是「有脏文档」')
  })

  test('全部标签都存好之后，Go 侧映射清空、聚合转 false', async () => {
    const ctx = makeApp()
    const a = ctx.session.createSession({ path: '/a.md', content: 'AAA' })

    await ctx.session.activateSession(a)
    ctx.docState.markDirty()
    await sleep(0)
    assert.equal(ctx.goAnyDirty(), true, '存之前 Go 侧仍有脏文档')
    await ctx.docState.saveSession(a)
    await sleep(0)
    assert.equal(ctx.goDirty('/a.md'), false, '存好后 /a.md 的条目应被删掉（不是留着 false 值）')
    assert.equal(ctx.goAnyDirty(), false, '全部干净后聚合必须转 false')
    assert.equal(ctx.session.anyDirty.value, false)
  })
})
