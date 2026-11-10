// editor/inlineExtras.js — 行内渲染件：HTML 标签、行内公式、emoji、脚注。
//
// 标签清单以 markdown/html.js 的 EDITOR_TAG_CLASS 为准，公式统一走 renderMath。
// widget 的 eq() 要比较构造期的全部字段，否则 CodeMirror 会复用旧 DOM。

import { Decoration, WidgetType } from '@codemirror/view'
import { EDITOR_BLOCK_TAGS, EDITOR_TAG_CLASS } from '../markdown/html.js'
import { renderMath } from '../markdown/math.js'

// 只查直接子节点，不递归。SyntaxNode 没有 state/doc，文本要用传入的 doc。
export function findChild(node, name) {
  const n = node.node
  if (!n) return null
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === name) return c
  }
  return null
}

// ---------------------------------------------------------------------------
// 活跃行集合与引用块嵌套深度
// ---------------------------------------------------------------------------

// 与选区相交的行，上下各扩 1 行，避免光标跨行时装饰频繁切换。

export function activeLineSet(doc, selection) {
  const active = new Set()
  for (const r of selection.ranges) {
    const from = Math.max(1, doc.lineAt(r.from).number - 1)
    const to = Math.min(doc.lines, doc.lineAt(r.to).number + 1)
    for (let n = from; n <= to; n++) active.add(n)
  }
  return active
}

/** Blockquote 的嵌套深度（含自身）。沿祖先链数，1 级 = 最外层 */
export function blockquoteDepth(node) {
  let depth = 0
  for (let n = node.node; n; n = n.parent) if (n.name === 'Blockquote') depth++
  return depth
}

/**
 * 记下某个 Blockquote 覆盖到的每一行的深度（取最大值）。
 *
 * 【为什么先收集再统一发类】外层 Blockquote 的区间包含内层所有行，若按
 * 「每层各发一个行类」实现，同一行会同时挂上 d1/d2/d3 三个类 —— 三者特异性
 * 相同，样式表里最后一个胜出，于是三层引用看起来一模一样（用户截图里的现象）。
 */
export function noteQuoteDepth(out, doc, node, visFrom, visTo) {
  const depth = blockquoteDepth(node)
  const from = Math.max(node.from, visFrom)
  const to = Math.min(node.to, visTo)
  if (from >= to) return
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos)
    if (depth > (out.get(line.number) ?? 0)) out.set(line.number, depth)
    pos = line.to + 1
  }
}

/**
 * 深度 → 行类名。
 *
 * 【为什么必须「按行取最深、只发一个类」】行级装饰只能给同一行加类名，而
 * `.cm-line` 的 border-left 只有一条 —— 三层 Blockquote 嵌套时，外层节点会
 * 给内层所有行也带上类，若按「每层各加一个类」实现，同一行会同时出现
 * d1/d2/d3 三个类。三者特异性相同（都是 (0,2,0)），最终只剩样式表里的
 * **最后一个**生效 —— 视觉上就是「三层一模一样」，正是用户反馈的现象。
 * 故调用方按「行首 → 最大深度」去重，这里只把深度映射成**一个**类名。
 */
export function quoteClass(depth) {
  if (depth >= 3) return 'cm-md-quote cm-md-quote-3'
  if (depth === 2) return 'cm-md-quote cm-md-quote-2'
  return 'cm-md-quote'
}

// ---------------------------------------------------------------------------
// 链接：文字区间 / 脚注前缀
// ---------------------------------------------------------------------------

/**
 * `[文字](url)` / `[文字][ref]` 的**文字区间**：头两个 LinkMark 之间。
 *
 * 不用正则在原文上抠：链接文字里允许嵌套括号与转义，只有解析器给出的区间
 * 是权威的。空文字（`[](url)`）返回 null —— 空 mark 会让 CM 抛 RangeError。
 */
export function linkTextRange(node) {
  const n = node.node
  if (!n) return null
  const marks = []
  for (let c = n.firstChild; c && marks.length < 2; c = c.nextSibling) {
    if (c.name === 'LinkMark') marks.push(c)
  }
  if (marks.length < 2 || marks[0].to >= marks[1].from) return null
  return { from: marks[0].to, to: marks[1].from }
}

// 脚注引用 [^1] 的编号；不是脚注返回 null。
// lezer 把脚注引用解析成普通 Link，靠 ^ 前缀和「无 URL/LinkLabel」区分。

export function footnoteLabel(node, doc) {
  const n = node.node
  if (!n) return null
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === 'URL' || c.name === 'LinkLabel') return null
  }
  const marks = []
  for (let c = n.firstChild; c && marks.length < 2; c = c.nextSibling) {
    if (c.name === 'LinkMark') marks.push(c)
  }
  if (marks.length < 2) return null
  const inner = doc.sliceString(marks[0].to, marks[1].from)
  return isFootnoteLabel(inner) ? inner.slice(1) : null
}

// 判断 Link 文本是不是单个脚注标签。必须排除含 [] 的文本：
// lezer 会把同一行的多个脚注合并成一个 Link，只看 ^ 会连中间正文一起吞掉。
export function isFootnoteLabel(inner) {
  return typeof inner === 'string' && inner.startsWith('^') && inner.length > 1
    && !/[\[\]]/.test(inner.slice(1))
}

// 扫描一行里的脚注引用。语法树会把多个引用合并，按文本扫更可靠。
// 跳过 ![^x]（图片 alt）和定义行（由整行装饰覆盖）。
export function scanFootnoteRefs(text, offset = 0) {
  const out = []
  const re = /\[\^([^\[\]\s]+)\]/g
  let m
  while ((m = re.exec(text))) {
    if (m.index > 0 && text[m.index - 1] === '!') continue
    out.push({ from: offset + m.index, to: offset + m.index + m[0].length, label: m[1] })
  }
  return out
}

// ---------------------------------------------------------------------------
// 脚注定义行（含续行）
// ---------------------------------------------------------------------------

/** 一行是不是脚注定义的首行（行首 0~3 空格 + `[^label]:`，且后面没有别的正文形状） */
export function isFootnoteDefStart(text) {
  return /^\s{0,3}\[\^[^\]\s]+\]:/.test(text)
}

// `[^label]: 内容` → { label, rest }；不是脚注定义返回 null。
// 前缀口径与 isFootnoteDefStart 保持一致。
export function parseFootnoteDefText(text) {
  const m = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(text)
  return m ? { label: m[1], rest: m[2] } : null
}

/**
 * 脚注定义块的行范围：定义行加后续缩进续行，遇到空行、非缩进行或下一条定义停止。
 */
export function footnoteDefRange(doc, lineNumber) {
  const line = doc.line(lineNumber)
  if (!isFootnoteDefStart(line.text)) return null
  let last = line
  for (let n = lineNumber + 1; n <= doc.lines; n++) {
    const next = doc.line(n)
    if (!next.text.trim()) break
    if (!/^\s+\S/.test(next.text)) break
    if (/^\s{0,3}\[\^[^\]\s]+\]:/.test(next.text)) break
    last = next
  }
  return { from: line.from, to: last.to }
}

/**
 * 收集范围内所有脚注定义块的行号。
 * 按行扫描而不是跟 LinkReference：lezer 只把首行算进节点，续行会漏掉。
 */
export function footnoteDefLines(doc, fromLine, toLine, isExcluded) {
  const out = new Set()
  for (let n = Math.max(1, fromLine); n <= Math.min(doc.lines, toLine); n++) {
    const line = doc.line(n)
    if (isExcluded && isExcluded(line)) continue
    if (!isFootnoteDefStart(line.text)) continue
    const def = footnoteDefRange(doc, n)
    const last = def ? doc.lineAt(def.to).number : n
    for (let m = n; m <= last; m++) out.add(m)
  }
  return out
}

// ---------------------------------------------------------------------------
// HTML 内联标签：解析 / 配对 / 颜色
// ---------------------------------------------------------------------------

/**
 * 拆一个 HTMLTag 节点的原始文本。
 * 返回 null 表示形状不认识（调用方一律「保持源码可见」，绝不猜）。
 */
export function parseHtmlTag(raw) {
  const m = /^<\s*(\/?)\s*([a-zA-Z][\w:-]*)([\s\S]*?)\/?>$/.exec(raw)
  if (!m) return null
  return {
    closing: m[1] === '/',
    name: m[2].toLowerCase(),
    attrs: m[3],
    selfClosing: /\/\s*>$/.test(raw),
  }
}

/**
 * 标签名 → WYSIWYG 语义类名；不在白名单里返回 null。
 *
 * `EDITOR_BLOCK_TAGS`（details/summary/p/div…）一律返回 null：折叠块由块级
 * widget 整块渲染（blockRanges.js 登记区间），行内层再插手会与它抢同一片文本。
 */
export function tagClass(name) {
  if (!name || EDITOR_BLOCK_TAGS.has(name)) return null
  // hasOwnProperty：标签名是外部输入，`<constructor>` 这类会命中原型链
  return Object.prototype.hasOwnProperty.call(EDITOR_TAG_CLASS, name)
    ? EDITOR_TAG_CLASS[name]
    : null
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const NAMED_COLOR = /^[a-zA-Z]{3,20}$/

/**
 * 从属性串里取出 `style` 的 color 值；取不到或不合法返回 null。
 *
 * 【只认十六进制 / 命名色 —— 这是安全边界，不是保守】装饰的 attributes 会
 * 直接变成行内 style，任意值等于开了一条 CSS 注入通道：`position:fixed;
 * z-index:9999; inset:0` 能把整个界面盖住，而文档可以是任何人给的 .md
 * （桌面应用里打开别人文档是常规操作）。故只放行「颜色」这一个属性、
 * 且值必须落在两个颜色形状里。
 */
export function htmlColor(attrs) {
  const m = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs || '')
  const style = m ? (m[2] ?? m[3] ?? '') : ''
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0 || decl.slice(0, i).trim().toLowerCase() !== 'color') continue
    const v = decl.slice(i + 1).trim()
    if (HEX_COLOR.test(v) || NAMED_COLOR.test(v)) return v
  }
  return null
}

// 读取属性串里的单个属性值，支持双引号、单引号和无引号写法。
// attrs 来自 parseHtmlTag，已去掉标签尖括号。
export function attrValue(attrs, name) {
  const re = new RegExp(
    '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>"\']+))', 'i'
  )
  const m = re.exec(attrs ?? '')
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? null
}

// `<img src alt>` → { src, alt }；没有 src 时返回 null，保留源码。
// 尺寸由 ImageWidget 从 attrs 读取，见 imageWidget.sizeOf。
export function htmlImgSrc(attrs) {
  const src = attrValue(attrs, 'src')
  return src ? { src, alt: attrValue(attrs, 'alt') ?? '' } : null
}

/**
 * 找开标签对应的闭标签（同一父节点下的兄弟里，按同名标签计数配对）。
 * 返回闭标签节点或 null（用户正写到一半：不配对时保持源码，不吞内容）。
 */
export function matchCloseTag(node, name, doc) {
  const n = node.node
  const parent = n && n.parent
  if (!parent) return null
  let depth = 1
  for (let s = n.nextSibling; s; s = s.nextSibling) {
    if (s.name !== 'HTMLTag') continue
    const tag = parseHtmlTag(doc.sliceString(s.from, s.to))
    if (!tag || tag.name !== name) continue
    if (tag.closing) depth--
    else if (!tag.selfClosing) depth++
    if (depth === 0) return { from: s.from, to: s.to }
  }
  return null
}

// ---------------------------------------------------------------------------
// 装饰区间写入件（wysiwyg.js 的装饰集累积口）
// ---------------------------------------------------------------------------

/**
 * 给某节点的每一行加行级类。
 *
 * 注意 range 必须是**点区间**（from == to == line.from）——line 装饰的语义是
 * 「给该行加样式」，CM6 只读 from。若写成 `{from: line.from, to: line.to}` 的非点区间，
 * tile 构建会把行装饰当作跨整行区间处理，根节点 length 与子节点总长失配，
 * 首次 measure 就在 TilePointer.advance 抛
 * 「Cannot destructure property 'tile' of 'parents.pop(...)'」。
 */
export function pushLineClass(out, doc, node, cls, visFrom, visTo, seen) {
  const from = Math.max(node.from, visFrom)
  const to = Math.min(node.to, visTo)
  if (from >= to) return
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos)
    pushLine(out, line.from, cls, seen)
    pos = line.to + 1
  }
}

/**
 * 往装饰集里加一条行级类，按「位置 + 类名」去重。
 *
 * 【为什么必须去重】visibleRanges 允许重叠（CM 分片视口常共享边界行）：
 * 同一条规则会在相邻两片各跑一次，同一位置产生两条一摸一样的行装饰。
 * RangeSet 能装下它们（不会抛错），但 tile 缓存里会多出一份重复条目，
 * 滚动时每次重建都白白增长。用 (from, cls) 作键即可 —— 同一行上不同
 * 类名（如引用底色 + 代码块底色）仍会各自保留。
 */
function pushLine(out, at, cls, seen) {
  const key = at + '|' + cls
  if (seen) {
    if (seen.has(key)) return
    seen.add(key)
  }
  out.push({ from: at, to: at, value: Decoration.line({ class: cls }) })
}

/**
 * 把收集好的「行号 → 引用深度」铺成行类，然后清空。
 * 每行只发**一个**深度类：三个深度类特异性相同，同挂一行时只有样式表里最后
 * 一个生效 —— 那正是「三级引用一模一样」的成因（见 quoteClass 的注释）。
 */
export function flushQuoteLines(out, doc, depthMap, seen) {
  for (const [num, depth] of depthMap) pushLine(out, doc.line(num).from, quoteClass(depth), seen)
  depthMap.clear()
}

/**
 * 行内 mark。class 来自 html.js 的清单；color 只可能是 htmlColor 放行的颜色值
 * （它是唯一允许进 DOM 的 style 属性，边界原因见 htmlColor）。
 */
export function pushMark(out, from, to, cls, color) {
  if (from >= to) return
  const attributes = color ? { style: `color: ${color}` } : undefined
  out.push({ from, to, value: Decoration.mark({ class: cls || undefined, attributes }) })
}

// ---------------------------------------------------------------------------
// 行内公式：`$E = mc^2$`
// ---------------------------------------------------------------------------

/**
 * 扫描一行里的行内公式，返回 `[{from, to, tex}]`（from/to 是绝对偏移）。
 *
 * 【为什么这里必须自己扫】lezer 不认 TeX —— 语法树里**没有任何节点**可挂，
 * 所以「按节点名判定」这条路对公式不成立，只能按行扫文本。但边界规则必须
 * 与 markdown/math.js 的行内规则**逐条对齐**（那边是预览/导出的唯一口径），
 * 否则会出现「编辑器里是公式、预览里是一对美元符」这种最难归因的分叉：
 *   - `$$` 交给块级，不当行内；
 *   - 定界符内侧不许有空白（`价格 $ 5 $ 元` 保持纯文本）；
 *   - 闭合 `$` 后紧跟数字不算闭合（`$5` / `$10` 的价格写法不吞行）；
 *   - `\$` 是转义，不参与配对。
 */
export function scanInlineMath(text, offset = 0) {
  const out = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] !== '$') { i++; continue }
    if (text[i + 1] === '$') { i += 2; continue }
    let j = i + 1
    let end = -1
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue }
      if (text[j] === '$') { end = j; break }
      j++
    }
    if (end < 0) break
    const tex = text.slice(i + 1, end)
    const badEdge = /^\s|\s$/.test(tex) || tex.trim() === ''
    if (badEdge || /\d/.test(text[end + 1] ?? '')) { i = end + 1; continue }
    out.push({ from: offset + i, to: offset + end + 1, tex })
    i = end + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// 行内 widget
// ---------------------------------------------------------------------------

/**
 * 行内公式 widget。html 在**构造期**就渲染好并进 eq —— 与图片同一课：
 * 若只比 tex，KaTeX 选项/字体口径变化时 CM 判「没变」会一直复用旧 DOM。
 */
export class MathWidget extends WidgetType {
  constructor(tex) {
    super()
    this.tex = tex
    this.html = renderMath(tex, { display: false })
  }
  eq(other) { return other.tex === this.tex && other.html === this.html }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-math'
    s.innerHTML = this.html
    return s
  }
  // 【必须是 false，不能是 true】ignoreEvent 为 true 表示「编辑器忽略发生在
  // widget 内部的事件」——点击公式将**什么都不发生**，光标也不会跳过来，
  // 用户会以为界面卡住了。这是行内文本件（与 HrWidget 那种纯画线不同）：
  // 必须让 CM 接管点击，按 atomicRanges 把光标落到公式两侧。
  ignoreEvent() { return false }
}

/** emoji 短码 widget：`:smile:` → 表情字符。字符由 markdown/emoji.js 决定 */
export class EmojiWidget extends WidgetType {
  constructor(char) {
    super()
    this.char = char
  }
  eq(other) { return other.char === this.char }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-emoji'
    s.textContent = this.char
    return s
  }
  ignoreEvent() { return false }
}

/** 脚注引用 widget：`[^1]` 的方括号语法换成上标编号 */
export class FootnoteRefWidget extends WidgetType {
  constructor(label) {
    super()
    this.label = label
  }
  eq(other) { return other.label === this.label }
  toDOM() {
    const s = document.createElement('sup')
    s.className = 'cm-md-footnote-ref'
    s.textContent = this.label
    return s
  }
  // 同为行内文本件：点击脚注编号要让光标落到它边上（理由见 MathWidget 处）
  ignoreEvent() { return false }
}

