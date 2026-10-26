/**
 * markdown-math.test.mjs — KaTeX 公式的渲染契约（2026-10-25 新增）
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/markdown/math.js（renderMath / MATH_OPTIONS /
 * mathPlugin）+ frontend/src/preview/markdown.js 的接线（render 的 mathOutput）。
 *
 * 【为什么这组必须是机检】公式这条链路上的失败**全都静默**：
 *   1) 定界符误判：`价格 $ 5 $ 元` 被当成公式 → 用户看到一段红字公式而不是
 *      自己写的价格，而渲染器不报错、控制台也干净。
 *   2) 边界漏判：`$5 和 $10` 这类价格写法被「吞」掉半行，属于内容损坏级别。
 *   3) 语法错误：KaTeX 抛出的异常若冒出渲染管线，整篇预览会变成空白
 *      （renderer 抛一次就整块没了），而不是「公式位置显示红字」。
 *   4) 导出形态：导出 HTML 若用 katex-html 形态，产物依赖 KaTeX 的 20 个字体
 *      文件，而导出目录里没有 → 接收方看到符号错位，且**不报错**。
 *
 * 判据来源（不拿实现输出当期望）：
 *   - 三形态与边界规则来自 markdown/math.js 头注声明的三条边界（与 Typora /
 *     GitHub 的直觉一致），不是「跑一遍看看输出什么」。
 *   - `output` 两种形态的语义来自文件头注「mathml 只产 MathML」。
 *   - trust / 空公式的语义来自 MATH_OPTIONS 的注释与 renderMath 的 @returns。
 *
 * 全部走**真实渲染**（import 真实 createRenderer / renderMath），源码正则不算数。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, render } from '../src/preview/markdown.js'
import { renderMath, MATH_OPTIONS } from '../src/markdown/math.js'

const md = createRenderer()

describe('公式三形态 · 行内 / 块级 / 段中单行 display', () => {
  test('行内 `$x^2$`：产 md-math 外壳，且**不是**块级容器', () => {
    const html = render(md, '质能方程 $E=mc^2$ 结束')
    assert.match(html, /<span class="md-math">/, '行内公式缺少 md-math 外壳')
    assert.match(html, /class="katex"/, '未产出 KaTeX 结构')
    assert.ok(!html.includes('md-math-block'), '行内公式不该被当成块级公式')
    assert.ok(!html.includes('md-math-display'), '行内公式不该带 display 语义')
  })

  test('块级 `$$` 独占行：产 md-math-block + katex-display', () => {
    const html = render(md, '$$\n\\frac{1}{2}\n$$\n')
    assert.match(html, /<div class="md-math-block">/, '块级公式缺少 md-math-block 容器')
    assert.match(html, /class="katex-display"/, '块级公式应使用 display 模式')
    assert.ok(!html.includes('katex-error'), '这段公式是合法的，不该出现错误态')
  })

  test('单行 `$$ x $$`（独占一行）也按块级处理（Typora 粘贴的常见形态）', () => {
    const html = render(md, '$$ E = mc^2 $$\n')
    assert.match(html, /<div class="md-math-block">/, '单行块级公式应产出块容器')
  })

  test('段落中间的 `$$…$$` 按「行内 display」处理，不被切碎成裸美元符', () => {
    const html = render(md, '段落中间的 $$E=mc^2$$ 单行')
    assert.match(html, /<span class="md-math md-math-display">/, '段中单行 display 未被识别')
    assert.ok(!html.includes('md-math-block'), '段中形式不该升级成块级容器（会打断段落）')
    // 决定性断言：不许留下裸美元符（那正是「没支持」的界面表现）
    assert.ok(!html.includes('$$'), '渲染结果里残留了裸的 $$ 定界符')
  })
})

describe('定界符边界 · 不许把普通文本误判成公式', () => {
  test('`价格 $ 5 $ 元`：定界符内侧有空白，保持纯文本', () => {
    const html = render(md, '价格 $ 5 $ 元')
    assert.ok(!html.includes('md-math'), '内侧带空白的 `$ 5 $` 被误判成公式')
    assert.match(html, /\$ 5 \$/, '原文应原样保留（用户要能看到自己写的美元符）')
  })

  test('`价格 $5 和 $10 元`：闭合 `$` 后紧跟数字，不吞行', () => {
    const html = render(md, '价格 $5 和 $10 元')
    assert.ok(!html.includes('md-math'), '价格写法 `$5 … $10` 被误判成公式')
    assert.match(html, /\$5 和 \$10/, '价格原文被破坏')
  })

  test('`\\$5 元`：转义美元符按字面文本输出，不进入公式规则', () => {
    const html = render(md, '转义 \\$5 元')
    assert.ok(!html.includes('md-math'), '转义后的美元符仍被当成公式定界符')
    assert.match(html, /\$5 元/, '转义美元符应输出为字面 $5')
  })

  test('空内容 `$ $` / `$$$$` 都不产公式（空公式不产 widget）', () => {
    for (const src of ['$ $', '$$$$', 'a $ $ b']) {
      const html = render(md, src)
      assert.ok(!html.includes('md-math'), `空公式形态 ${JSON.stringify(src)} 不该产出公式`)
    }
    // 纯空白块级公式：整段不产出任何容器（renderer 返回空串）
    assert.equal(render(md, '$$\n\n$$\n').trim(), '', '空块级公式不该产出空壳容器')
  })

  test('renderMath 对空源码返回空串（调用方据此决定是否产 widget）', () => {
    assert.equal(renderMath(''), '')
    assert.equal(renderMath('   '), '')
    assert.equal(renderMath(null), '')
  })
})

describe('输出形态 · 应用内 html vs 导出 mathml', () => {
  test('默认（应用内）形态：含 katex-html（视觉精确）', () => {
    const html = render(md, '$x^2$')
    assert.match(html, /katex-html/, '应用内形态应含 katex-html')
    assert.match(html, /<math/, 'KaTeX 默认同时产 MathML 分支（无 CSS 场景可读）')
  })

  test('导出形态 mathml：**不含** katex-html，但含 <math>', () => {
    const html = render(md, '$x^2$', { mathOutput: 'mathml' })
    assert.ok(!html.includes('katex-html'), 'mathml 形态仍在产 katex-html —— 导出产物会依赖缺失的 KaTeX 字体')
    assert.match(html, /<math/, 'mathml 形态必须产出 MathML')
    assert.match(html, /class="katex"/, 'mathml 形态仍应保留 katex 外壳（样式无害且便于定位）')
  })

  test('块级公式的导出形态同样只产 MathML', () => {
    const html = render(md, '$$\n\\frac{1}{2}\n$$\n', { mathOutput: 'mathml' })
    assert.ok(!html.includes('katex-html'), '块级导出仍含 katex-html')
    assert.match(html, /<math[^>]*display="block"/, '块级 MathML 应带 display="block"')
    assert.match(html, /<mfrac>/, 'MathML 分支应保留分式结构')
  })

  test('renderMath 直调：output 缺省为 html，显式 mathml 才切换', () => {
    assert.match(renderMath('x'), /katex-html/)
    assert.ok(!renderMath('x', { output: 'mathml' }).includes('katex-html'))
    assert.match(renderMath('x', { output: 'mathml' }), /<math/)
  })
})

describe('错误处理 · 语法错误绝不抛出渲染管线', () => {
  test('`$\\frac{1}$`（参数不全）：不抛异常，产出 katex-error 红字', () => {
    let html
    assert.doesNotThrow(() => { html = render(md, '$\\frac{1}$ 错误') }, '渲染器抛错会让整块预览空白')
    assert.match(html, /katex-error/, '语法错误应产出 katex-error 错误态')
    assert.match(html, /价格|错误/, '错误公式之外的正文必须仍然渲染')
  })

  test('KaTeX 非 ParseError（递归过深 → 栈溢出）回落成 md-math-error 纯文本', () => {
    // throwOnError:false 只兜 ParseError；栈溢出这类普通 Error 走 renderMath 的
    // catch 分支。若那条分支坏掉，异常会冒到 markdown-it → 整篇渲染失败。
    const bomb = '\\frac{'.repeat(2000) + 'x' + '}{1}'.repeat(2000)
    let out
    assert.doesNotThrow(() => { out = renderMath(bomb) }, 'renderMath 不得把异常抛给调用方')
    assert.match(out, /md-math-error/, '非 ParseError 应回落成 md-math-error')
    assert.match(out, /title="/, '错误态应带 title 说明（便于用户与排查者定位）')
    assert.ok(!out.includes('katex-html'), '回落分支不该产出半截 KaTeX 结构')
  })

  test('错误态经完整渲染管线也只影响公式本身（正文不被吞）', () => {
    const html = render(md, '前文\n\n$\\frac{1}$\n\n后文\n')
    assert.match(html, /前文/)
    assert.match(html, /后文/)
    assert.match(html, /katex-error/)
  })
})

describe('安全口径 · trust:false（禁止 \\href / \\url 注入链接）', () => {
  test('MATH_OPTIONS 的信任开关写死为 false 且不可被改写（冻结）', () => {
    assert.equal(MATH_OPTIONS.trust, false, 'trust 必须为 false（KaTeX 默认值，本仓显式写死）')
    assert.equal(MATH_OPTIONS.throwOnError, false, 'throwOnError 必须为 false（错误不得抛出渲染管线）')
    assert.ok(Object.isFrozen(MATH_OPTIONS), 'MATH_OPTIONS 应冻结，防运行时被「顺手打开」')
  })

  test('`\\href{…}{…}` 不产链接：既无 <a> 也无 href 属性', () => {
    const out = renderMath('\\href{https://example.com}{x}')
    assert.ok(!/<a[\s>]/.test(out), 'trust:false 下 \\href 产生了 <a> 标签')
    assert.ok(!out.includes('href="'), 'trust:false 下 \\href 仍写出了 href 属性')
    // 注意：URL 仍会以**纯文本**出现在 KaTeX 的 annotation（TeX 源码回放）里，
    // 那不是可点击链接，故不禁止 —— 这里禁的是「可导航属性」而不是字符串本身。
    assert.ok(!/href=["']?https?:/i.test(out), '产物里出现了可导航的 http(s) href')
  })

  test('`\\url{…}` 同样不产链接（经完整渲染管线复核）', () => {
    const html = render(md, '$\\url{https://example.com}$')
    assert.ok(!/<a[\s>]/.test(html), 'trust:false 下 \\url 产生了 <a> 标签')
    assert.ok(!html.includes('href="'), 'trust:false 下 \\url 仍写出了 href 属性')
    // 对照：普通链接语法照旧可用（证明「无 <a>」不是渲染器整体坏掉）
    assert.match(render(md, '[链接](https://example.com)'), /<a href="https:\/\/example.com">/)
  })
})
