// tableWidget.js — 可编辑表格的 DOM widget（单元格编辑 / 键盘导航 / 行列操作触发）
// ----------------------------------------------------------------------------
// 从 tableRender.js 拆出：那个文件负责「什么时候把表格渲染出来」（语法树扫描 +
// StateField block 装饰），本文件负责「渲染出来之后用户怎么编辑它」。
// 边界是一条 import 线，两边互不感知实现细节。
//
// 【为什么单元格用 contenteditable】嵌套 EditorView 会在 block 装饰里与宿主
// 视图争抢焦点/选区，IME 合成事件还会串层。单层 contenteditable + 显式序列化
// 回文档是本仓实测可行的路径（见 HANDOFF 表格轮）。
//
// 【编辑期间的重渲染保护】用户打字会让文档变化 → 装饰重建。eq() 靠 activeWidget
// 识别「还是同一个表格」，让 CM 复用同一份 DOM，焦点与 IME 不被打断；
// 没有这道保护，每敲一个字光标都会跳回行首。

import { WidgetType } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { serializeTable, locateTable } from './tableRender.js'
import { selfSync, currentEditingWidget, setEditingWidget } from './tableSync.js'
import { createActionBar, insertColumn, insertRow, removeColumn, removeRow } from './tableOps.js'
import { t } from '../i18n/index.js'

// 编辑期间文档不断被自家同步改写，装饰随之重建 —— eq 靠 tableSync 里的
// 「正在编辑的 widget」识别「还是我」，让 CM 复用同一份 DOM，焦点与 IME 不被打断。

function focusEnd(el) {
  el.focus()
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(false)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(r)
}

export class TableWidget extends WidgetType {
  constructor(t) {
    super()
    this.model = t.model
    this.key = t.source
    this.from = t.from
    this.to = t.to
    this.source = t.source
    this.dom = null
    this.viewRef = null
    this.composing = false
    // 操作条的作用目标：最后一次获得焦点的单元格（未点过时默认表头第 0 列）
    this.activeCol = 0
    this.activeRow = -1
    this.ac = new AbortController()
  }

  eq(other) {
    const editing = currentEditingWidget()
    if (editing && editing.dom?.isConnected && (editing === this || editing === other)) return true
    return other.key === this.key
  }

  // 事件全部由 widget 自己处理（Tab/Enter 导航、Esc 退出、粘贴转纯文本），
  // CM 不参与 —— 否则点击单元格会被当作普通光标点击。
  ignoreEvent() { return true }

  toDOM(view) {
    this.viewRef = view
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table'
    const table = document.createElement('table')
    const { header, aligns, rows } = this.model

    const mk = (tag, text, i) => {
      const el = document.createElement(tag)
      el.contentEditable = 'true'
      el.textContent = text
      if (aligns[i] === 'center') el.style.textAlign = 'center'
      else if (aligns[i] === 'right') el.style.textAlign = 'right'
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
    wrap.appendChild(table)

    const opt = { signal: this.ac.signal }
    wrap.addEventListener('input', () => this.sync(), opt)
    wrap.addEventListener('compositionstart', () => { this.composing = true }, opt)
    wrap.addEventListener('compositionend', () => { this.composing = false; this.sync() }, opt)
    wrap.addEventListener('keydown', (e) => this.onKeydown(e), opt)
    wrap.addEventListener('paste', (e) => this.onPaste(e), opt)
    wrap.addEventListener('focusin', (e) => {
      setEditingWidget(this)
      // 记下当前单元格的行列：行列操作作用在「用户正在编辑的那一格」，
      // 而不是固定作用在表尾 —— 否则插列永远加在最后一列，与直觉相反。
      const cell = e.target?.closest?.('td,th')
      if (!cell) return
      this.activeCol = cell.cellIndex
      const rowIndex = [...table.rows].indexOf(cell.closest('tr'))
      // 表头行记为 -1（在其下方插行即表体第 0 行），表体行按 0 基计
      this.activeRow = rowIndex <= 0 ? -1 : rowIndex - 1
    }, opt)
    wrap.addEventListener('focusout', (e) => {
      if (e.relatedTarget && wrap.contains(e.relatedTarget)) return // 单元格间移动
      if (currentEditingWidget() === this) setEditingWidget(null)
      this.sync() // 离场前把最后一次未同步的输入落盘
    }, opt)

    // ---- 行列操作条（构建逻辑在 tableOps.js）----
    // 挂在 wrap 内而不是 body：它继承 ignoreEvent()=true，点击不会被 CM 当成
    // 点击文档；且随 widget 一起销毁（AbortSignal 在 destroy 里 abort），不必手工清理。
    wrap.appendChild(createActionBar((action) => this.runAction(action), this.ac.signal))
    // 悬停显形（样式见 editor-wysiwyg.css 的 .cm-md-table.is-hover）
    wrap.addEventListener('mouseenter', () => wrap.classList.add('is-hover'), opt)
    wrap.addEventListener('mouseleave', () => wrap.classList.remove('is-hover'), opt)

    this.dom = wrap
    return wrap
  }

  /**
   * 行列增删的唯一入口。
   *
   * 【为什么改 model 再整体写回】列数散布在表头/每一行/对齐/分隔行四处，
   * 直接改 DOM 再同步时只要有一处跟不上，产出的就是**非法 Markdown**
   * （GFM 列数不一致时整表退化为段落）。在 model 上改到自洽再统一序列化。
   *
   * 【为什么先 sync()】用户可能刚打完字还没离开单元格，先做一次幂等同步，
   * 保证操作基于屏幕上的最新内容。
   */
  runAction(action) {
    this.sync()
    const model = this.model
    const col = this.activeCol ?? 0
    const row = this.activeRow ?? -1
    const colCount = model.header.length

    switch (action) {
      case 'add-row':
        insertRow(model, row + 1)
        break
      case 'add-col':
        insertColumn(model, Math.min(col + 1, colCount))
        break
      case 'del-row':
        // 表体最少保留 1 行：删空后只剩表头，GFM 仍合法，但用户几乎总是手滑
        if (model.rows.length <= 1) return this.refuse('lastRow')
        removeRow(model, row)
        break
      case 'del-col':
        // 最少保留 1 列（同理）
        if (colCount <= 1) return this.refuse('lastColumn')
        removeColumn(model, col)
        break
      default:
        return
    }
    this.writeModel()
  }

  /** 拒绝操作时给一次短暂提示（不改文档），避免用户以为按钮坏了 */
  refuse(kind) {
    const el = this.dom
    if (!el) return
    el.classList.remove('is-refused')
    void el.offsetWidth // 强制重排，让动画在连续点击时可重播
    el.classList.add('is-refused')
    // 文案走 i18n；用 title 而非气泡：单元格是 contenteditable，覆盖层会打断输入
    el.title = t(kind === 'lastRow' ? 'table.keepLastRow' : 'table.keepLastColumn')
    setTimeout(() => {
      if (el.isConnected) el.classList.remove('is-refused')
    }, 600)
  }

  /** 把当前 model 写回文档（与 sync 同一套区间重定位保护） */
  writeModel() {
    const view = this.viewRef
    if (!view || !this.dom) return
    const text = serializeTable(this.model)
    const state = view.state
    let { from, to } = this
    if (state.doc.sliceString(from, to) !== this.source) {
      const found = locateTable(state, from)
      if (!found) return
      ;({ from, to } = found)
    }
    if (text === state.doc.sliceString(from, to)) return
    view.dispatch({ changes: { from, to, insert: text }, annotations: selfSync.of(true) })
    this.from = from
    this.to = from + text.length
    this.source = text
    this.key = text
  }

  destroy() {
    this.ac.abort()
    if (currentEditingWidget() === this) setEditingWidget(null)
  }

  /** 单元格 DOM → serializeTable → 文档。定位失败宁可不同步，绝不猜区间 */
  sync() {
    const view = this.viewRef
    if (!view || !this.dom || view.composing || this.composing) return
    const table = this.dom.querySelector('table')
    if (!table) return
    const grid = [...table.rows].map((tr) => [...tr.cells].map((td) => td.textContent))
    const model = { header: grid[0], aligns: this.model.aligns, delimRaw: this.model.delimRaw, rows: grid.slice(1) }
    const text = serializeTable(model)
    const state = view.state
    let { from, to } = this
    if (state.doc.sliceString(from, to) !== this.source) {
      const found = locateTable(state, from)
      if (!found) return
      ;({ from, to } = found)
    }
    if (text === state.doc.sliceString(from, to)) return
    view.dispatch({ changes: { from, to, insert: text }, annotations: selfSync.of(true) })
    this.from = from
    this.to = from + text.length
    this.source = text
    this.model = model
  }

  onKeydown(e) {
    const view = this.viewRef
    const cell = e.target.closest?.('td,th')
    if (!view || !cell) return
    // 撤销重做必须路由给 CM：contenteditable 的原生 undo 只改 DOM 不改文档，
    // 放任不管会造成「界面撤销了、文档没变」的分叉
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo(view)
      else undo(view)
      return
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const table = this.dom.querySelector('table')
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!this.stepCell(table, cell, e.shiftKey ? -1 : 1)) this.appendRow(table, e.shiftKey ? -1 : 0)
    } else if (e.key === 'Enter') {
      e.preventDefault() // Enter 不得在单元格里造 <div>；语义 = 下一行同列（末行则加行）
      const rowsArr = [...table.rows]
      const col = cell.cellIndex
      const next = rowsArr[rowsArr.indexOf(cell.closest('tr')) + 1]
      if (next && next.cells[col]) focusEnd(next.cells[col])
      else this.appendRow(table, col)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      this.sync()
      view.dispatch({ selection: { anchor: Math.min(this.to, view.state.doc.length) }, scrollIntoView: true })
      view.focus()
    }
  }

  stepCell(table, cell, delta) {
    const cells = [...table.querySelectorAll('th,td')]
    const j = cells.indexOf(cell) + delta
    if (j < 0 || j >= cells.length) return false
    focusEnd(cells[j])
    return true
  }

  appendRow(table, focusCol = 0) {
    const n = this.model.header.length
    const { aligns } = this.model
    const tr = document.createElement('tr')
    const tds = []
    for (let i = 0; i < n; i++) {
      const td = document.createElement('td')
      td.contentEditable = 'true'
      if (aligns[i] === 'center') td.style.textAlign = 'center'
      else if (aligns[i] === 'right') td.style.textAlign = 'right'
      tr.appendChild(td)
      tds.push(td)
    }
    table.tBodies[0].appendChild(tr)
    focusEnd(tds[Math.min(Math.max(focusCol, 0), n - 1)])
    this.sync()
  }

  onPaste(e) {
    if (!e.target.closest?.('td,th')) return
    const text = e.clipboardData?.getData('text/plain')
    if (text == null) return
    e.preventDefault()
    // 单元格是单行语义：换行折叠为空格，防止破坏表格结构。
    // execCommand 虽被标记过时，但在 contenteditable 插入纯文本仍是最可靠手段。
    document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '))
  }
}
