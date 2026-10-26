/**
 * preview-markdown.test.mjs — 预览渲染器的行为契约（2026-10-14 新增）
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/preview/markdown.js（createRenderer / render）——
 * 预览区、导出 HTML/PDF、复制选区为 HTML 三者共用的同一个渲染器。
 *
 * 为什么必须机检：本轮修的两个缺陷都**不抛异常**：
 *   1) markdown-it-task-lists 在 enabled:true 时输出缺空格的畸形 HTML
 *      `<input class="task-list-item-checkbox"type="checkbox">`。浏览器按
 *      HTML5 规范能容错解析（Chrome 实测渲染正常），但这是「依赖容错」——
 *      换 stricter 的解析器 / 将来接净化器就会静默丢掉 type 属性。
 *   2) 阅读态已于 2026-10-14 整体移除（渲染收敛进编辑器内的表格真渲染），
 *      预览渲染器只剩导出 HTML/PDF 与复制为 HTML 两个消费方 —— 对错在这里
 *      用真实渲染断言。
 *
 * 全部走**真实渲染**（import 真实 createRenderer），不拿源码正则假装验证。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, render } from '../src/preview/markdown.js'

describe('GFM 任务列表 · 勾选框 HTML', () => {
  test('未勾选 / 已勾选都输出**带空格**的合法 input（畸形 HTML 不流出渲染器）', () => {
    const html = render(createRenderer(), '- [ ] 买牛奶\n- [x] 写周报\n')
    assert.match(html, /<input class="task-list-item-checkbox" type="checkbox">/, '未勾选项缺空格')
    assert.match(html, /<input class="task-list-item-checkbox" checked="" type="checkbox">/, '已勾选项缺空格')
    // 决定性断言：畸形形态一个都不许剩
    assert.ok(!/class="task-list-item-checkbox"type=/.test(html), '仍存在缺空格的 type 属性')
    assert.ok(!/checked=""type=/.test(html), '仍存在缺空格的 checked 属性')
  })

  test('label 包裹保持（markdown-it-task-lists 的 label:true 行为不被破坏）', () => {
    const html = render(createRenderer(), '- [ ] 买牛奶\n')
    assert.match(html, /<label><input [^>]*> 买牛奶<\/label>/)
  })

  test('普通列表不受影响（html_inline 覆写只碰任务勾选框那一处形态）', () => {
    const html = render(createRenderer(), '- 普通项\n')
    assert.ok(!/input/.test(html), '普通列表不该出现 input')
    assert.match(html, /<li>普通项<\/li>/)
  })
})

describe('渲染器回归（覆写 html_inline 不许动其它规则）', () => {
  const md = createRenderer()

  test('合法表格照旧渲染成 <table>（预览 / 导出的同一渲染器）', () => {
    const html = render(md, '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n')
    assert.match(html, /<table>/)
    assert.match(html, /<th>名称<\/th>/)
    assert.match(html, /<td>苹果<\/td>/)
  })

  test('标题仍写 id 锚点（heading_open 覆写与 html_inline 覆写互不干扰）', () => {
    const html = render(md, '# 使用指南\n')
    assert.match(html, /<h1 id="使用指南">/)
  })

  test('重复标题的去重 id 每次渲染都重置（-1 / -2 后缀稳定）', () => {
    const html = render(md, '# 章节\n\n# 章节\n')
    assert.match(html, /id="章节"/)
    assert.match(html, /id="章节-1"/)
  })

  test('原始 HTML 走白名单净化：危险属性被剥掉，不认识的事件处理器不进 DOM', () => {
    // 【2026-10-25 契约变更】原文断言的是「html:false ⇒ 一切原始 HTML 被转义」。
    // 用户真机反馈「HTML 标签不支持」（<kbd> / <mark> / <details> 全显示成源码），
    // 故渲染器改为 html:true + 白名单重建（frontend/src/markdown/html.js）。
    // 判据随之改变：不再是「不许出现 <img」，而是「危险的属性与协议不许存活」——
    // 这比原判据更贴近真实风险（原判据只能守住「全部关掉」这一种做法）。
    const html = render(md, '<img src=x onerror=alert(1)>\n')
    assert.match(html, /<img src="x">/, '白名单内的 img 应保留，但属性需按白名单重建')
    assert.ok(!/onerror/i.test(html), '事件处理器属性必须被丢弃')
    // script / iframe 这类容器整段删除（含内容），连转义文本都不留
    assert.ok(!/<script/i.test(render(md, '<script>alert(1)</script>\n')))
    // javascript: 协议被剥成无 href 的 <a>
    assert.ok(!/javascript:/i.test(render(md, '<a href="javascript:alert(1)">x</a>\n')))
    // 不认识的标签退化为文本（用户至少看得到自己写了什么，不是静默消失）
    assert.match(render(md, '<blink>x</blink>\n'), /&lt;blink&gt;/)
  })

  test('代码块仍走高亮（highlight 规则不受影响）', () => {
    const html = render(md, '```js\nconst a = 1\n```\n')
    assert.match(html, /<pre><code class="language-js">/)
    assert.match(html, /hljs-keyword/)
  })
})
