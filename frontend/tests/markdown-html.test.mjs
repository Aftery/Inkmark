/**
 * markdown-html.test.mjs — 原始 HTML 白名单渲染的安全与能力契约（2026-10-25 新增）
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/markdown/html.js（sanitizeHtml / installHtmlSanitizer /
 * ALLOWED_TAGS / EDITOR_TAG_CLASS / EDITOR_BLOCK_TAGS）+ preview/markdown.js 的
 * `html: true` 接线。
 *
 * 【为什么这组必须是机检】这条改动把 `html: false` 换成了 `html: true`，是
 * 本轮唯一一个「放开面」的改动，它同时带来两类失败，且**都不报错**：
 *
 *   能力侧：白名单一旦漏掉某个标签，用户写 `<kbd>` / `<details>` / `<mark>`
 *     会被静默转义成字面尖括号 —— 正是「HTML 标签不支持」那条真机反馈的复现。
 *     这类失败没有异常、控制台干净，只能逐条断言。
 *
 *   安全侧：这是桌面应用，webview 里有 wails 绑定。风险不是「别人的网页」，
 *     而是「打开一份别人给的 .md」。`<img onerror=…>` / `javascript:` /
 *     `style="background-image:url(…)"` 任意一条漏掉，都是「打开文档即执行」。
 *     危害不在当次渲染，而在**它平时是静默的**：不点到那份文档永远看不见。
 *
 *   【2026-10-25 追加最易回归的一处】任务列表勾选框。GFM 勾选框由
 *   markdown-it-task-lists 以 html_inline token 注入（`<label><input …></label>`），
 *   一旦 html:true，这些 token 也会走白名单。白名单若不认 input/label，勾选框
 *   会被整体转义成文本 —— 任务列表退化成「一堆字面尖括号」，且**零报错**。
 *   （该处由 Lead 按「插件产物」特批放行，故本文件用 `<input type="password">`
 *   这类真·用户输入作反例，而不是拿勾选框本身当反例。）
 *
 * 判据来源（不拿实现输出当期望）：
 *   - 正例集合来自用户真机反馈点名的语法（HTML 标签 / 折叠块 / 行内样式），
 *     见 frontend/src/markdown/html.js 头注的「肌肉记忆」清单。
 *   - 安全反例集合来自 OWASP 的注入载体分类（事件处理器 / 危险协议 / 危险
 *     CSS 函数 / 危险容器标签），不是「随手试几个」。
 *   - style 白名单与「数值属性必须纯数字」来自 html.js 的 STYLE_PROPS /
 *     TAG_ATTRS 声明。
 *
 * 全部走**真实渲染**（import 真实 createRenderer），不拿源码正则假装验证。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, render } from '../src/preview/markdown.js'
import {
  sanitizeHtml,
  ALLOWED_TAGS,
  EDITOR_TAG_CLASS,
  EDITOR_BLOCK_TAGS,
} from '../src/markdown/html.js'

const md = createRenderer()

describe('白名单正例 · 用户点名要的 HTML 语法必须真的渲染', () => {
  test('`<kbd>` / `<mark>` / `<sup>` / `<sub>` / `<small>` 保留为真标签', () => {
    const html = render(md, '按 <kbd>Ctrl</kbd> 记住 <mark>重点</mark> 与 x<sup>2</sup> y<sub>1</sub> 及 <small>小字</small>')
    for (const tag of ['kbd', 'mark', 'sup', 'sub', 'small']) {
      assert.match(html, new RegExp(`<${tag}>`), `${tag} 被转义成了文本（「HTML 标签不支持」复现）`)
      assert.ok(!html.includes(`&lt;${tag}&gt;`), `${tag} 仍以字面尖括号出现`)
    }
  })

  test('`<span style="color: …">`：颜色这种「视觉微调」样式保留', () => {
    const html = render(md, '<span style="color: red">红字</span>')
    assert.match(html, /<span style="color: red">红字<\/span>/, '白名单内的 style 属性被丢弃')
  })

  test('`<abbr title>`：title 属性保留（悬停释义是它的全部意义）', () => {
    const html = render(md, '<abbr title="HyperText Markup Language">HTML</abbr>')
    assert.match(html, /<abbr title="HyperText Markup Language">/)
  })

  test('`<p align="center">` + 内嵌 `<img width>`：对齐与尺寸都要保留', () => {
    const html = render(md, '<p align="center"><img src="pic.png" width="480" alt="图"></p>')
    assert.match(html, /<p align="center">/, 'p 的 align 被丢弃（用户说的「居中不生效」）')
    assert.match(html, /<img[^>]*width="480"/, 'img 的 width 被丢弃')
    assert.match(html, /alt="图"/, 'img 的 alt 被丢弃')
  })

  test('`<details><summary>`：折叠块整块直通（不是转义后的文本）', () => {
    const html = render(md, '<details>\n<summary>点开看</summary>\n\n折叠内容\n\n</details>\n')
    assert.match(html, /<details>/, 'details 被转义 —— 折叠块直接失效')
    assert.match(html, /<summary>点开看<\/summary>/)
    assert.match(html, /<p>折叠内容<\/p>/, '折叠块正文未被渲染')
    assert.ok(!html.includes('&lt;details'), 'details 仍以字面尖括号出现')
  })

  test('`<details open>`：布尔属性 open 保留（展开态是作者意图）', () => {
    const html = render(md, '<details open><summary>x</summary>y</details>\n')
    assert.match(html, /<details open>/, 'open 布尔属性被丢弃，折叠块默认收起')
  })

  test('`<a href>` 三种合法目标都保留：https / mailto / 站内锚点', () => {
    assert.match(render(md, '<a href="https://example.com">外链</a>'), /<a href="https:\/\/example\.com">/)
    assert.match(render(md, '<a href="mailto:a@b.co">邮件</a>'), /<a href="mailto:a@b\.co">/)
    assert.match(render(md, '<a href="#sec">锚点</a>'), /<a href="#sec">/)
  })

  test('普通 Markdown 语法不受净化影响（表格 / 标题 / 代码块仍在）', () => {
    const html = render(md, '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n# 标题\n')
    assert.match(html, /<table>/)
    assert.match(html, /<h1 id="标题">/)
  })
})

describe('安全反例 · 逐条注入载体必须被拒绝', () => {
  test('`<script>` 连内容整段删除（含转义文本都不留）', () => {
    const html = render(md, '<script>alert(1)</script>\n\n正文\n')
    assert.ok(!/<script/i.test(html), 'script 标签存活')
    assert.ok(!html.includes('alert(1)'), 'script 内容仍以文本形式残留')
    assert.match(html, /正文/, '相邻正文被连带删除（净化范围过大）')
  })

  test('`<img onerror>`：标签保留但事件处理器属性被剥掉', () => {
    const html = render(md, '<img src=x onerror=alert(1)>\n')
    assert.match(html, /<img src="x">/, '白名单内的 img 应保留并按白名单重建')
    assert.ok(!/onerror/i.test(html), '事件处理器属性必须被丢弃')
    assert.ok(!html.includes('alert(1)'), '事件处理器表达式残留')
  })

  test('`javascript:` 协议：href 整条剥掉，不留可点击载体', () => {
    const html = render(md, '<a href="javascript:alert(1)">x</a>\n')
    assert.ok(!/javascript:/i.test(html), 'javascript: 协议存活')
    assert.ok(!/href=/i.test(html), 'href 属性应被整条丢弃（而不是改成空值）')
    assert.match(html, /<a>x<\/a>/, 'a 标签本身应保留（文字不该消失）')
  })

  test('`java\\tscript:`（控制字符绕过）：同样被拒', () => {
    // 经典绕过：把 tab 塞进协议名中间，浏览器解析时仍会拼成 javascript:
    const html = render(md, '<a href="java\tscript:alert(1)">x</a>\n')
    assert.ok(!/javascript:/i.test(html), '控制字符绕过未被处理')
    assert.ok(!/href=/i.test(html), '控制字符版本的 href 仍在')
  })

  test('`vbscript:` / `file:` 协议一律不放行', () => {
    for (const proto of ['vbscript:msgbox(1)', 'file:///etc/passwd']) {
      const html = render(md, `<a href="${proto}">x</a>\n`)
      assert.ok(!/href=/i.test(html), `${proto} 的 href 未被剥离`)
    }
  })

  test('`style="background-image:url(…)"`：能引外部资源的样式被整条丢弃', () => {
    const html = render(md, '<span style="background-image:url(http://evil/x.png)">x</span>\n')
    assert.ok(!/url\(/i.test(html), 'url() 仍在 style 里（可外发请求 / 探测）')
    assert.ok(!/background-image/i.test(html), 'background-image 声明存活')
    assert.match(html, /<span>x<\/span>/, 'span 本身应保留')
  })

  test('`style="color:expression(…)"`（老 IE 执行载体）被丢弃', () => {
    const html = render(md, '<span style="color:expression(alert(1))">x</span>\n')
    assert.ok(!/expression\(/i.test(html), 'expression() 存活')
    assert.ok(!html.includes('alert(1)'), 'expression 载荷残留')
  })

  test('style 里的合法属性保留、非法属性丢弃（逐条混合场景）', () => {
    const out = sanitizeHtml('<span style="color: red; background-image: url(http://x/y.png)">a</span>')
    assert.match(out, /style="color: red"/, '合法 color 声明应保留')
    assert.ok(!/url\(/i.test(out), '非法声明应被逐条剔除而不是整条 style 失效')
  })

  test('`<iframe>` / `<script>` 块级整段删除：容器与内容都不留', () => {
    // 块位置（独占一行）时整段是**一个** html_block token，净化器的「危险容器
    // 连同内容删除」正则能成对命中 —— 内容连转义文本都不留（容器里的文本也不该留下）。
    for (const tag of ['iframe', 'script', 'style']) {
      const html = render(md, `<${tag} src="http://evil">载荷</${tag}>\n\n正文\n`)
      assert.ok(!new RegExp(`<${tag}`, 'i').test(html), `${tag} 标签存活`)
      assert.ok(!html.includes('载荷'), `${tag} 的内容仍在（危险容器的文本也不该以任何形式留下）`)
      assert.match(html, /正文/, '相邻正文被连带删除（净化范围过大）')
    }
  })

  test('`<object>` / `<embed>` / `<template>` / `<noscript>`：块级同样整段删除', () => {
    for (const tag of ['object', 'embed', 'template', 'noscript']) {
      const html = render(md, `<${tag} src="http://evil">载荷</${tag}>\n\n正文\n`)
      assert.ok(!new RegExp(`<${tag}[\\s>]`, 'i').test(html), `${tag} 标签存活`)
      assert.match(html, /正文/)
    }
  })

  test('行内形态的危险容器：连内容一起干净删除（零残余）', () => {
    // 【2026-10-25 Lead 裁决后的加强版契约】上一版只锁「安全侧」，因为当时
    // markdown-it 把**行内**的开闭标签拆成两个 html_inline token，「成对删除」
    // 的正则跨不了 token —— 开标签被删、内容退化成文本、闭标签转义成可见的
    // `&lt;/iframe&gt;`。安全性质成立，但界面上一段尖括号残渣会被用户当成
    // 「HTML 又没支持」的第 N 次反馈。
    // 修法：markdown/html.js 的 stripDangerousRuns 在 core 阶段按 depth 整段丢弃
    // inline children。本用例连「残余」一起锁死 —— 一旦有人把那步改回逐 token
    // 正则，`&lt;/` 会立刻出现并让这条报红。
    for (const tag of ['iframe', 'object', 'embed', 'script', 'style', 'noscript', 'template']) {
      const html = render(md, `前 <${tag} src="javascript:alert(1)">载荷</${tag}> 后`)
      assert.ok(!new RegExp(`<${tag}[\\s>]`, 'i').test(html), `行内 ${tag} 产出了活标签`)
      assert.ok(!html.includes('javascript:'), `行内 ${tag} 的协议载荷仍可点击/可执行`)
      assert.ok(!/&lt;\//.test(html), `行内 ${tag} 残留了转义的闭标签：${html}`)
      assert.match(html, /前\s*后/, `行内 ${tag} 的内容未被删除：${html}`)
    }
    // 嵌套 / 孤立闭标签也不能漏出来（depth 计数而非「丢到第一个闭标签」）
    assert.doesNotMatch(render(md, 'a <iframe>x<iframe>y</iframe>z</iframe> b'), /&lt;\//)
    assert.doesNotMatch(render(md, '前 </iframe> 后'), /&lt;\//)
    // 相邻正文不许被连带吞掉
    assert.match(render(md, '前 <iframe>x</iframe> 后'), /前\s*后/)
  })

  test('未知标签退化为文本（用户至少看得到自己写了什么，不是静默消失）', () => {
    const html = render(md, '<blink>x</blink>\n')
    assert.match(html, /&lt;blink&gt;/, '未知标签应转义成文本')
    assert.match(html, /&lt;\/blink&gt;/, '未知标签的闭合标签也应转义')
  })

  test('`<input type="password">`：非勾选框的 input 不许摆出可输入控件', () => {
    const out = sanitizeHtml('<input type="password" name="p">')
    assert.ok(!/type="password"/i.test(out), 'password 类型的 input 属性存活（假登录框）')
    assert.ok(!/name="p"/i.test(out), 'name 属性存活')
  })

  test('`<label class="task-list-item-label">` 之外的 label class 被丢弃', () => {
    const out = sanitizeHtml('<label class="evil" for="x">y</label>')
    assert.ok(!/class="evil"/i.test(out), '非任务列表的 label class 存活')
  })
})

describe('任务列表勾选框 · html:true 后最容易静默回归的一处', () => {
  test('GFM 勾选框必须存活且带空格（没有被白名单转义成文本）', () => {
    const html = render(md, '- [ ] 买牛奶\n- [x] 写周报\n')
    assert.match(html, /<input class="task-list-item-checkbox" type="checkbox">/, '未勾选项缺失或被转义')
    assert.match(html, /<input class="task-list-item-checkbox" checked="" type="checkbox">/, '已勾选项缺失或被转义')
    assert.ok(!html.includes('&lt;input'), '勾选框被转义成字面文本 —— 任务列表退化成尖括号')
    assert.ok(!html.includes('&lt;label'), 'label 被转义成字面文本')
    assert.match(html, /<label><input [^>]*> ?买牛奶<\/label>/, 'label 包裹结构被破坏')
  })

  test('勾选框形态经 sanitizeHtml 直接放行（插件产物特批路径）', () => {
    const out = sanitizeHtml('<label class="task-list-item-label"><input class="task-list-item-checkbox" checked="" type="checkbox"> 项</label>')
    assert.match(out, /<input class="task-list-item-checkbox" checked="" type="checkbox">/)
    assert.match(out, /<label class="task-list-item-label">/)
  })

  test('缺空格的畸形形态会被补齐（installHtmlSanitizer 的定点修补）', () => {
    // markdown-it-task-lists 的已知缺陷：class 与 type 之间没有空格。
    // html.js 的 clean() 对该 marker 走「补空格 + 原样放行」分支。
    const out = sanitizeHtml('<input class="task-list-item-checkbox"type="checkbox">')
    assert.match(out, /class="task-list-item-checkbox" type="checkbox"/, '缺空格未被修补')
    assert.ok(!/class="task-list-item-checkbox"type=/.test(out), '畸形形态仍然存在')
  })
})

describe('两侧同源清单 · 编辑器与渲染器不得各写一份', () => {
  test('ALLOWED_TAGS 覆盖编辑器 EDITOR_TAG_CLASS 的每一个标签', () => {
    const missing = Object.keys(EDITOR_TAG_CLASS).filter((tag) => !ALLOWED_TAGS.has(tag))
    assert.deepEqual(
      missing,
      [],
      '编辑器认识的标签不在渲染器白名单里 —— 同一份文档两处表现不同（编辑器渲染、导出转义）'
    )
  })

  test('EDITOR_BLOCK_TAGS 是 ALLOWED_TAGS 的子集', () => {
    const extra = [...EDITOR_BLOCK_TAGS].filter((tag) => !ALLOWED_TAGS.has(tag))
    assert.deepEqual(extra, [], `块级标签清单里有未放行的标签：${extra.join(', ')}`)
  })

  test('清单规模自检（防清单被清空导致上面两条假通过）', () => {
    assert.ok(ALLOWED_TAGS.size >= 40, `ALLOWED_TAGS 只剩 ${ALLOWED_TAGS.size} 项，清单可能被误删`)
    assert.ok(Object.keys(EDITOR_TAG_CLASS).length >= 15, 'EDITOR_TAG_CLASS 项数异常')
    assert.ok(EDITOR_BLOCK_TAGS.size >= 3, 'EDITOR_BLOCK_TAGS 项数异常')
    // 用户点名要的标签必须一个不少
    for (const tag of ['kbd', 'mark', 'sup', 'sub', 'small', 'abbr', 'details', 'summary', 'p', 'a']) {
      assert.ok(ALLOWED_TAGS.has(tag), `白名单漏了用户点名的标签：${tag}`)
    }
  })

  test('EDITOR_TAG_CLASS 的值全部是 cm-md- 前缀的语义类名（样式单一出处）', () => {
    for (const [tag, cls] of Object.entries(EDITOR_TAG_CLASS)) {
      assert.match(cls, /^cm-md-/, `${tag} 的编辑器类名 ${cls} 不符合 cm-md-* 约定`)
    }
  })
})
