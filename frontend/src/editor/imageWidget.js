// editor/imageWidget.js — 图片预览装饰的唯一组装点
// ----------------------------------------------------------------------------
// 【为什么从 wysiwyg.js 拆出来】wysiwyg.js 已顶到契约 5 的 300 有效代码行红线，
// 而图片这一块（ImageWidget + buildImageDOM + urlOf/altOf）约 70 行有效代码，
// 且与「行内文本渲染」没有耦合 —— 它的产物是**整块内容**（一段 `![alt](url)`
// 换成一个 <img>），生命周期只跟文档路径、不跟行内容走。
// 拆分后既有导入路径不变：wysiwyg.js 里 `export { buildImageDOM, ImageWidget }
// from './imageWidget.js'`（tests/image-asset-context.test.mjs 从这里取）。

import { WidgetType } from '@codemirror/view'
// 图片 src 的文档相对路径 → /doc-assets/ 改写（唯一口径在 assetUrl.js）；
// 不改写的话 src 会落到构建产物目录，图片永远是碎图占位
import { resolveAssetSrc } from './assetUrl.js'
// 子节点查找的唯一实现放在 inlineExtras.js：图片与链接都要在「同一层子节点」里
// 找 URL / LinkMark，两处各写一份必然在「要不要下钻」上分叉
import { findChild } from './inlineExtras.js'

/**
 * 构建图片预览的 DOM（占位框态含在内）。
 * 独立成导出函数的原因：ImageWidget 的 toDOM 要按「构造期 / 构建期」两个
 * 时点解析 src（见 ImageWidget 头注的定格缺陷），测试也需要一个能注入
 * document stub 直接驱动的入口 —— 它就是图片装饰的**唯一 DOM 组装点**。
 *
 * @param {string} rawSrc Markdown 里的原始 src（占位框文案用它，与旧实现一致）
 * @param {string} resolved 已按 assetUrl 口径改写的 src（img 实际加载的地址）
 * @param {string} alt
 */
export function buildImageDOM(rawSrc, resolved, alt) {
  const wrap = document.createElement('span')
  wrap.className = 'cm-md-img'
  const img = document.createElement('img')
  img.src = resolved
  img.alt = alt
  img.loading = 'lazy'
  img.addEventListener('error', () => {
    // 远程图常因离线 / 防盗链失败：留一个可读的占位而不是碎图标。
    // tip 文案用**原始** src（用户写进 Markdown 的路径），不是改写后的
    // /doc-assets/… —— 占位框是给「看 Markdown 的人」读的。
    wrap.classList.add('is-broken')
    img.remove()
    const tip = document.createElement('span')
    tip.className = 'cm-md-img-tip'
    tip.textContent = alt || rawSrc
    wrap.appendChild(tip)
  })
  wrap.appendChild(img)
  return wrap
}

// ---------- 图片：`![alt](url)` 换成图片预览 ----------
// 只在「非活跃行」替换（活跃行保持源码，见 wysiwyg.js 头注的显形判定）：用户
// 正在编辑那一行时把它变成图片反而挡路。加载失败不抛——onError 把 <img> 摘掉，
// 由 CSS 的 .is-broken 呈现占位框（并保留 alt 文本于 title）。
//
// 【eq/toDOM 为什么带着 resolvedSrc —— 2026-10-23 真机回归「图片占位框显示
// assets/ 路径而不是图片」的根因，勿回退】
// 改写依赖 assetUrl 的模块级开关，而 widget 是**构造期快照**：插图时文档往往
// 还没落盘（开关关着）⇒ toDOM 拿到未改写的 assets/… ⇒ 404 ⇒ 占位框。此后文档
// 落盘、开关打开，但 eq() 只比 src/alt（两者不变）⇒ CM 复用旧 DOM ⇒ 破损态
// 永久定格。另一条路径是跨目录切换，toDOM 读到的是上一个文档的开关状态。
// 修法 = 让「改写口径」参与复用判定（构造期解析出的 resolvedSrc 进 eq）；但仅此
// 不够 —— 路径变化**不产生 CM 事务**，装饰根本不会重算，故另需 assetContext.js
// 的版本号与刷新信号（见该文件头与 wysiwyg.js 的 shouldRebuildDecorations）。
export class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super()
    this.src = src
    this.alt = alt
    // eq 键带 resolvedSrc：否则文档路径状态变化时 widget 被判「没变」，
    // 上一次按旧开关解析出的地址（多半是 404）会被一直复用（见上）。
    this.resolvedSrc = resolveAssetSrc(src)
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt
      && other.resolvedSrc === this.resolvedSrc
  }
  toDOM() {
    // toDOM 可能在构造之后很久才被 CM 调用（视口外惰性构建），此时再读一次
    // 当前开关；构造期已解析的 this.resolvedSrc 作为兜底 —— 两个时点都不漏。
    const resolved = resolveAssetSrc(this.src) || this.resolvedSrc
    return buildImageDOM(this.src, resolved, this.alt)
  }
  ignoreEvent() { return false }
}

/**
 * 从 Image 节点里取出 URL 与 alt 文本。
 * 不用正则去 `![]()` 上抠（会误伤嵌套括号与转义），而是走子节点：
 * URL 节点是解析器给出的权威区间，LinkLabel 里是 alt。
 * 两个都要在直接子节点里找 —— Image 的子结构随内容变
 * （`![](a.png)` 没有 LinkLabel，`![说明](a.png)` 有）。
 *
 * 【坑，勿改】SyntaxNode 上**没有** .state / .doc 属性（只有 from/to/name/
 * node/nextSibling 等）。取文本必须用调用方传进来的 doc。
 * 曾写成 node.state.doc 直接把插件打崩（CodeMirror plugin crashed）。
 */
export function urlOf(node, doc) {
  const url = findChild(node, 'URL')
  if (!url) return null
  // URL 节点含尖括号包裹时 slice 出来是 <a.png>，去掉
  return doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
}

/**
 * 取图片的 alt 文本。
 *
 * 【为什么不能只认 LinkLabel 子节点 —— 2026-10-24 实测】lezer 对**行内式**
 * `![alt](url)` **不产出 LinkLabel 节点**（Image 的子节点只有
 * LinkMark/LinkMark/LinkMark/URL/LinkMark），只有**引用式** `![alt][ref]` 才有。
 * 旧实现只查后者 ⇒ 行内图片的 alt 恒为 ''：占位框丢掉用户写的说明、退化成裸
 * 路径，eq 的 alt 项也永远不生效（两侧都是空串）。故行内式改从 Image 的**头两个
 * LinkMark 之间**取（`![` 之后到 `]` 之前）—— 那就是 alt 的权威区间，比在
 * `![]()` 上跑正则可靠（不误伤嵌套括号与转义）。
 */
export function altOf(node, doc) {
  const label = findChild(node, 'LinkLabel')
  if (label) return doc.sliceString(label.from, label.to).replace(/^\[|\]$/g, '')
  const n = node.node
  if (!n) return ''
  // 第一个 LinkMark 是 `![`，第二个是 `]`；两者之间即 alt
  const marks = []
  for (let c = n.firstChild; c && marks.length < 2; c = c.nextSibling) {
    if (c.name === 'LinkMark') marks.push(c)
  }
  if (marks.length < 2) return ''
  return doc.sliceString(marks[0].to, marks[1].from)
}
