/**
 * tab-reorder.test.mjs — 拖拽重排（P4）
 * ============================================================================
 * 被测对象：`useEditorSession.reorder(fromIndex, toIndex)` / `moveSession(fromId, toId)`，
 * 以及 TabBar.vue 的拖拽装配契约。
 *
 * 【判据为什么打在「id 顺序真的变了」+「activeId 不变」上】
 *   ① 只断言「长度 / 集合不变」是恒真的：把实现写成「交换两个位置的元素」也能过，
 *      而那正是最容易犯的错（拖拽语义是**插入**，不是交换）。唯一有区分力的是顺序。
 *   ② 只断言「顺序变了」又会漏掉最容易犯的另一个错：顺手把 `activeId` 指到被拖的
 *      标签上（「拖一下就跳文档」）。与 MD-15 同源 —— 功能生效了，但用户感知为
 *      「点了别的东西」，界面上看不出是缺陷。
 *   ③ MRU **不得**跟着排列走：它是访问顺序，落点（MD-09）与浮层排序（MD-10）都
 *      依赖它；重排顺手重排 MRU，关标签的落点会跟着漂。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shallowRef } from 'vue'
import { useEditorSession } from '../src/composables/useEditorSession.js'
import { stripComments } from './helpers/lexer.mjs'

globalThis.requestAnimationFrame ??= (fn) => fn()

const realWarn = console.warn.bind(console)
console.warn = (msg, ...rest) => {
  if (typeof msg === 'string' && /is called when there is no active component instance/.test(msg)) return
  realWarn(msg, ...rest)
}

function makeFour() {
  const s = useEditorSession({
    editorRef: shallowRef(null),
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
  const a = s.createSession({ path: '/a.md', content: 'A' })
  const b = s.createSession({ path: '/b.md', content: 'B' })
  const c = s.createSession({ path: '/c.md', content: 'C' })
  return { s, ids: [a.id, b.id, c.id], order: () => s.sessions.value.map((x) => x.id) }
}

describe('拖拽重排 · 顺序', () => {
  test('把末尾那个拖到最前：顺序真的变了，且对象身份不变', () => {
    const { s, order } = makeFour()
    const before = s.sessions.value.slice()
    const last = before[before.length - 1]

    assert.equal(s.reorder(3, 0), true, '下标 3 → 0 应生效')
    assert.deepEqual(
      order(),
      [last.id, ...before.slice(0, 3).map((x) => x.id)],
      '插入语义：被拖的插到目标位置，其余依次后移（若实现成「交换」这里就不等）',
    )
    assert.equal(s.sessions.value[0], last, '必须是同一个 session 对象（换对象会让 state / 脏标记脱钩）')
    assert.deepEqual(
      order().slice().sort(),
      before.map((x) => x.id).sort(),
      '重排不得增删任何标签',
    )
  })

  test('往前拖与往后拖都可逆（插入语义 vs 交换语义的分水岭）', () => {
    const { s, order } = makeFour()
    const orig = order()
    assert.equal(s.reorder(0, 2), true)
    assert.deepEqual(order(), [orig[1], orig[2], orig[0], orig[3]])
    assert.equal(s.reorder(2, 0), true)
    assert.deepEqual(order(), orig, '反向操作必须回到原顺序')
  })

  test('原地 / 越界 / 非整数一律返回 false 且不动顺序', () => {
    const { s, order } = makeFour()
    const orig = order()
    assert.equal(s.reorder(1, 1), false, '原地：没有变化')
    assert.equal(s.reorder(-1, 2), false)
    assert.equal(s.reorder(0, 4), false, '目标越界必须拒绝（否则 splice 会插到末尾之外）')
    assert.equal(s.reorder(9, 0), false)
    assert.equal(s.reorder(0, 1.5), false)
    assert.deepEqual(order(), orig)
  })
})

describe('拖拽重排 · 不得改变的两件事', () => {
  test('activeId 不变（拖拽不是「切标签」）', () => {
    const { s, ids } = makeFour()
    s.activeId.value = ids[1]
    assert.equal(s.reorder(2, 0), true)
    assert.equal(
      s.activeId.value,
      ids[1],
      '拖拽把 activeId 拽到被拖的标签上 —— 用户感知为「拖一下就跳文档」，' +
        '与 MD-15 同源的反直觉缺陷（功能生效了，但像点了别的东西）',
    )
  })

  test('MRU 不变（它是访问顺序，与排列正交；落点与浮层都依赖它）', () => {
    const { s, ids } = makeFour()
    const mruBefore = s.mru.value.slice()
    assert.deepEqual(mruBefore.slice(0, 3), [ids[2], ids[1], ids[0]], '前提：MRU 最近创建的在前')
    s.reorder(3, 0)
    assert.deepEqual(s.mru.value, mruBefore, 'MRU 跟着排列走会让关标签的落点（MD-09）漂移')
  })
})

describe('拖拽重排 · moveSession（按 id 的组件侧入口）', () => {
  test('fromId → toId 的位置，等价于按下标 reorder', () => {
    const { s, ids, order } = makeFour()
    const t1 = s.sessions.value[0].id
    assert.equal(s.moveSession(ids[0], ids[2]), true)
    assert.deepEqual(order(), [t1, ids[1], ids[2], ids[0]])
  })

  test('未知 id 返回 false（不许静默变成「移动到 -1」）', () => {
    const { s, ids, order } = makeFour()
    const orig = order()
    assert.equal(s.moveSession('t999', ids[0]), false)
    assert.equal(s.moveSession(ids[0], 't999'), false)
    assert.deepEqual(order(), orig)
  })
})

describe('拖拽重排 · TabBar 装配契约', () => {
  const TAB_BAR = stripComments(
    readFileSync(new URL('../src/components/TabBar.vue', import.meta.url), 'utf8'),
  )
  const APP = stripComments(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'))

  test('标签真的可拖，四件事都接了（start / over / drop / end）', () => {
    assert.match(TAB_BAR, /draggable="true"/, '标签没有 draggable —— 浏览器不会发起拖拽')
    for (const h of ['@dragstart', '@dragover', '@drop', '@dragend']) {
      assert.ok(TAB_BAR.includes(h), `缺 ${h}：拖拽会「开始了但落不下去」（或落下后拖拽态不复位）`)
    }
    assert.ok(
      TAB_BAR.includes('@dragover.prevent'),
      '@dragover 必须 .prevent —— 不阻止默认行为时浏览器不会把元素当成 drop 目标',
    )
  })

  test('拖拽态有两个非颜色信号，且都有对应样式（不是死属性）', () => {
    assert.match(TAB_BAR, /:data-dragging=/, '缺 data-dragging：拖动中没有任何可见反馈')
    assert.match(TAB_BAR, /:data-drop-target=/, '缺 data-drop-target：用户看不出会插到哪一格')
    assert.match(TAB_BAR, /\.tab\[data-dragging='true'\]/, 'data-dragging 必须真有样式')
    assert.match(TAB_BAR, /\.tab\[data-drop-target='true'\]/, 'data-drop-target 必须真有样式')
  })

  test('App.vue 把 @move 接到 moveSession（否则拖了个寂寞，且不报错）', () => {
    const tag = (APP.match(/<TabBar\b[\s\S]*?\/>/) || [''])[0]
    assert.ok(tag.length > 0, 'App.vue 里找不到 <TabBar … /> —— 判据锚点失效')
    assert.match(tag, /@move="[^"]*moveSession"/, `拖拽事件没接到 moveSession。实际标签：${tag}`)
  })
})
