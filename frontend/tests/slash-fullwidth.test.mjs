/**
 * slash-fullwidth.test.mjs — 斜杠面板的中文输入法路径（2026-10-14 新增）
 * ---------------------------------------------------------------------------
 * 背景（真机验收 #7，用户原话：「斜杆没反应」）：
 * keymap 原来只绑半角 '/'。中文输入法在中文标点模式下，/ 键产出的是**全角
 * 斜线 U+FF0F（'／'）**，w3c-keyname 原样返回 event.key，于是永远匹配不上
 * —— 用户在新行行首按斜杠，面板「没反应」，且没有任何报错。
 * （早先的 CDP 探针用 dispatchKeyEvent 送半角 '/' 模拟，绕开了输入法，
 * 所以探针全绿而真机红 —— 假绿灯的又一形态。）
 *
 * 两条修复路径，两种验证手段，分工明确：
 *   ① keymap 增绑 '／'   → 本文件用**真实扩展 + 真 keyName + 真 run**
 *                          验证绑定表（见文末接线 pin）；真实按键路径另由
 *                          scripts/probe/probe-r11-fixes.mjs 在无头 Chrome
 *                          里 dispatch 全角键端到端复验。
 *   ② updateListener 兜底 → 输入法若不产生可匹配的 keydown（走
 *                          composition/insertText），从「刚插入的单个
 *                          斜杠字符」反推开面板。本文件用**真 ChangeSet
 *                          + 假 host** 驱动这条路径的全部边界；
 *                          「updateListener 真的调用了它」由探针端到端钉死。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { maybeOpenFromInserted, slashCommandExtension } from '../src/editor/slashCommand.js'

/** 与 createEditor.js 同款 GFM 解析器（真实 ChangeSet 的来源） */
const GFM = markdown({ base: markdownLanguage })

/** 造一次「文档里插入了 text」的真实事务，包装成 updateListener 看到的形态 */
function updateAfterInsert(doc, insert, from) {
  const state = EditorState.create({ doc, extensions: [GFM] })
  const tr = state.update({ changes: { from, insert } })
  return {
    state: tr.state,
    view: { state: tr.state },
    changes: tr.changes,
    docChanged: true,
  }
}

/** 假 host：记录 openMenu 调用；isOpen 可配置（验证「不双开」） */
function stubHost({ open = false } = {}) {
  const calls = []
  return {
    calls,
    isOpen: () => open,
    openMenu: (view, anchor) => calls.push({ anchor }),
  }
}

describe('maybeOpenFromInserted · 输入法兜底路径（真 ChangeSet + 假 host）', () => {
  test('行首插入全角 ／ → 补开面板，锚点 = 插入位置', () => {
    const host = stubHost()
    // 空文档行首插入 ／：锚点应为 0
    maybeOpenFromInserted(updateAfterInsert('', '／', 0), host)
    assert.equal(host.calls.length, 1, '全角斜杠必须能开面板')
    assert.equal(host.calls[0].anchor, 0)
  })

  test('行首插入半角 / → 同样补开（两条路径行为一致）', () => {
    const host = stubHost()
    // 'a\n' 长 2；第二行行首 = 位置 2
    maybeOpenFromInserted(updateAfterInsert('a\n', '/', 2), host)
    assert.equal(host.calls.length, 1)
    assert.equal(host.calls[0].anchor, 2)
  })

  test('行首空白之后插入 ／ → 开（与 onSlash 的行首守卫同口径）', () => {
    const host = stubHost()
    maybeOpenFromInserted(updateAfterInsert('  ', '／', 2), host)
    assert.equal(host.calls.length, 1)
    assert.equal(host.calls[0].anchor, 2)
  })

  test('行中间插入 ／ → 不开（路径 / 日期里的斜杠是正常正文）', () => {
    const host = stubHost()
    maybeOpenFromInserted(updateAfterInsert('https://a', '／', 8), host)
    assert.equal(host.calls.length, 0, '行首守卫必须与按键路径逐字一致')
  })

  test('第二行行首插入 ／ → 开（锚点取全局位置，不是行内位置）', () => {
    const host = stubHost()
    // '第一行\n' 长度 4；第二行行首 = 位置 4
    maybeOpenFromInserted(updateAfterInsert('第一行\n', '／', 4), host)
    assert.equal(host.calls.length, 1)
    assert.equal(host.calls[0].anchor, 4)
  })

  test('多字符插入（粘贴 / 片段 / 整段替换）→ 一律不开', () => {
    const host = stubHost()
    maybeOpenFromInserted(updateAfterInsert('', '／t', 0), host)
    assert.equal(host.calls.length, 0)
    // 插入的文本里含斜杠但不止一个字符：同样不开
    maybeOpenFromInserted(updateAfterInsert('', 'a／', 0), host)
    assert.equal(host.calls.length, 0)
  })

  test('面板已开着 → 不开（避免与按键路径双开；过滤词归 syncFromDoc 管）', () => {
    const host = stubHost({ open: true })
    maybeOpenFromInserted(updateAfterInsert('', '／', 0), host)
    assert.equal(host.calls.length, 0)
  })

  test('host 缺失 → 静默返回不抛（组件未挂载窗口期）', () => {
    assert.doesNotThrow(() => maybeOpenFromInserted(updateAfterInsert('', '／', 0), null))
    assert.doesNotThrow(() => maybeOpenFromInserted(updateAfterInsert('', '／', 0), undefined))
  })

  test('非斜杠单字符（普通打字）→ 不开（每键都走这条路径，误开就是噪音）', () => {
    const host = stubHost()
    maybeOpenFromInserted(updateAfterInsert('', 'a', 0), host)
    maybeOpenFromInserted(updateAfterInsert('', '，', 0), host)
    assert.equal(host.calls.length, 0)
  })
})

// ===========================================================================
// 接线 pin：keymap 必须同时绑两种斜线形态
// ---------------------------------------------------------------------------
// 手段（行为测试，非源码正则）：构造**真实扩展** slashCommandExtension →
// 从 EditorState 的 keymap facet 取回 CM 真正会用的绑定表（摊平方式与
// @codemirror/view 内部 getKeymap 逐字一致）→ 用 w3c-keyname 的**真**
// keyName 解析按键 → 调**真** run。删掉 / 注释掉 '／' 绑定立刻红。
//
// 为什么不许用源码正则 assert.match(code, /key: '／'/)：变异自证时实测，
// 把绑定行注释掉后正则照样匹配注释文本 → 假绿。正则看不见「绑定还在不在
// 表里」，只有 facet 能。
//
// 为什么精确匹配 b.key 就等价于 CM 的解析：本表所有绑定都无修饰键、
// 无 platform 覆盖、无 shift；CM 的 runHandlers 对无修饰字符键就是
// `keyName(event)` 查 `b[platform] || b.key`（dist/index.js buildKeymap）。
// ===========================================================================
import { keymap as keymapFacet } from '@codemirror/view'
import { keyName } from 'w3c-keyname'

/** 从真实扩展里取「CM 真正会执行的绑定表」+ 一个记录 openMenu 的假 host */
function bindingsFromRealExtension(doc = '') {
  const opened = []
  const host = {
    isOpen: () => false,
    openMenu: (view, anchor) => opened.push(anchor),
    move: () => {}, confirm: () => {}, close: () => {}, syncFromDoc: () => {},
  }
  const state = EditorState.create({ doc, extensions: slashCommandExtension(() => host) })
  const table = state.facet(keymapFacet).reduce((a, b) => a.concat(b), [])
  return { table, opened }
}

/** 按真实 keyName 解析结果在绑定表里找绑定（找不到返回 undefined） */
function bindingForKey(key) {
  const { table, opened } = bindingsFromRealExtension()
  const b = table.find((x) => x.key === keyName({ key }))
  return { binding: b, opened }
}

/** 假 view：够 onSlash 用（selection / doc.lineAt / dispatch） */
function stubView(doc = '') {
  const dispatched = []
  return {
    dispatched,
    state: {
      selection: { main: { empty: true, head: doc.length } },
      doc: { length: doc.length, lineAt: () => ({ from: 0, text: doc }) },
    },
    dispatch: (tr) => dispatched.push(tr),
  }
}

describe('keymap 接线 pin（真实扩展 + 真 keyName + 真 run）', () => {
  test("绑定表里有 key: '／'（全角，中文输入法形态）且 run 真的开面板", () => {
    const { binding, opened } = bindingForKey('／')
    assert.ok(binding, "全角绑定丢失（中文输入法用户将再次「按了没反应」）")
    const view = stubView()
    assert.equal(binding.run(view), true, 'run 必须消费该键')
    assert.equal(view.dispatched.length, 1, 'onSlash 应在同事务里插入斜杠')
    assert.equal(view.dispatched[0].changes.insert, '/')
    assert.deepEqual(opened, [0], 'openMenu 锚点 = 插入位置')
  })

  test("回归：key: '/'（半角）仍在表里且行为一致", () => {
    const { binding, opened } = bindingForKey('/')
    assert.ok(binding, '半角绑定丢失')
    const view = stubView()
    assert.equal(binding.run(view), true)
    assert.deepEqual(opened, [0])
  })

  test('keyName 对全角斜线原样返回（这条事实是绑定能命中的前提）', () => {
    assert.equal(keyName({ key: '／' }), '／')
    assert.equal(keyName({ key: '/' }), '/')
  })

  test('普通字符键不在表里（防止 pin 退化成「什么都绑」）', () => {
    assert.equal(bindingForKey('x').binding, undefined)
    assert.equal(bindingForKey('q').binding, undefined)
    // Enter / Escape / 方向键**在**表里（面板导航），不在此断言范围
  })
})
