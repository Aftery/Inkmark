// editor/wysiwygBlocks.js — 块级即时渲染：折叠块 <details> + 多行公式 $$…$$
// ----------------------------------------------------------------------------
// 【要解决什么】用户文档里的
//     <details><summary>点击展开更多内容</summary> … </details>
// 与「$$ 独占一行的」多行公式，在编辑器里全是源码：尖括号、竖排的 $$。用户预期
// 是「折叠块真的能点开/收起」「公式真的排版出来」—— 这是 Typora 级编辑器的基础
// 预期，不是增强项。
//
// 【为什么是 StateField，而不是 ViewPlugin】跨行整体替换只能由 block 装饰完成，
// 而 @codemirror/view 明确禁止**插件**提供 block 装饰（dist/index.js:2774 抛
// RangeError "Block decorations may not be specified via plugins"）。StateField
// 经 EditorView.decorations facet 提供是唯一合法路径 —— 与 tableRender.js 同构。
// 照抄它的三处关键写法（不要「顺手简化」）：
//   ① ensureSyntaxTree + partial 标记：StateField.create 跑在语法树补齐之前；
//   ② 树补齐后没有任何事务会通知 field，故有一个 blockScanKick 兜底轮询；
//   ③ selectionInside 用「严格相交」判定（边界算界外），Esc/点击后停在边界时
//      渲染态不被撤掉。
//
// 【区间绝不自己再扫一遍】「哪几行必须由块级 widget 独占」的唯一登记处是
// editor/blockRanges.js（blockRangesField）。行内装饰侧读同一个 field 跳过这些
// 区间，本文件也只**读**它（不自己正则匹配 `<details>`）：两套扫描器迟早在
// 嵌套 / 围栏代码 / 未闭合这些边界上分叉，而分叉的表现正是「同一片文本被两套
// 机制抢」—— CM 构建 tile 时抛 "Cannot destructure property 'tile'" 一族错误，
// 崩溃后 state 已提交而 DOM 不刷新，用户看到的是「编辑器卡住不动了」。
//
// 【与表格共存 —— 显式互斥，绝不重叠】tables 的 block 装饰来自 tableRender.js
// 的 field，它与本文件是两个独立提供者，CM 不会替我们仲裁重叠。故本文件在造
// widget 前先读 tableRenderField 的 tables，只要某个块区间与任一表格区间**严格
// 相交**就整体跳过该块：
//   - 取舍：折叠块里嵌了表格时，折叠块保持源码可见（表格照常真渲染）。
//   - 为什么不反过来（让表格退位）：表格 field 不归本文件管，这里没有能力撤掉
//     它的装饰；而两份 block 装饰重叠必崩。宁可少渲染一个折叠块，也不能崩。
//   - 反向同理：表格里的 `<details>` 落在 Table 节点行内，blockRanges 的
//     DETAILS_OPEN（行首匹配）本就不会登记它，故不产生第二个方向的重叠。
//
// 【嵌套 <details> 的确定行为】扫描侧按 depth 计数，登记的是**最外层**整段；
// 本文件因此只渲染外层一处 widget。内容区里剩下的内层 `<details>…</details>`
// 随用户 HTML 一起过白名单净化（markdown/html.js 的唯一口径），于是它以**原生
// 折叠元素**的形态出现在内容区、可再点开 —— 但内层内容按 HTML 文本显示，不再
// 递归成 Markdown 渲染（递归渲染要引入第二套 Markdown 渲染器，与预览侧必然
// 分叉）。这是刻意的取舍：不崩、行为确定、零数据丢失。
//
// 【交互 = 只改 DOM，绝不改文档】`<details>` 的展开/收起是浏览器原生能力
// （点 <summary> 切换 open 属性），不需要一行 JS，也就永远不会 dispatch 文档
// 变更（AC-03「装饰层零篡改」）。widget 的 ignoreEvent() 恒 true，CM 不接管
// 其中的点击/按键 —— 这正是 tableWidget 的做法：CM 一旦 preventDefault，
// 原生切换就没了。
//
// 【eq() 的取舍：不比较 open】eq 只比 kind + 源码文本，**不含展开状态**。
// 若把 open 纳入 eq，每次点开/收起都会让 CM 判定「widget 变了」而重建 DOM ——
// 用户正在读的那段内容会闪一下，长折叠块里还会跳到顶部。既然展开状态是纯 DOM
// 状态（不进文档），复用 DOM 就是唯一正确的语义。
//
// 【源码怎么回来】选区与本区间严格相交时显示源码（与 tableRender 同一口径）。
// 进入方式：方向键（本文件**不**注册 atomicRanges，光标可以走进去）、⌘F 查找
// 命中块内文本、拖选跨过块边界。刻意没做「编辑源码」按钮：按钮要文案就得加
// i18n key（不在本轮改动范围），而 widget 内任何自定义交互都要 dispatch，反而
// 削弱「装饰层零篡改」这条硬约束。
//
// 【图标零 emoji】展开指示三角用 CSS 的 border 三角画（见
// themes/editor-wysiwyg-blocks.css），不引入图标库、不写 emoji 字符。

import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { blockRangesField } from './blockRanges.js'
import { tableRenderField } from './tableRender.js'
// 用户手写 HTML 的白名单净化 —— 全仓唯一口径（预览侧同一份）。内容区与摘要
// 都要过它：`<details>` 的正文同样是「别人给的 .md 里的 HTML」，不净化等于给
// webview 开后门（本仓风险模型见 markdown/html.js 头注）。
import { sanitizeHtml } from '../markdown/html.js'
// 公式渲染的唯一口径（KaTeX 选项只在那里出现一次）
import { renderMath } from '../markdown/math.js'

// ---------------- 解析（纯函数，便于直接对源码打靶） ----------------

/**
 * 拆 `<details>` 源码 → { open, summary, body }；结构不成立返回 null。
 *
 * 区间来自 blockRanges（已按 depth 配对到最外层闭标签），故闭标签取**最后一个**
 * `</details>`：内层折叠块的闭标签一定出现在它之前。
 */
export function parseDetails(source) {
  const head = /^\s{0,3}<details\b([^>]*)>/i.exec(source)
  if (!head) return null
  const bodyFrom = head[0].length
  const close = source.toLowerCase().lastIndexOf('</details')
  if (close <= bodyFrom) return null
  const inner = source.slice(bodyFrom, close)
  const sum = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(inner)
  return {
    // 源码里写了 open 就以展开态登场；之后的切换只在 DOM 里发生
    open: /\bopen\b/i.test(head[1] || ''),
    summary: sum ? sum[1] : '',
    // 摘要已单独渲染，正文里要把它摘掉，否则标题会出现两次
    body: sum ? inner.slice(0, sum.index) + inner.slice(sum.index + sum[0].length) : inner,
  }
}

/**
 * 取 `$$` 围栏之间的公式源码。首尾两行**必须**是独占的 `$$`（再验一次而不是
 * 相信扫描：区间来自 blockRanges，但它的边界一旦偏一行，这里就会把围栏行本身
 * 喂给 KaTeX —— 那不会报错，只会在公式里渲染出两个 `$`，属于最难归因的一类）。
 */
export function parseMathBlock(source) {
  const lines = source.split(/\r\n|\r|\n/)
  if (lines.length < 2) return null
  if (lines[0].trim() !== '$$' || lines[lines.length - 1].trim() !== '$$') return null
  const tex = lines.slice(1, -1).join('\n').trim()
  // 空公式（`$$\n$$`）不产 widget：渲染出来是一块空白，用户会以为内容丢了
  return tex ? { tex } : null
}

/**
 * 拆对齐块源码 → { tag, align, body }；结构不成立返回 null。
 *
 * 首行必须是独占一行的 `<div …>` / `<p …>` 开标签、末行是同名闭标签独占一行
 * （blockRanges 已做一次配对，这里再验一次 —— 理由同 parseMathBlock：扫描边界
 * 偏一行时，闭标签行正文会混进 body，渲染出半截 HTML 文字）。
 *
 * align 只放行四个对齐关键字：它要变成 widget 的 style.textAlign，任意值等于
 * 一条 CSS 注入通道（同 htmlColor 只认颜色的取窄逻辑）。正文交给
 * sanitizeHtml —— 与 `<details>` 正文同一份白名单口径，不新增信任面。
 */
export function parseHtmlAlignBlock(source) {
  const lines = source.split(/\r\n|\r|\n/)
  const head = /^\s{0,3}<(div|p)((?:\s[^<>]*?)?)(\/?)>$/.exec(lines[0].trim())
  if (!head || head[3] === '/') return null
  const tag = head[1].toLowerCase()
  if (!new RegExp('^\\s*</\\s*' + tag + '\\s*>$', 'i').test(lines[lines.length - 1])) return null
  const align = /\balign\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(head[2] ?? '')
  const a = align ? (align[1] ?? align[2] ?? align[3] ?? '') : ''
  return {
    tag,
    align: /^(left|center|right|justify)$/i.test(a) ? a.toLowerCase() : '',
    body: lines.slice(1, -1).join('\n'),
  }
}

// ---------------- widget ----------------

/**
 * 点击渲染块 → 把光标放进块内源码。
 *
 * 【为什么必须显式派发选区】block 装饰把整段源码换成了一个 widget，
 * `ignoreEvent() = true` 又让 CM 完全不看这次点击 —— 表现就是「公式 / HTML 块
 * 渲染出来以后点不进去、改不了」。这里用当前 DOM 反查块起点（**不能用构造期
 * 缓存的 from**：块上方插入文字后 widget 会被 CM 复用，旧 from 已经偏移），
 * 再落到正文首行。选区一进块，selectionInside() 就让 widget 退回源码。
 *
 * @param {HTMLElement} el widget 根元素
 * @param {import('@codemirror/view').EditorView} view
 * @param {string} source 块原文（用来跳过开标签 / `$$` 那一行）
 * @param {'mousedown'|'dblclick'} [type]
 */
function editSourceOn(el, view, source, type = 'mousedown') {
  el.addEventListener(type, (e) => {
    e.preventDefault()
    e.stopPropagation()
    let from = -1
    try { from = view.posAtDOM(el) } catch { return }
    if (from < 0) return
    const nl = source.indexOf('\n')
    const pos = Math.min(from + (nl < 0 ? 1 : nl + 1), view.state.doc.length)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
  })
}

/**
 * 对齐块 widget：`<div align="center">…</div>` 整块渲染成同名元素、对齐映射到
 * style.textAlign。正文是**用户手写 HTML**，必须过 sanitizeHtml（与 <details>
 * 的正文同一口径：预览里会渲染的，编辑器里就只能渲染净化后的版本）。
 */
class HtmlAlignWidget extends WidgetType {
  constructor(block) {
    super()
    this.kind = 'html'
    this.source = block.source
    this.parts = block.parsed
  }

  eq(other) {
    return other.kind === this.kind && other.source === this.source
  }

  // 内容是静读区（无交互元素），点击让光标落到块两侧（与 details 同一取舍）
  ignoreEvent() { return true }

  toDOM(view) {
    const el = document.createElement(this.parts.tag)
    el.className = 'cm-md-html-align'
    if (this.parts.align) el.style.textAlign = this.parts.align
    // 只放白名单重建后的内容：innerHTML 的信任边界见 parseHtmlAlignBlock 头注
    el.innerHTML = sanitizeHtml(this.parts.body)
    editSourceOn(el, view, this.source)
    return el
  }
}

class DetailsBlockWidget extends WidgetType {
  constructor(block) {
    super()
    this.kind = 'details'
    this.source = block.source
    this.parts = block.parsed
  }

  eq(other) {
    // 只比源码（含 kind）：open 状态是纯 DOM 状态，比进来会让点开/收起重建 DOM
    return other.kind === this.kind && other.source === this.source
  }

  // 点击/按键全部交还浏览器：<summary> 的原生切换就靠这个
  ignoreEvent() { return true }

  toDOM(view) {
    const el = document.createElement('details')
    el.className = 'cm-md-details'
    if (this.parts.open) el.open = true
    // 单击留给原生展开/收起；双击才进源码编辑 —— 否则折叠块的交互会被编辑态抢走
    editSourceOn(el, view, this.source, 'dblclick')

    const sum = document.createElement('summary')
    sum.className = 'cm-md-details-summary'
    const title = sanitizeHtml(this.parts.summary).trim()
    if (title) sum.innerHTML = title
    // 没有 <summary> 时不编造标题（浏览器的默认 "Details" 是英文硬编码，
    // 与界面语言无关，宁可只留指示三角）
    else sum.classList.add('is-untitled')
    el.appendChild(sum)

    const body = document.createElement('div')
    body.className = 'cm-md-details-body'
    body.innerHTML = sanitizeHtml(this.parts.body)
    el.appendChild(body)
    return el
  }
}

class MathBlockWidget extends WidgetType {
  constructor(block) {
    super()
    this.kind = 'math'
    this.source = block.source
    this.tex = block.parsed.tex
  }

  eq(other) {
    return other.kind === this.kind && other.source === this.source
  }

  ignoreEvent() { return true }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-math-block'
    // 只放 renderMath 的输出：居中与 display 版式由 KaTeX 的 .katex-display
    // 自己负责，这里再套一层居中/内边距就会和导出侧排成两套版式。
    // 渲染放在 toDOM 而不是构造函数：eq 命中时 CM 复用旧 DOM，构造函数却每次
    // 文档变化都跑一遍 —— 公式多时那是白烧的 KaTeX 计算。
    const html = renderMath(this.tex, { display: true })
    if (html) wrap.innerHTML = html
    // 渲染失败（空源码等极端情况）退回源码文本，绝不产出空白块
    else wrap.textContent = this.source
    editSourceOn(wrap, view, this.source)
    return wrap
  }
}

// ---------------- 装饰组装 ----------------

/** 选区与块区间严格相交才显示源码（边界算界外，与 tableRender 同一口径） */
function selectionInside(state, block) {
  return state.selection.ranges.some((r) => r.to > block.from && r.from < block.to)
}

function decoOf(state, blocks) {
  const b = new RangeSetBuilder()
  for (const blk of blocks) {
    if (selectionInside(state, blk)) continue
    const widget = blk.kind === 'details' ? new DetailsBlockWidget(blk)
      : blk.kind === 'math' ? new MathBlockWidget(blk)
      : new HtmlAlignWidget(blk)
    // 【inclusiveEnd 只在「块一直延伸到文档末尾」时关掉 —— 否则光标无处可落】
    // CM 的 block replace 默认 inclusiveEnd:true（端点也归 widget 所有）。当块
    // 覆盖到 doc.length 且文档**不以换行结尾**时，文档末尾没有任何普通文本行可
    // 承载光标：此时在末尾打字会被 CM 改写到**文档开头**（实测 "Zhead\n\nBLOCK"），
    // 属于静默写错位置，比不渲染严重得多。
    // 关掉 inclusiveEnd 后 CM 会为该位置补一个空行锚点，输入正确落在块之后。
    // 只在触及文末时这样做：普通块（后面还有正文）必须保持默认语义，否则「光标
    // 贴着块尾」会被判成块内（实测会让边界处的渲染态消失、输入丢失）。
    const atDocEnd = blk.to === state.doc.length
    b.add(blk.from, blk.to, Decoration.replace({ widget, block: true, inclusiveEnd: !atDocEnd }))
  }
  return b.finish()
}

/** 位置是否落在围栏代码块里（语法树口径，见下方「二次校验」注释） */
function inFencedCode(tree, pos) {
  let node = tree.resolveInner(pos, 1)
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true
    node = node.parent
  }
  return false
}

/**
 * 按 blockRanges 的区间造块清单（+ 装饰集）。
 *
 * 【为什么区间还要「二次校验」】blockRangesField 只在 docChanged 时重扫，而它
 * 扫描时用的语法树可能是**部分树**（大文档 / 刚打开 / 嵌套代码语言异步加载中）。
 * 用部分树做「围栏代码排除」会失效：实测 509KB 文档里，`<details>` 写在 ```html
 * 围栏内时，create 那一刻的扫描把它当成了真折叠块（围栏节点还没解析出来）。
 * 那个错误区间会一直留在 field 里直到下一次输入。本文件不改 blockRanges（冻结），
 * 故在消费侧用**当前**语法树再验两道：
 *   - tree.length < r.to：树还没铺到区间末尾，这张「是不是代码块」的判定不可信，
 *     本轮不造 widget（宁可不渲染，也不吞掉围栏里的代码）；
 *   - inFencedCode：区间起点确实在围栏代码里，跳过。
 * 配合下面的 blockScanKick，树补齐后会重扫一次，正确结果随即补上。
 */
function buildBlocks(state) {
  const ranges = state.field(blockRangesField, false) ?? []
  let tree = ensureSyntaxTree(state, state.doc.length, 100)
  // partial 与 tableRender 同义：结果不可信，任何一笔事务都要重扫
  const partial = !tree || !syntaxTreeAvailable(state, state.doc.length)
  if (!tree) tree = syntaxTree(state)
  if (!ranges.length) return { blocks: [], deco: Decoration.none, partial }
  // 表格装饰来自另一个 field（tableRender.js）：重叠必崩，故先取它的区间做互斥
  const tables = state.field(tableRenderField, false)?.tables ?? []
  const blocks = []
  for (const r of ranges) {
    if (tree.length < r.to) continue
    if (inFencedCode(tree, Math.min(r.from + 1, r.to))) continue
    if (tables.some((t) => r.from < t.to && r.to > t.from)) continue
    const source = state.sliceDoc(r.from, r.to)
    const parsed = r.kind === 'details' ? parseDetails(source)
      : r.kind === 'html' ? parseHtmlAlignBlock(source)
      : parseMathBlock(source)
    if (!parsed) continue
    blocks.push({ from: r.from, to: r.to, kind: r.kind, source, parsed })
  }
  return { blocks, deco: decoOf(state, blocks), partial }
}

// ---------------- StateField：block 装饰的唯一来源 ----------------

/** 触发全量重扫的事务效果（树补齐后由 blockScanKick 发出） */
export const rescanBlocks = StateEffect.define()

export const wysiwygBlocksField = StateField.define({
  create: (state) => buildBlocks(state),
  update(value, tr) {
    const force = tr.effects.some((e) => e.is(rescanBlocks))
    // partial：上一轮扫描用的树不完整（结果不可信），任何事务都要重扫
    if (force || tr.docChanged || value.partial) return buildBlocks(tr.state)
    if (!tr.selection) return value
    // 仅选区变化：复用块清单只重算可见性（widget 经 eq 命中，零 DOM 重建）
    return { blocks: value.blocks, deco: decoOf(tr.state, value.blocks), partial: value.partial }
  },
  // from(field, get)：值是 {blocks, deco} 而非裸 DecorationSet，必须传取值函数 ——
  // 默认恒等会把整个对象塞进 decorations facet，view 构建时在 RangeSet.spans 里崩。
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

// ---------------- 初始扫描兜底 ----------------
// StateField.create 跑在语法树补齐之前（见 buildBlocks 的「二次校验」）。树在后
// 台 idle 解析完成时**没有任何事务**会通知 field，故这里在树就绪后补发一笔重扫。
// 常态零开销：树本来就是完整的（绝大多数文档），构造后立即发一笔就停。
// 写法照 tableRender.js 的 tableScanKick，包括 destroy 后的退出守卫。
export function blockScanKick() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.destroyed = false
        this.poll(view)
      }
      poll(view) {
        // destroy() 之后必须停：视图已销毁仍轮询会白烧 CPU，且对已销毁视图
        // 派发事务会让 CM6 抛 update 异常
        if (this.destroyed) return
        if (syntaxTreeAvailable(view.state, view.state.doc.length)) {
          // 统一经 setTimeout：插件构造发生在 view 的 update 周期内，同步
          // dispatch 会嵌套事务
          this.timer = setTimeout(() => {
            if (!this.destroyed && view.dom?.isConnected) {
              view.dispatch({ effects: rescanBlocks.of(null) })
            }
          }, 0)
          return
        }
        this.timer = setTimeout(() => this.poll(view), 60)
      }
      destroy() {
        this.destroyed = true
        clearTimeout(this.timer)
      }
    },
  )
}
