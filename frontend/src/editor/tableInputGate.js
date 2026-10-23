// tableInputGate.js — 拦截 CM 对单元格内容的默认读回（表格输入失焦的第一道闸）
// ----------------------------------------------------------------------------
// 从 tableWidget.js 拆出（契约 5：拆分后两文件都回到 300 有效行红线之下），
// 但这条链值得独立成文 —— 它是 2026-10-23 真机「表格打几个字失焦 + 表格变竖线」
// 的核心根因之一，时序细节不钉在这里必然被后人当冗余删掉。
//
// 【根因链】单元格是 contenteditable，用户敲的字浏览器先改 DOM。CM 的
// DOMObserver.flush 会把「contentDOM 内的 DOM 变更」读回文档：
//   applyDOMChange → applyDOMChangeInner → applyDefaultInsert →
//   view.dispatch({changes, userEvent:'input.type'})
//   （@codemirror/view/dist/index.js:4346+ / 4374 / 4378）
// 这笔事务**不带 selfSync**，而表格的编辑标记靠「selfSync 事务才存活」
// （tableRender.js 的 tableRenderField.updateF：docChanged 且无 selfSync ⇒
// setEditingWidget(null)）。于是：
//   a) 编辑标记被清 ⇒ tableWidget.eq() 的复用条件失效（key 又因打字必然不同）
//      ⇒ CM 走 toDOM 整表重建 ⇒ 单元格焦点 / IME 合成被打断 ——
//      「输入几个字符就失去焦点」；
//   b) 读回事务的插入点 / 选区取自单元格 DOM ⇒ 主选区被搬进表格 range ⇒
//      下一帧 selectionInside 翻真 ⇒ block widget 从装饰里撤下 = 表格区间
//      恢复成 Markdown 竖线行（用户眼里「自动变成列表/源码」），焦点随
//      widget DOM 摘除彻底丢失。
// 静态代码里这条链有闸（readMutation 对 widget 的短路、onSelectionChange 的
// ignoreEvent 保护、hasFocus=false 时 newSel 被清），但三道闸都是「时序敏感」
// 的：selectionChanged 残留、activeElement 归位、flush 时机三者相交的竞态窗
// 在真机上随机命中 —— 这正是「打几个字才翻」的随机性来源。本拦截器把窗口
// 从源头封死：读回事务根本不会发生。
//
// 【为什么吞掉是安全的】单元格内容落盘的唯一权威通道是 widget 自己的
// input / compositionend → sync() → dispatchText(selfSync)（整表序列化回写）。
// CM 的默认读回在表格场景是**第二条写通道**：它写的是「单元格局部文本」，
// 与 sync 的整表写回互相踩（内容分叉 + 清标记）。拦掉后浏览器原生改的 DOM
// 由 sync() 收口；删除（Backspace 等）同样触发 input 事件 ⇒ sync 覆盖，不丢能力。
//
// 【判定】from/to 是 CM 已经算好的文档坐标（无论来自 domBoundsAround 还是
// posFromDOM），落在任一已扫描表格 range 内 ⇒ 这笔输入发生在单元格或其边界，
// 全部吞掉。用 tableRenderField 的 tables 清单（增量树扫描缓存）判定，
// 零语法树开销；`from < t.to && to >= t.from` 的右端用 >= 是为了把「贴着表格
// 末边界」的输入也纳入 —— 边界插入属于表格自身的维护操作（widget 的 Esc、
// appendRow 都落在边界上）。

import { EditorView } from '@codemirror/view'
import { tableRenderField } from './tableRender.js'

export const tableInputGate = EditorView.inputHandler.of((view, from, to) => {
  const { tables } = view.state.field(tableRenderField)
  for (const t of tables) {
    if (from < t.to && to >= t.from) return true
  }
  return false
})
