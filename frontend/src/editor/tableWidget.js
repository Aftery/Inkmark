// tableWidget.js — 可编辑表格的 DOM widget（单元格编辑 / 键盘导航 / 行列操作触发）
// ----------------------------------------------------------------------------
// 从 tableRender.js 拆出：那个文件负责「什么时候把表格渲染出来」（语法树扫描 +
// StateField block 装饰），本文件负责「渲染出来之后用户怎么编辑它」。
//
// 【为什么单元格用 contenteditable】嵌套 EditorView 会在 block 装饰里与宿主
// 视图争抢焦点/选区，IME 合成事件还会串层。单层 contenteditable + 显式序列化
// 回文档是本仓实测可行的路径（见 HANDOFF 表格轮）。
//
// 【编辑期间的重渲染保护】用户打字会让文档变化 → 装饰重建。eq() 靠 activeWidget
// 识别「还是同一个表格」，让 CM 复用同一份 DOM，焦点与 IME 不被打断；
// 没有这道保护，每敲一个字光标都会跳回行首。
//
// 【结构变更后必须自己重建 DOM —— 这是个真陷阱】eq() 返回 true 时 CM **复用旧
// DOM**，而增删行列/重排/改对齐之后文档已变、旧 DOM 却还是老结构：用户会看到
// 「点了按钮没反应」，一离开再回来才对（因为那时才真正重建）。故结构类操作
// 一律走 rebuild()：按 model 重建 <table> 并把焦点按行列下标还原。

import { WidgetType } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { serializeTable, locateTable } from './tableRender.js'
import { selfSync, currentEditingWidget, setEditingWidget } from './tableSync.js'
import {
  ALIGN_CYCLE, createActionBar, insertColumn, insertRow, moveColumn, moveRow,
  nextAlign, removeColumn, removeRow, setAlignIndicator, setColumnAlign,
} from './tableOps.js'
import { attachTableDrag } from './tableDrag.js'
import { t } from '../i18n/index.js'

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
    this.table = null
    this.viewRef = null
    this.composing = false
    // 操作条的作用目标：最后一次获得焦点的单元格（未点过时默认表头第 0 列）
    this.activeCol = 0
    this.activeRow = -1
    this.ac = new AbortController()
    this.drag = null
  }

  eq(other) {
    const editing = currentEditingWidget()
    const reuse = (editing && editing.dom?.isConnected && (editing === this || editing === other)) ||
      other.key === this.key
    // 只在「同一个表格」时接区间：key 不同意味着源码变了、而 model 仍是旧的，
    // 此时把新 source 塞进来会造成「新 source + 旧 model」错配 —— 随后 sync()
    // 会用旧 DOM 序列化出的内容覆盖掉新内容（数据丢失）。故保守跳过。
    if (reuse && other.key === this.key) this.adoptRange(other)
    return !!reuse
  }

  /**
   * 复用 DOM 时把「区间记账」接过来 —— CM 的复用语义有个不对称：
   *
   *   findWidget() 命中 eq() 之后返回的是 `new WidgetTile(tile.dom, …, widget)`
   *   ——**旧 DOM 配新实例**。新实例带的是刚解析出的最新 from/to，却因为 toDOM
   *   从未被调用而没有 dom / table / viewRef，是个空壳；真正挂着 input 监听、
   *   真正在收键盘事件的是**旧实例**。于是旧实例成了唯一活着的编辑者，而它的
   *   from/to 永远停在第一次渲染时的位置（CM 从不回写它）。
   *
   * 只要表格上方/下方被插入过文字（写正文、撤销、外部改动都会），旧实例的区间
   * 就整体偏移。此后再在单元格里打字，dispatchText() 拿过期区间去 sliceString，
   * 对不上 source 就转 locateTable —— 而过期位置常常已经不在任何 Table 节点里
   * （落在上方段落中），locateTable 返回 null，sync() 静默放弃：用户敲的字没进
   * 文档，光标却还在单元格里。这是「输入会跑行」里最容易被当成玄学的那一半。
   *
   * 修法：既然复用是「旧 DOM 继续用」，就把新实例的位置基准交给旧实例。只在
   * key（表格源码）一致时发生，故 model 内容必然一致，不动 model。
   */
  adoptRange(other) {
    if (other === this) return
    this.from = other.from
    this.to = other.to
    this.source = other.source
    this.key = other.key
  }

  // 事件全部由 widget 自己处理（Tab/Enter 导航、Esc 退出、粘贴转纯文本），
  // CM 不参与 —— 否则点击单元格会被当作普通光标点击。
  ignoreEvent() { return true }

  /** 按 model 构建 <table>（重建与首次渲染共用，保证两条路径绝不会画出两种结构） */
  buildTable() {
    const table = document.createElement('table')
    const { header, aligns, rows } = this.model
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

  toDOM(view) {
    this.viewRef = view
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table'
    this.table = this.buildTable()
    wrap.appendChild(this.table)

    const opt = { signal: this.ac.signal }
    wrap.addEventListener('input', () => this.sync(), opt)
    wrap.addEventListener('compositionstart', () => { this.composing = true }, opt)
    wrap.addEventListener('compositionend', () => { this.composing = false; this.sync() }, opt)
    wrap.addEventListener('keydown', (e) => this.onKeydown(e), opt)
    wrap.addEventListener('paste', (e) => this.onPaste(e), opt)
    wrap.addEventListener('focusin', (e) => this.onFocusIn(e), opt)
    wrap.addEventListener('focusout', (e) => {
      if (e.relatedTarget && wrap.contains(e.relatedTarget)) return // 单元格间移动
      if (currentEditingWidget() === this) setEditingWidget(null)
      this.sync() // 离场前把最后一次未同步的输入落盘
    }, opt)

    // ---- 行列操作条（构建逻辑在 tableOps.js）----
    // 挂在 wrap 内而不是 body：它继承 ignoreEvent()=true，点击不会被 CM 当成
    // 点击文档；且随 widget 一起销毁（AbortSignal 在 destroy 里 abort）。
    this.bar = createActionBar((action) => this.runAction(action), this.ac.signal)
    wrap.appendChild(this.bar)
    // 悬停显形（样式见 editor-wysiwyg.css 的 .cm-md-table.is-hover）
    wrap.addEventListener('mouseenter', () => wrap.classList.add('is-hover'), opt)
    wrap.addEventListener('mouseleave', () => wrap.classList.remove('is-hover'), opt)

    // ---- 行列拖拽重排（tableDrag.js）----
    // getTable 而不是直接传元素：结构变更后 <table> 会被换掉，闭包里必须取最新那个
    this.drag = attachTableDrag({
      wrap,
      getTable: () => this.table,
      signal: this.ac.signal,
      onMove: (kind, from, to) => this.move(kind, from, to),
    })

    this.dom = wrap
    this.refreshIndicators()
    return wrap
  }

  /** 记录当前单元格行列（键盘导航 / 操作条 / 对齐按钮的作用目标都依赖它） */
  onFocusIn(e) {
    setEditingWidget(this)
    const cell = e.target?.closest?.('td,th')
    if (!cell) return
    this.activeCol = cell.cellIndex
    const rowIndex = [...this.table.rows].indexOf(cell.closest('tr'))
    // 表头行记为 -1（在其下方插行即表体第 0 行），表体行按 0 基计
    this.activeRow = rowIndex <= 0 ? -1 : rowIndex - 1
    this.refreshIndicators()
  }

  /** 对齐指示器随活动列更新（操作条上高亮当前列的对齐档） */
  refreshIndicators() {
    const align = this.model.aligns?.[this.activeCol] ?? 'left'
    setAlignIndicator(this.bar, align)
  }

  /**
   * 按 model 重建 DOM，并把焦点还原到同一行列。
   *
   * 只用于**结构变更**（增删行列 / 重排 / 改对齐）：这类操作后文档已变，但
   * CM 因 eq() 命中会复用旧 DOM，不主动重建就是「界面没反应」（见文件头）。
   */
  rebuild({ focusRow = null, focusCol = null } = {}) {
    const wrap = this.dom
    if (!wrap) return
    const old = this.table
    const next = this.buildTable()
    wrap.replaceChild(next, old)
    this.table = next
    this.drag?.refresh?.()
    this.refreshIndicators()
    // 焦点还原：优先调用方指定，否则沿用操作前的活动单元格
    const row = focusRow ?? (this.activeRow + 1)
    const col = focusCol ?? this.activeCol
    const tr = this.table.rows[Math.max(0, Math.min(row, this.table.rows.length - 1))]
    const cell = tr?.cells?.[Math.max(0, Math.min(col, (tr?.cells?.length ?? 1) - 1))]
    if (cell) focusEnd(cell)
  }

  /**
   * 行列增删 / 对齐 / 重排的唯一入口。
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

    // 对齐：点同一个档位再循环到下一档（左 → 中 → 右 → 左）
    if (action.startsWith?.('align:')) {
      const want = action.slice(6)
      const target = want === 'cycle' ? nextAlign(model.aligns[col]) : want
      setColumnAlign(model, col, ALIGN_CYCLE.includes(target) ? target : nextAlign(model.aligns[col]))
      this.writeModel()
      this.rebuild({ focusCol: col })
      return
    }

    let focusRow = null
    switch (action) {
      case 'add-row':
        focusRow = row + 2 // 表体新行插在 row+1（0 基），DOM 行号 = +1（表头占一位）+1（新行）
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
    this.rebuild({ focusRow, focusCol: Math.min(col, model.header.length - 1) })
  }

  /** 拖拽重排落点（tableDrag 松手时调一次，只产生一条撤销记录） */
  move(kind, from, to) {
    this.sync()
    if (kind === 'col') moveColumn(this.model, from, to)
    else moveRow(this.model, from, to)
    this.activeCol = kind === 'col' ? to : this.activeCol
    this.activeRow = kind === 'row' ? to : this.activeRow
    this.writeModel()
    this.rebuild({ focusRow: kind === 'row' ? to + 1 : this.activeRow + 1, focusCol: this.activeCol })
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
    if (!view) return
    // 用文档主换行符序列化：文档是 CRLF 时若硬编码 '\n'，回写会让表格行变 LF
    // 而相邻行仍是 CRLF，重渲染错位（用户侧「输着输着跑行」）。见 tableRender.js。
    const text = serializeTable(this.model, view.state.lineBreak)
    return this.dispatchText(text)
  }

  /**
   * 区间保护 + 去重后写回。
   *
   * 返回值 = **文档此刻是否已等于 `text`**（不是「有没有产生事务」）：
   * true 表示已一致（刚写进去或本就一致），false 表示区间定位失败、什么都没做
   * （宁可不同步，也绝不猜区间）。
   *
   * 【为什么是这个语义】`sync()` 拿它决定要不要把 model 升级成刚从 DOM 读出的
   * 那份。若把「文本本就一致」报成 false，model 会停在旧值而 DOM 已是新值 ——
   * model / source / key 脱节，下次 eq() 的比较基准就错了（表现为内容滞后、
   * 错位）。故成功路径**一律**同步更新 from / to / source / key，维持不变量：
   * `state.sliceDoc(from, to) === source === key === serializeTable(model)`
   *
   * [注意] 读回必须用 `state.sliceDoc` 而不是 `state.doc.sliceString`：后者恒按
   * '\n' 拼接，前者按 `state.lineBreak`。两者在默认配置下相等（生产即是如此，
   * 全仓未配置 lineSeparator facet），但一旦文档配了 CRLF，混用会让「刚写进去的
   * 文本」与「读回来的文本」永远不等 —— 去重失效，每敲一个字都多一笔事务。
   */
  dispatchText(text) {
    const view = this.viewRef
    const state = view.state
    let { from, to } = this
    if (state.sliceDoc(from, to) !== this.source) {
      const found = locateTable(state, from)
      if (!found) return false
      ;({ from, to } = found)
    }
    // 文本已一致：不产生多余事务，但记账仍要对齐（见上）
    if (text !== state.sliceDoc(from, to)) {
      const tr = state.update({ changes: { from, to, insert: text }, annotations: selfSync.of(true) })
      view.dispatch(tr)
      // 【为什么不能写 from + text.length】CM 按 lineSeparator facet 切行，换行符
      // 被归一化（\r\n → 单个位置）：文档是 CRLF 时 text.length 比真实增量多出
      // 「换行个数」个字符。用 text.length 记账会让 this.to 越过表格末尾，下一次
      // sliceString(from, to) 会把表格后的一行正文一起圈进来 —— 用户侧就是
      // 「输着输着跑行 / 旁边的段落被吃掉」。以真实新文档长度为准。
      to = from + (tr.newDoc.length - (state.doc.length - (to - from)))
    }
    this.from = from
    this.to = to
    this.source = text
    this.key = text
    return true
  }

  destroy() {
    this.ac.abort()
    if (currentEditingWidget() === this) setEditingWidget(null)
  }

  /**
   * 单元格 DOM → serializeTable → 文档。定位失败宁可不同步，绝不猜区间。
   *
   * 【不变量】成功时 model / source / key / from / to **必须一起更新**（source/key/
   * from/to 在 dispatchText 里，model 在这里）。任何一半落单，下一次 eq() 或
   * dispatchText() 的比较基准就错了，DOM 与文档开始各说各话 —— 用户侧表现为
   * 内容滞后、错位。tests/table-sync-invariant.test.mjs 钉死这条不变量。
   */
  sync() {
    const view = this.viewRef
    if (!view || !this.dom || view.composing || this.composing) return
    const table = this.table
    if (!table) return
    const grid = [...table.rows].map((tr) => [...tr.cells].map((td) => td.textContent))
    const model = { header: grid[0], aligns: this.model.aligns, delimRaw: this.model.delimRaw, rows: grid.slice(1) }
    const text = serializeTable(model, view.state.lineBreak)
    if (this.dispatchText(text)) this.model = model
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
    const table = this.table
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!this.stepCell(cell, e.shiftKey ? -1 : 1)) {
        // 正向越界才补行；反向越界（首格 Shift+Tab）什么都不做 ——
        // 曾经在这里无条件 appendRow，导致「想退出去」反而多出一行
        if (!e.shiftKey) this.appendRow(table, 0)
      }
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

  stepCell(cell, delta) {
    const cells = [...this.table.querySelectorAll('th,td')]
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
      td.style.textAlign = aligns[i] ?? 'left'
      tr.appendChild(td)
      tds.push(td)
    }
    table.tBodies[0].appendChild(tr)
    focusEnd(tds[Math.min(Math.max(focusCol, 0), n - 1)])
    this.activeRow = table.rows.length - 2
    this.drag?.refresh?.()
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
