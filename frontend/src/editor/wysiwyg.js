// WYSIWYG 即时模式装饰器（D-2 默认编辑形态）
// ----------------------------------------------------------------------------
// 架构依据：docs/spec/phaseC-architecture.md §3（逐条照做）。
//
// 核心约束（@codemirror/view@6.43.13 实测，勿凭文档记忆改写）：
// 1) 插件提供的装饰「不得 block、不得跨行替换」（dist/index.js:2772-2776 会抛
//    RangeError）。本文件只用行内 Decoration.replace / Decoration.mark / 行内
//    widget / Decoration.line，绝无 block 装饰。
// 2) 装饰只在 visibleRanges 内计算（禁止全文档扫描，AC-05 大文档性能）。
// 3) IME 保护：view.composing 为 true 时冻结重算（AC-04 中文输入硬需求）。
// 4) atomicRanges 必需：光标必须跳过隐藏区，否则方向键「按了不动」。
// 5) 内容零篡改（AC-03）：本模块只产装饰，永不 dispatch 文档变更。
//
// 显形判定（§3.2）：「活跃」= 与任一 selection range 相交的行。活跃行的所有
// 隐藏型替换一律跳过（显形 = 保持源码原样）；行级样式类（引用底色等）照常应用。
//
// 【本文件只管「在哪儿用」】HTML 内联标签的解析/配对、行内公式的边界扫描、
// emoji 与脚注的 widget 都在 editor/inlineExtras.js；图片整块在
// editor/imageWidget.js（两者都是为了让本文件守住建制 5 的 300 有效行红线）。
//
// 样式：.cm-md-* 全部定义在 themes/editor-wysiwyg.css（该文件是唯一定义处）。

import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
// 任务列表 checkbox 的无障碍标签要随界面语言走 —— 它是 span[role=checkbox] 的
// aria-label，屏幕阅读器会读出来，属于货真价实的用户可见文案。
import { t } from '../i18n/index.js'
// 改写口径的版本号：文档路径变化不产生事务，装饰必须靠它判「过期了」。
// 同步点与版本号都在 assetContext.js（文件头有完整根因说明）。
import { assetVersion } from './assetContext.js'
// 短码表情的唯一真源（与预览/导出同一份表，否则同一份文档两副面孔）
import { emojiFor } from '../markdown/emoji.js'
// details / 多行 $$ 区间由块级 widget 独占（blockRanges.js 是唯一登记处）
import { blockRangesField } from './blockRanges.js'
import {
  activeLineSet, noteQuoteDepth, pushLineClass, flushQuoteLines, pushMark,
  findChild, linkTextRange, footnoteLabel, parseHtmlTag, tagClass, htmlColor,
  matchCloseTag, scanInlineMath, scanFootnoteRefs, footnoteDefLines,
  isFootnoteDefStart, MathWidget, EmojiWidget, FootnoteRefWidget,
} from './inlineExtras.js'

// 图片装饰已整块搬到 imageWidget.js（行数红线）；这里重导出以保住既有导入路径
// （tests/image-asset-context.test.mjs 从本文件 import buildImageDOM）。
export { buildImageDOM, ImageWidget } from './imageWidget.js'
import { ImageWidget, urlOf, altOf } from './imageWidget.js'

// ---------- 开关：StateField + StateEffect（与 createEditor.js 的 setFocusMode 同构） ----------
// 默认开启：即时模式是 D-2 的默认编辑形态。
export const setWysiwyg = StateEffect.define()

export const wysiwygField = StateField.define({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setWysiwyg)) return e.value
    return value
  },
})

// ---------- 行内 widget：列表圆点 / 任务勾选框 ----------
class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = '\u2022' /* U+2022 圆点，替代原文的破折/星号/加号符号 */
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() { return false }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked }
  eq(other) { return other.checked === this.checked }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-task-box' + (this.checked ? ' checked' : '')
    s.setAttribute('role', 'checkbox')
    s.setAttribute('aria-checked', this.checked ? 'true' : 'false')
    s.setAttribute('aria-label', t(this.checked ? 'task.done' : 'task.unchecked'))
    return s
  }
  ignoreEvent() { return false }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() })
const taskDeco = (checked) => Decoration.replace({ widget: new TaskCheckboxWidget(checked) })
const emptyHintDeco = Decoration.mark({ class: 'cm-md-empty' })
const listmarkDeco = Decoration.mark({ class: 'cm-md-listmark' })
// 隐藏用的空替换共用一个实例：eq 恒等 ⇒ 视口滚动时 CM 不必重建这些 DOM
const hideDeco = Decoration.replace({})

// ---------- 分割线：把 `---` 替换成一条真实的横线 ----------
// 为什么用 widget 而不是只给隐藏后的行加边框：hide() 之后行内没有任何内容，
// 行高会塌到 0（CM6 的空行高度由 .cm-line 的 line-height 决定，替换成空
// widget 更矮），而分割线需要一条**占位且撑开高度**的可见线。用 widget
// 同时拿到「不占字符」与「有高度」两个性质。
class HrWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-hr'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() { return true }
}
const hrDeco = Decoration.replace({ widget: new HrWidget() })

const parentName = (ref) => (ref.node && ref.node.parent ? ref.node.parent.name : '')

// ---------- 装饰构建：只遍历 visibleRanges ----------
/**
 * 构建整份装饰集（唯一构建入口）。
 *
 * 形参是 state + 可见区间而**不是** view：本函数只用到这两样，收窄签名后
 * 「同一份文档 + 两种改写口径」可以在 node 里直接对比（见
 * tests/image-asset-context.test.mjs）。
 *
 * @param {import('@codemirror/state').EditorState} state
 * @param {readonly {from:number,to:number}[]} visibleRanges
 */
export function buildDecorations(state, visibleRanges) {
  if (!state.field(wysiwygField)) {
    return { deco: Decoration.none, atomic: Decoration.none }
  }
  const doc = state.doc
  const active = activeLineSet(doc, state.selection)
  const decoRanges = []
  const replaces = []
  // 块级区间（details / 多行 $$）：**整节点被覆盖**才跳过。
  // 不能直接用 isBlockCovered 的相交语义 —— iterate 第一个进入的节点就是
  // Document（0..doc.length），相交判定对它恒为 true，整篇会被一句话跳过，
  // 界面表现为「编辑器空白」。
  const blocks = state.field(blockRangesField, false) ?? []
  const inBlock = (from, to) => blocks.some((r) => from >= r.from && to <= r.to)
  // 活跃行 → 不隐藏（显形）；跨行与重叠的拦截在末尾统一做（见 replaces 的去重）
  const canHide = (from) => !active.has(doc.lineAt(from).number)
  // 【跨行 = 致命，必须在唯一入口拦】插件提供的 replace 覆盖换行时，CM 在
  // emit 阶段直接抛 "Decorations that replace line breaks may not be specified
  // via plugins"（dist/index.js:2776）。lezer 的节点**可以**跨行：实测
  // `![a⏎b](u)` 是一个完整 Image 节点、`<span⏎ style="…">` 是一个完整 HTMLTag。
  // 故 replace 一律按「首个行尾」裁剪，宁可少隐一段也不让整个插件崩掉。
  const lineSafeTo = (from, to) => Math.min(to, doc.lineAt(from).to)
  const hide = (from, to) => {
    if (!canHide(from) || from >= to) return
    replaces.push({ from, to: lineSafeTo(from, to), value: hideDeco })
  }
  // 整行隐藏（含行首缩进）：脚注定义的续行常有 4 空格缩进，`hide(line.from,
  // line.to)` 会把缩进一起隐掉 —— 这正是我们要的效果；单列成辅助只是让调用处
  // 不必每次写 line.from / line.to。
  const hideLine = (line) => hide(line.from, line.to)
  // widget 替换不能裁剪（半截替换会产出「半个图片/半个公式」），跨行时整套跳过
  const singleLine = (from, to) => !doc.sliceString(from, to).includes('\n')
  const markFor = (from, to, cls, color) => pushMark(decoRanges, from, to, cls, color)

  // 引用块深度：先收集每行最大深度、再统一发一个类（原因见 noteQuoteDepth）。
  // 行级装饰的点区间要求见 pushLineClass 的头注；seen 是重叠视口的去重键。
  const quoteDepth = new Map()
  const seenLines = new Set()

  for (const { from: visFrom, to: visTo } of visibleRanges) {
    // 代码区间：行内公式的**文本扫描**要避开它们（`$x$` 在代码里是内容）。
    // 语法树本身不给 Math 节点，公式只能按行扫文本，故需要这份排除表。
    const codeRanges = []
    syntaxTree(state).iterate({
      from: visFrom,
      to: visTo,
      enter: (node) => {
        const name = node.name
        const parent = parentName(node)

        // 块级 widget 独占的区间（details / 多行公式）：整段跳过，别抢同一片文本
        if (inBlock(node.from, node.to)) return false

        // 块容器：行级底色（不改布局，仅背景，与专注模式 line 类叠加共存）
        if (name === 'Blockquote') { noteQuoteDepth(quoteDepth, doc, node, visFrom, visTo); return }
        if (name === 'FencedCode') {
          codeRanges.push([node.from, node.to])
          pushLineClass(decoRanges, doc, node, 'cm-md-codeblock', visFrom, visTo, seenLines)
          return
        }
        if (name === 'InlineCode' || name === 'CodeText') { codeRanges.push([node.from, node.to]); return }

        // 分隔线：整行替换为横线 widget。必须**整节点**替换且在活跃行显形
        // （否则光标停在那一行时横线消失，位置感错乱）。
        if (name === 'HorizontalRule') {
          if (canHide(node.from)) replaces.push({ from: node.from, to: node.to, value: hrDeco })
          return
        }

        // 表格：整体移交 tableRender.js（StateField block 装饰 + 可编辑单元格）。
        // Bear 式管道隐藏已退役 —— 本插件只有行内装饰、做不了真表格（文件头 §1），
        // 跳过整个子树避免与 block 装饰重复处理同一片内容。
        if (name === 'Table') return false

        // 图片：非活跃行替换为图片预览。父 Image 的 from/to 覆盖整个
        // `![alt](url)`，一次整体替换（内部 LinkMark/URL/LinkTitle 的
        // 隐藏靠区间去重被拦掉，不会与本条产生重叠替换区间）。
        if (name === 'Image') {
          // 跨行图片（alt 里带换行，lezer 实测会合并成一个 Image 节点）整体跳过：
          // 插件跨行替换会被 CM 直接拒绝，而只隐掉里头几个符号会留下
          // `a⏎b` 这种「半截语法」—— 比原始源码更难读。故整棵子树不碰。
          if (!singleLine(node.from, node.to)) return false
          if (canHide(node.from)) {
            const src = urlOf(node, doc) ?? ''
            const alt = altOf(node, doc) ?? ''
            if (src) {
              replaces.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new ImageWidget(src, alt) }) })
              return false
            }
          }
          return
        }

        // 引用式链接定义：`[ref]: url` 与脚注定义 `[^1]: 内容` 都解析成
        // LinkReference。非活跃时隐藏（正文里不该看到定义），活跃时显形可改。
        // 【逐行隐藏，绝不跨行替换】lezer 允许标题/内容续行，节点可能跨两行
        // （实测 `[ref]: url⏎  "标题"` 是一个节点）；插件跨行替换会被 CM 抛
        // RangeError，故按行切开、每段都落在同一行内。
        if (name === 'LinkReference') {
          // 【脚注定义不在这里处理 —— 2026-10-26 缺陷 D】lezer 对「续行紧接另一条
          // 定义」的排列**不产 LinkReference**（把第三行并进上一段 Paragraph），
          // 跟着节点走就一定漏。脚注定义统一改由下面的行级扫描处理（含续行），
          // 这里只处理普通引用式链接定义 `[ref]: url`。
          // 普通定义也可能跨行（实测 `[ref]: url⏎  "标题"` 是一个节点），故按行切开。
          if (!isFootnoteDefStart(doc.lineAt(node.from).text)) {
            for (let pos = node.from; pos < node.to;) {
              const line = doc.lineAt(pos)
              hide(pos, Math.min(node.to, line.to))
              pos = line.to + 1
            }
          }
          return false
        }

        // 链接文字上语义色（引用式 / 行内式 / 快捷键式都一样）；脚注引用另走一条
        if (name === 'Link') {
          const label = footnoteLabel(node, doc)
          if (label) {
            // 这里只处理「整个 Link 恰好就是一个脚注引用」的情形。同一行有多个
            // 脚注时 lezer 会把它们合并成一个 Link（内部文本含 `[`/`]`），
            // footnoteLabel 会返回 null，改由下面的行级 scanFootnoteRefs 逐个处理
            // —— 否则中间那段正文会被一起换掉（2026-10-25 截图里「文字1]，还可以
            // 有命名脚注[^note」就是这条漏判的现场）。
            if (canHide(node.from) && singleLine(node.from, node.to)) {
              replaces.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new FootnoteRefWidget(label) }) })
            }
            return
          }
          // 合并型脚注 Link（内部文本含 `[`/`]`）：**不加链接色**。它的文字区间
          // 横跨「^1]，…[^note」这种碎片，上色只会让中间那段正文变成链接色，
          // 而那根本不是链接。真正的脚注由行级 scanFootnoteRefs 换成上标 widget。
          const text = linkTextRange(node, doc)
          if (text && !doc.sliceString(text.from, text.to).includes('^')) {
            markFor(text.from, text.to, 'cm-md-link')
          }
          return
        }
        // 自动链接 `<https://x>`：只保留 url 文本并上链接色，尖括号在 LinkMark 分支隐藏
        if (name === 'Autolink') {
          const url = findChild(node, 'URL')
          if (url) markFor(url.from, url.to, 'cm-md-link')
          return
        }

        // HTML 内联标签：隐藏标签本体、给两者之间的内容上语义类。
        // 清单只认 html.js 的 EDITOR_TAG_CLASS；不在清单里的一律保持源码可见
        // （用户至少能看到自己写了什么，而不是静默消失）。
        if (name === 'HTMLTag') {
          const raw = doc.sliceString(node.from, node.to)
          const tag = parseHtmlTag(raw)
          // 跨行标签（属性换行）实测存在；隐藏半截会留下 `style="…">` 这种残渣，
          // 比整段源码更难读 —— 一律保持源码可见
          if (!tag || !singleLine(node.from, node.to)) return
          const cls = tagClass(tag.name)
          const color = tag.closing ? null : htmlColor(tag.attrs)
          if (!cls && !color) return
          hide(node.from, node.to)
          if (tag.closing || tag.selfClosing) return
          const close = matchCloseTag(node, tag.name, doc)
          if (close) hide(close.from, close.to)
          // 内容区间到闭标签为止；用户正写到一半（未配对）时只隐标签，不吞内容
          markFor(node.to, close ? close.from : doc.lineAt(node.to).to, cls, color)
          return
        }

        switch (name) {
          case 'HeaderMark': { // # ~ ######（含其后一个空格）
            let to = node.to
            if (doc.sliceString(to, to + 1) === ' ') to += 1
            hide(node.from, to)
            return
          }
          case 'EmphasisMark': {
            // **bold**（父长 > 4 才有内容）/ *em*（父长 > 2）
            const min = parent === 'StrongEmphasis' ? 4 : 2
            const p = node.node.parent
            if (p && p.to - p.from > min) hide(node.from, node.to)
            else if (!active.has(doc.lineAt(node.from).number))
              decoRanges.push({ from: node.from, to: node.to, value: emptyHintDeco })
            return
          }
          case 'StrikethroughMark': {
            const p = node.node.parent
            if (p && p.name === 'Strikethrough' && p.to - p.from > 4) hide(node.from, node.to)
            return
          }
          case 'CodeMark': {
            if (parent === 'InlineCode') {
              const p = node.node.parent
              if (p && p.to - p.from > 2) hide(node.from, node.to) // `x` 空码不隐藏
            } else if (parent === 'FencedCode') {
              // 围栏整行（含 CodeInfo 语言名）行内替换为空；to == line.to 不触发跨行禁令
              hide(node.from, doc.lineAt(node.from).to)
            }
            return
          }
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle': {
            // Link/Image 内的 [ ] ( ) 与 URL / 标题；Autolink 只隐尖括号、URL 是正文
            if (parent === 'Link' || parent === 'Image') hide(node.from, node.to)
            else if (parent === 'Autolink' && name === 'LinkMark') hide(node.from, node.to)
            return
          }
          case 'LinkLabel': {
            // 引用式链接的 `[ref]` 尾巴：Link 的直接子节点。Image 的 LinkLabel
            // 是 alt 文本（整块已由图片 widget 处理），不能在这里隐掉。
            if (parent === 'Link') hide(node.from, node.to)
            return
          }
          case 'QuoteMark': { // > （含其后一个空格）
            let to = node.to
            if (doc.sliceString(to, to + 1) === ' ') to += 1
            hide(node.from, to)
            return
          }
          case 'ListMark': {
            if (parent === 'BulletList' && canHide(node.from)) {
              replaces.push({ from: node.from, to: node.to, value: bulletDeco })
            } else if (parent === 'OrderedList' && canHide(node.from)) {
              // 有序列表序号保形着色（不换内容，无需 atomic）
              decoRanges.push({ from: node.from, to: node.to, value: listmarkDeco })
            }
            return
          }
          case 'TaskMarker': { // [ ] / [x] → 勾选框 widget
            if (!canHide(node.from)) return
            const inner = doc.sliceString(node.from + 1, node.to - 1).trim().toLowerCase()
            const checked = inner === 'x'
            replaces.push({ from: node.from, to: node.to, value: taskDeco(checked) })
            if (checked) pushLineClass(decoRanges, doc, node, 'cm-md-task-done', visFrom, visTo, seenLines)
            return
          }
          case 'Emoji': { // `:smile:` → 表情；不认识的短码保持源码（与 GitHub 一致）
            const char = emojiFor(doc.sliceString(node.from, node.to))
            if (char && canHide(node.from) && singleLine(node.from, node.to)) {
              replaces.push({ from: node.from, to: node.to, value: Decoration.replace({ widget: new EmojiWidget(char) }) })
            }
            return
          }
        }
      },
    })

    // 行级扫描两件事：行内公式 `$…$` 与脚注引用 `[^label]`。
    //
    // 【为什么公式非扫不可】lezer 不认 TeX，语法树里**没有任何节点**可挂。
    // 【为什么脚注也要扫】同一行多个脚注会被 lezer 合并成一个 Link 节点（内部
    // 文本横跨两个脚注 + 中间正文），按节点处理必然漏；`[^label]` 在词法上很
    // 规整，按行扫反而精确（见 inlineExtras.js 的 isFootnoteLabel / scanFootnoteRefs）。
    // 公式的边界规则逐条对齐 markdown/math.js（预览/导出的唯一口径），否则会出现
    // 「编辑器是公式、预览是一对美元符」这种静默分叉。两者都只在非活跃行生效。
    for (let n = doc.lineAt(visFrom).number; n <= doc.lineAt(visTo).number; n++) {
      const line = doc.line(n)
      if (active.has(n) || inBlock(line.from, line.to)) continue
      const inCode = (from, to) => codeRanges.some(([a, b]) => from >= a && to <= b)
      // 脚注定义块（首行 + 缩进续行）整块隐藏。走行级而非节点：缺陷 D 里 lezer
      // 对「续行紧接另一条定义」不产 LinkReference，跟着节点走必漏（详见
      // inlineExtras.footnoteDefLines 头注）。先登记行号集合，本行就不再产 widget。
      const defLines = isFootnoteDefStart(line.text)
        ? footnoteDefLines(doc, n, doc.lineAt(visTo).number, (l) => inBlock(l.from, l.to)
            || codeRanges.some(([a, b]) => l.from >= a && l.to <= b))
        : null
      if (defLines) { for (const m of defLines) hideLine(doc.line(m)); continue }
      for (const m of scanInlineMath(line.text, line.from)) {
        if (inCode(m.from, m.to)) continue
        replaces.push({ from: m.from, to: m.to, value: Decoration.replace({ widget: new MathWidget(m.tex) }) })
      }
      for (const m of scanFootnoteRefs(line.text, line.from)) {
        if (inCode(m.from, m.to)) continue
        replaces.push({ from: m.from, to: m.to, value: Decoration.replace({ widget: new FootnoteRefWidget(m.label) }) })
      }
    }
  }

  // 【必须在所有可见区间跑完之后才铺引用行类】visibleRanges 允许重叠（相邻
  // 分片常共享边界行）。若在每片末尾各铺一次，同一条跨片断的行会被两片各判
  // 出一个深度 —— 实测「> > > 三」在 [0,12)+[12,n) 两片下同时收到
  // `cm-md-quote cm-md-quote-2` 与 `...-3` 两条行装饰，两个类特异性相同，
  // 样式表里后者胜出，但前一条仍留在 tile 里白占一份。累积到末尾统一铺，
  // 每行只会有「所有片里见过的最大深度」这一个结论。
  flushQuoteLines(decoRanges, doc, quoteDepth, seenLines)

  // replace 区间必须互不重叠：CM 对重叠替换的渲染未定义（两段替换叠在一起会
  // 出现半行消失）。按起点升序、同起点取更长者，再顺序丢弃被覆盖的区间 ——
  // 这样「整节点替换」（Image / 脚注 / 公式）永远胜过它内部那些细节节点。
  replaces.sort((a, b) => a.from - b.from || b.to - a.to)
  const atomicRanges = []
  let lastEnd = -1
  for (const r of replaces) {
    if (r.from < lastEnd) continue
    lastEnd = r.to
    decoRanges.push(r)
    atomicRanges.push(r)
  }

  return {
    deco: Decoration.set(decoRanges, true),
    atomic: Decoration.set(atomicRanges, true),
  }
}

// ---------- ViewPlugin：函数式装饰提供者（视口计算之后调用，天然 O(可见行数)） ----------

/**
 * 是否需要重算装饰集。
 *
 * 【为什么单列成导出函数】「文档路径变化」这一类更新**不带任何 CM 可见信号**
 * （docChanged / selectionSet / viewportChanged 全为 false），旧实现在这个
 * 判据里就丢掉了它 —— 而这段逻辑无法靠目视验证：漏判的表现是「图片停在旧
 * 地址」，装饰集本身完全合法。收窄成纯函数后可以拿真实 EditorState 逐条打靶
 * （tests/image-asset-context.test.mjs）。
 *
 * @param {object} u ViewUpdate 形态（测试里用真实 Transaction 拼）
 * @param {number} prevAssetVersion 上次构建时记下的改写口径版本
 */
export function shouldRebuildDecorations(u, prevAssetVersion) {
  return (
    // 改写口径变了（文档路径变了）：图片 src 的整体口径随之变化。
    // 这一条必须排在最前 —— 它对应的更新里其余判据全为 false。
    prevAssetVersion !== assetVersion() ||
    u.docChanged ||
    u.selectionSet ||
    u.viewportChanged ||
    u.startState.field(wysiwygField) !== u.state.field(wysiwygField)
  )
}

export const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      const built = buildDecorations(view.state, view.visibleRanges)
      this.decorations = built.deco
      this.atomic = built.atomic
      // 装饰是按**当下**的改写口径构建的，把口径版本记下来（assetContext.js）。
      // 构造期取版本而不是比较旧装饰里的 widget —— widget 的 resolvedSrc 只能
      // 反映它自己那一次 resolve，判定「整个装饰集是否过期」还得看这个全局量。
      this.assetVersion = assetVersion()
    }
    update(update) {
      // IME 保护（AC-04）：合成期间冻结装饰重算，沿用上一次装饰集。
      // 绝不在合成中途改动 DOM，否则候选窗/预编辑文本可能被清掉。
      // 【注意本行必须在版本号判定之前】合成期整笔跳过 ⇒ this.assetVersion
      // 保持旧值，合成结束后（下一笔事务）仍判定为过期、补一次重建 ——
      // 过期信息不会因跳过而丢失（见 assetContext.js 文件头最后一段）。
      if (update.view.composing) return
      if (!shouldRebuildDecorations(update, this.assetVersion)) return
      const built = buildDecorations(update.view.state, update.view.visibleRanges)
      this.decorations = built.deco
      this.atomic = built.atomic
      this.assetVersion = assetVersion()
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------- atomicRanges（§3.3）：光标跳过隐藏区，可用性前提 ----------
// 原子区不阻止程序化 selection 更新（jumpToHeading 等 dispatch 不受影响）。
// facet 输入是 (view) => RangeSet；须在 wysiwygPlugin 之后注册（createEditor.js）。
export const wysiwygAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(wysiwygPlugin)?.atomic ?? Decoration.none,
)
