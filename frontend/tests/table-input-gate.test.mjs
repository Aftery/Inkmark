/**
 * table-input-gate.test.mjs — 「表格输入几个字就失焦 + 表格变竖线」回归
 * ---------------------------------------------------------------------------
 * 用户原话（真机）：「表格的话还是一样，输入几个字符失去焦点了，然后自动就
 * 切换列表了」。此前 aac6b5b 修的是高度记账（跑行），本轮修的是**事务通道**：
 *
 * 根因链（tableInputGate.js / tableRender.js 守卫头注有完整版）：
 *   ① 单元格是 contenteditable，打字 = 浏览器先改 DOM；
 *   ② CM 的 DOMObserver.flush 把 contentDOM 内的 DOM 变更读回文档：
 *      applyDOMChange → applyDefaultInsert → view.dispatch({changes,
 *      userEvent:'input.type'})（view/dist/index.js:4346+/4374/4378）——
 *      这笔事务**不带 selfSync**；
 *   ③ tableRenderField.updateF 把它当外部改动 ⇒ setEditingWidget(null)
 *      ⇒ eq() 复用断（key 因打字必然不同）⇒ toDOM 整表重建 ⇒ 焦点/IME 断；
 *   ④ flush 的 newSel-only 分支（4329-4344）在「selectionChanged 残留 +
 *      hasFocus 归真 + 任一 flush」三重竞态下把**主选区搬进表格 range**
 *      ⇒ selectionInside 翻真 ⇒ block widget 撤下 = 表格退化成竖线行。
 *
 * 【测试口径】真机 DOM 时序（MutationObserver / selectionchange）无法在
 * Node 里真实触发（无 DOM），故这里钉死的是两条修法的**判定语义**：
 *   - tableInputGate：CM 读回事务的 (from,to) 落在表格 range 内 ⇒ 必须吞；
 *     表格外的正常输入 ⇒ 必须放行（否则正文没法打字）。
 *   - tableSelectionGuard：只改选区、目标落在表格严格相交区间的事务 ⇒
 *     必须改写到表格边界；贴边界 / 带文档变更的事务 ⇒ 放行。
 * 每条判定都对应真机上的一条翻转/放行路径，红 = 对应真机症状复发。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tableRenderField, tableSelectionGuard } from '../src/editor/tableRender.js'
import { tableInputGate } from '../src/editor/tableInputGate.js'
import { setEditingWidget, currentEditingWidget } from '../src/editor/tableSync.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(join(root, 'src', p), 'utf8')

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
const DOC = `前文\n\n${TABLE}\n\n后文`
const T_FROM = DOC.indexOf('| a |')
const T_TO = T_FROM + TABLE.length

function mkState(doc, anchor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: Math.min(anchor, doc.length) },
    // 多光标用例需要显式开启（CM 默认 asSingle 会坍缩多 range，见守卫测试组）
    extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownLanguage }), tableRenderField, tableSelectionGuard, tableInputGate],
  })
}

/** 取 gate 处理函数（EditorView.inputHandler facet 的值是处理函数数组） */
function gateHandlerOf(state) {
  const handlers = state.facet(EditorView.inputHandler)
  assert.ok(handlers.length >= 1, 'inputHandler facet 必须有注册')
  // tableInputGate 的处理函数签名 (view, from, to) ⇒ length === 3；
  // CM 内建无其他 length===3 的处理器（smartInput 的 handler 用到第 4 参）。
  const gate = handlers.find((f) => f.length === 3)
  assert.ok(gate, '必须能按签名定位 tableInputGate 处理函数')
  return gate
}

// ===========================================================================
// 1. tableInputGate：CM 读回事务的拦截判定
// ===========================================================================

describe('tableInputGate · 拦截 CM 对单元格内容的默认读回', () => {
  test('接线契约：inputHandler 必须注册进 createEditor（防拆文件后忘接线）', () => {
    assert.match(src(join('editor', 'createEditor.js')), /tableInputGate,/)
  })

  test('读回事务落在表格 range 内（打字/删除的两种坐标来源）⇒ 吞掉', () => {
    const st = mkState(DOC)
    const gate = gateHandlerOf(st)
    const fakeView = { state: st }
    // 场景 A：单元格中部打字（domBoundsAround 覆盖不了 widget 时 from/to
    // 由 posFromDOM 算出，落单元格内）
    assert.equal(gate(fakeView, T_FROM + 10, T_FROM + 10, 'X', () => {}), true,
      '单元格内输入必须返回 true（吞掉 CM 默认读回）')
    // 场景 B：表格末字符后贴边界输入（appendRow / Esc 退出的坐标形态）
    assert.equal(gate(fakeView, T_TO - 1, T_TO - 1, 'X', () => {}), true,
      '表格末字符后贴边界输入也必须吞掉')
  })

  test('表格外的正常输入放行（正文打字不受影响）', () => {
    const st = mkState(DOC)
    const gate = gateHandlerOf(st)
    const fakeView = { state: st }
    assert.equal(gate(fakeView, 1, 1, 'X', () => {}), false, '表格前正文输入放行')
    assert.equal(gate(fakeView, DOC.length, DOC.length, 'X', () => {}), false, '文档末尾输入放行')
  })

  test('吞掉后编辑标记存活：无 selfSync 事务不再被产生（eq 复用不断）', () => {
    // 链路证明：gate 吞掉 ⇒ applyDefaultInsert 不跑 ⇒ 没有「无 selfSync 的
    // docChanged」 ⇒ field.updateF 的清标记分支不触发。
    const st = mkState(DOC)
    setEditingWidget({ tag: 'cell' })
    // 仅选区变化（gate 吞掉文档事务后 flush 可能留下的形态）不清标记
    st.update({ selection: { anchor: T_FROM + 5 } })
    assert.equal(currentEditingWidget()?.tag, 'cell', '仅选区变化保留编辑标记')
  })
})

// ===========================================================================
// 2. tableSelectionGuard：拦「把主选区搬进表格」的选区事务
// ===========================================================================

describe('tableSelectionGuard · flush 的 newSel-only 搬运必须被改写', () => {
  test('主选区（表外旧位置）被搬进表格内部 ⇒ 改写到表格起始边界', () => {
    const st = mkState(DOC, 0)
    // 真机形态：flush 派发 {selection: 单元格内坐标}（探针 4 的数学）
    const tr = st.update({ selection: { anchor: T_FROM + 12 }, userEvent: 'select' })
    const out = tableSelectionGuard ? null : null
    // transactionFilter 的执行发生在 state.update 内部 —— 直接断言事务产物：
    // 新主选区必须不在表格严格相交区间内（边界/表外都算守卫成功）
    const anchor = tr.state.selection.main.anchor
    assert.ok(
      !(anchor > T_FROM && anchor < T_TO),
      `主选区(${anchor}) 被守卫改写后必须落在表外/边界，表格区间 [${T_FROM},${T_TO})`,
    )
    // 文档没被改（守卫只动选区）
    assert.equal(tr.docChanged, false, '守卫不得顺带改文档')
  })

  test('贴边界的选区事务放行（Esc 退出落在表格末边界必须可用）', () => {
    const st = mkState(DOC, 0)
    const tr = st.update({ selection: { anchor: T_TO } })
    assert.equal(tr.state.selection.main.anchor, T_TO, '边界位置放行（Esc 依赖它退出）')
  })

  test('带文档变更的事务不拦（widget 自身 sync 的 selfSync 回写不受影响）', () => {
    const st = mkState(DOC, 0)
    const tr = st.update({
      changes: { from: T_FROM + 10, to: T_FROM + 10, insert: 'X' },
      selection: { anchor: T_FROM + 11 },
    })
    assert.equal(tr.docChanged, true, '文档变更照常生效')
    assert.equal(tr.state.selection.main.anchor, T_FROM + 11, '选区随事务保留')
  })

  test('表格外的正常选区移动不受影响（点击正文 / ⌘F 跳转）', () => {
    const st = mkState(DOC, 0)
    const tr = st.update({ selection: { anchor: 1 } })
    assert.equal(tr.state.selection.main.anchor, 1, '表外选区原样放行')
  })
})

// ===========================================================================
// 3. dispatchText 的选区守卫（tableWidget）：sync 后主选区钉在表格边界
// ===========================================================================
// 这组直接驱动真 TableWidget（fake view 载具与 table-widget-height.test.mjs 同款），
// 钉死「sync 产生的事务必须带边界选区」与「已搬进表内的主选区必须被纠正」。

describe('tableWidget.dispatchText · 选区守卫', () => {
  test('sync 回写的事务把主选区钉在表格起始边界（防 flush 的 newSel 搬运）', async () => {
    const { TableWidget } = await import('../src/editor/tableWidget.js')
    const st = mkState(DOC, 0)
    const cur = st.field(tableRenderField).deco.iter()
    assert.equal(cur.from, T_FROM, '前提：装饰存在')
    const w = cur.value.widget
    const dispatched = []
    const view = {
      state: st,
      composing: false,
      focus() {},
      dispatch(tr) {
        dispatched.push(tr)
        this.state = tr.state
      },
    }
    w.viewRef = view
    w.dom = { isConnected: true, getBoundingClientRect: () => ({ height: 120 }) }
    w.table = { rows: [w.model.header, ...w.model.rows].map((cells) => ({ cells: cells.map((t) => ({ textContent: t })) })) }
    setEditingWidget(w)

    w.table.rows[1].cells[0].textContent = '1X'
    w.sync()
    assert.ok(dispatched.length >= 1, 'sync 必须产生回写事务')
    const syncTr = dispatched[0]
    assert.equal(syncTr.state.selection.main.anchor, T_FROM,
      '回写事务的选区必须钉在表格起始边界（界外 ⇒ 渲染态保持）')
  })
})

// ===========================================================================
// 4. 守卫的多光标边界：只改写落表内的 range，其余保留
// ===========================================================================

describe('tableSelectionGuard · 多 range 收口边界', () => {
  test('跨表多光标：表内 range 被改写到边界，表外 range 原样保留', () => {
    const st = mkState(DOC, 0)
    const inside = T_FROM + 12
    const outside = DOC.length - 1
    const tr = st.update({
      selection: EditorSelection.create([EditorSelection.cursor(inside), EditorSelection.cursor(outside)], 0),
    })
    const anchors = tr.state.selection.ranges.map((r) => r.anchor)
    assert.ok(!anchors.some((a) => a > T_FROM && a < T_TO), '不得有 range 残留在表内')
    assert.ok(anchors.includes(outside), '表外 range 必须原样保留')
    assert.equal(tr.docChanged, false, '守卫不改文档')
  })
})
