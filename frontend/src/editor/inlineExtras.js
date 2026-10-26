// editor/inlineExtras.js — 行内渲染件：HTML 标签 / 行内公式 / emoji / 脚注
// ----------------------------------------------------------------------------
// 【为什么单独成文件】wysiwyg.js 已顶到契约 5 的 300 有效代码行红线。这四类
// 渲染件的共同点是：它们都**不是 Markdown 语义**，而是「Markdown 之上的补充
// 语法」—— lezer 要么只给出一个裸节点（HTMLTag / Emoji），要么根本不给节点
// （TeX 公式）。判定与 DOM 组装都在本文件，wysiwyg.js 只负责「在哪儿用」。
//
// 【三条硬口径，改这个文件前先看】
// 1) 标签清单只从 markdown/html.js 的 EDITOR_TAG_CLASS 取 —— 那是唯一真源。
//    另抄一份的后果是「编辑器认某个标签、预览/导出不认」，同一份文档两副面孔。
// 2) 公式必须经 markdown/math.js 的 renderMath（唯一口径，KaTeX 选项只在那里）。
//    本文件不 import katex：一旦两处各写一份选项，`trust`/`maxExpand` 这类
//    安全参数迟早分叉，且**都不抛异常**，只有肉眼看得出。
// 3) 所有 widget 的 eq() 必须把「构造期算出来的全部字段」纳入比较。本仓
//    2026-10-23 的图片定格缺陷就是 eq 漏字段：CM 判「没变」⇒ 复用旧 DOM ⇒
//    错误状态永久定格，而且全程不报错。

import { Decoration, WidgetType } from '@codemirror/view'
import { EDITOR_BLOCK_TAGS, EDITOR_TAG_CLASS } from '../markdown/html.js'
import { renderMath } from '../markdown/math.js'

/**
 * 在**直接**子节点里找第一个指定名字的节点。
 * 不递归：lezer 的嵌套语义靠父节点判定（URL 只可能是 Link/Image/Autolink 的
 * 直接子节点），递归会拿到更深层的同名节点、把判定口径搞糊。
 *
 * 【坑，勿改】SyntaxNode 上**没有** .state / .doc（只有 from/to/name/node 等）。
 * 取文本必须用调用方传进来的 doc —— 曾写成 node.state.doc 直接把插件打崩。
 */
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

/**
 * 与任一选区相交的行号集合，上下各扩 1 行。
 *
 * 【为什么要扩 1 行（真机反馈）】只含选区行时，光标移到相邻行的瞬间，该行的
 * 标记从「隐藏 + 原子」突变为可见，atomicRanges 动态变化导致方向键跳跃感明显。
 * 扩展后相邻行标记已处于可见态（非原子），跨行移动平滑。
 */
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

/**
 * 脚注引用 `[^1]` 的编号；不是脚注返回 null。
 *
 * 【lezer 把脚注引用解析成普通 Link —— 必须按 `^` 前缀区分】它没有 URL、
 * 也没有 LinkLabel，只有两个 LinkMark 夹着文本 `^1`。若不加这个判据，
 * 脚注会被当成普通链接处理：`^1` 变成链接文字（上不了上标），而普通引用式
 * 链接 `[文字][ref]` 又有 LinkLabel，两者靠「有无 URL/LinkLabel」也能分，
 * 但那太脆（lezer 版本变化时分不出来）。`^` 前缀是 Markdown 规范里脚注的
 * 定义性特征，最稳。
 */
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

/**
 * Link 的内部文本是不是**单个**脚注标签（`^1` / `^note`）。
 *
 * 【两条判据缺一不可 —— 2026-10-25 真机截图暴露的缺陷】
 * ① 以 `^` 开头（脚注的定义性特征，见 footnoteLabel 头注）；
 * ② **不含 `[` / `]`**。
 * 为什么 ② 是必须的：lezer 会**把同一行的多个脚注引用合并成一个 Link**。
 * 实测 `文字[^1]，还可以有命名脚注[^note]。` 产出的 Link 是
 *   Link(10..30) 内部文本 = `^1]，还可以有命名脚注[^note`
 * 若只看 ①，这个 20 字符的整段会被当成一个脚注 widget 换掉 —— 界面表现为
 * 「第二个脚注连同中间的正文一起消失，只剩一个上标 1」，而**不报任何错**。
 * 故含括号一律判「不是单个脚注」，由行级扫描（scanFootnoteRefs）逐个处理。
 */
export function isFootnoteLabel(inner) {
  return typeof inner === 'string' && inner.startsWith('^') && inner.length > 1
    && !/[\[\]]/.test(inner.slice(1))
}

/**
 * 扫描一行里的脚注引用，返回 `[{from, to, label}]`（绝对偏移）。
 *
 * 【为什么脚注不能只靠语法树】如 isFootnoteLabel 头注所述：同一行多个脚注会被
 * lezer 合并成一个 Link 节点，按节点处理必然要么吞掉中间正文、要么漏掉后续脚注。
 * 脚注引用本身是**词法层面**很规整的 `[^label]`，按行扫文本反而更准 —— 与行内
 * 公式（scanInlineMath）同一取舍，两处都只处理「非活跃行」。
 *
 * 边界：
 *  - 标签里不许出现空白或括号（`[^a b]` 不是标准脚注写法，保持源码）；
 *  - 前面紧邻 `!`（`![^x]`）不算：那是图片的 alt，交给图片 widget；
 *  - 定义行 `[^1]: 内容` 也会命中 —— 无害，整行的隐藏装饰区间更长，去重时
 *    会盖掉它（见 wysiwyg.js 的 replaces 去重）。
 */
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

/**
 * 拆一条脚注定义首行 → { label, rest }；不是定义行返回 null。
 *
 * 【为什么要有它】2026-10-26 真机反馈「脚注在编辑器里整段消失」：定义行此前被
 * 整行隐藏、正文 nowhere 可读 —— 预览/导出侧内容渲染成 `<section class="footnotes">`，
 * 编辑器侧却一个字都看不到。修法是首行不再隐藏，而是换成下方的 FootnoteDefWidget
 * （编号上标 + 内容小字）；本函数就是 widget 渲染时唯一的取材口，与
 * isFootnoteDefStart 逐一同步（前缀口径一字不差）。
 */
export function parseFootnoteDefText(text) {
  const m = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(text)
  return m ? { label: m[1], rest: m[2] } : null
}

/**
 * 脚注定义 `[^label]: 内容` 的**全部行**区间（含缩进续行）。
 *
 * 【为什么必须自己扫，而不用 LinkReference 节点】lezer 只把**首行**算进
 * LinkReference，续行会被当成普通段落甚至 CodeBlock：
 *   `[^note]: 命名脚注可以写多行，`
 *   `    续行需要缩进。`          ← 实测是 CodeBlock（缩进 4 空格即代码块）
 * 于是编辑器里只隐藏了首行、续行原样留在正文中 —— 用户看到「一条脚注内容
 * 一半消失了、另一半变成代码块」，而预览/导出里它是完整的一条脚注
 * （markdown-it-footnote 认缩进续行）。这类「同一份文档两副面孔」是本轮
 * 反复在修的主线，故定义行也改成按行扫。
 *
 * 【续行判定与预览侧对齐】markdown-it-footnote 把「紧跟定义行、且缩进 ≥1 个
 * 空格」的后续行都算进脚注（实测 2 空格与 4 空格都认，空行终止）。这里用
 * 同一口径：从定义行往下，遇到空行 / 非缩进行 / 另一条定义行就停。
 *
 * 【只在整行独占定义时登记】行首允许 0~3 空格（CommonMark 的缩进上限），
 * 且 `[^label]:` 之后必须没有别的正文 —— 否则 `说明[^1]: x` 这种行内写法
 * 会被误当成定义行整行隐藏。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {number} lineNumber 起始行号（1-based）
 * @returns {{from:number,to:number}|null} 定义块的行首到最后一行的行尾
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
 * 收集 [fromLine, toLine] 范围内的**脚注定义块**覆盖到的行号（含缩进续行）。
 *
 * 【为什么按行扫，而不是跟着 lezer 的 LinkReference 节点走 —— 2026-10-26 缺陷 D】
 * 缺陷现场（QA 实测 + Lead 复现）：
 *     [^a]: 第一条
 *       续行
 *     [^b]: 第二条
 * 第三行紧跟在续行之后时，lezer **不产 LinkReference**，而是把它并进上一段的
 * Paragraph（实测 Paragraph(12..24) 里只有 Link(15..19)）。按节点处理的后果是：
 * 前两条被隐藏、`[^b]` 被行级扫描换成上标 widget、而 `: 第二条` 半截源码裸露在
 * 正文里 —— 同一份文档在预览/导出里是完整的两条脚注（实测 2 个 <li>），编辑器
 * 里却是「一个上标 + 半行源码」，属于本仓最忌讳的一类静默分叉。
 *
 * 故定义块与行内公式、脚注引用一样，统一走**行级口径**（三者都是「词法规整、
 * 语法树不可靠」的语法）。加上空行后另起一段的缩进内容（markdown-it-footnote
 * 支持脚注多段落）也覆盖不到 —— 这是刻意的取舍：宁可少隐藏一段，也不吞掉
 * 用户正文；多段落场景下首段与缩进续行仍会正常隐藏。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {number} fromLine 起始行号（1-based，含）
 * @param {number} toLine 结束行号（1-based，含）
 * @param {(line: object) => boolean} [isExcluded] 该行是否落在代码块 / 块级 widget 区间
 * @returns {Set<number>} 需要隐藏的行号
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

/**
 * 从属性串里取**单个**属性值（img 的 src / alt 用）；取不到返回 null。
 *
 * 【为什么不复用 markdown/html.js 的 parseAttrs】那是给「白名单重建」用的
 * （逐属性遇非引号值吃到空白为止），它把 `<` `>` 也当属性名边界之外合法字符，
 * 而这里喂进来的 attrs 来自 parseHtmlTag（标签体已被剥离，不含尖括号）。
 * 正则一条解决，与 htmlColor 同批函数，不需要拖入两份解析器。
 */
export function attrValue(attrs, name) {
  const re = new RegExp(
    '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>"\']+))', 'i'
  )
  const m = re.exec(attrs ?? '')
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? null
}

/**
 * 从 HTMLTag 标签体里取出 img 的 src / alt；不是可显示的 img（无 src）返回 null。
 *
 * 【为什么给 img 开小灶】img 在预览侧白名单里（INLINE_ALLOWED），`<img …/>` 独立
 * 一行时预览渲染出真图片；编辑器侧此前把它当普通 HTMLTag 留源码 —— 真机反馈
 * 「内嵌 HTML 的图片不显示」。widget 与 markdown `![]()` 共用 cm-md-img，尺寸
 * 由 ImageWidget 从 attrs 还原（width/height 只认纯数字，见 imageWidget.sizeOf）。
 */
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

/**
 * 脚注**内容** widget：定义行 `[^1]: 这是脚注内容。` 整行换成
 * 「上标编号 + 内容小字」。此前定义行整块隐藏（与预览侧 `<section
 * class="footnotes">` FileInfo 两副面孔），真机反馈是「脚注在正文里找不到内容」
 * —— 静默消失正是本仓最忌讳的形态。内容用 textContent 装载：它来自文档本身，
 * 不是 HTML，不能当 innerHTML 塞进去（`<b>` 这样的字面量会被激活成元素）。
 */
export class FootnoteDefWidget extends WidgetType {
  constructor(label, content) {
    super()
    this.label = label
    this.content = content
  }
  eq(other) { return other.label === this.label && other.content === this.content }
  toDOM() {
    // 骨架是静态字符串（不掺任何文档文本）；两处内容用 textContent 装载：
    // `[^1]: <b>x</b>` 这类字面量不能被激活成元素，它来自文档，不是 HTML
    const w = document.createElement('span')
    w.className = 'cm-md-footnote-def'
    w.innerHTML = '<sup class="cm-md-footnote-ref"></sup><span class="cm-md-footnote-def-content"></span>'
    w.firstChild.textContent = this.label
    w.lastChild.textContent = this.content
    return w
  }
  // 内容取自文档，无交互；与 MathWidget 同理由：点击要落光标
  ignoreEvent() { return false }
}

/**
 * 脚注定义块的装饰清单：**首行**换成 FootnoteDefWidget（内容可见），续行保持
 * 隐藏（hideDeco 空替换，与 wysiwyg.js 的 hideDeco 同一字面）。
 *
 * 【为什么在 inlineExtras 而不在 wysiwyg.js】wysiwyg.js 的有效行数已顶到门禁
 * 红线，这里每多一行都挤掉别的职责。widget 与解析函数同住一个文件，也就天然
 * 满足「清单与解析同源」。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {Set<number>} defLines footnoteDefLines 的产物（行号集合，含首行）
 * @param {number} firstLineNo 定义首行行号（1-based）
 * @param {(from:number)=>boolean} canHide 活跃行不隐藏（显形源码，与全文件同一口径）
 * @param {(from:number,to:number)=>boolean} singleLine 跨行拦截（同 wysiwyg.js）
 * @returns {{from:number,to:number,value:object}[]} 可直接并入 replaces 的区间
 */
export function footnoteDefDecorations(doc, defLines, firstLineNo, canHide, singleLine) {
  // defLines 可能含**下一条定义的首行**（footnoteDefLines 收的是范围内所有定义
  // 块的行号，不是单块）——本块在「下一个定义首行」处终止，其余块由 wysiwyg 的
  // 逐行扫描在其各自的首行上自处理（隐藏是幂等的，widget 同样会再产一次）。
  const sorted = [...defLines].sort((a, b) => a - b)
  const blockLines = []
  for (const ln of sorted.slice(sorted.indexOf(firstLineNo) + 1)) {
    if (isFootnoteDefStart(doc.line(ln).text)) break
    blockLines.push(ln)
  }
  const out = []
  const first = doc.line(firstLineNo)
  const parts = parseFootnoteDefText(first.text)
  if (parts && canHide(first.from) && singleLine(first.from, first.to)) {
    // 空内容照样渲染 widget（编号在），与预览侧空脚注一致
    const content = (parts.rest + ' ' + blockLines.map((ln) => doc.line(ln).text.trim()).join(' ')).trim()
    out.push({ from: first.from, to: first.to,
      value: Decoration.replace({ widget: new FootnoteDefWidget(parts.label, content) }) })
  }
  for (const ln of blockLines) {
    const l = doc.line(ln)
    if (canHide(l.from)) out.push({ from: l.from, to: l.to, value: hideLineDeco })
  }
  return out
}

/** 续行隐藏装饰。与 wysiwyg.js 的 hideDeco 有同一字面（空替换） */
const hideLineDeco = Decoration.replace({})
