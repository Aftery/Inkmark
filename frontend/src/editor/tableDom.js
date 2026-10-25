/**
 * tableDom.js — 按 model 构建 <table> DOM
 * ============================================================================
 * 从 tableWidget.js 拆出（2026-10-24）：构建逻辑与「编辑器集成」（事件、
 * 区间记账、eq 复用）职责不同，且契约 5 的 300 有效行红线要求 widget 主文件
 * 保持精简。重建（rebuild）与首次渲染（toDOM）共用这一个函数，保证两条路径
 * 绝不会画出两种结构。
 *
 * 对应关系（model ↔ DOM）：
 *   header  → thead 里的 th（contentEditable，与 td 同为可编辑单元格）
 *   aligns  → 每列的 text-align（缺省 left）
 *   rows    → tbody 里的 tr/td
 */

/** 按 model 构建一棵完整的 <table>（调用方负责挂进文档与事件委托） */
export function buildTableFromModel(model) {
  const table = document.createElement('table')
  const { header, aligns, rows } = model
  const mk = (tag, text, i) => {
    const el = document.createElement(tag)
    el.contentEditable = 'true'
    el.textContent = text
    el.style.textAlign = aligns[i] ?? 'left'
    return el
  }
  const thead = document.createElement('thead')
  const htr = document.createElement('tr')
  header.forEach((c, i) => htr.appendChild(mk('th', c, i)))
  thead.appendChild(htr)
  table.appendChild(thead)
  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const tr = document.createElement('tr')
    row.forEach((c, i) => tr.appendChild(mk('td', c, i)))
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}
