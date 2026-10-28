/**
 * writing-surface.test.mjs — 正文写作面排版一体化（Typora 化 A）的静态契约
 * ---------------------------------------------------------------------------
 * 被测对象：editor/extensions.js 的 EditorView 排版段、tokens/design-tokens.css、
 *           themes/preview.css
 *
 * 【为什么这组必须是机检 —— 全部是「静默失败」型】
 *  这轮改的是观感，错了不报错、不抛异常，界面只是「看起来不对」：
 *
 *   1) 只给 .cm-content 加 max-width 但**没开软换行**：
 *      CM6 baseTheme 的 .cm-content 是 white-space:pre，长段落不换行而是横向撑开。
 *      实测（1600px 视口、一段长中文）：未换行时内容宽 6798px、横向可滚 5198px；
 *      只加 max-width 后仍有 5606px 横向溢出 —— 变成「在 736px 窄栏里横向滚动」，
 *      比不改更难用。这个组合错误在界面上极其醒目，但**没有任何断言会自然失败**。
 *
 *   2) 用 CSS 自己写软换行（而不装 EditorView.lineWrapping）：
 *     截图看着「换行了」，但 CM6 的 heightOracle 靠 contentAttributes 里的
 *      cm-lineWrapping 类名预判换行；绕开它会让行高测量走错分支，表现为
 *      上下方向键的光标纵向位置漂移 —— 输入时才会发现，且很难归因。
 *
 *   3) 编辑区与预览区行宽「各写各的」：
 *      用户的「行宽」偏好（themes/prefs.js）只写 --preview-measure。编辑区若引用
 *      别的变量（或写死 46rem），用户切窄/宽档位时只有预览变、编辑区不变 ——
 *      正是本仓反复出现的「左右不一致」。
 *
 * [纪律] 与 wysiwyg-decor.test.mjs 同：只用 node:fs + RegExp，不用 shell grep
 *（本仓 UTF-8 文件在 shell grep 下静默无输出，会得到假绿灯）。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8')

const extensions = read('editor', 'extensions.js')
const tokens = read('themes', 'tokens', 'design-tokens.css')
const previewCss = read('themes', 'preview.css')
const appShellCss = read('themes', 'app-shell.css')

/**
 * 剥注释。本仓已因「匹配到注释里的代码」栽过 8 次（见 wysiwyg-decor.test.mjs
 * 的 stripComments 头注）—— 尤其本轮我在 extensions.js 的注释里**大段引用了**
 * `white-space:pre` / `maxWidth` 这些词，不剥注释的话下面每条断言都会被自己的
 * 说明文字误命中，得到「代码没改也全绿」的假绿灯。
 */
function stripComments(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

const extensionsCode = stripComments(extensions)

/**
 * 取 extensions.js 里 EditorView.theme({...}) 的对象体（到 focusField 为止）。
 *
 * 【锚点随实现搬迁 · 2026-10-28】扩展清单整体搬到 editor/extensions.js 后，
 * 排版 theme 也在那里；原来「到 updateListener 为止」这个尾锚点随两个监听器
 * 一起留在了 createEditor.js（它们是 view 侧的，不进共享扩展清单），
 * 故尾锚点改为 extensions.js 里紧跟 theme 之后的 focusField。
 * 断言强度未变（取的仍是同一个 theme 对象体）。
 */
function themeBlock() {
  const start = extensionsCode.indexOf('EditorView.theme({')
  const end = extensionsCode.indexOf('focusField,')
  assert.ok(start >= 0 && end > start, `定位 EditorView.theme 失败（${start}/${end}）—— 判据锚点消失，结论不可采信`)
  return extensionsCode.slice(start, end)
}

/**
 * 取 design-tokens.css 里「与主题无关的结构尺度」那个 `:root { ... }` 块。
 *
 * 【为什么必须精确到这个块】本文件里 `--leading-body` 出现两次：
 *   - paper 主题块（`:root[data-theme='paper']`）刻意覆写为 1.8 / 1.85（衬线需更大行距）；
 *   - 结构尺度块（裸 `:root`）才是三主题共用的默认值 1.7 / 1.7。
 * 直接用全文第一个匹配会命中 paper 的值，断言 1.8 !== 1.85 变成一条与
 * 「默认主题是否一致」无关的**假红**。判据用「块内同时定义了 --text-base」来锁定
 * 结构尺度块 —— 字号基准只该在那里出现一次。
 */
function rootBlockDefining(token) {
  const re = /(^|\n):root\s*\{([\s\S]*?)\n\}/g
  let m
  while ((m = re.exec(tokens)) !== null) {
    if (m[2].includes(token)) return m[2]
  }
  assert.fail(`design-tokens.css 里找不到定义 ${token} 的裸 :root 块（判据锚点消失）`)
}

// ===========================================================================
// 1) 软换行：居中定宽的前置条件
// ===========================================================================
describe('编辑区 · 软换行', () => {
  test('必须安装 EditorView.lineWrapping（否则 max-width 会把长段落变成横向滚动）', () => {
    assert.match(
      extensionsCode,
      /EditorView\.lineWrapping\b/,
      '缺少 EditorView.lineWrapping：.cm-content 的 white-space 仍是 pre，' +
        '长段落不换行而是横向溢出，窄栏下表现为「文字被截断 + 底部横向滚动条」',
    )
  })

  test('软换行必须用官方扩展，不得用 CSS 自己写 white-space/overflow-wrap', () => {
    // 自己在 theme 里写换行会让 CM6 的 heightOracle 预判失效（行高测量走错分支），
    // 表现为上下方向键的光标纵向位置漂移 —— 只在自己写 CSS 时才会出现。
    const body = themeBlock()
    assert.ok(
      !/whiteSpace\s*:/.test(body),
      '.cm-content/.cm-line 里不得手写 whiteSpace 换行 —— ' +
        'CM6 的换行必须走 EditorView.lineWrapping，否则行高测量与实际渲染不一致',
    )
    assert.ok(
      !/overflowWrap\s*:/.test(body),
      '不得手写 overflowWrap —— 官方 lineWrapping 已包含 break-spaces + anywhere 的等价声明',
    )
  })
})

// ===========================================================================
// 2) 居中定宽：与预览区同源同一个 measure token
// ===========================================================================
describe('编辑区 · 居中定宽', () => {
  test('.cm-content 必须有 max-width 且引用 --preview-measure', () => {
    const body = themeBlock()
    const content = body.slice(
      body.indexOf("'.cm-content'"),
      body.indexOf("'.cm-line'"),
    )
    assert.ok(content.length > 0, '未找到 .cm-content 样式块（判据锚点消失）')
    assert.match(
      content,
      /maxWidth\s*:\s*'var\(--preview-measure\)'/,
      '.cm-content 必须用 max-width: var(--preview-measure) 定宽 —— ' +
        '写死 46rem 会让用户的「行宽」偏好只作用于预览区，编辑区不跟随',
    )
    assert.match(
      content,
      /margin\s*:\s*'0 auto'/,
      '.cm-content 定宽后必须 margin: 0 auto 居中，否则文字贴左、右侧留一大片空',
    )
  })

  test('编辑区与预览区必须引用同一个 measure 变量（不是各写一份）', () => {
    // 预览区的既有范式：.preview-body { max-width: var(--preview-measure); margin: 0 auto }
    assert.match(
      previewCss,
      /\.preview-body\s*\{[^}]*max-width:\s*var\(--preview-measure\)/s,
      '预览区 .preview-body 的 max-width 变了 —— 编辑区与它对齐的前提消失',
    )
    const body = themeBlock()
    assert.match(
      body,
      /maxWidth:\s*'var\(--preview-measure\)'/,
      '编辑区的 max-width 未引用 --preview-measure：两处不同源，用户调行宽时左右不一致',
    )
  })

  test('--preview-measure 必须在 token 里存在且为正向长度', () => {
    const m = tokens.match(/--preview-measure:\s*([^;]+);/)
    assert.ok(m, 'design-tokens.css 缺少 --preview-measure')
    assert.match(m[1].trim(), /^\d+(\.\d+)?rem$/, `--preview-measure 应是 rem 长度，实际: ${m[1].trim()}`)
  })

  test('.cm-line 必须是已定位元素（浮层锚点）', () => {
    // .cm-md-copy / .cm-md-table-bar 是 position:absolute，锚点取「最近已定位祖先」。
    // CM6 给 .cm-scroller 设了 position:relative，故 .cm-line 若为 static，
    // 这两个浮层会锚在整个滚动容器上：复制按钮飘到窗口右上角（实测距所在行
    // -2142px），居中定宽后更会落到正文栏之外。
    const body = themeBlock()
    const line = body.slice(body.indexOf("'.cm-line'"))
    assert.match(
      line,
      /position:\s*'relative'/,
      '.cm-line 缺少 position:relative —— 代码块复制按钮与表格操作条会锚到 ' +
        '.cm-scroller 上，浮窗脱离所在行（改动前即存在此缺陷）',
    )
  })
})

// ===========================================================================
// 3) 字号 / 行距：编辑区与预览区成对一致
// ===========================================================================
describe('编辑正文 · 字号与行距同源', () => {
  test('编辑区字号走 --text-base，预览区走 --text-md，两者 token 值相等', () => {
    const body = themeBlock()
    assert.match(
      body,
      /fontSize:\s*'var\(--text-base\)'/,
      '编辑区正文字号必须引用 --text-base（C2 不变量的编辑区一侧）',
    )
    assert.match(
      previewCss,
      /\.preview-body\s*\{[^}]*font-size:\s*var\(--text-md\)/s,
      '预览区正文必须引用 --text-md（C2 不变量的预览区一侧）',
    )
    const structural = rootBlockDefining('--text-base')
    const base = structural.match(/--text-base:\s*([^;]+);/)
    const md = structural.match(/--text-md:\s*([^;]+);/)
    assert.ok(base && md, '默认 :root 块缺少 --text-base / --text-md')
    assert.equal(
      base[1].trim(),
      md[1].trim(),
      `--text-base(${base[1].trim()}) 与 --text-md(${md[1].trim()}) 必须同值，` +
        '否则左右两栏文字宽度与折行位置不一致',
    )
  })

  test('编辑区行距走 --leading-body，预览区走 --leading-reading', () => {
    const body = themeBlock()
    assert.match(body, /lineHeight:\s*'var\(--leading-body\)'/, '编辑区必须引用 --leading-body')
    assert.match(
      previewCss,
      /\.preview-body\s*\{[^}]*line-height:\s*var\(--leading-reading\)/s,
      '预览区必须引用 --leading-reading',
    )
    // 【必须取「结构尺度」那个 :root 块】paper 主题块刻意把行距调大到 1.8 / 1.85
    // （衬线需更大行距），直接用全文第一个匹配会命中 paper 的值，得到一条
    // 与「默认主题」无关的假红。故定位到同时定义 --text-base 的那个默认块。
    const structural = rootBlockDefining('--text-base')
    const bodyLeading = structural.match(/--leading-body:\s*([\d.]+);/)
    const readingLeading = structural.match(/--leading-reading:\s*([\d.]+);/)
    assert.ok(
      bodyLeading && readingLeading,
      '默认 :root 块缺少 --leading-body / --leading-reading',
    )
    assert.equal(
      bodyLeading[1],
      readingLeading[1],
      `默认主题下 --leading-body(${bodyLeading[1]}) 与 --leading-reading(${readingLeading[1]}) ` +
        '必须相等，否则编辑区与预览区文字基线错位',
    )
  })

  test('行距必须落在可读区间（1.5~2.0），防止误改成 1 或 3 这类值', () => {
    const structural = rootBlockDefining('--text-base')
    const m = structural.match(/--leading-body:\s*([\d.]+);/)
    assert.ok(m, '默认 :root 块缺少 --leading-body')
    const v = Number(m[1])
    assert.ok(
      v >= 1.5 && v <= 2.0,
      `--leading-body=${v} 超出可读区间 [1.5, 2.0] —— 正文行距过密或过散`,
    )
  })
})

// ===========================================================================
// 4) 三态一致：编辑 / 预览 / 导出用同一个 measure 尺度
// ===========================================================================
describe('三态比例映射 · 编辑与预览同轴', () => {
  test('.export-preview 的宽度与 --single-measure 同源（导出仍是居中定宽）', () => {
    assert.match(
      appShellCss,
      /\.export-preview\s*\{[^}]*width:\s*var\(--single-measure\)/s,
      '导出用的 .export-preview 宽度未引用 --single-measure —— 编辑/预览/导出三态失去同一尺度',
    )
    const m = tokens.match(/--single-measure:\s*([^;]+);/)
    assert.ok(m, 'design-tokens.css 缺少 --single-measure')
  })

  test('--single-measure 与 --preview-measure 同值（同一中轴的量化保证）', () => {
    const single = tokens.match(/--single-measure:\s*([^;]+);/)
    const preview = tokens.match(/--preview-measure:\s*([^;]+);/)
    assert.ok(single && preview, '缺少 --single-measure / --preview-measure')
    assert.equal(
      single[1].trim(),
      preview[1].trim(),
      `--single-measure(${single[1].trim()}) 与 --preview-measure(${preview[1].trim()}) 应同值：` +
        '导出预览与编辑区正文若不同宽，导出结果的换行位置会和写作时看到的不一样',
    )
  })
})
