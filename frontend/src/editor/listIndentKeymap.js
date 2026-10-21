// listIndentKeymap.js — Tab / Shift+Tab 的 CM keymap 接线（纯逻辑在 listIndent.js）
// ----------------------------------------------------------------------------
// 【为什么拆成两个文件】listIndent.js 是纯函数（doc + 选区 → 变更数组），可被
// node:test 直接驱动；本文件只负责把它接进 CM 的 keymap，并且**必须排在
// indentWithTab 之前**（同一个 Tab 键，列表场景要抢在通用缩进前面）。
//
// 【放行条件】选区里没有任何列表项 → 返回 false，交回 indentWithTab：
//   - 代码块内按 Tab 应该是「插入缩进」而不是「列表缩进」；
//   - 普通段落按 Tab 若被吃掉，用户会觉得 Tab 键坏了。
// 这条守卫让「列表智能缩进」是**叠加**在既有行为上，而不是替换掉它。

import { keymap } from '@codemirror/view'
import { listIndentChanges } from './listIndent.js'

/**
 * 把变更数组套进一次事务。
 * 选区按「首个变更行的行首」重设 —— 缩进后行首位置本来就变了，沿用旧 anchor
 * 会落在行中（表现为光标莫名其妙停在文字中间）。
 */
function applyIndent(view, dir) {
  const { state } = view
  const changes = listIndentChanges(state.doc, state.selection.ranges, dir)
  if (!changes || !changes.length) return false

  const firstLine = state.doc.lineAt(state.selection.main.from).number
  view.dispatch({
    changes,
    // 光标保持在原来的逻辑位置：按首行的缩进增量平移
    selection: { anchor: shiftByFirst(state, changes, firstLine) },
    userEvent: dir > 0 ? 'input.indent' : 'delete.dedent',
  })
  return true
}

/** 选区锚点按首行前缀长度变化平移（缩进 +2 / 反缩进 -2 或吸附） */
function shiftByFirst(state, changes, lineNo) {
  const line = state.doc.line(lineNo)
  const hit = changes.find((c) => c.from === line.from)
  const delta = hit ? hit.insert.length - (hit.to - hit.from) : 0
  const head = state.selection.main.head
  return Math.max(line.from, Math.min(head + delta, state.doc.length))
}

/** 生成 keymap 扩展（Tab / Shift+Tab 两条） */
export function listIndentExtension() {
  return keymap.of([
    { key: 'Tab', run: (view) => applyIndent(view, 1) },
    { key: 'Shift-Tab', run: (view) => applyIndent(view, -1) },
  ])
}
