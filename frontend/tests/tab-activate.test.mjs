/**
 * tab-activate.test.mjs — 切标签的状态保真（P1，核心时序）
 * ============================================================================
 * 被测对象：`useEditorSession` 的 `activateSession`（架构方案 §5.2 的 15 步时序）。
 *
 * 【判据为什么是「内容 / 光标 / 滚动 / 撤销栈」而不是「切换成功」】
 * 这四样恰是「切了但没切对」的四张脸，而它们的失败**都不抛异常**：
 *   ① 内容回退 —— `session.state` 没回写，切回时 setState 装的是旧 state；
 *   ② 光标丢失 —— 只回写 docChanged、漏了 selectionSet；
 *   ③ 滚动归零 —— `scrollTop` 不在 EditorState 里，setState 会重建 docView；
 *   ④ 撤销栈串档 —— 两标签共用一份 state（而不是各持一份）。
 * `assert(doc === 期望)` 对这四种情况都会红，`assert(切换没抛错)` 一种都抓不到。
 *
 * 【驱动方式：真 EditorState + 视图替身】
 * Node 里没有 DOM，造不出真 `EditorView`（那需要 WKWebView / 无头 Chrome，
 * 属 `scripts/probe/` 的职责）。但**状态**可以全真：两份 state 由
 * `useEditorSession.createSession` 用**共享的同一份扩展**造出来，`history()`
 * 是真的、撤销栈是真的、选区是真的。视图替身只复刻三件 `activateSession`
 * 真正依赖的事：`state` / `setState` / `scrollDOM.scrollTop`，外加把事务交给
 * `state` 里的 `updateListener` facet（**这一点不可省** —— 少了它，「监听器是否
 * 装进了每一份 state」这条判据就测不出来，而那正是 setState 换 state 时最容易
 * 静默失效的接线）。
 *
 * 【区分性要求】两个标签的内容必须可区分（"AAA" / "BBB"）。若都用同一段文字，
 * 「切回显示旧内容」与「切回显示正确内容」的结果相同 —— 那是假绿灯。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shallowRef } from 'vue'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { undo } from '@codemirror/commands'
import { useEditorSession } from '../src/composables/useEditorSession.js'
import { stripComments } from './helpers/lexer.mjs'

// Node 里没有 rAF；步骤 9 的滚动恢复依赖它。同步执行即可（断言因此是确定性的）。
globalThis.requestAnimationFrame ??= (fn) => fn()

const realWarn = console.warn.bind(console)
console.warn = (msg, ...rest) => {
  if (typeof msg === 'string' && /is called when there is no active component instance/.test(msg)) return
  realWarn(msg, ...rest)
}

/**
 * 视图替身。只实现 activateSession 会碰到的成员，并**复刻 CM6 的派发语义**：
 * 事务生效后把 update 交给 `state.facet(EditorView.updateListener)` 里的回调。
 */
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
        view,
        state: tr.state,
        startState: tr.startState,
        transactions: [tr],
        changes: tr.changes,
        docChanged: tr.docChanged,
        selectionSet: tr.selection !== undefined,
      }
      for (const fn of tr.state.facet(EditorView.updateListener)) fn(update)
      return tr
    },
    focus() { this.focused = true },
  }
  return view
}

/** 建一个「已有 view 在编辑」的会话环境（模拟 onMounted 之后的形态） */
function mount() {
  const editorRef = shallowRef(null)
  const docChanges = []
  const s = useEditorSession({
    editorRef,
    onDocChange: () => docChanges.push(1),
    onImageFile: () => {},
    onClipboardImage: () => {},
    typewriterOn: shallowRef(false),
    onOutlineRefresh: () => {},
    onEditorReady: () => {},
    zoom: shallowRef(100),
    focusOn: shallowRef(false),
    invalidateOutline: () => {},
  })
  // onMounted 不在组件里不会执行，这里手工把视图装进槽位（与真实装配后的形态一致）
  const view = makeView(s.activeSession.value.state)
  editorRef.value = view
  return { s, view, editorRef, docChanges }
}

/** 在光标处插入文本（走真实事务 + 真实监听器） */
function type(view, text) {
  const pos = view.state.doc.length
  view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
}

describe('切标签 · 内容保真', () => {
  test('切走再切回，装的是**最新**内容（不是切走时的旧 state）', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    const b = s.createSession({ path: '/b.md', content: 'BBB' })

    await s.activateSession(a)
    assert.equal(view.state.doc.toString(), 'AAA')
    type(view, '111') // A 里编辑 → 新 state
    assert.equal(view.state.doc.toString(), 'AAA111')

    await s.activateSession(b)
    assert.equal(view.state.doc.toString(), 'BBB', '切到 B 必须是 B 的内容')

    await s.activateSession(a)
    assert.equal(
      view.state.doc.toString(), 'AAA111',
      '切回 A 必须拿到**编辑后**的内容 —— 拿到 "AAA" 说明 session.state 没回写（静默丢稿）',
    )
  })

  test('两个标签的内容可区分：切回 A 不得带出 B 的任何字符', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    const b = s.createSession({ path: '/b.md', content: 'BBB' })

    await s.activateSession(b)
    type(view, 'zzz')
    await s.activateSession(a)
    assert.equal(view.state.doc.toString(), 'AAA')
    assert.ok(!view.state.doc.toString().includes('B'), '切回 A 后不得残留 B 的内容')
    assert.ok(!view.state.doc.toString().includes('z'), '切回 A 后不得残留 B 的编辑')
  })
})

describe('切标签 · 监听器必须活在每一份 state 里', () => {
  test('切换之后打字仍能触发 onDocChange（setState 会整体替换 state，监听器随 state 走）', async () => {
    const { s, view, docChanges } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })

    await s.activateSession(a)
    const before = docChanges.length
    type(view, 'x')
    assert.ok(
      docChanges.length > before,
      '切标签后 onDocChange 不再被调用 —— 说明 updateListener 只装在 view 的**初始** ' +
        'state 上，切一次就永久丢失（症状：打字不标脏、预览不更新，且不报错）',
    )
  })

  test('切换之后选区变化仍能回写到当前会话（光标不丢）', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    await s.activateSession(a)
    view.dispatch({ selection: { anchor: 2 } })
    assert.equal(s.getActiveSession().state.selection.main.head, 2,
      'selectionSet 不触发 onDocChange，故 onUpdate 里必须也回写 state')
  })
})

describe('切标签 · 光标与滚动位置', () => {
  test('光标位置精确保留（移到位置 2，切走再切回仍在 2）', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    const b = s.createSession({ path: '/b.md', content: 'BBB' })

    await s.activateSession(a)
    view.dispatch({ selection: { anchor: 2 } })
    assert.equal(view.state.selection.main.head, 2)

    await s.activateSession(b)
    assert.equal(view.state.selection.main.head, 0, 'B 自己的光标在 0（区分性）')

    await s.activateSession(a)
    assert.equal(view.state.selection.main.head, 2, '切回 A 光标必须回到 2')
  })

  test('scrollTop 精确保留（且恢复值必须**不等于**顶部，否则测不出归零）', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    const b = s.createSession({ path: '/b.md', content: 'BBB' })

    await s.activateSession(a)
    view.scrollDOM.scrollTop = 240 // 真的滚下去（0 会让「归零」与「正确」不可区分）
    assert.notEqual(view.scrollDOM.scrollTop, 0)

    await s.activateSession(b)
    assert.equal(view.scrollDOM.scrollTop, 0, 'B 初始在顶部')

    await s.activateSession(a)
    assert.equal(
      view.scrollDOM.scrollTop, 240,
      '切回 A 的滚动位置没恢复 —— scrollTop 不在 EditorState 里，setState 会把它清零',
    )
  })
})

describe('切标签 · 撤销栈按标签隔离', () => {
  test('在 A 里 undo 撤不到 B 的编辑（两标签各持一份 state，不共用撤销栈）', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    const b = s.createSession({ path: '/b.md', content: 'BBB' })

    await s.activateSession(a)
    type(view, 'a1')
    await s.activateSession(b)
    type(view, 'b1')
    assert.equal(view.state.doc.toString(), 'BBBb1')

    await s.activateSession(a)
    assert.equal(view.state.doc.toString(), 'AAAa1')

    // 在 A 里撤销一次：应只撤掉 A 自己的那次输入
    undo({ state: view.state, dispatch: (spec) => { view.state = view.state.update(spec).state } })
    const after = view.state.doc.toString()
    assert.equal(after, 'AAA', '撤销一次应回到 A 的原始内容')
    assert.ok(!after.includes('B'), 'A 的撤销栈不得含 B 的编辑（共用一份 state 才会串档）')

    // B 的撤销栈不受影响
    await s.activateSession(b)
    assert.equal(view.state.doc.toString(), 'BBBb1', 'B 的内容不得因 A 撤销而改变')
  })
})

describe('切标签 · 重复激活与 MRU', () => {
  test('重复激活当前标签是空操作（不重建 docView）', async () => {
    const { s, view } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    await s.activateSession(a)
    const stateRef = view.state
    await s.activateSession(a)
    assert.equal(view.state, stateRef, '同一标签再次激活不得换 state 对象')
  })

  test('MRU：最近访问的在最前，且不重复', async () => {
    const { s } = mount()
    const a = s.createSession({ path: '/a.md', content: 'AAA' })
    const b = s.createSession({ path: '/b.md', content: 'BBB' })

    await s.activateSession(a)
    await s.activateSession(b)
    await s.activateSession(a)

    assert.deepEqual(s.mru.value.slice(0, 2), [a.id, b.id], 'MRU 头部应是最近访问的两个，且无重复')
    assert.equal(new Set(s.mru.value).size, s.mru.value.length, 'MRU 不得出现重复 id')
  })
})

describe('切标签 · IME 合成守卫（步骤 0）', () => {
  test('合成中请求切换 → 不立即换 state（预编辑文本只在 DOM 里，setState 会丢字）', async () => {
    const { s, view } = mount()
    const b = s.createSession({ path: '/b.md', content: 'BBB' })
    const prevId = s.activeId.value
    const prevDoc = view.state.doc.toString()

    view.composing = true
    await s.activateSession(b)
    assert.equal(view.state.doc.toString(), prevDoc, '合成中不得切换（否则未上屏的字消失）')
    assert.equal(s.activeId.value, prevId, '合成中 activeId 不得变')

    // 合成结束的那笔事务（composing 变 false）应把挂起的切换补上
    view.composing = false
    view.dispatch({ selection: { anchor: 0 } })
    await new Promise((r) => setTimeout(r, 0)) // 补执行走 setTimeout(…, 0)，见 onEditorUpdate
    assert.equal(view.state.doc.toString(), 'BBB', '合成结束后应执行被挂起的切换')
    assert.equal(s.activeId.value, b.id)
  })
})

// ===========================================================================
// 顺序契约的源码守卫（静态）
// ===========================================================================
/**
 * 【为什么需要一条源码断言 —— 变异 C 的实证】
 * 架构方案 §5.2 把「步骤 5 `view.setState(target.state)` 必须先于步骤 6
 * `activeId.value = target.id`」写成契约，但上面那些行为用例**抓不到顺序错**：
 * 视图替身只复刻了 state / setState / scrollDOM.scrollTop，没有接
 * `watch(filePath) → applyDocPath` 这条链，于是「顺序反了」的真实后果
 * （applyDocPath 的 dispatch 打在**旧** state 上 → 装饰按旧口径重建 →
 * 图片地址指向错目录）在单测里没有可观测差异。
 * 实测：把 setState 挪到 activeId 之后，上面 10 条行为用例仍然全部通过。
 * 故补这一条静态顺序断言 —— 它守的是**判据本身**，属静态契约而非行为测试。
 *
 * 【必须剥注释】`runActivation` 内外都有解释这两个调用先后的注释（连"顺序反了
 * 会怎样"都写在里面）。不剥的话 indexOf 会命中注释里的同名文本，顺序判据就变成
 * 「注释怎么写就怎么算」—— 本仓已因「匹配到注释里的代码」栽过 8 次
 * （见 wysiwyg-decor.test.mjs 的 stripComments 头注），故复用仓库既有的剥注释器。
 */
describe('切标签 · 顺序契约（源码守卫）', () => {
  const SRC = stripComments(
    readFileSync(new URL('../src/composables/useEditorSession.js', import.meta.url), 'utf8'),
  )

  /** 切出 runActivation 的函数体（到下一个顶层两空格缩进的 `}` 为止） */
  function activationBody() {
    const start = SRC.indexOf('async function runActivation(')
    assert.ok(start >= 0, '找不到 runActivation —— 判据锚点消失，结论不可采信')
    const end = SRC.indexOf('\n  }\n', start)
    assert.ok(end > start, '切不出 runActivation 的函数体 —— 判据锚点消失，结论不可采信')
    return SRC.slice(start, end)
  }

  test('两个锚点都在 runActivation 体内，且在全文唯一（否则下面的顺序断言会恒真）', () => {
    const body = activationBody()
    assert.ok(
      body.includes('view.setState(target.state)'),
      '体内找不到 view.setState(target.state) —— 顺序判据失效',
    )
    assert.ok(
      body.includes('activeId.value = target.id'),
      '体内找不到 activeId.value = target.id —— 顺序判据失效',
    )
    // 全文唯一性再核一次：切片边界一错就会比到别处的同名文本（假绿）
    assert.equal(SRC.split('view.setState(target.state)').length - 1, 1)
    assert.equal(SRC.split('activeId.value = target.id').length - 1, 1)
  })

  test('view.setState 必须先于 activeId 切换（顺序是契约，反了会静默错位）', () => {
    const body = activationBody()
    const setState = body.indexOf('view.setState(target.state)')
    const activate = body.indexOf('activeId.value = target.id')
    assert.ok(
      setState < activate,
      '顺序契约被破坏：view.setState(target.state) 必须写在 activeId.value = target.id 之前。' +
        '反了会怎样？第 6 步会触发 watch(filePath) → applyDocPath，它的 dispatch 打在**旧** ' +
        'state 上 → 图片装饰按旧口径重建 → 图片地址指向错目录 —— 全程不报错。',
    )
  })
})
