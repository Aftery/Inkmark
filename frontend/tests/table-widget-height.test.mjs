/**
 * table-widget-height.test.mjs — 「表格输入打 2 个字符就跑行」的高度记账回归
 * ---------------------------------------------------------------------------
 * 用户原话：「表格输入的话输入 2 个字符就跑了」。这一轮的根因不在记账公式、
 * 也不在 CRLF（那两项上一轮已修且单元层全绿），而在 **CM 的高度记账**：
 *
 *   WidgetType.estimatedHeight 默认 -1（view/dist/index.js:148）
 *     → NodeBuilder.point（index.js:6036-6044）
 *         let height = deco.widget ? deco.widget.estimatedHeight : 0
 *         if (height < 0) height = this.oracle.lineHeight
 *         if (deco.block) this.addBlock(new HeightMapBlock(len, height, deco))
 *       —— 整张表格被当成**一行**高（约 27px @ 16px/1.7），
 *         而 3~4 行表格 DOM 实际高 100~170px。
 *
 * 落差本身不致命（measure() 下一帧用 setMeasuredHeight 量回真值，index.js:5689）。
 * 致命的是**每敲一个字重演一次**：
 *   ① 每敲一个字 source 变 → 装饰层 new 一个新 TableWidget（key = 新 source）；
 *   ② PointDecoration.heightRelevant 对 block 装饰**恒为 true**（index.js:352-354），
 *      故新旧装饰永不 equal；
 *   ③ DecorationComparator.comparePoint（index.js:6139-6142）必然报一个
 *      height change range；
 *   ④ ViewState.update（index.js:6318-6322）把它并入 heightChanges →
 *      heightMap.applyChanges → HeightMapBlock 重建，高度回落到
 *      oracle.lineHeight，replace()（index.js:5659-5664）还会置 heightChangeFlag；
 *   ⑤ 下一帧 measure() 才量回真实高度。
 * 于是表格后续内容每帧先上跳约 120px 再回落 —— 连续打字时每敲一个字跳一次。
 * 这就是「跑行」的物理来源，也解释了它为什么像玄学。
 *
 * 【被测对象】editor/tableWidget.js 的 estimatedHeight + editor/tableHeight.js 的缓存
 * 【修法】estimatedHeight 返回「上次实测高度」（跨实例缓存，按表格源码 key），
 *          让 HeightMapBlock 一建出来就接近真实高度，不再每帧先塌回一行高。
 *
 * 【本轮最重要的一条：时序】第 3 组用例专门钉死「缓存必须在 dispatch **之前**
 * 写好」。这不是实现细节，而是修复能否生效的分水岭 —— 写晚一步，逐字输入时
 * 命中率恒为 0（每轮 source 都变，上一轮存的键永远匹配不上下一轮的读）。
 *
 * 【为什么用真的 widget 而不是纯函数】estimatedHeight 是同步 getter，其调用时机
 * 在 CM 的 NodeBuilder 里（toDOM 之前），缓存又是跨实例的模块级状态 —— 必须
 * 把真的 TableWidget 接到真 EditorState 上跑，才能覆盖「新实例从缓存里读到
 * 上一个实例量到的高度」这条真实链路。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tableRenderField, serializeTable } from '../src/editor/tableRender.js'
import { setEditingWidget } from '../src/editor/tableSync.js'
import {
  estimatedTableHeight, measureTableHeight, primeTableHeight,
  rememberTableHeight, resetTableHeightCache,
} from '../src/editor/tableHeight.js'

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
const DOC = `前文\n\n${TABLE}\n\n后文`

// ---------------------------------------------------------------------------
// 最小载具
// ---------------------------------------------------------------------------

function mkState(doc) {
  return EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [markdown({ base: markdownLanguage }), tableRenderField],
  })
}

function widgetsOf(state) {
  const out = []
  state.field(tableRenderField).deco.between(0, state.doc.length, (from, to, value) => {
    const w = value.spec?.widget
    if (w?.constructor?.name === 'TableWidget') out.push({ from, to, w })
  })
  return out
}

/**
 * 假 view。`onDispatch` 在建视图时被调用 —— 这是本套用例观测时序的唯一手段：
 * 真 CM 里 NodeBuilder 读 estimatedHeight 就发生在 view.dispatch 内部，
 * 所以「dispatch 被调用的那一刻缓存里有什么」正是新实例会读到的东西。
 */
function fakeView(state, onDispatch) {
  return {
    state,
    composing: false,
    focus() {},
    dispatch(tr) {
      onDispatch?.(tr)
      this.state = this.state.update(tr).state
    },
  }
}

/** <table> 替身：rows[0] 是表头，与真 DOM 的 rows 语义一致 */
function fakeTable(model) {
  return {
    rows: [model.header, ...model.rows].map((cells) => ({
      cells: cells.map((textContent) => ({ textContent })),
    })),
  }
}

/** 装一个可编辑 widget：接上 view / DOM 标记 / <table> 替身（等价于 toDOM 之后的态） */
function mount(doc = DOC, onDispatch) {
  const state = mkState(doc)
  const [entry] = widgetsOf(state)
  assert.ok(entry, 'state 里必须渲染出一个 TableWidget（否则后面的断言没有意义）')
  const w = entry.w
  const view = fakeView(state, onDispatch)
  w.viewRef = view
  w.dom = { isConnected: true }
  w.table = fakeTable(w.model)
  return { w, view, entry, state }
}

/** 在 [row][col] 单元格里追加字符（模拟用户在单元格打字） */
function typeIn(w, text, row = 1, col = 0) {
  w.table.rows[row].cells[col].textContent = text
}

/** 算出「这次 sync 会把什么文本写进文档」—— 即下一轮新实例的 key */
function nextSourceOf(w, text, row = 1, col = 0, lineBreak = '\n') {
  const grid = w.table.rows.map((tr) => tr.cells.map((td) => td.textContent))
  grid[row][col] = text
  return serializeTable(
    { header: grid[0], aligns: w.model.aligns, delimRaw: w.model.delimRaw, rows: grid.slice(1) },
    lineBreak,
  )
}

// 每条用例都从空缓存开始：模块级 Map 会跨用例串味
const fresh = (fn) => () => { resetTableHeightCache(); fn() }

// ===========================================================================
// 1. estimatedHeight 的退化语义：没量过必须返回 -1
// ===========================================================================
/**
 * 【为什么 -1 是正确值】CM 对 estimatedHeight < 0 的处理是退回
 * oracle.lineHeight 并在下一帧 measure() 量回真值（index.js:6041-6042 +
 * 5689-5699）。这是安全退化，比「猜一个数」安全得多：猜小了照样跳，猜大了
 * 会在表格被删掉 / 内容变少时留下错误高度且永不自愈。
 */
describe('表格高度预估 · 未量过时返回 -1', () => {
  test('一个从未被量过的表格源码必须返回 -1', fresh(() => {
    const { w } = mount()
    assert.equal(w.estimatedHeight, -1, '未量过必须报 -1（让 CM 走 measure() 兜底）')
  }))

  test('estimatedHeight 是同步 getter：此刻 DOM 不存在也不能抛错', fresh(() => {
    const { w } = mount()
    w.dom = null
    w.table = null
    assert.doesNotThrow(() => w.estimatedHeight)
    assert.equal(w.estimatedHeight, -1)
  }))
})

// ===========================================================================
// 2. 核心：跨实例缓存必须在「每敲一个字换一个实例」时仍然命中
// ===========================================================================
/**
 * 【这条守的是修复的整个前提】
 * eq() 命中时 CM 返回 `new WidgetTile(tile.dom, …, 新实例)` —— 旧 DOM 配新实例
 * （findWidget，index.js:2600）。新实例没有 dom / table / viewRef，toDOM 从未
 * 被调用；而 estimatedHeight 恰好在 toDOM 之前被 NodeBuilder 读取。
 * 所以缓存必须是**按源码 key、跨实例**的，不能存在实例自己身上。
 *
 * 红起来意味着：第二个字打下去时新实例又报 -1 → HeightMapBlock 又塌回
 * oracle.lineHeight → 后续内容又跳一次。这正是「打 2 个字符就跑」。
 */
describe('表格高度预估 · 跨实例缓存', () => {
  test('sync 之后新实例必须能报出实测高度', fresh(() => {
    const { w, view } = mount()
    const H = 168
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: H }) }
    typeIn(w, '1X')
    w.sync()

    // 文档变了 → 装饰层重建 → 新的 TableWidget 实例（key = 含第一个字的新源码）
    const [fresh1] = widgetsOf(view.state)
    assert.ok(fresh1, '第一次输入后仍应渲染出表格')
    assert.notEqual(fresh1.w, w, '必须是新实例（CM 的复用语义：旧 DOM 配新实例）')
    assert.equal(fresh1.w.estimatedHeight, H, '新实例必须从跨实例缓存读到高度')
  }))

  test('新实例拿到的高度必须来自缓存而非实例自身字段（toDOM 从未被调用）', fresh(() => {
    const { w, view } = mount()
    const H = 150
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: H }) }
    typeIn(w, '1X')
    w.sync()

    const [nw] = widgetsOf(view.state)
    // 新实例的 dom / table / viewRef 都是 null（toDOM 未调用）——
    // 若实现把高度存在实例字段上，这里必然拿不到。
    assert.equal(nw.w.dom, null, '前提核实：新实例确实没有 DOM')
    assert.equal(nw.w.estimatedHeight, H, '没有 DOM 也必须能报出高度（只能来自模块级缓存）')
  }))

  test('连续敲三个字：每个字换新实例，且每轮都能命中缓存', fresh(() => {
    const { w, view } = mount()
    const H = 168
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: H }) }
    typeIn(w, '1X')
    w.sync()

    let live = w
    for (const text of ['1XY', '1XYZ', '1XYZ!']) {
      const [nw] = widgetsOf(view.state)
      assert.equal(nw.w.estimatedHeight, H, `敲到 ${text} 时新实例必须命中缓存`)
      // 让这个新实例接着当编辑者，继续下一轮
      live.dom = null
      nw.w.viewRef = view
      nw.w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: H }) }
      nw.w.table = fakeTable(nw.w.model)
      typeIn(nw.w, text)
      nw.w.sync()
      live = nw.w
    }
  }))
})

// ===========================================================================
// 3. 时序：缓存必须在 dispatch 之前写好（本修复成不成立的判据）
// ===========================================================================
/**
 * 【这一组是整个修复的判决性用例】
 * dispatchText() 里第一件事是 state.update()，它同步跑 StateField.update →
 * decoOf() new 出带**新 source** 的 TableWidget；紧接着 view.dispatch() 同步
 * 跑 docView.update → NodeBuilder 读 estimatedHeight。也就是说，新实例读缓存
 * 发生在 dispatch **还没返回**的时候。
 *
 * 若实现写成「dispatch 之后才 remember(this.key, h)」：这一轮读到的仍是 -1，
 * 而 next 轮的 source 又变了 —— 上一轮存的键永远匹配不上下一轮的读，逐字
 * 输入时命中率恒为 0，等于没修。
 *
 * 观测手段：在 fakeView.dispatch 被调用的第一行读缓存。真 CM 里这正是
 * NodeBuilder 读 estimatedHeight 的时刻。
 */
describe('表格高度预估 · 缓存必须先于 dispatch 写入', () => {
  test('dispatch 被调用的那一刻，新源码的 key 已经在缓存里', fresh(() => {
    const H = 168
    const seen = {}
    const { w, view } = mount(DOC, () => {
      // 此刻 NodeBuilder 即将（真 CM 中是「已经」）读取新实例的 estimatedHeight
      seen.forNextSource = estimatedTableHeight(seen.expected ?? '__unset__')
    })
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: H }) }
    typeIn(w, '1X')
    seen.expected = nextSourceOf(w, '1X')

    w.sync()

    assert.equal(
      seen.forNextSource,
      H,
      'dispatch 期间新源码必须已能查到高度 —— 否则这一轮新实例仍报 -1，修复不生效',
    )
    // 交叉核实：doc 里确实是这段源码，新实例的 key 与它一致
    const [nw] = widgetsOf(view.state)
    assert.equal(nw.w.key, seen.expected, '新实例的 key 必须正是被提前登记的那个源码')
    assert.equal(nw.w.estimatedHeight, H)
  }))

  test('源码不变时（幂等 sync）不得产生事务，也不得把缓存写坏', fresh(() => {
    let dispatchCount = 0
    const { w } = mount(DOC, () => { dispatchCount++ })
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 140 }) }
    // [注意] 必须敲一个与原内容**不同**的字：原文档该格就是 '1'，敲 '1' 等于没变，
    // 不会产生事务，这条用例会退化成什么都没测。
    typeIn(w, '1X')
    w.sync()
    assert.equal(dispatchCount, 1, '前提核实：内容变了必须产生一笔事务')
    assert.equal(w.estimatedHeight, 140, '首次 sync 后必须已登记高度')
    w.sync() // 同样内容再同步一次
    assert.equal(dispatchCount, 1, '内容一致时不得再产生事务（去重）')
    assert.equal(w.estimatedHeight, 140, '幂等 sync 不得清掉已有高度')
  }))

  test('源码里含换行/特殊字符也能作为 key 正确登记', fresh(() => {
    const H = 120
    const { w } = mount()
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: H }) }
    typeIn(w, 'a|b', 1, 0) // 竖线必须被转义，确保源码结构不被破坏
    w.sync()
    assert.ok(w.estimatedHeight > 0, '带竖线的单元格内容也必须能登记高度')
  }))
})

// ===========================================================================
// 4. 缓存必须按 key 隔离（不能把 A 表的高度安到 B 表头上）
// ===========================================================================
describe('表格高度预估 · 按源码 key 隔离', () => {
  test('两张源码不同的表不得共享高度', fresh(() => {
    const doc = `${TABLE}\n\n${['| x | y |', '| --- | --- |', '| p | q |'].join('\n')}`
    const state = mkState(doc)
    const all = widgetsOf(state)
    assert.equal(all.length, 2, '前提核实：文档里应有两张表')

    const [first] = all
    const second = all[1]
    first.w.viewRef = fakeView(state)
    first.w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 90 }) }
    first.w.table = fakeTable(first.w.model)
    typeIn(first.w, '1X')
    first.w.sync()

    assert.ok(first.w.estimatedHeight > 0, '第一张表应报自己的实测高度')
    assert.equal(
      second.w.estimatedHeight,
      -1,
      '第二张表源码不同，必须仍是 -1（共享高度会把矮表撑高/高表压扁）',
    )
  }))

  test('缓存容量有上限：长会话不会无限增长', fresh(() => {
    // 灌入远超上限的不同源码
    for (let i = 0; i < 200; i++) rememberTableHeight(`| t${i} |\n| --- |\n| ${i} |`, 100 + i)
    // 最新的几条必须在（FIFO 只淘汰最老的）
    assert.equal(estimatedTableHeight('| t199 |\n| --- |\n| 199 |'), 299)
    assert.equal(estimatedTableHeight('| t0 |\n| --- |\n| 0 |'), -1, '最老的应被淘汰')
  }))
})

// ===========================================================================
// 5. 量不到时的保留语义（不能退化回 -1 让抖动复现）
// ===========================================================================
describe('表格高度预估 · 量失败时的保留语义', () => {
  test('量不到时必须保留上一次的有效值', fresh(() => {
    const { w } = mount()
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 140 }) }
    typeIn(w, '1X')
    w.sync()
    assert.ok(w.estimatedHeight > 0)

    // DOM 不在了 → measureTableHeight 量不到，但不得把已有缓存清掉
    const key = w.key
    w.dom = { isConnected: false, getBoundingClientRect: () => ({ height: 0 }) }
    assert.equal(measureTableHeight(w), false, '量不到应返回 false')
    assert.equal(estimatedTableHeight(key), 140, '量不到时必须保留上一次的有效高度')
  }))

  test('量不到时不得把缓存写成 0 / NaN（那会让 CM 认为表格高 0，直接塌没）', fresh(() => {
    const { w } = mount()
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 0 }) }
    assert.equal(measureTableHeight(w), false)
    assert.equal(w.estimatedHeight, -1, '高度 0 不是有效高度，必须仍报 -1')

    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: NaN }) }
    assert.equal(measureTableHeight(w), false)
    assert.equal(w.estimatedHeight, -1, 'NaN 不是有效高度')

    w.dom = { isConnected: true }
    assert.equal(measureTableHeight(w), false, '没有 getBoundingClientRect 也不能抛错')
  }))

  test('空 key / 负高度一律拒收', fresh(() => {
    assert.equal(rememberTableHeight('', 100), false)
    assert.equal(rememberTableHeight(null, 100), false)
    assert.equal(rememberTableHeight('k', -5), false)
    assert.equal(rememberTableHeight('k', 0), false)
    assert.equal(estimatedTableHeight('k'), -1)
  }))
})

// ===========================================================================
// 6. 结构变更（增删行列）后高度必须立刻重取
// ===========================================================================
/** 只够 buildTable / rebuild 用的最小 DOM：<table>.rows 与 <tr>.cells 按子节点派生 */
function installMiniDom() {
  const mkEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      contentEditable: '',
      textContent: '',
      style: {},
      className: '',
      dataset: {},
      focus() {},
      appendChild(c) { this.children.push(c); return c },
      setAttribute() {},
      querySelectorAll() { return [] },
      contains() { return false },
      classList: { add() {}, remove() {} },
    }
    el.replaceChild = (n, old) => {
      const i = el.children.indexOf(old)
      if (i < 0) throw new Error('replaceChild: 目标不是子节点')
      el.children[i] = n
      return old
    }
    if (tag === 'table') {
      Object.defineProperty(el, 'rows', {
        get() {
          const out = []
          for (const sec of this.children) {
            if (sec.tagName === 'THEAD' || sec.tagName === 'TBODY') out.push(...sec.children)
          }
          return out
        },
      })
    }
    if (tag === 'tr') {
      Object.defineProperty(el, 'cells', { get() { return this.children } })
    }
    return el
  }
  const prev = { document: globalThis.document, window: globalThis.window }
  globalThis.document = {
    createElement: mkEl,
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
  }
  globalThis.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) }
  return () => {
    globalThis.document = prev.document
    globalThis.window = prev.window
  }
}

/**
 * 【这条守的是 rebuild() 里的 measureTableHeight】增删行列后行数变了、高度
 * 必然变。若不在这里重取，下一轮 NodeBuilder 拿到的还是旧行数的高度 —— 用户
 * 点一下「加行」，表格先按旧高度画一帧再跳，与逐字输入是同一种抖动。
 */
describe('表格高度预估 · 结构变更后重取', () => {
  test('rebuild 必须真的换掉 <table>，并按新高度重取', fresh(() => {
    const restore = installMiniDom()
    try {
      const { w } = mount()
      w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 100 }) }
      typeIn(w, '1X')
      w.sync()
      assert.ok(w.estimatedHeight > 0)

      const oldTable = w.table
      // wrap 要有 replaceChild：rebuild 第一件事就是把旧 <table> 换成新的
      w.dom.replaceChild = function (n, old) {
        assert.equal(old, oldTable, 'rebuild 必须替换掉当前这张 <table>')
        this.replaced = n
        return old
      }
      // 加了一行 → 表格变高
      w.dom.getBoundingClientRect = () => ({ height: 160 })
      w.model.rows.push(['新行', '新行'])

      w.rebuild({})

      assert.ok(w.dom.replaced, 'rebuild 必须真的调用 replaceChild 换掉 <table>')
      assert.equal(w.table, w.dom.replaced, 'this.table 必须指向新构建的那张表')
      assert.notEqual(w.table, oldTable, '新旧 <table> 不得是同一个对象')
      assert.equal(w.estimatedHeight, 160, '结构变更后必须重取高度（沿用旧高度还是会跳）')
    } finally {
      restore()
    }
  }))

  test('rebuild 时量不到高度不得清掉原有缓存', fresh(() => {
    const restore = installMiniDom()
    try {
      const { w } = mount()
      w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 100 }) }
      typeIn(w, '1X')
      w.sync()
      const keep = w.estimatedHeight
      assert.ok(keep > 0)

      w.dom.replaceChild = () => {}
      w.dom.getBoundingClientRect = () => ({ height: 0 }) // 量不到
      w.rebuild({})

      assert.equal(w.estimatedHeight, keep, '量不到时必须保留上一次的有效高度')
    } finally {
      restore()
    }
  }))
})

// ===========================================================================
// 7. 不影响既有编辑契约
// ===========================================================================
describe('表格高度预估 · 不影响既有编辑契约', () => {
  test('sync 之后编辑标记仍指向本实例（eq 的「编辑中」分支不受影响）', fresh(() => {
    const { w } = mount()
    setEditingWidget(w)
    try {
      w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 160 }) }
      typeIn(w, '1X')
      w.sync()
      assert.ok(w.estimatedHeight > 0)
      // 关键：key 变了（源码含新字），但「编辑中」这一支仍必须复用 DOM
      const other = { key: '| 完全不同的表 |\n| --- |\n| x |', from: 999, to: 1200, source: '' }
      assert.equal(w.eq(other), true, '编辑中必须继续复用 DOM（否则焦点每敲一个字就丢）')
    } finally {
      setEditingWidget(null)
    }
  }))

  test('tableWidget 不得再用实例字段存高度（复用态下拿不到）', () => {
    // 源码契约：estimatedHeight 必须查模块级缓存。这条防的是「改回实例字段」
    // 这种看起来更简单、但在 CM 复用语义下必然失效的写法。
    const p = fileURLToPath(new URL('../src/editor/tableWidget.js', import.meta.url))
    const src = readFileSync(p, 'utf8')
    assert.match(src, /get estimatedHeight\(\)\s*\{\s*return estimatedTableHeight\(this\.key\)/,
      'estimatedHeight 必须直接查模块级缓存（不得读实例字段）')
    // 时序契约：提前登记必须出现在 state.update 之前（见第 3 组用例的运行时证据）
    const primeAt = src.indexOf('primeTableHeight(')
    const updateAt = src.indexOf('state.update(')
    assert.ok(primeAt > 0, 'tableWidget 必须调用 primeTableHeight 提前登记高度')
    assert.ok(updateAt > 0, '前提核实：dispatchText 内部有 state.update')
    assert.ok(primeAt < updateAt, '提前登记必须早于 state.update —— 写晚一步则逐字输入命中率恒为 0')
  })
})
