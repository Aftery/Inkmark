// editor/imageWidget.js — 图片预览 widget 与 DOM 组装。

import { WidgetType } from '@codemirror/view'
// 文档相对路径改写为 /doc-assets/
import { resolveAssetSrc } from './assetUrl.js'
import { attrValue, findChild } from './inlineExtras.js'

// 只接受纯数字，避免任意值写进 DOM 属性
function sizeOf(attrs, name) {
  const v = attrValue(attrs, name)
  return /^\d{1,4}$/.test(v ?? '') ? Number(v) : 0
}

/**
 * 构建图片预览 DOM。独立导出便于测试直接注入 document stub。
 * rawSrc 用于加载失败时的占位文案，resolved 是实际加载地址。
 */
export function buildImageDOM(rawSrc, resolved, alt, width = 0, height = 0) {
  const wrap = document.createElement('span')
  wrap.className = 'cm-md-img'
  const img = document.createElement('img')
  img.src = resolved
  img.alt = alt
  img.loading = 'lazy'
  // 保留 HTML 里写的尺寸，与预览一致
  if (width) img.width = width
  if (height) img.height = height
  img.addEventListener('error', () => {
    // 加载失败时显示可读占位；文案用原始 src，而不是 /doc-assets/ 地址
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

// src 的解析依赖 assetUrl 的模块级状态，而 widget 是构造期快照。
// resolvedSrc 参与 eq，文档落盘或切换目录后才会重建，避免 404 占位态一直留着。
// 路径变化本身不产生事务，另有 assetContext 负责触发刷新。
export class ImageWidget extends WidgetType {
  constructor(src, alt, attrs = '') {
    super()
    this.src = src
    this.alt = alt
    // 尺寸参与 eq，属性变化时才能重建
    this.width = sizeOf(attrs, 'width')
    this.height = sizeOf(attrs, 'height')
    this.resolvedSrc = resolveAssetSrc(src)
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt
      && other.resolvedSrc === this.resolvedSrc
      && other.width === this.width && other.height === this.height
  }
  toDOM() {
    // 视口外构建时可能已过了一段时间，这里再读一次当前状态
    const resolved = resolveAssetSrc(this.src) || this.resolvedSrc
    return buildImageDOM(this.src, resolved, this.alt, this.width, this.height)
  }
  ignoreEvent() { return false }
}

/**
 * 从 Image 节点取 URL。URL 子节点是解析器的权威区间，不要用正则抠。
 * SyntaxNode 没有 state/doc，文本必须用传入的 doc。
 */
export function urlOf(node, doc) {
  const url = findChild(node, 'URL')
  if (!url) return null
  // URL 节点含尖括号包裹时 slice 出来是 <a.png>，去掉
  return doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
}

/**
 * 取图片 alt。行内式 ![alt](url) 没有 LinkLabel 节点，需要从前两个
 * LinkMark 之间取；引用式才有 LinkLabel。
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
