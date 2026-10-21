/**
 * table-interaction.test.mjs — 表格交互打磨的纯逻辑层
 * ---------------------------------------------------------------------------
 * 被测对象：
 *   - editor/tableOps.js    对齐（setColumnAlign / nextAlign）、重排（moveRow / moveColumn）
 *   - editor/tableDrag.js   落点计算（dropIndexAt / toMoveIndex / isNoopMove）
 *   - editor/pasteCommand.js 选区 + URL → [文字](url)（linkifySelection）
 *
 * 【为什么落点计算必须单测】拖拽的落点换算（「插入位」→「移动后下标」）差一位
 * 就是「拖到 c 右边却落在 c 左边」这种手感的根源，而它完全无法靠目视稳定复现。
 *
 * 【期望值来源】GFM 的表格语法（对齐只存在于分隔行）+ 拖拽的通行直觉
 * （拖到目标左半边 = 放到它前面）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTable, serializeTable } from '../src/editor/tableRender.js'
import {
  ALIGN_CYCLE, insertColumn, insertRow, moveColumn, moveRow, nextAlign, setColumnAlign,
} from '../src/editor/tableOps.js'
import { dropIndexAt, toMoveIndex, isNoopMove } from '../src/editor/tableDrag.js'
import { linkifySelection, looksLikeUrl } from '../src/editor/pasteCommand.js'

const TABLE = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |'

describe('表格对齐 · 只存在于分隔行', () => {
  test('三档对齐写成 GFM 分隔行，并且能被重新解析回来', () => {
    const m = parseTable(TABLE)
    setColumnAlign(m, 0, 'left')
    setColumnAlign(m, 1, 'center')
    setColumnAlign(m, 2, 'right')
    const out = serializeTable(m)
    assert.match(out.split('\n')[1], /^\| --- \| :---: \| ---: \|$/, `分隔行写法不对：${out}`)
    const back = parseTable(out)
    assert.deepEqual(back.aligns, ['left', 'center', 'right'], '往返必须一致（否则对齐一刷新就丢）')
  })

  test('非法对齐值回落到左对齐（历史脏数据不能让按钮卡死）', () => {
    const m = parseTable(TABLE)
    setColumnAlign(m, 1, 'justify')
    assert.deepEqual(m.aligns, ['left', 'left', 'left'])
  })

  test('越界下标被夹住，不抛错也不写坏数组', () => {
    const m = parseTable(TABLE)
    setColumnAlign(m, 99, 'center')
    assert.deepEqual(m.aligns, ['left', 'left', 'center'], '越界写到最后一列')
    assert.equal(m.aligns.length, 3)
  })

  test('nextAlign 循环左 → 中 → 右 → 左（单击一轮换一遍）', () => {
    assert.deepEqual(ALIGN_CYCLE, ['left', 'center', 'right'])
    assert.equal(nextAlign('left'), 'center')
    assert.equal(nextAlign('center'), 'right')
    assert.equal(nextAlign('right'), 'left')
    // indexOf 未命中返回 -1，下一档落在 0（left）—— 这是有意的：
    // 脏数据一律先归位到左对齐，再谈下一档
    assert.equal(nextAlign('bogus'), 'left')
  })
})

describe('表格重排 · 移动而非交换', () => {
  test('moveColumn 是「插入到目标位置」，不是两列互换', () => {
    const m = parseTable(TABLE)
    moveColumn(m, 0, 2) // a 拖到最右
    assert.deepEqual(m.header, ['b', 'c', 'a'])
    assert.deepEqual(m.rows[0], ['2', '3', '1'], '每一行都要跟着动')
    assert.ok(parseTable(serializeTable(m)), '产物必须仍是合法 GFM')
  })

  test('moveColumn 带着对齐一起走（不能串位）', () => {
    const m = parseTable('| a | b | c |\n| :-: | --- | ---: |\n| 1 | 2 | 3 |')
    moveColumn(m, 0, 2)
    assert.deepEqual(m.aligns, ['left', 'right', 'center'], '对齐必须跟着所属列移动')
    assert.deepEqual(parseTable(serializeTable(m)).aligns, ['left', 'right', 'center'])
  })

  test('moveColumn 在同列内移动是空操作', () => {
    const m = parseTable(TABLE)
    const before = serializeTable(m)
    moveColumn(m, 1, 1)
    assert.equal(serializeTable(m), before)
  })

  test('moveRow 只动表体，表头不受影响', () => {
    const m = parseTable(TABLE)
    moveRow(m, 0, 1)
    assert.deepEqual(m.rows, [['4', '5', '6'], ['1', '2', '3']])
    assert.deepEqual(m.header, ['a', 'b', 'c'], '表头行不参与行重排')
  })

  test('越界下标被夹住（拖到表格外不应写坏 model）', () => {
    const m = parseTable(TABLE)
    moveRow(m, 0, 99)
    assert.deepEqual(m.rows, [['4', '5', '6'], ['1', '2', '3']], '夹到末行')
    const n = parseTable(TABLE)
    moveColumn(n, 0, 99)
    assert.deepEqual(n.header, ['b', 'c', 'a'])
  })

  test('结构操作后列数处处自洽（表头 / 每行 / 对齐 / 分隔行）', () => {
    const m = parseTable(TABLE)
    insertColumn(m, 1)
    moveColumn(m, 0, 3)
    const back = parseTable(serializeTable(m))
    assert.ok(back, '必须仍能解析')
    assert.equal(back.header.length, 4)
    assert.ok(back.rows.every((r) => r.length === 4), '每行列数一致，否则整表退化成段落')
    assert.equal(back.aligns.length, 4)
  })
})

describe('拖拽落点 · 插入位与目标下标', () => {
  const spans = [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 30 },
  ]

  test('落在元素左半边 → 插到它之前；右半边 → 之后', () => {
    assert.equal(dropIndexAt(spans, 2), 0)
    assert.equal(dropIndexAt(spans, 8), 1, '落在第一格右半边 → 插到第二格之前')
    assert.equal(dropIndexAt(spans, 12), 1)
    assert.equal(dropIndexAt(spans, 28), 3, '落在最后一格右半边 → 末尾')
    assert.equal(dropIndexAt(spans, 99), 3, '超出表格 → 末尾')
    assert.equal(dropIndexAt([], 5), 0, '空表不崩')
  })

  test('toMoveIndex：抽出后目标位前移一位（这是「差一位」bug 的根）', () => {
    // 4 列 [a,b,c,d]，把 a（0）拖到「c 与 d 之间」= 插入位 3 → 目标下标 2
    assert.equal(toMoveIndex(0, 3), 2)
    // 把 d（3）拖到「a 之前」= 插入位 0 → 目标仍是 0（向后拖不受影响）
    assert.equal(toMoveIndex(3, 0), 0)
    assert.equal(toMoveIndex(1, 1), 1, '插到自己前面 = 原地不动')
    assert.equal(toMoveIndex(1, 2), 1, '插到自己后面 = 原地不动')
  })

  test('isNoopMove 让「原地放下」不产生撤销记录', () => {
    assert.equal(isNoopMove(2, 2), true)
    assert.equal(isNoopMove(2, 3), false)
  })

  test('端到端：把首列拖到最后，产物顺序正确', () => {
    const insertAt = dropIndexAt(spans, 29) // 最后一格右半边
    const to = toMoveIndex(0, insertAt)
    const m = parseTable(TABLE)
    moveColumn(m, 0, to)
    assert.deepEqual(m.header, ['b', 'c', 'a'])
  })
})

describe('粘贴 URL · 选区转链接', () => {
  test('识别常见 URL 形态（含裸域名）', () => {
    for (const s of ['https://a.com', 'http://a.com/x?y=1', 'www.a.com', 'mailto:a@b.c']) {
      assert.equal(looksLikeUrl(s), true, s)
    }
    for (const s of ['', '   ', 'a.com', '两行\nhttps://a.com', '看 https://a.com 这个']) {
      assert.equal(looksLikeUrl(s), false, JSON.stringify(s))
    }
  })

  test('选中文字 + URL → [选中文字](url)', () => {
    const r = linkifySelection('https://example.com/x', '示例站点')
    assert.equal(r.snippet, '[示例站点](https://example.com/x)')
  })

  test('裸域名补 https://（与 CM 的 pasteURLAsLink 口径一致）', () => {
    assert.equal(linkifySelection('www.example.com', '站点').snippet, '[站点](https://www.example.com)')
  })

  test('没有选区 / 不是 URL → 不转换（保持普通粘贴）', () => {
    assert.equal(linkifySelection('https://a.com', ''), null)
    assert.equal(linkifySelection('普通文本', '选中'), null)
  })

  test('选区已是链接、或跨行时不叠加（否则产物是源码噪音）', () => {
    assert.equal(linkifySelection('https://a.com', '[已有](https://b.com)'), null)
    assert.equal(linkifySelection('https://a.com', '第一行\n第二行'), null)
  })
})

// ---------------------------------------------------------------------------
// DOM 重建：结构变更后 CM 会复用旧 DOM（widget eq 命中），必须自己重建
// ---------------------------------------------------------------------------
/**
 * 最小 DOM 桩。只实现 TableWidget.rebuild() 用到的 API —— 目标是验证
 * 「model 改了之后 DOM 结构真的跟着改」，而不是模拟浏览器。
 *
 * 【为什么这条必须测】TableWidget.eq() 在编辑期返回 true，CM 因此复用旧 DOM；
 * 若 rebuild() 没写或写错，用户看到的是「点了对齐/拖了列，界面没反应」，
 * 一离开再回来才对 —— 典型的静默失效，纯函数测试完全看不见。
 */
class DomStub {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.style = {}
    this.dataset = {}
    this.className = ''
    this._text = ''
    this.classList = { add() {}, remove() {}, contains() { return false } }
  }
  get cells() { return this.children }
  get textContent() { return this._text }
  set textContent(v) { this._text = v; this.children = [] }
  get tHead() { return this.children.find((c) => c.tagName === 'THEAD') ?? null }
  get tBodies() { return this.children.filter((c) => c.tagName === 'TBODY') }
  get rows() {
    const out = []
    if (this.tHead) out.push(...this.tHead.children)
    for (const b of this.tBodies) out.push(...b.children)
    return out
  }
  get cellIndex() { return this.parentNode ? this.parentNode.children.indexOf(this) : -1 }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c }
  replaceChild(n, o) {
    const i = this.children.indexOf(o)
    this.children[i] = n
    n.parentNode = this
    return o
  }
  querySelector() { return null }
  querySelectorAll() { return [] }
  addEventListener() {}
  setAttribute() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
}

describe('表格 DOM 重建 · 结构变更必须同步到界面', () => {
  /** 装 DOM 桩并按当前 model 造一个 widget（每例独立，避免互相污染） */
  async function makeWidget(source) {
    const g = globalThis
    const saved = { document: g.document, window: g.window }
    g.document = {
      documentElement: { style: {} },
      createElement: (t) => new DomStub(t),
      createRange: () => ({ selectNodeContents() {}, collapse() {} }),
      getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    }
    g.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) }
    const { TableWidget } = await import('../src/editor/tableWidget.js')
    const model = parseTable(source)
    const widget = new TableWidget({ model, source, from: 0, to: source.length })
    const view = {
      state: { doc: { length: source.length, sliceString: () => source }, selection: { main: { from: 0, to: 0 } } },
      dispatch() {},
      focus() {},
    }
    widget.toDOM(view)
    const restore = () => { g.document = saved.document; g.window = saved.window }
    return { widget, model, restore }
  }

  const headerOf = (w) => w.table.tHead.children[0].cells.map((c) => c.textContent)

  test('改对齐后 DOM 的 textAlign 立刻更新（否则用户看到「按钮没用」）', async () => {
    const { widget, model, restore } = await makeWidget(TABLE)
    try {
      assert.equal(widget.table.tHead.children[0].cells[1].style.textAlign, 'left')
      setColumnAlign(model, 1, 'center')
      widget.rebuild({ focusCol: 1 })
      assert.equal(widget.table.tHead.children[0].cells[1].style.textAlign, 'center')
    } finally { restore() }
  })

  test('重排列后 DOM 的单元格顺序跟着变（含表体每一行）', async () => {
    const { widget, model, restore } = await makeWidget(TABLE)
    try {
      moveColumn(model, 0, 1) // a 移到下标 1 → b, a, c
      widget.rebuild({ focusCol: 1 })
      assert.deepEqual(headerOf(widget), ['b', 'a', 'c'], '表头顺序必须同步')
      assert.deepEqual(
        widget.table.tBodies[0].children[0].cells.map((c) => c.textContent),
        ['2', '1', '3'],
        '表体每一行都要跟着重排',
      )
    } finally { restore() }
  })

  test('增删行后 DOM 行数同步（不多不少）', async () => {
    const { widget, model, restore } = await makeWidget(TABLE)
    try {
      const before = widget.table.rows.length
      insertRow(model, model.rows.length)
      widget.rebuild({})
      assert.equal(widget.table.rows.length, before + 1, '插行后 DOM 必须多一行')
      moveRow(model, 0, 0)
      widget.rebuild({})
      assert.equal(widget.table.rows.length, before + 1, '空移动不得改变行数')
    } finally { restore() }
  })
})
