// tableFocus.js — 表格单元格的焦点/光标落点
// ----------------------------------------------------------------------------
// 从 tableWidget.js 拆出：那文件管「表格怎么编辑」，本文件只管「光标放在哪」。
// 拆出的直接原因是契约 5 行数门禁（tableWidget.js 已贴着 300 有效行红线），
// 但这条职责本身也确实独立：单元格是 contenteditable，落光标必须自己造
// Range —— 用 el.focus() 只会落到元素开头，用 selection API 又会被浏览器
// 在下一帧重置。三个调用点（键盘导航 / 结构变更后还原 / 追加行）都依赖同一
// 套「光标贴到单元格末尾」的语义，写在一处才不会各写一份走样。

/**
 * 把光标放到元素内容末尾并获得焦点。
 *
 * 【为什么不是 el.focus() 就完事】contenteditable 元素获得焦点时浏览器把光标
 * 放在**开头**（或按点击位置）。键盘导航（Tab/Enter）语义是「接着往下写」，
 * 光标必须落在末尾。故显式构造 Range 并 collapse(false)。
 */
export function focusEnd(el) {
  el.focus()
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(false)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(r)
}

/**
 * 按行列下标把焦点还原到某个单元格（越界自动夹到最近合法格）。
 *
 * 【为什么越界要夹而不是放弃】增删行列后调用方给的是**操作前**的下标：删掉
 * 最后一列时 activeCol 可能已经越界。此时直接把焦点丢掉（不 focus）会让
 * 用户下一次按键落到文档上、表格退出编辑态 —— 表现为「点一下删除按钮，
 * 输入法没了」。夹到最近合法格是用户预期的降级。表头行下标为 0。
 *
 * @param {{rows: ArrayLike<{cells: ArrayLike<HTMLElement>}>}} table
 * @param {number} row 行下标（0 = 表头）
 * @param {number} col 列下标
 * @returns {HTMLElement|null} 被聚焦的单元格（无表格时 null）
 */
export function restoreCellFocus(table, row, col) {
  const rows = table?.rows
  if (!rows?.length) return null
  const tr = rows[Math.max(0, Math.min(row, rows.length - 1))]
  const cells = tr?.cells
  if (!cells?.length) return null
  const cell = cells[Math.max(0, Math.min(col, cells.length - 1))]
  if (!cell) return null
  focusEnd(cell)
  return cell
}
