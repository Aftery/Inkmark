// editor/wysiwygBlocks.js — 块级渲染：<details>、$$…$$、整块 <div>/<p>。
//
// 跨行替换只能由 StateField 提供 block 装饰，ViewPlugin 会被 @codemirror/view 拒绝。
// 区间由 blockRanges.js 统一登记；与表格区间相交时跳过，避免两份 block 装饰重叠。
// 展开状态只存在于 DOM，所以 eq() 不比较 open，避免每次点击都重建内容。

import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { blockRangesField } from './blockRanges.js'
import { tableRenderField } from './tableRender.js'
// 用户手写 HTML 统一走白名单净化，与预览侧同一份
import { sanitizeHtml } from '../markdown/html.js'
// 公式渲染的唯一口径（KaTeX 选项只在那里出现一次）
import { renderMath } from '../markdown/math.js'

// ---------------- 解析（纯函数，便于直接对源码打靶） ----------------

/**
 * 拆 `<details>` 源码 → { open, summary, body }；结构不成立返回 null。
 * 闭标签取最后一个，避免把内层折叠块的闭标签当成外层。
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
    open: /\bopen\b/i.test(head[1] || ''),
    summary: sum ? sum[1] : '',
    // 摘要单独渲染，正文里去掉，避免标题重复
    body: sum ? inner.slice(0, sum.index) + inner.slice(sum.index + sum[0].length) : inner,
  }
}

/**
 * 取 `$$` 围栏之间的公式；首尾必须都是独占一行的 `$$`。
 * 空公式返回 null，避免渲染成空白块。
 */
export function parseMathBlock(source) {
  const lines = source.split(/\r\n|\r|\n/)
  if (lines.length < 2) return null
  if (lines[0].trim() !== '$$' || lines[lines.length - 1].trim() !== '$$') return null
  const tex = lines.slice(1, -1).join('\n').trim()
  return tex ? { tex } : null
}

/**
 * 拆对齐块源码 → { tag, align, body }；首尾标签必须各占一行，否则返回 null。
 * align 会写进 style.textAlign，只放行 left/center/right/justify。
 * body 交给 sanitizeHtml，与 <details> 使用同一份白名单。
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
 * 点击渲染块后把光标放回源码，selectionInside() 随即撤掉 widget。
 * 用 posAtDOM 取当前位置；widget 被复用时，构造期的 from 可能已经偏移。
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

// `<div align>` / `<p align>` 块：渲染成同名元素并应用对齐。
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

  // 点击由 editSourceOn 处理，CM 不接管
  ignoreEvent() { return true }

  toDOM(view) {
    const el = document.createElement(this.parts.tag)
    el.className = 'cm-md-html-align'
    if (this.parts.align) el.style.textAlign = this.parts.align
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
    // open 是纯 DOM 状态，参与比较会导致每次点击都重建
    return other.kind === this.kind && other.source === this.source
  }

  // 单击留给原生展开/收起
  ignoreEvent() { return true }

  toDOM(view) {
    const el = document.createElement('details')
    el.className = 'cm-md-details'
    if (this.parts.open) el.open = true
    editSourceOn(el, view, this.source, 'dblclick')

    const sum = document.createElement('summary')
    sum.className = 'cm-md-details-summary'
    const title = sanitizeHtml(this.parts.summary).trim()
    if (title) sum.innerHTML = title
    // 没有 <summary> 时只留指示三角，不用浏览器默认的英文标题
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
    // 版式交给 KaTeX；放在 toDOM 里，eq 命中时不会重复计算
    const html = renderMath(this.tex, { display: true })
    if (html) wrap.innerHTML = html
    else wrap.textContent = this.source // 渲染失败时退回源码，避免空白块
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
    // 块覆盖到文档末尾且没有结尾换行时关掉 inclusiveEnd，让 CM 补一个空行锚点；
    // 否则末尾输入会被改写到文档开头。普通块保持默认，避免边界位置被误判为块内。
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
 * 按 blockRanges 的区间生成块和装饰。
 * 区间可能来自不完整的语法树，这里用当前树再确认一次，避免把围栏代码里的标签当块。
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

// StateField.create 早于语法树补齐，树就绪后没有事务通知 field，这里补发一次重扫。
export function blockScanKick() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.destroyed = false
        this.poll(view)
      }
      poll(view) {
        if (this.destroyed) return // 视图销毁后继续派发会让 CM 抛 update 异常
        if (syntaxTreeAvailable(view.state, view.state.doc.length)) {
          // 构造期间同步 dispatch 会嵌套事务
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
