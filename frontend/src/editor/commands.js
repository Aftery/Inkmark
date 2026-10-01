// Markdown 格式化命令（AC-10 toggle 语义 / AC-11 选区包裹保高亮）
// ----------------------------------------------------------------------------
// 消费方：App.vue 的菜单事件（menu:format-*）与 Toolbar.vue 按钮统一走这里。
// 不在 CM keymap 里重复绑定（菜单 accelerator 先于 WebView 消费按键，
// 同键双绑会静默失效 —— 架构 §7）。
//
// 命令签名统一为 CM command：(view) => boolean，可直接 exec，也可传给 keymap。
// 节点名均实测自 @lezer/markdown@1.7.2（node_modules Type 枚举）。

import { syntaxTree } from '@codemirror/language'

const FENCE_RE = /^\s*(```|~~~)/

// ---------- 内部工具 ----------

// 从 head 位置向上找第一个指定类型的祖先节点（含自身）
function enclosing(state, pos, names) {
  let node = syntaxTree(state).resolveInner(pos, -1)
  while (node) {
    if (names.includes(node.name)) return node
    node = node.parent
  }
  return null
}

// 选中行数组（1 起行号闭区间）
function selectedLines(state) {
  const r = state.selection.main
  const from = state.doc.lineAt(r.from).number
  const to = state.doc.lineAt(r.to).number
  const lines = []
  for (let n = from; n <= to; n++) lines.push(state.doc.line(n))
  return lines
}

// 行级 toggle：全部命中 → 剥离；否则 → 全部加标记。返回变更数组。
function lineToggle(view, test, strip, apply) {
  const lines = selectedLines(view.state)
  const all = lines.every((l) => test(l.text))
  const changes = []
  for (const line of lines) {
    const next = all ? strip(line.text) : apply(line.text)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  if (changes.length) view.dispatch({ changes })
  return true
}

const indentOf = (text) => (/^\s*/.exec(text) || [''])[0]

// ---------- 行内格式：加粗 / 斜体 / 删除线 / 行内码 ----------

function toggleInline(view, nodeType, markType, marker) {
  const state = view.state
  const r = state.selection.main
  const node = enclosing(state, r.head, [nodeType])

  // toggle off：选区起点落在该格式节点内 → 摘除全部标记子节点（AC-10 不叠加）
  if (node && node.from <= r.from && r.to <= node.to) {
    const marks = []
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === markType) marks.push(c)
    }
    if (marks.length) {
      const changes = marks.map((m) => ({ from: m.from, to: m.to }))
      // 选区位置按被摘除标记量平移（AC-11：恢复后仍保持高亮）
      const shift = (pos) => {
        let d = 0
        for (const m of marks) { if (m.to <= pos) d += m.to - m.from }
        return pos - d
      }
      view.dispatch({
        changes,
        selection: { anchor: shift(r.from), head: shift(r.to) },
      })
      return true
    }
  }

  // toggle on：包裹选区，标记成对插入；无选区 → 插入空标记光标居中。
  // 左右翼边界（QA P1#1）：选区首尾空白留在标记外侧再插 marker ——
  // `** 文字 **` 在 CommonMark 左右翼（flanking）规则下不渲染为强调，必须 `**文字**`。
  // 全空白选区（trim 后为空）无内容可包 → 保持原行为不动（插空标记）。
  const a = r.from
  const b = r.to
  let lead = 0
  let trail = 0
  if (!r.empty) {
    const text = state.sliceDoc(a, b)
    lead = text.length - text.replace(/^\s+/, '').length
    trail = text.length - text.replace(/\s+$/, '').length
    if (lead + trail >= text.length) { lead = 0; trail = 0 } // 全空白：退回插空标记
  }
  const wa = a + lead   // 内容起点 = marker 左插位
  const wb = b - trail  // 内容终点 = marker 右插位
  view.dispatch({
    changes: [
      { from: wa, insert: marker },
      { from: wb, insert: marker },
    ],
    selection: r.empty
      ? { anchor: a + marker.length }
      : { anchor: wa + marker.length, head: wb + marker.length },
  })
  return true
}

export const toggleBold = (view) => toggleInline(view, 'StrongEmphasis', 'EmphasisMark', '**')
export const toggleItalic = (view) => toggleInline(view, 'Emphasis', 'EmphasisMark', '*')
export const toggleStrike = (view) => toggleInline(view, 'Strikethrough', 'StrikethroughMark', '~~')
export const toggleInlineCode = (view) => toggleInline(view, 'InlineCode', 'CodeMark', '`')

// ---------- 链接 / 图片（⌘K：选区作链接文本，url 占位被选中） ----------

export const toggleLink = (view) => toggleWrapLink(view, false)
export const insertImage = (view) => toggleWrapLink(view, true)

function toggleWrapLink(view, isImage) {
  const state = view.state
  const r = state.selection.main
  const node = enclosing(state, r.head, ['Link', 'Image'])
  const bang = isImage ? '!' : ''

  // toggle off：还原为纯文本（保留链接文字）
  if (node && node.from <= r.from && r.to <= node.to) {
    let label = null
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === 'LinkLabel') label = state.doc.sliceString(c.from, c.to)
    }
    view.dispatch({
      changes: [{ from: node.from, to: node.to, insert: label ?? state.doc.sliceString(node.from, node.to) }],
    })
    return true
  }

  const label = state.doc.sliceString(r.from, r.to)
  // [选区](url) —— url 占位 3 字符，插入后选中它，直接输入即替换
  const insert = `${bang}[${label}](url)`
  const urlStart = r.from + bang.length + label.length + 3 // "!(" 后 "[" + 文本 + "]" "(" 之后
  view.dispatch({
    changes: [{ from: r.from, to: r.to, insert }],
    selection: { anchor: urlStart, head: urlStart + 3 },
  })
  return true
}

// ---------- 标题（0 = 正文，1~6；toggle：同级再触发 = 还原正文） ----------

export function toggleHeading(level) {
  return (view) => {
    const prefix = level > 0 ? '#'.repeat(level) + ' ' : ''
    return lineToggle(
      view,
      (t) => levelOf(t) === level,
      (t) => t.replace(/^\s*#{1,6}\s+/, ''),
      (t) => {
        const stripped = t.replace(/^\s*#{1,6}\s+/, '')
        return indentOf(t) + prefix + stripped.slice(indentOf(t).length)
      },
    )
  }
}

function levelOf(text) {
  const m = /^\s*(#{1,6})\s+/.exec(text)
  return m ? m[1].length : 0
}

// ---------- 引用 ----------

export const toggleBlockquote = (view) =>
  lineToggle(
    view,
    (t) => /^\s*>\s?/.test(t),
    (t) => t.replace(/^(\s*)>\s?/, '$1'),
    (t) => indentOf(t) + '> ' + t.slice(indentOf(t).length),
  )

// ---------- 列表（无序 / 有序 / 任务） ----------

const ANY_LIST_MARK = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/

export const toggleBulletList = (view) =>
  lineToggle(
    view,
    (t) => /^\s*[-*+]\s+(?!\[[ xX]\])/.test(t), // 任务列表不算无序命中（互斥转换）
    (t) => t.replace(/^(\s*)[-*+]\s+/, '$1'),
    (t) => {
      const stripped = t.replace(ANY_LIST_MARK, '')
      const i = indentOf(stripped)
      return i + '- ' + stripped.slice(i.length)
    },
  )

export const toggleOrderedList = (view) => {
  let n = 0 // 有序序号按选中行顺序重排（CommonMark 实际序号）
  return lineToggle(
    view,
    (t) => /^\s*\d+\.\s+/.test(t),
    (t) => t.replace(/^(\s*)\d+\.\s+/, '$1'),
    (t) => {
      const stripped = t.replace(ANY_LIST_MARK, '')
      const i = indentOf(stripped)
      return i + `${++n}. ` + stripped.slice(i.length)
    },
  )
}

export const toggleTaskList = (view) =>
  lineToggle(
    view,
    (t) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(t),
    (t) => t.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1'),
    (t) => {
      const stripped = t.replace(ANY_LIST_MARK, '')
      const i = indentOf(stripped)
      return i + '- [ ] ' + stripped.slice(i.length)
    },
  )

// ---------- 围栏代码块 ----------

export const toggleCodeBlock = (view) => {
  const state = view.state
  const r = state.selection.main
  const node = enclosing(state, r.head, ['FencedCode'])

  if (node) {
    // toggle off：删除首尾围栏行（保留代码内容）。相邻空代码块合并为单变更防重叠。
    const open = state.doc.lineAt(node.from)
    const close = state.doc.lineAt(node.to)
    const changes = []
    const openIsFence = FENCE_RE.test(open.text)
    const closeIsFence = close.number > open.number && FENCE_RE.test(close.text)
    if (openIsFence && closeIsFence && close.number === open.number + 1) {
      changes.push({ from: open.from, to: close.to })
    } else {
      if (openIsFence) changes.push({ from: open.from, to: open.to + 1 })
      if (closeIsFence) changes.push({ from: close.from - 1, to: close.to }) // 连同前一换行一起删
    }
    if (changes.length) view.dispatch({ changes })
    return true
  }

  const fromLine = state.doc.lineAt(r.from)
  const toLine = state.doc.lineAt(r.to)
  view.dispatch({
    changes: [
      { from: fromLine.from, insert: '```\n' },
      { from: toLine.to, insert: '\n```' },
    ],
    selection: r.empty ? { anchor: fromLine.from + 4 } : undefined,
  })
  return true
}

// ---------- 插入类：表格 / 分隔线 ----------

export const insertTable = (view) => {
  const r = view.state.selection.main
  const tpl = '\n| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n|  |  |  |\n'
  view.dispatch({ changes: [{ from: r.from, to: r.to, insert: tpl }] })
  return true
}

export const insertHr = (view) => {
  const r = view.state.selection.main
  view.dispatch({ changes: [{ from: r.from, insert: '\n---\n' }] })
  return true
}

// ---------- 当前选区的格式状态（工具条选中态数据源） ----------

export function activeFormats(state) {
  const head = state.selection.main.head
  const formats = { heading: 0 }
  let node = syntaxTree(state).resolveInner(head, -1)
  for (let n = node; n; n = n.parent) {
    const m = /^ATXHeading([1-6])$/.exec(n.name)
    if (m) formats.heading = Number(m[1])
    else if (n.name === 'StrongEmphasis') formats.bold = true
    else if (n.name === 'Emphasis') formats.italic = true
    else if (n.name === 'Strikethrough') formats.strike = true
    else if (n.name === 'InlineCode') formats.code = true
    else if (n.name === 'Link') formats.link = true
    else if (n.name === 'FencedCode') formats.codeblock = true
  }
  const text = state.doc.lineAt(head).text
  if (/^\s*>\s?/.test(text)) formats.quote = true
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(text)) formats.task = true
  else if (/^\s*[-*+]\s+/.test(text)) formats.ul = true
  if (/^\s*\d+\.\s+/.test(text)) formats.ol = true
  return formats
}
