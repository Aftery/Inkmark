/**
 * html-embed.test.mjs — 内嵌 HTML（对齐块 / `<img>`）在编辑器侧的渲染契约
 * ---------------------------------------------------------------------------
 * 真机反馈：「内嵌 HTML 不支持，内容参考那个示例」——`<div align="center">` 整块
 * 以源码躺在编辑器里，`<img src=…>` 也只是一行尖括号。预览/导出侧本来就走
 * markdown/html.js 的白名单正常渲染，故这是**编辑器单边的两副面孔**。
 *
 * 这里钉住三件事：
 *   1) blockRanges 只登记「开闭标签各自独占一行」的 div/p 块，围栏代码里的同名
 *      标签不得被吞（吞了就是「代码块里的示例凭空少一段」）；
 *   2) parseHtmlAlignBlock 的配对 / align 白名单，防止任意值变成 CSS 注入；
 *   3) 正文过 sanitizeHtml（预览侧同一口径），`<script>` / 事件属性不得复活。
 *
 * 与 footnote-inline.test.mjs 同款：走真实 EditorState + 语法树，不用源码正则
 * 假装验证（区间偏一行不会报错，只会静默少渲染一段）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'

import { blockRangesField, scanBlockRanges } from '../src/editor/blockRanges.js'
import { parseHtmlAlignBlock, wysiwygBlocksField } from '../src/editor/wysiwygBlocks.js'
import { htmlImgSrc } from '../src/editor/inlineExtras.js'
import { buildDecorations, wysiwygField } from '../src/editor/wysiwyg.js'

/** 小文档的语法树在 create 时已完整；selection 放尾部避免块被显形源码 */
function mkState(doc) {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage }), blockRangesField, wysiwygBlocksField],
  })
}

function rangesOf(doc) {
  const state = mkState(doc)
  return scanBlockRanges(state.doc, syntaxTree(state))
}

const htmlRanges = (doc) => rangesOf(doc).filter((r) => r.kind === 'html')

describe('blockRanges · 对齐块区间', () => {
  test('div/p 独占一行的开闭标签配对成整块', () => {
    const doc = '<div align="center">\n  <p>居中</p>\n</div>\n\n正文\n'
    const [r] = htmlRanges(doc)
    assert.ok(r, '未登记 html 区间（编辑器会继续显示源码）')
    assert.equal(doc.slice(r.from, r.to), '<div align="center">\n  <p>居中</p>\n</div>')
  })

  test('嵌套同名 div 按 depth 配对到最外层闭标签', () => {
    const doc = '<div align="center">\n<div>内层</div>\n</div>\n'
    const [r] = htmlRanges(doc)
    assert.ok(r)
    assert.equal(doc.slice(r.from, r.to), doc.trimEnd())
  })

  test('行内 `<p>…</p>` 不登记（交给行内 HTMLTag，避免两套机制重叠）', () => {
    assert.deepEqual(htmlRanges('前文 <p align="center">行内</p> 后文\n'), [])
  })

  test('未闭合的开标签不登记（用户正写到一半时保持源码，不吞后半篇）', () => {
    assert.deepEqual(htmlRanges('<div align="center">\n正文没有闭标签\n'), [])
  })

  test('围栏代码里的 `<div>` 是内容，不得当块标记', () => {
    const doc = '```html\n<div align="center">\n示例\n</div>\n```\n'
    assert.deepEqual(htmlRanges(doc), [])
  })
})

describe('parseHtmlAlignBlock · 解析与对齐白名单', () => {
  test('取出 tag / align / body', () => {
    const block = parseHtmlAlignBlock('<p align=\'right\'>\n  右对齐\n</p>')
    assert.deepEqual(block, { tag: 'p', align: 'right', body: '  右对齐' })
  })

  test('没有 align 时不编造对齐值', () => {
    const block = parseHtmlAlignBlock('<div>\n内容\n</div>')
    assert.equal(block.align, '')
  })

  test('align 只认四个关键字，任意值不得流进 style', () => {
    const block = parseHtmlAlignBlock('<div align="center; background:url(x)">\n内容\n</div>')
    assert.equal(block.align, '', '非法 align 被当成样式值 = CSS 注入通道')
  })

  test('闭标签不同名 / 尾巴带正文时拒绝解析', () => {
    assert.equal(parseHtmlAlignBlock('<div>\n内容\n</section>'), null)
    assert.equal(parseHtmlAlignBlock('<div>\n内容</div>'), null)
  })
})

/** 只实现 widget.toDOM / 点击接线用到的几项 */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.style = {}
    this.innerHTML = ''
    this.textContent = ''
    this.open = false
    this.children = []
    this.listeners = {}
    this.classList = {
      add: (c) => { this.className = `${this.className} ${c}`.trim() },
      contains: (c) => this.className.split(/\s+/).includes(c),
    }
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  appendChild(child) { this.children.push(child); return child }
  fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn(event) }
}

function widgetOf(doc, kind = 'html') {
  const state = mkState(doc)
  let found = null
  state.field(wysiwygBlocksField).deco.between(0, doc.length, (_f, _t, val) => {
    if (val.widget?.kind === kind) found = val.widget
  })
  return found
}

/** 用桩 view 驱动 toDOM，并按 type 触发 widget 上注册的编辑事件 */
function clickWidget(widget, doc, { type = 'mousedown', from = 0 } = {}) {
  let anchor = null
  let focused = false
  let prevented = false
  let stopped = false
  const view = {
    state: { doc: { length: doc.length } },
    posAtDOM: () => from,
    dispatch: (tr) => { anchor = tr.selection.anchor },
    focus: () => { focused = true },
  }
  const prev = globalThis.document
  globalThis.document = { createElement: (tag) => new El(tag) }
  try {
    const el = widget.toDOM(view)
    el.fire(type, {
      preventDefault: () => { prevented = true },
      stopPropagation: () => { stopped = true },
    })
    return { el, anchor, focused, prevented, stopped }
  } finally {
    globalThis.document = prev
  }
}

describe('HtmlAlignWidget · 正文净化', () => {
  test('渲染同名元素 + textAlign，且 script / 事件属性被白名单剥掉', () => {
    const doc = [
      '<div align="center">',
      '  <p>保留</p>',
      '  <script>alert(1)</script>',
      '  <a href="javascript:alert(1)" onclick="evil()">链接</a>',
      '</div>',
      '',
      '哨兵',
      '',
    ].join('\n')
    const w = widgetOf(doc)
    assert.ok(w, '没造出 html widget（判据失效）')

    const prev = globalThis.document
    globalThis.document = { createElement: (tag) => new El(tag) }
    try {
      const el = w.toDOM()
      assert.equal(el.tagName, 'DIV')
      assert.equal(el.className, 'cm-md-html-align')
      assert.equal(el.style.textAlign, 'center')
      assert.match(el.innerHTML, /保留/)
      assert.doesNotMatch(el.innerHTML, /<script|onclick|javascript:/i,
        '正文没过 sanitizeHtml —— 预览不执行的，编辑器也不能执行')
    } finally {
      globalThis.document = prev
    }
  })
})

describe('渲染块 · 点击进入源码编辑', () => {
  test('HTML 对齐块：单击把选区放进正文首行（widget 随 selectionInside 退回源码）', () => {
    const doc = '<div align="center">\n  <p>保留</p>\n</div>\n\n哨兵\n'
    const w = widgetOf(doc, 'html')
    assert.ok(w, '没造出 html widget（判据失效）')
    const r = clickWidget(w, doc)
    assert.ok(r.anchor > 0 && r.anchor < doc.indexOf('</div>'), `选区没落进块内：${r.anchor}`)
    assert.ok(doc.slice(r.anchor, doc.indexOf('</div>')).includes('<p>保留</p>'), '选区没落在正文首行')
    assert.equal(r.prevented, true, '必须 preventDefault，否则 CM 的默认点击会再抢一次选区')
    assert.equal(r.stopped, true, '必须 stopPropagation，避免事件冒到 CM 的 contentDOM')
    assert.equal(r.focused, true, '派发选区后必须把焦点交还编辑器，否则用户无法继续打字')
  })

  test('公式块：单击把选区放进 `$$` 之间的源码首行', () => {
    const doc = '$$\na^2+b^2=c^2\n$$\n\n哨兵\n'
    const w = widgetOf(doc, 'math')
    assert.ok(w, '没造出 math widget（判据失效）')
    const r = clickWidget(w, doc)
    assert.equal(doc.slice(r.anchor).split('\n')[0], 'a^2+b^2=c^2', '光标没落到公式源码行')
    assert.equal(r.focused, true)
  })

  test('折叠块：单击保留原生展开/收起，双击才进源码编辑', () => {
    const doc = '<details>\n<summary>标题</summary>\n正文\n</details>\n\n哨兵\n'
    const w = widgetOf(doc, 'details')
    assert.ok(w, '没造出 details widget（判据失效）')
    const r = clickWidget(w, doc, { type: 'dblclick' })
    assert.equal(doc.slice(r.anchor).split('\n')[0], '<summary>标题</summary>', '双击没落到折叠块源码')
    assert.equal(r.el.listeners.mousedown, undefined, '单击必须留给原生 <summary>，不能被编辑态抢走')
  })
})

describe('htmlImgSrc · `<img …>` 属性取值', () => {
  test('双引号 / 单引号 / 无引号三种写法都能取到 src 与 alt', () => {
    assert.deepEqual(htmlImgSrc(' src="a.png" alt="图"'), { src: 'a.png', alt: '图' })
    assert.deepEqual(htmlImgSrc(" src='b.png' alt='说明'"), { src: 'b.png', alt: '说明' })
    assert.deepEqual(htmlImgSrc(' src=c.png'), { src: 'c.png', alt: '' })
  })

  test('没有 src 的 img 返回 null（保持源码，不造空图）', () => {
    assert.equal(htmlImgSrc(' alt="只有说明"'), null)
    assert.equal(htmlImgSrc(''), null)
  })

  test('width / height 进入图片 widget（示例里「可控制大小」不能只在预览生效）', () => {
    const doc = '<img src="data:image/svg+xml;base64,AA==" width="200" height="150" alt="logo" />\n\n哨兵\n'
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage }), wysiwygField],
    })
    let w = null
    buildDecorations(state, [{ from: 0, to: doc.length }]).deco.between(0, doc.length, (_f, _t, val) => {
      if (val.widget?.constructor.name === 'ImageWidget') w = val.widget
    })
    assert.ok(w, 'HTML img 没有换成图片 widget')
    assert.equal(w.width, 200)
    assert.equal(w.height, 150)
  })
})
