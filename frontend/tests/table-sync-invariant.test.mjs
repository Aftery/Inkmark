/**
 * table-sync-invariant.test.mjs — 「表格输入会跑行」的可复现回归
 * ---------------------------------------------------------------------------
 * 用户原话：「表格那里输入会跑行」。这句话底下是**两个独立缺陷**，都不是观感
 * 问题，也都不靠肉眼复现才能定位 —— 本文件用真的 EditorState + 真的
 * tableRenderField 驱动 TableWidget，把它们钉成可执行的不变量。
 *
 * 【被测对象】editor/tableWidget.js 的 sync() / dispatchText() / eq()
 * 【为什么必须测这一层】`sync()` 是「单元格 DOM → 文档」的唯一写入口，它在每次
 * input 事件上跑。它一旦记错自己的区间（from/to），后续每一次按键都会基于错的
 * 基准往下滚 —— 而 DOM 里的内容仍然是对的，于是「文档与界面各说各话」，
 * 用户看到的就是表格内容滞后、行错位、旁边段落被吃掉。这类错位在纯函数层
 * （parseTable / serializeTable）完全看不见，必须把 widget 接到真 state 上跑。
 *
 * 【两条不变量】
 *   ① 记账一致：dispatchText() 成功后
 *      `state.sliceDoc(from, to) === source === key === serializeTable(model)`
 *      —— 四者互为基准，任一个落单，下次比较就错。
 *   ② 位置正确：写回后 from/to 必须精确框住表格，
 *      **不得**把表格后面的一行正文圈进来（`text.length` 在 CRLF 归一化后会偏大）。
 *
 * 【这个测试若失败意味着什么】
 *   - 不变量①红 → 用户会在单元格里打字却看到内容不更新 / 更新到别处，
 *     而且 `eq()` 会用错的 key 判断「还是同一个表格」，导致 DOM 复用错位。
 *   - 不变量②红 → `this.to` 越过表格边界，下一次 sliceString 读回来的「当前表格
 *     源码」会混入表格后的正文；再写回时就把那行正文写没了 —— 典型的
 *     「表格下面的字被我打字弄丢了」。
 *
 * 【为什么用假的 view 而不是 EditorView】真 EditorView 需要 DOM + 布局 + 视口，
 * 在 node --test 里跑不起来（本仓无 jsdom，见 tests/helpers/dom-stub.js 的选型
 * 说明）。而 sync()/dispatchText() 只碰 `view.state`、`view.dispatch`、
 * `view.composing` —— 用真的 EditorState + 一个直通 dispatch 的最小 view 即可，
 * 被测逻辑（区间记账 + 序列化回写）与真机**完全同一份代码**。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tableRenderField, parseTable, serializeTable, locateTable } from '../src/editor/tableRender.js'
import { setEditingWidget } from '../src/editor/tableSync.js'

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')

// ---------------------------------------------------------------------------
// 最小载具
// ---------------------------------------------------------------------------

/**
 * 建一个真 state（含 markdown 语法树 + tableRenderField 装饰）。
 * crlf=true 时显式配置 lineSeparator —— 用来覆盖「文档是 CRLF」这条路径。
 */
function mkState(doc, { crlf = false } = {}) {
  const extensions = [markdown({ base: markdownLanguage }), tableRenderField]
  if (crlf) extensions.push(EditorState.lineSeparator.of('\r\n'))
  return EditorState.create({ doc, selection: { anchor: 0 }, extensions })
}

/** 从 StateField 的装饰里取出所有 TableWidget（按文档顺序） */
function widgetsOf(state) {
  const out = []
  state.field(tableRenderField).deco.between(0, state.doc.length, (from, to, value) => {
    const w = value.spec?.widget
    if (w?.constructor?.name === 'TableWidget') out.push({ from, to, w })
  })
  return out
}

/** 最小 view：只管 state / composing / dispatch / focus（sync 只用这四个） */
function fakeView(state) {
  return {
    state,
    composing: false,
    focus() {},
    dispatch(tr) {
      this.state = this.state.update(tr).state
    },
  }
}

/**
 * <table> 替身。sync() 只读 `[...table.rows].map(tr => [...tr.cells].map(td => td.textContent))`，
 * 故只要 rows → cells → textContent 这条链在即可（顺序即文档顺序）。
 */
function fakeTable(model) {
  return {
    rows: [model.header, ...model.rows].map((cells) => ({
      cells: cells.map((textContent) => ({ textContent })),
    })),
  }
}

/** 装一个可编辑的 widget：接上 view / DOM 标记 / <table> 替身（等价于 toDOM 之后的态） */
function mount(doc, opts = {}) {
  const state = mkState(doc, opts)
  const [entry] = widgetsOf(state)
  assert.ok(entry, 'state 里必须渲染出一个 TableWidget（否则后面的断言没有意义）')
  const w = entry.w
  const view = fakeView(state)
  w.viewRef = view
  w.dom = { isConnected: true }
  w.table = fakeTable(w.model)
  return { w, view, entry, state }
}

/** 断言四条记账基准互相一致，且区间精确框住表格 */
function assertLedgerConsistent(w, view, label, { tail = null } = {}) {
  const slice = view.state.sliceDoc(w.from, w.to)
  assert.equal(slice, w.source, `${label}：doc 的 [from,to) 必须等于 source（否则下次比较基准就错了）`)
  assert.equal(w.key, w.source, `${label}：key 必须与 source 同步（eq() 靠它判断是否复用 DOM）`)
  assert.equal(
    serializeTable(w.model, view.state.lineBreak),
    w.source,
    `${label}：model 序列化结果必须等于 source（否则 DOM 与文档脱节）`,
  )
  assert.ok(parseTable(w.source), `${label}：写回的表格源码必须仍是合法 GFM 表格`)
  if (tail !== null) {
    assert.equal(
      view.state.sliceDoc(w.to),
      tail,
      `${label}：表格之后的内容必须原样不动（to 越过边界就会把下一行正文卷进来）`,
    )
  }
}

// ===========================================================================
// 1. 逐字输入：每次 sync 后四条记账基准都必须一致
// ===========================================================================
describe('表格逐字输入 · 记账不变量', () => {
  test('连续三次输入后 slice/source/key/model 始终一致，且表格外文本不动', () => {
    // [注意] 这里刻意用「中文段落包住表格」的形态：上方段落用来暴露 from 偏移，
    // 下方段落用来暴露 to 越界 —— 两种错位都只在「表格不是全文」时才看得见。
    const { w, view } = mount(`前文\n\n${TABLE}\n\n后文`)
    for (const typed of ['1X', '1XY', '1XYZ']) {
      w.table.rows[1].cells[0].textContent = typed
      w.sync()
      assertLedgerConsistent(w, view, `输入 "${typed}" 之后`, { tail: '\n\n后文' })
    }
    assert.match(view.state.sliceDoc(0, view.state.doc.length), /\| 1XYZ \| 2 \|/, '输入必须真的落到表体单元格')
  })

  test('改表头同样维持不变量（表头与表体走同一条 dispatchText）', () => {
    const { w, view } = mount(`前文\n\n${TABLE}\n\n后文`)
    w.table.rows[0].cells[0].textContent = '标题甲'
    w.sync()
    assertLedgerConsistent(w, view, '改表头之后', { tail: '\n\n后文' })
  })

  test('把单元格清空（内容变空串）也必须如实回写', () => {
    const { w, view } = mount(`前文\n\n${TABLE}\n\n后文`)
    w.table.rows[1].cells[1].textContent = ''
    w.sync()
    assertLedgerConsistent(w, view, '清空单元格之后', { tail: '\n\n后文' })
    assert.match(view.state.sliceDoc(0, view.state.doc.length), /\| 1 \|  \|/, '清空必须写成空单元格')
  })
})

// ===========================================================================
// 2. 「文本本来就一致」这条路径：返回值必须报成功，且记账仍要对齐
// ===========================================================================
/**
 * 这条守的是 dispatchText 的**返回值语义**：它回答的是「文档此刻是否已等于
 * text」，而不是「这次有没有产生事务」。若把「本来就一致」也报成 false，
 * sync() 就不会把 model 升级成刚读出来的那份 —— DOM 已是新值、model 停在旧值，
 * 两者分叉。红起来意味着「用户删掉再打回同一个字」这类幂等操作会让表格
 * 之后的内容错位。
 */
describe('表格同步 · 幂等写回的返回值语义', () => {
  test('DOM 与文档已一致时 sync 仍视为成功并保持 model 同步', () => {
    const { w, view } = mount(`前文\n\n${TABLE}\n\n后文`)
    // 先真的改一次，让记账走一遍事务路径
    w.table.rows[1].cells[0].textContent = '1X'
    w.sync()
    const afterFirst = w.source
    // 再把 DOM 改回与文档一致的值 —— 序列化结果与本条文档相同，不应产生事务
    w.table.rows[1].cells[0].textContent = '1X'
    const docBefore = view.state.doc.toString()
    w.sync()
    assert.equal(view.state.doc.toString(), docBefore, '文本一致时不得产生多余事务（撤销栈里不该多一笔）')
    assert.equal(w.source, afterFirst, 'source 不得被改坏')
    assertLedgerConsistent(w, view, '幂等 sync 之后', { tail: '\n\n后文' })
    assert.equal(
      serializeTable(w.model, view.state.lineBreak),
      w.source,
      '幂等路径上 model 也必须仍在正确值（不能因为 return false 就漏掉 model 更新）',
    )
  })

  /**
   * 【这条守的是「幂等分支也必须把区间记账搬正」】
   * 设一个**已经漂移**的 from/to（模拟旧实例好久没校正），但让 DOM 内容与文档
   * 完全一致 —— 于是走到 dispatchText 的「文本已一致」分支。此时若该分支只
   * `return false` 而不更新 from/to，漂移就**永久固化**了：下一次输入仍要重新
   * locateTable，而 locateTable 从漂移位置出发并不总能找到表格（见下一个用例）。
   *
   * 红起来意味着：区间一旦漂移就再也修不回来，用户会周期性地丢输入。
   */
  test('幂等分支必须把 from/to 校正回真实表格范围（漂移不会自愈就是永久错位）', () => {
    const { w, view, entry } = mount(`前文\n\n${TABLE}\n\n后文`)
    const trueFrom = entry.from
    const trueTo = entry.to
    // 人为制造 +1 的漂移：slice 对不上 source，locateTable 还能救回来
    w.from = trueFrom + 1
    w.to = trueTo + 1
    const docBefore = view.state.doc.toString()
    // DOM 不动 → 序列化结果与文档一致 → 走幂等分支
    w.sync()
    assert.equal(view.state.doc.toString(), docBefore, '幂等分支不得改文档')
    assert.equal(w.from, trueFrom, `幂等分支必须把 from 校正回 ${trueFrom}，实际 ${w.from}（漂移不会自愈）`)
    assert.equal(w.to, trueTo, `幂等分支必须把 to 校正回 ${trueTo}，实际 ${w.to}`)
    assertLedgerConsistent(w, view, '漂移后幂等 sync', { tail: '\n\n后文' })
  })

  /**
   * 【为什么漂移必须自愈：locateTable 救不了所有漂移】
   * 区间往前漂（from 落在表格上方的段落里）时，Lezer 从那个位置向上找 Table
   * 节点必然落空 —— 此时 dispatchText 只能 return false 静默放弃，用户敲的字
   * 直接不进文档。所以「靠 locateTable 兜底」不成立，必须在复用那一刻就把
   * 区间接正（eq → adoptRange），并让幂等分支也能搬正。
   */
  test('区间前漂时 locateTable 确实救不回来 —— 这就是必须提前校正的理由', () => {
    const { w, view, entry } = mount(`前文\n\n${TABLE}\n\n后文`)
    w.from = entry.from - 3
    w.to = entry.to - 3
    w.table.rows[1].cells[0].textContent = '1X'
    // 漂移 3 个字符后，从该位置向上找不到 Table 节点 → 同步被放弃
    assert.equal(
      locateTable(view.state, w.from),
      null,
      '前提核实：区间前漂时 locateTable 返回 null（若这里变成能救回，本条与上一条的结论都要复核）',
    )
    w.sync()
    assert.equal(
      view.state.doc.toString().includes('1X'),
      false,
      '前提核实：这条路径下输入确实会丢（正因如此才必须在 eq/幂等分支提前校正）',
    )
  })
})

// ===========================================================================
// 3. 位置记账：to 必须精确落在表格末尾（守 text.length 的坑）
// ===========================================================================
/**
 * 【这个测试守的是什么】`this.to = from + text.length` 在文档主换行符是 CRLF 时
 * 是**偏大**的：CM 按 lineSeparator facet 切行，插入文本里的 '\r\n' 在文档里
 * 只占一个位置，而 text.length 把两个字符都数了。于是 to 越过表格末尾，
 * 下一次 sliceString(from, to) 会把表格后面的正文卷进来当「表格源码」。
 *
 * 红起来意味着：用户在某张表格里输入后，**表格下方那行字会被吞掉**或错位。
 */
describe('表格位置记账 · to 必须精确落在表格末尾', () => {
  for (const crlf of [false, true]) {
    test(`lineBreak=${crlf ? 'CRLF' : 'LF'}：写回后 to 精确等于表格末尾`, () => {
      const sep = crlf ? '\r\n' : '\n'
      const doc = ['前文', '', ...TABLE.split('\n'), '', '后文'].join(sep)
      const { w, view } = mount(doc, { crlf })
      const tail = `${sep}${sep}后文`

      for (const typed of ['1X', '1XY']) {
        w.table.rows[1].cells[0].textContent = typed
        w.sync()
        assertLedgerConsistent(w, view, `[${crlf ? 'CRLF' : 'LF'}] 输入 "${typed}" 后`, { tail })
        // 额外的硬断言：to 之后紧跟的必须正好是「空行 + 后文」
        assert.ok(
          view.state.sliceDoc(w.to).startsWith(sep.repeat(2) + '后文'),
          `[${crlf ? 'CRLF' : 'LF'}] to=${w.to} 之后应是空行+后文，实际是 ${JSON.stringify(view.state.sliceDoc(w.to))}`,
        )
      }
    })
  }

  test('CRLF 文档里写回不得把表格各行的换行符改成 LF', () => {
    const sep = '\r\n'
    const doc = ['前文', '', ...TABLE.split('\n'), '', '后文'].join(sep)
    const { w, view } = mount(doc, { crlf: true })
    w.table.rows[1].cells[0].textContent = '1X'
    w.sync()
    const tableText = view.state.sliceDoc(w.from, w.to)
    assert.ok(tableText.includes(sep), `写回后的表格应保留 CRLF，实际: ${JSON.stringify(tableText)}`)
    assert.equal(
      tableText.split(sep).length,
      TABLE.split('\n').length,
      '写回后表格行数必须不变（换行符被改写会连带改变行数与偏移）',
    )
  })
})

// ===========================================================================
// 4. 复用 DOM 时的区间同步（eq 命中后旧实例继续收事件）
// ===========================================================================
/**
 * 【根因】CM 的 findWidget() 命中 eq() 后返回 `new WidgetTile(tile.dom, …, widget)`
 * —— **旧 DOM 配新实例**。新实例带最新 from/to 但没有 dom/table/viewRef（toDOM
 * 没被调用）；真正挂着 input 监听的是旧实例，而 CM 从不回写它的 from/to。
 * 于是只要表格上方插入过文字，旧实例的区间就整体偏移，此后输入要么写错位置，
 * 要么 locateTable 落空而静默丢弃。
 *
 * 红起来意味着：用户在表格上方写了几行再回来编辑表格，输入丢失或错位。
 */
describe('表格 DOM 复用 · 区间必须跟着文档走', () => {
  test('表格上方插入文字后，活实例的 from/to 被 adoptRange 校正到新位置', () => {
    const { w, view, entry } = mount(`前文\n\n${TABLE}\n\n后文`)
    const fromBefore = w.from
    const insertLen = '前文追加'.length
    view.dispatch({ changes: { from: 0, insert: '前文追加' } })

    // 文档变了 → 装饰重建 → 新 widget 实例带着新位置
    const [fresh] = widgetsOf(view.state)
    assert.ok(fresh, '插入后仍应渲染出表格')
    assert.equal(fresh.from, fromBefore + insertLen, '新实例应带偏移后的 from')

    // CM 会调 eq() 决定复用；复用即把新位置交给活实例
    assert.equal(w.eq(fresh.w), true, 'key 相同 → 必须复用（否则每敲一个字焦点都会丢）')
    assert.equal(w.from, fresh.from, '复用后活实例的 from 必须校正（否则写回会落到表格外）')
    assert.equal(w.to, fresh.to, '复用后活实例的 to 必须校正')

    // 校正之后，输入必须落到正确的表格里
    w.table.rows[1].cells[0].textContent = '1X'
    w.sync()
    assertLedgerConsistent(w, view, '上方插入后 sync', { tail: '\n\n后文' })
    assert.match(
      view.state.sliceDoc(0, view.state.doc.length),
      /\| 1X \| 2 \|/,
      '输入必须落到表格里（不是被丢弃，也不是写到上方段落）',
    )
    assert.ok(
      view.state.sliceDoc(0, insertLen) === '前文追加',
      '上方插入的文字不得被动过',
    )
    void entry
  })

  test('表格不在文档开头：上方偏移后仍能正确定位并写回', () => {
    const doc = `第一段\n\n第二段\n\n${TABLE}\n\n收尾`
    const { w, view } = mount(doc)
    view.dispatch({ changes: { from: 0, insert: '# 标题\n\n' } })
    const [fresh] = widgetsOf(view.state)
    assert.ok(w.eq(fresh.w), '应复用')
    w.table.rows[1].cells[0].textContent = '1X'
    w.sync()
    assertLedgerConsistent(w, view, '多重偏移后 sync', { tail: '\n\n收尾' })
  })
})

// ===========================================================================
// 5. eq() 的既有契约不得被这次改动带坏
// ===========================================================================
describe('表格 eq · 复用契约不变', () => {
  test('表格源码不同（key 不同）时不得复用 —— 否则会画出上一个表格的 DOM', () => {
    const { w } = mount(`前文\n\n${TABLE}\n\n后文`)
    const other = { key: '| 完全不同的表 |\n| --- |\n| x |' }
    assert.equal(w.eq(other), false, 'key 不同必须重建 DOM（模型变了却复用 = 内容滞后）')
  })

  test('eq 传入自身不得抛错（CM 在某些路径上会自比）', () => {
    const { w } = mount(`前文\n\n${TABLE}\n\n后文`)
    assert.equal(w.eq(w), true)
    assert.doesNotThrow(() => w.eq(w))
  })

  /**
   * 【这条守的是「接区间」的边界：key 不同就绝不能接】
   * eq() 的「编辑中」分支会在源码已变时仍返回 true（为了不打断 IME / 焦点）。
   * 此时新实例的 source 是**新**内容，而活实例的 model 还是**旧**的 —— 若把
   * 新 source 接过来，下一次 sync() 就会用旧 DOM 序列化出的文本覆盖掉新内容，
   * 用户刚才的编辑直接丢失。故 key 不同时只复用 DOM、不接区间。
   */
  test('源码已变（key 不同）+ 编辑中：可复用 DOM，但绝不接收对方区间', () => {
    const { w } = mount(`前文\n\n${TABLE}\n\n后文`)
    const fromBefore = w.from
    const toBefore = w.to
    const sourceBefore = w.source
    const otherText = '| 全新 | 内容 |\n| --- | --- |\n| 9 | 9 |'
    const changed = { key: otherText, from: 999, to: 1200, source: otherText }

    // 前提核实：非编辑态走 key 比较 → 不复用
    assert.equal(w.eq(changed), false, 'key 不同必须重建 DOM')

    // 关键路径：单元格持有焦点（编辑中）时 eq 会为了不打断 IME/焦点而返回 true。
    // 这一支**绕过 key 比较**，正是「新 source 配旧 model」错配的入口。
    setEditingWidget(w)
    try {
      const reused = w.eq(changed)
      assert.equal(reused, true, '前提核实：编辑中且 dom 已连接时必须复用以保住焦点')
      assert.equal(w.from, fromBefore, '编辑中复用也不得把 from 改成对方的（否则写回落到别处）')
      assert.equal(w.to, toBefore, '编辑中复用也不得把 to 改成对方的')
      assert.equal(
        w.source,
        sourceBefore,
        '编辑中复用也不得改 source —— 否则「新 source + 旧 model」会让下次 sync() 用旧 DOM 覆盖新内容',
      )
    } finally {
      setEditingWidget(null)
    }
  })
})
