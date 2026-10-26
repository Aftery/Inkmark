/**
 * markdown-extras.test.mjs — 扩展语法（嵌套引用 / 折叠块 / 脚注 / emoji / 导出副本）契约
 * ---------------------------------------------------------------------------
 * 被测对象：
 *   · frontend/src/preview/markdown.js —— 四个插件的接线顺序与产物
 *   · frontend/src/markdown/footnote.js —— 定制 ref / block_open / anchor 三条规则
 *   · frontend/src/markdown/emoji.js —— bare（只认 `:code:`）与 full 表
 *   · frontend/src/i18n/*.js —— 脚注文案四个 key（三种语言）
 *   · frontend/src/export/exporters.js ↔ frontend/src/themes/markdown-extras.css
 *     —— 两份**自包含副本**的关键选择器比对
 *
 * 【为什么这组必须是机检】全都「不报错，只是少了一块」：
 *   1) 嵌套引用：markdown-it 本身会正确产出三层 <blockquote>，但本仓曾只有一层
 *      底色 ⇒ 屏幕上一模一样，用户看到的是「一级二级三级引用渲染不对」。
 *      结构对、层次看不出来 —— 缺的是**样式**，而样式漏改不报错。
 *   2) 脚注：默认产物有三处与本仓规格冲突（裸 <hr> 分割线、↩ 回跳图标落在
 *      P0-1 零 emoji 扫描区间、标题不输出）。三条都被定制过，任何一条退回默认
 *      形态都不报错，只是排版退化 / 门禁违规。
 *   3) emoji：`full` 表自带 emoticon 快捷表（`:)` `8-)` 等纯标点序列），在中文
 *      技术文档里误伤率极高 —— `价格 8) 结束` 被改成「价格 + 表情 + 结束」，
 *      用户根本没写表情。我们用的是 `bare`（只认 `:code:`），这是本次实现契约，
 *      一旦有人「顺手换回 full」就静默回归。
 *   4) 导出副本：exporters.js 里的 CSS 是自包含副本（导出产物要脱离应用独立可看，
 *      不能 @import 应用样式）。两处规则**最容易改一边忘另一边** —— 而用户看到
 *      的只是「导出后折叠块/脚注/公式跟应用里长得不一样」，没人会报 bug。
 *
 * 判据来源（不拿实现输出当期望）：
 *   - 三层嵌套的结构来自 Markdown 引用语法的领域定义。
 *   - 脚注文案来自 i18n 字典的 key（`footnote.title/ref/back/backText`），
 *     文案走 t()，故断言的是「key 存在 + 渲染结果包含该语言的译文」。
 *   - emoji 的 bare/full 差异来自 markdown-it-emoji 的公开行为与本文件头注。
 *   - CSS 选择器清单来自 markdown-extras.css 的段落标题（嵌套引用 / 折叠块 /
 *     行内 HTML / 脚注 / 公式），属于「两边都必须有」的最小集。
 *
 * 全部走**真实渲染**；CSS 比对读两份真实文件文本（UTF-8，用 node:fs 读 ——
 * 本仓 shell grep 在 UTF-8 上会静默返回空，栽过多次假绿灯）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createRenderer, render } from '../src/preview/markdown.js'
import { initI18n, setLocale, t } from '../src/i18n/index.js'
import { emojiFor, EMOJI_LOOKUP } from '../src/markdown/emoji.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const readSrc = (...p) => readFileSync(join(SRC, ...p), 'utf8')

// i18n 的当前语言是模块级 ref，必须先 initI18n 才有确定的基准语言。
// 只装一次；各用例用 setLocale 切语言并在 finally 里切回 zh-CN（避免串味）。
initI18n()
const md = createRenderer()

describe('嵌套引用 · 三层结构必须真的有层级', () => {
  test('`>` / `>>` / `>>>` 产出三层嵌套 <blockquote>（不是三个并列块）', () => {
    const html = render(md, '> 一层\n>\n> > 二层\n> >\n> > > 三层\n')
    // 结构判据：三层 blockquote 依次为祖先关系（开标签顺序 1→2→3，闭标签逆序）
    assert.match(
      html,
      /<blockquote>\s*<p>一层<\/p>\s*<blockquote>\s*<p>二层<\/p>\s*<blockquote>\s*<p>三层<\/p>\s*<\/blockquote>\s*<\/blockquote>\s*<\/blockquote>/,
      '三层引用未形成嵌套结构（用户反馈的「嵌套引用没层级」）'
    )
    assert.equal((html.match(/<blockquote>/g) || []).length, 3, 'blockquote 数量不对')
    assert.equal((html.match(/<\/blockquote>/g) || []).length, 3, '闭合标签数量不对')
  })

  test('单层引用仍是一层（防「为了嵌套把层级整体多套一层」）', () => {
    const html = render(md, '> 只有一层\n')
    assert.equal((html.match(/<blockquote>/g) || []).length, 1)
    assert.match(html, /<blockquote>\s*<p>只有一层<\/p>\s*<\/blockquote>/)
  })

  test('引用块内的其它语法照旧渲染（引用不吞掉列表 / 代码）', () => {
    const html = render(md, '> - 项一\n> - 项二\n')
    assert.match(html, /<blockquote>[\s\S]*<li>项一<\/li>/)
  })
})

describe('折叠块 <details> · 直通与展开语义', () => {
  test('块级 `<details><summary>` 原样直通（含正文段落）', () => {
    const html = render(md, '<details>\n<summary>点开看</summary>\n\n折叠内容\n\n</details>\n')
    assert.match(html, /<details>/)
    assert.match(html, /<summary>点开看<\/summary>/)
    assert.match(html, /<p>折叠内容<\/p>/)
  })

  test('`<details>` 里可以写 Markdown（围栏代码 / 列表都在折叠体内渲染）', () => {
    const html = render(md, '<details>\n<summary>代码</summary>\n\n```js\nconst a = 1\n```\n\n</details>\n')
    assert.match(html, /<details>[\s\S]*<pre><code class="language-js">/)
    assert.match(html, /<\/details>/)
  })
})

describe('脚注 · ref / 尾部区块 / 回跳文案', () => {
  test('上标引用带上标类、锚点、role 与 aria-label（三语言共用同一结构）', () => {
    const html = render(md, '正文[^1]\n\n[^1]: 脚注内容\n')
    assert.match(html, /<sup class="footnote-ref">/, '缺少 footnote-ref 上标')
    assert.match(html, /<a href="#fn1" id="fnref1"/, '锚点缺失（点了跳不过去）')
    assert.match(html, /role="doc-noteref"/, '缺少 doc-noteref 角色')
    assert.match(html, /aria-label="[^"]+"/, '缺少 aria-label（屏幕阅读器会把编号读成数字）')
  })

  test('尾部区块：有 <section class="footnotes"> + 可读小标题，且**没有**裸 <hr> 分割线', () => {
    const html = render(md, '正文[^1]\n\n[^1]: 脚注内容\n')
    assert.match(html, /<section class="footnotes">/, '缺少脚注尾部区块')
    assert.match(html, /<h2 class="footnotes-title">/, '缺少脚注小标题（默认产物不输出标题，属静默信息缺失）')
    assert.match(html, /<ol class="footnotes-list">/)
    // 默认产物是 <hr class="footnotes-sep"> —— 与本仓「不用装饰线分层」的视觉规格相悖
    assert.ok(!html.includes('footnotes-sep'), '裸分割线又回来了（默认产物未替换）')
  })

  test('回跳链接用语义化文本，不用字符图标（P0-1 也不允许）', () => {
    const html = render(md, '正文[^1]\n\n[^1]: 脚注内容\n')
    assert.match(html, /class="footnote-backref"/)
    assert.match(html, /aria-label="[^"]+"/, '回跳缺少 aria-label')
    // 默认实现的回跳是「左弯箭头 + 变体选择符」（U+21A9 U+FE0E），落在零 emoji 扫描区间
    assert.ok(!html.includes('\u21a9'), '回跳退回了箭头字符（功能图标禁字符化）')
    assert.ok(!html.includes('\ufe0e'), '产物里出现了变体选择符（P0-1 扫描区间）')
  })

  test('多条引用同一脚注：subId 锚点不重复（否则回跳会跳错位置）', () => {
    const html = render(md, 'A[^1] 与 B[^1]\n\n[^1]: 唯一一条\n')
    const refs = [...html.matchAll(/id="(fnref[^"]+)"/g)].map((m) => m[1])
    assert.equal(refs.length, 2, '两次引用应产出两个 ref 锚点')
    assert.notEqual(refs[0], refs[1], '重复引用的 ref id 撞了（回跳会落在同一处）')
  })

  test('命名脚注与编号脚注共存（编号按出现顺序）', () => {
    const html = render(md, 'A[^1] B[^note]\n\n[^1]: 第一条\n[^note]: 命名那条\n')
    assert.match(html, /<li id="fn1" class="footnote-item">/)
    assert.match(html, /<li id="fn2" class="footnote-item">/)
    assert.match(html, /命名那条/)
  })

  test('脚注文案走 t()：三种语言的四个 key 都存在且译文不同', () => {
    const keys = ['footnote.title', 'footnote.ref', 'footnote.back', 'footnote.backText']
    const seen = new Map()
    try {
      for (const loc of ['zh-CN', 'en-US', 'ja-JP']) {
        setLocale(loc)
        for (const key of keys) {
          const v = t(key, { n: 1 })
          assert.equal(typeof v, 'string', `${loc} 的 ${key} 不是字符串`)
          assert.ok(v.length > 0, `${loc} 的 ${key} 是空串`)
          // t() 缺 key 时返回 key 原文（不抛错、不返回空串）—— 用这条识别缺 key
          assert.notEqual(v, key, `${loc} 缺 key ${key}（运行时会把 key 原文显示给用户）`)
          // 占位符必须被真的替换（没替换 = 占位符名拼错，界面露出 {n}）
          if (key !== 'footnote.title' && key !== 'footnote.backText') {
            assert.ok(!v.includes('{n}'), `${loc} 的 ${key} 占位符 {n} 未被替换: ${v}`)
          }
        }
        seen.set(loc, t('footnote.title'))
      }
    } finally {
      setLocale('zh-CN')
    }
    assert.notEqual(seen.get('en-US'), seen.get('zh-CN'), 'en-US 与 zh-CN 的脚注标题相同（可能没翻译）')
    // zh-CN 与 ja-JP 的标题都写作「脚注」是既有产品决定，故只断言 en 与它们不同
    assert.notEqual(seen.get('en-US'), seen.get('ja-JP'), 'en-US 与 ja-JP 的脚注标题相同')
  })

  test('渲染结果包含当前语言的译文（文案真的接到了渲染器上）', () => {
    try {
      setLocale('en-US')
      const html = render(md, 'x[^1]\n\n[^1]: note\n')
      assert.match(html, /<h2 class="footnotes-title">Footnotes<\/h2>/, 'en-US 下脚注标题未走 t()')
      assert.ok(html.includes(t('footnote.backText')), 'en-US 下回跳文案未走 t()')
      assert.match(html, /aria-label="Footnote 1"/, 'en-US 下 ref 的 aria-label 未走 t()')
    } finally {
      setLocale('zh-CN')
    }
    const zh = render(md, 'x[^1]\n\n[^1]: note\n')
    assert.match(zh, /<h2 class="footnotes-title">脚注<\/h2>/, 'zh-CN 下脚注标题未走 t()')
  })
})

describe('emoji 短码 · bare（只认 :code:）', () => {
  test('`:smile:` 渲染成对应表情字符（映射与 LOOKUP 一致，不写死码位）', () => {
    const html = render(md, ':smile:')
    const expected = EMOJI_LOOKUP.smile
    assert.ok(expected, 'EMOJI_LOOKUP 里没有 smile —— 短码表可能没加载成功')
    assert.ok(html.includes(expected), ':smile: 未渲染成对应字符')
    assert.ok(!html.includes(':smile:'), '源码短码仍以文本残留')
  })

  test('`:white_check_mark:`（GitHub 别名，bare + full 表的覆盖力）', () => {
    const html = render(md, ':white_check_mark:')
    assert.ok(html.includes(EMOJI_LOOKUP.white_check_mark), ':white_check_mark: 未渲染')
  })

  test('`emojiFor()` 与渲染器同源：命中返回字符、未命中返回 null', () => {
    assert.equal(emojiFor(':smile:'), EMOJI_LOOKUP.smile)
    assert.equal(emojiFor('smile'), EMOJI_LOOKUP.smile, '不带冒号的形式也应命中')
    assert.equal(emojiFor(':not_real:'), null, '未知短码必须返回 null（保持文本）')
    assert.equal(emojiFor(''), null)
    assert.ok(Object.keys(EMOJI_LOOKUP).length > 1000, '短码表规模异常（应含 GitHub 全量别名）')
  })

  test('`:not_real:` 保持文本（与 GitHub 一致：不认识的短码不该被吞）', () => {
    const html = render(md, '这里 :not_real: 保持原样')
    assert.match(html, /:not_real:/, '未知短码被吞掉了')
  })

  test('**反例**：`价格 8) 结束` 不许被改成表情（bare 与 full 的分界线）', () => {
    // full 表里 `8-)` 映射到「戴墨镜的脸」，`:)` `;)` `:D` 同理。
    // 中文技术文档里 `8)` 是极常见的序号写法，误伤率极高 —— 这是本轮实现契约。
    for (const src of ['价格 8) 结束', '价格 8-) 结束', '温度 :) 正常', '备注 ;) 完', 'A :D B']) {
      const html = render(md, src)
      assert.match(
        html,
        /8\)|8-\)|:\)|;\)|:D/,
        `${JSON.stringify(src)} 里的纯标点序列被替换成了表情（应保持文本）`
      )
      // 决定性断言：产物里不许出现任何表情字符
      assert.ok(
        !/[\u{1F300}-\u{1FAFF}]/u.test(html),
        `${JSON.stringify(src)} 渲染出了表情字符 —— emoticon 快捷表被误启用（应用 bare，不是 full）`
      )
    }
  })

  test('**反例**：未命中的短码在句子里保持文本（不被「就近替换」）', () => {
    const html = render(md, '开头 :smile: 中间 :not_an_emoji_at_all: 结尾')
    assert.ok(html.includes(EMOJI_LOOKUP.smile), '命中的短码应替换')
    assert.ok(html.includes(':not_an_emoji_at_all:'), '未命中的短码应保持文本')
  })
})

describe('导出副本 ↔ 应用样式 · 关键选择器两边都必须在', () => {
  // 两份文件都是**自包含副本**：themes/markdown-extras.css 给应用内，
  // exporters.js 的 exportCss 给导出产物（不能 @import，产物要能独立打开）。
  // 逐条断言最小集 —— 缺一条就是「导出后某一类扩展语法失去排版」。
  const extrasCss = readSrc('themes', 'markdown-extras.css')
  const exportersJs = readSrc('export', 'exporters.js')

  /**
   * 【为什么必须真的解析规则、而不是 `text.includes('kbd{')`】
   * 第一版就是这么写的，变异自证当场抓到一个**假绿灯**：
   * 把导出副本里的三层规则 `blockquote blockquote blockquote{…}` 整行删掉后，
   * 断言仍然通过 —— 因为文件里还有四层规则
   * `blockquote blockquote blockquote blockquote{…}`，
   * 而 `'blockquote blockquote blockquote{'` 是它的**前缀子串**。
   * 这类失败模式极隐蔽：守卫看起来在检查层级，实际只检查了「有没有以它开头的串」。
   *
   * 故改为「解析出规则的选择器集合，再按**完整选择器**比对」：
   *   · 去掉注释（注释里出现的 `details{` 之类不该算数）；
   *   · 按 `{` 切出选择器段，逐条 trim 并把内部空白压成单空格；
   *   · `a, b` 这种逗号列表拆成两条独立选择器。
   * 这样 `blockquote blockquote blockquote` 与 `… blockquote blockquote` 是两条
   * 不同条目，删掉前者必定缺失，不会再被后者顶替。
   */
  function parseSelectors(cssText) {
    const noComment = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const set = new Set()
    for (const m of noComment.matchAll(/([^{}]+)\{/g)) {
      const prelude = m[1].trim()
      // @media / @supports 这类 at-rule 的前导不是选择器，跳过
      if (!prelude || prelude.startsWith('@')) continue
      for (const one of prelude.split(',')) {
        // 应用内样式表带 .preview-body 作用域前缀（限定正文区），导出模板的
        // <article> 本身就是预览容器故不需要 —— 去掉前缀才能逐条比对。
        const sel = one.trim().replace(/^\.preview-body\s*/, '').replace(/\s+/g, ' ')
        if (sel) set.add(sel)
      }
    }
    return set
  }

  /**
   * 选择器 → 声明块正文（同样去注释、去 `.preview-body` 前缀、压空白）。
   * 用于「这条规则的取值是什么」类断言（如层级是否真的逐级加深）。
   *
   * 【为什么是「合并」而不是「后者覆盖」】同一选择器在一个文件里可以出现多次，
   * 各自只补一部分属性（markdown-extras.css 里 `blockquote blockquote` 就有两条：
   * 一条给背景色，一条给 margin）。若按后者覆盖，背景色那条会被 margin 那条吃掉，
   * 断言就会误报「没有加深」—— 实测踩过这次假红。CSS 层叠本来就是多条规则叠加，
   * 合并才是正确语义。
   */
  function parseDeclarations(cssText) {
    const noComment = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const map = new Map()
    for (const m of noComment.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const bodies = m[2].replace(/\s+/g, ' ').trim()
      for (const one of m[1].split(',')) {
        const sel = one.trim().replace(/^\.preview-body\s*/, '').replace(/\s+/g, ' ')
        if (!sel || sel.startsWith('@')) continue
        map.set(sel, map.has(sel) ? `${map.get(sel)} ${bodies}` : bodies)
      }
    }
    return map
  }

  /** 最狠的一档归一化：去掉**全部**空白（仅用于「某条声明在不在」这类判断） */
  const squash = (s) => s.replace(/\s+/g, '')

  const extrasSelectors = parseSelectors(extrasCss)
  const exportSelectors = parseSelectors(exportersJs)

  test('规则解析器自检（解析失效时必须报错，不能静默变成「两边都空 → 一致」）', () => {
    // 这是本仓记录过多次的失败模式：差集两侧同时为空 → 假通过。
    assert.ok(extrasSelectors.size >= 25, `markdown-extras.css 只解析出 ${extrasSelectors.size} 条选择器（预期 25+）`)
    assert.ok(exportSelectors.size >= 25, `exporters.js 只解析出 ${exportSelectors.size} 条选择器（预期 25+）`)
    // 正反例：解析器认识真实规则、且不把注释里的文本当成规则
    assert.ok(extrasSelectors.has('kbd'), '解析器读不出 `kbd` 选择器')
    assert.ok(
      ![...extrasSelectors].some((s) => s.includes('<details>')),
      '解析器把注释里的 `<details>` 文本当成了选择器 —— 注释剥离失效'
    )
  })

  /**
   * 关键选择器清单（两边都必须有）。
   * 注意这里写的是**完整选择器**（含后代层级），不是前缀 —— 见上方说明。
   */
  const SELECTORS = [
    // 嵌套引用：三层逐级加深（缺任一层 = 「嵌套没层级」回归）
    ['嵌套引用一层', 'blockquote'],
    ['嵌套引用二层', 'blockquote blockquote'],
    ['嵌套引用三层', 'blockquote blockquote blockquote'],
    // 折叠块
    ['折叠块容器', 'details'],
    ['折叠块标题', 'summary'],
    // 行内 HTML 语义标签
    ['kbd 键帽', 'kbd'],
    ['mark 高亮', 'mark'],
    ['abbr 释义', 'abbr[title]'],
    // 脚注
    ['脚注区块', '.footnotes'],
    ['脚注小标题', '.footnotes-title'],
    ['脚注回跳', '.footnote-backref'],
    // 公式
    ['行内公式外壳', '.md-math'],
    ['块级公式外壳', '.md-math-block'],
    ['公式错误态', '.katex-error'],
  ]

  test('选择器清单自检（防清单被清空导致本条假通过）', () => {
    assert.ok(SELECTORS.length >= 14, `选择器清单只剩 ${SELECTORS.length} 条`)
    for (const [name, sel] of SELECTORS) assert.ok(sel.length > 2, `${name} 的选择器形态异常: ${sel}`)
  })

  test('两份文件都含全部关键选择器（改一边忘另一边即报红）', () => {
    const missing = []
    for (const [name, sel] of SELECTORS) {
      if (!extrasSelectors.has(sel)) missing.push(`${name}（${sel}）缺在 themes/markdown-extras.css`)
      if (!exportSelectors.has(sel)) missing.push(`${name}（${sel}）缺在 export/exporters.js`)
    }
    assert.deepEqual(
      missing,
      [],
      '扩展语法的样式副本两边不一致 —— 这两处是自包含副本，最容易改一边忘另一边：\n' + missing.join('\n')
    )
  })

  test('嵌套引用的层级加深必须真的用了 color-mix 递进（不是三层同色）', () => {
    // 「结构对但屏幕上看不出层级」正是用户报的那个缺陷。判据不是「有没有嵌套选择器」，
    // 而是「每一层的底色取值确实不同」—— 都退回同一个 --surface-warm 就是缺陷复现。
    // 用规则解析而非子串匹配：`blockquote blockquote{` 必须真的是**恰好两层**那条规则。
    for (const [label, text] of [['markdown-extras.css', extrasCss], ['exporters.js', exportersJs]]) {
      const decl = parseDeclarations(text)
      const two = decl.get('blockquote blockquote')
      const three = decl.get('blockquote blockquote blockquote')
      assert.ok(two, `${label}：缺二层引用规则`)
      assert.ok(three, `${label}：缺三层引用规则`)
      assert.match(two, /color-mix/, `${label}：二层没有加深（仍是单一底色 = 缺陷复现）`)
      assert.match(three, /color-mix/, `${label}：三层没有加深（仍是单一底色 = 缺陷复现）`)
      // 决定性：两层的混合比例不同，才有「层级」可言
      const pct = (s) => (s.match(/(\d+(?:\.\d+)?)%/) || [])[1]
      assert.ok(pct(two), `${label}：二层 color-mix 缺少百分比`)
      assert.ok(pct(three), `${label}：三层 color-mix 缺少百分比`)
      assert.notEqual(pct(two), pct(three), `${label}：二层与三层的混合比例相同（层级看不出）`)
    }
  })

  test('两层规则不得被四层规则顶替（子串前缀假绿灯的专项回归）', () => {
    // 【这条是变异自证逼出来的】第一版守卫用 `includes('blockquote blockquote blockquote{')`
    // 子串匹配，删掉三层规则后仍然通过 —— 因为四层规则以它开头。
    // 故这里显式钉住「三层规则必须独立存在，且不是一个更长选择器的前缀」。
    for (const [label, set] of [['markdown-extras.css', extrasSelectors], ['exporters.js', exportSelectors]]) {
      const exact = [...set].filter((s) => /^blockquote( blockquote)*$/.test(s))
      assert.ok(
        exact.includes('blockquote blockquote blockquote'),
        `${label}：三层引用规则不存在（可能只剩四层规则，子串匹配会假绿）`
      )
      // 四层规则存在但**不能**充当三层的替代
      assert.ok(
        !exact.every((s) => s.split(' ').length >= 4),
        `${label}：引用层级规则全都是四层及以上 —— 三层缺失`
      )
    }
  })

  test('打印时折叠块必须强制展开（否则导出 PDF 内容整段消失且不报错）', () => {
    // 这里用全去空白的 squash：`details > *:not(summary)` 里的空白不承载语义，
    // 只留后代选择器的层级（那部分由上一条用规则解析守）。
    for (const [label, src] of [['markdown-extras.css', extrasCss], ['exporters.js', exportersJs]]) {
      assert.match(
        squash(src),
        /details>\*:not\(summary\)\{display:block/,
        `${label} 缺少「打印/导出时展开折叠块」规则 —— PDF 里只剩 summary 一行，内容静默消失`
      )
    }
  })

  test('KaTeX 自带样式表只在 themes/index.css 引入一次（应用内），导出不内嵌字体', () => {
    const indexCss = readSrc('themes', 'index.css')
    assert.match(indexCss, /@import 'katex\/dist\/katex\.min\.css'/, 'KaTeX 样式未在 index.css 引入')
    // 导出侧绝不能 @import KaTeX（产物要脱离应用，字体文件不在导出目录）
    assert.ok(!exportersJs.includes('katex.min.css'), '导出模板引入了 KaTeX 样式（产物会缺字体）')
    assert.match(indexCss, /@import '\.\/markdown-extras\.css'/, 'markdown-extras.css 未在样式入口引入（规则全部失效）')
  })
})
