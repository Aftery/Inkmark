// tableRender.js — GFM 表格真渲染 + 单元格直接编辑（Typora 式 WYSIWYG）
// ----------------------------------------------------------------------------
// 【为什么是 StateField 而不是 ViewPlugin】@codemirror/view 只禁止**插件**提供
// block 装饰（dist/index.js:2774 "Block decorations may not be specified via
// plugins"）；StateField 经 EditorView.decorations facet 提供 block 装饰是合法
// 路径。真表格必须跨行整体替换，只有这条路走得通 —— 这是对 phaseC 架构 §3.1
// 「绝无 block 装饰」的正式修订：Bear 式管道隐藏已按 2026-10-14 产品决策退役
// （用户拍板「单元格直接编辑」，阅读态方案一并否决）。
//
// 交互模型：
//   - 光标不在表格内（严格界内判定，边界算在外）→ 整体渲染成可编辑 <table>
//   - 光标在表格内（正在输入 / 选区跨表 / 跳转落点）→ 显示 Markdown 源码。
//     新建表格的自然路径：打完最后一行按回车，光标离开，立即渲染
//   - 点击渲染态单元格直接打字；输入经 serializeTable 同步回文档，
//     selfSync annotation 防回环；IME 合成期间冻结同步（AC-04，同 wysiwyg.js）
//   - 单元格内容按【纯文本】处理：`**粗体**` 等行内标记原样显示、原样回写，
//     零数据丢失；富文本单元格留待后续阶段
//   - 表格语法不合法（解析失败）→ 不渲染，交给 tableHint 的底部提示
//   - 引用块 / 列表项内的表格不渲染（block 装饰要求整行替换，行首的 `> ` /
//     缩进前缀无法覆盖），保持源码
//
// 性能注记：StateField 不知道视口，docChanged 时全文档扫描 Table 节点 ——
// 偏离 AC-05「只扫 visibleRanges」。lezer 增量树上 iterate 是毫秒级，写作
// 场景可接受；大文档出现卡顿再做按块缓存。仅选区变化时不重扫（复用上次表
// 清单只重算可见性，widget 经 eq 命中，零 DOM 重建）。

import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { Annotation, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { redo, undo } from '@codemirror/commands'

// 自家同步事务的标记：field 见到它就保留 activeWidget（编辑中），否则视为
// 外部改动（撤销 / 文件监听 / 命令插入）→ 强制重渲染，避免单元格 DOM 与文档脱节。
const selfSync = Annotation.define()

// ---------------- 解析 / 序列化（导出供测试） ----------------

/** 把一行按未转义的 `|` 切成单元格；`\|` 还原为字面竖线，首尾管道可省略 */
export function splitCells(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++ } else if (c === '|') { out.push(cur.trim()); cur = '' } else cur += c
  }
  out.push(cur.trim())
  return out
}

/**
 * 解析表格源码 → { header, aligns, delimRaw, rows }；不合法返回 null。
 * delimRaw 原样保留分隔行（:---: 的写法不在回写时被改写）。
 */
export function parseTable(text) {
  const lines = text.split('\n')
  if (lines.length < 2) return null
  const delim = splitCells(lines[1])
  if (!delim.length || !delim.every((c) => /^:?-+:?$/.test(c))) return null
  const aligns = delim.map((c) =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
  )
  return {
    header: splitCells(lines[0]),
    aligns,
    delimRaw: lines[1],
    rows: lines.slice(2).map(splitCells),
  }
}

const escCell = (s) => s.replace(/\|/g, '\\|')

/** 模型 → 源码。行内标记原样透传；单元格内的 `|` 转义，杜绝列错位 */
export function serializeTable(m) {
  const n = m.header.length
  const row = (cells) =>
    '| ' + Array.from({ length: n }, (_, i) => escCell(cells[i] ?? '')).join(' | ') + ' |'
  return [row(m.header), m.delimRaw, ...m.rows.map(row)].join('\n')
}

// ---------------- 语法树扫描 ----------------

function scanTables(state) {
  const { doc } = state
  // syntaxTree 在 state 初建 / 事务中可能是**部分解析树**（只到视口附近），
  // 表格靠后就会漏扫。ensureSyntaxTree 强制同步补齐（已有增量树时近乎免费）；
  // 预算内仍没补齐（大文档 / 嵌套代码语言还在异步加载）时记 partial=true，
  // 由 tableScanKick 在树真正可用后补一次重扫。
  let tree = ensureSyntaxTree(state, doc.length, 100)
  const partial = !tree || !syntaxTreeAvailable(state, doc.length)
  if (!tree) tree = syntaxTree(state)
  const tables = []
  tree.iterate({
    from: 0,
    to: doc.length,
    enter: (node) => {
      if (node.name !== 'Table') return
      const text = doc.sliceString(node.from, node.to)
      const model = parseTable(text)
      // 必须独占整行（行首即表格起点、行尾即表格终点），否则 block 替换会切碎引用/列表前缀
      if (model && doc.lineAt(node.from).from === node.from && doc.lineAt(node.to).to === node.to) {
        tables.push({ from: node.from, to: node.to, model, source: text })
      }
      return false // Table 子树内部无需再扫
    },
  })
  return { tables, partial }
}

/** 选区与表格严格相交才显示源码（边界位置算在外，Esc 退出后保持渲染态） */
function selectionInside(state, t) {
  return state.selection.ranges.some((r) => r.to > t.from && r.from < t.to)
}

function decoOf(state, tables) {
  const b = new RangeSetBuilder()
  for (const t of tables) {
    if (selectionInside(state, t)) continue
    b.add(t.from, t.to, Decoration.replace({ widget: new TableWidget(t), block: true }))
  }
  return b.finish()
}

// ---------------- 可编辑表格 widget ----------------

// 正在被编辑（单元格持有焦点）的 widget 实例。编辑期间文档不断被自家同步
// 改写，装饰随之重建 —— eq 靠它识别「还是我」，让 CM 复用同一份 DOM，
// 焦点与 IME 不被打断。
let activeWidget = null

function focusEnd(el) {
  el.focus()
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(false)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(r)
}

class TableWidget extends WidgetType {
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
    this.ac = new AbortController()
  }

  eq(other) {
    if (activeWidget && activeWidget.dom?.isConnected && (activeWidget === this || activeWidget === other)) return true
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
    wrap.addEventListener('focusin', () => { activeWidget = this }, opt)
    wrap.addEventListener('focusout', (e) => {
      if (e.relatedTarget && wrap.contains(e.relatedTarget)) return // 单元格间移动
      if (activeWidget === this) activeWidget = null
      this.sync() // 离场前把最后一次未同步的输入落盘
    }, opt)

    this.dom = wrap
    return wrap
  }

  destroy() {
    this.ac.abort()
    if (activeWidget === this) activeWidget = null
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

/** 区间失效时（表前内容被外部改动）沿语法树重新定位所在 Table */
function locateTable(state, pos) {
  const p = Math.max(0, Math.min(pos, state.doc.length))
  for (const bias of [1, -1]) {
    let node = syntaxTree(state).resolveInner(p, bias)
    while (node) {
      if (node.name === 'Table') return { from: node.from, to: node.to }
      node = node.parent
    }
  }
  return null
}

// ---------------- StateField：block 装饰唯一来源 ----------------

/** 触发全量重扫的事务效果（树补齐后由 tableScanKick 发出） */
export const rescanTables = StateEffect.define()

export const tableRenderField = StateField.define({
  create: (state) => {
    const { tables, partial } = scanTables(state)
    return { tables, deco: decoOf(state, tables), partial }
  },
  update(value, tr) {
    // 外部改动（撤销 / 文件监听 / 命令插入）打断单元格编辑：清标记强制重渲染
    if (tr.docChanged && !tr.annotation(selfSync)) activeWidget = null
    const force = tr.effects.some((e) => e.is(rescanTables))
    // partial：上次扫描时语法树没补齐（结果不可信），任何一笔事务都要重扫
    if (force || tr.docChanged || value.partial) {
      const { tables, partial } = scanTables(tr.state)
      return { tables, deco: decoOf(tr.state, tables), partial }
    }
    if (!tr.selection) return value
    // 仅选区变化：复用表清单只重算可见性（widget 经 eq 命中，零 DOM 重建）
    return { tables: value.tables, deco: decoOf(tr.state, value.tables), partial: value.partial }
  },
  // from(field, get)：field 值是 {tables, deco} 而非裸 DecorationSet，
  // 必须传取值函数 —— 默认恒等会把整个对象塞进 decorations facet，
  // view 构建时在 RangeSet.spans 里崩（HeapCursor.from 读 undefined.isEmpty）。
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

// ---------------- 初始扫描兜底 ----------------
// StateField.create 跑在语法树补齐之前（嵌套代码语言还在异步加载时
// ensureSyntaxTree 预算内补不全），而树在后台 idle 解析完成时**没有任何
// 事务**会通知 field。这个插件在树真正可用后发一笔 rescanTables 兜底，
// 只在「树没就绪」时进入轮询，树就绪即发一笔并停止 —— 常态零开销。
export function tableScanKick() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.poll(view)
      }
      poll(view) {
        // 统一经 setTimeout：插件构造发生在 view 的 update 周期内，
        // 同步 dispatch 会嵌套事务
        if (syntaxTreeAvailable(view.state, view.state.doc.length)) {
          this.timer = setTimeout(() => {
            if (view.dom?.isConnected) view.dispatch({ effects: rescanTables.of(null) })
          }, 0)
          return
        }
        this.timer = setTimeout(() => this.poll(view), 60)
      }
      destroy() {
        clearTimeout(this.timer)
      }
    },
  )
}
