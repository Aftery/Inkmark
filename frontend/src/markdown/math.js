// markdown/math.js — LaTeX 公式的唯一渲染口径（KaTeX）
// ----------------------------------------------------------------------------
// 【为什么要有这个文件】公式在两处出现：预览 / 导出（markdown-it 渲染器）与
// 编辑器 WYSIWYG（行内 / 块级 widget）。两处若各写一份 KaTeX 选项，迟早在
// `trust` / `maxExpand` / `displayMode` 这类安全与版式参数上分叉 —— 一边渲染
// 正常、另一边红字报错，而且**都不抛异常**。故选项只在本文件出现一次。
//
// 【安全口径】
//  - trust: false          —— 禁掉 \href / \url / \includegraphics 等能注入链接
//                             或读外部资源的命令（KaTeX 默认值，这里显式写死，
//                             防后人「顺手打开」）
//  - maxExpand: 1000       —— 宏展开上限（默认值），挡住 \def 递归炸弹
//  - maxSize: 50           —— 单个尺寸命令上限（默认值），挡住 \rule{9999em}
//                             把版面撑爆（导出 PDF 时是实打实的分页灾难）
//  - throwOnError: false   —— 语法错误由 KaTeX 自己变成红字 katex-error span，
//                             绝不把异常抛进渲染管线（渲染器抛错 = 整块预览空白）
//  - strict: false         —— 关掉 unicode 文本警告，否则手写中文公式会刷一屏
//                             console 警告（本仓控制台干净是排查前提）
//
// 【为什么 `output` 用默认的 htmlAndMathml】
// KaTeX 默认同时产出 MathML（给屏幕阅读器 / 无 CSS 场景）与 HTML span（给
// 视觉）。导出 HTML 时 CSS 一定带上（见 export/exporters.js），两者都在才是
// 最稳的：CSS 若因任何原因没跟上，MathML 分支仍可读。

import katex from 'katex'

/** KaTeX 选项（唯一真源：预览、导出、编辑器 widget 全部经 renderMath 复用） */
export const MATH_OPTIONS = Object.freeze({
  throwOnError: false,
  strict: false,
  trust: false,
  maxExpand: 1000,
  maxSize: 50,
})

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

/**
 * 把一段 LaTeX 渲染成 HTML。
 *
 * 【两种输出形态 —— output 参数为什么必须存在】
 *  - `'html'`（默认，应用内：编辑器 widget / 预览）：KaTeX 的 HTML span + MathML
 *    双份。视觉最精确，**但依赖 KaTeX 的 20 个 Web 字体**（由 themes/index.css
 *    统一引入）。应用内字体是随包分发的静态资源，没问题。
 *  - `'mathml'`（导出 HTML / PDF）：只产 MathML。**这是导出侧的硬要求** ——
 *    导出产物要脱离应用独立可看，KaTeX 的字体文件不在导出目录里；若导出用
 *    html 形态，接收方看到的是「字体缺失、符号错位」的公式（而且不报错，
 *    只是难看）。MathML 用接收方系统字体渲染，现代浏览器（含 WKWebView /
 *    PDF 导出所用的 WebKit）都原生支持。
 *  导出文件因此可以保持轻量（不内嵌 1MB 字体），代价是版式细节不如应用内精确。
 *
 * @param {string} tex 公式源码（不含 `$` 定界符）
 * @param {{display?: boolean, output?: 'html'|'mathml'}} [opts]
 * @returns {string} HTML；空源码返回空串（调用方据此决定是否产出 widget）
 */
export function renderMath(tex, { display = false, output = 'html' } = {}) {
  const src = String(tex ?? '')
  if (!src.trim()) return ''
  try {
    return katex.renderToString(src, {
      ...MATH_OPTIONS,
      displayMode: !!display,
      // mathml 形态下 KaTeX 不产 katex-html，故 class="katex" 外壳仍在（样式无害）
      ...(output === 'mathml' ? { output: 'mathml' } : {}),
    })
  } catch (err) {
    // throwOnError:false 只兜 ParseError；maxExpand / maxSize 触发的普通 Error
    // 会走到这里。回落成可读的纯文本，绝不抛出去（预览/导出是全量渲染，抛一次
    // 就整篇空白）。
    return `<span class="md-math-error" title="${escapeAttr(err?.message ?? err)}">${escapeText(src)}</span>`
  }
}

// ---------------------------------------------------------------------------
// markdown-it 插件：$...$ 行内 + $$...$$ 块级
// ---------------------------------------------------------------------------
// 【选择自己写规则、而不是再引一个 markdown-it-katex】
// 第三方实现常年停在 KaTeX 0.10 时代的选项上，且自带一份 CSS 覆盖；本仓只需要
// 「认定界符 → 交给 renderMath」这一件事，自写才能把定界符规则与测试口径钉死
// （tests/math-render.test.mjs）。

/**
 * 行内公式 `$...$`。
 *
 * 三条边界（与 Typora / GitHub 的直觉一致，测试逐条钉住）：
 *  1) `$$` 不走这条规则（块级规则处理），否则 `$$x$$` 会被切成行内；
 *  2) 定界符内侧不能是空白：`价格 $ 5 $ 元` 保持纯文本，不误判成公式；
 *  3) 闭合 `$` 后面紧跟数字时不算闭合：`$5` 和 `$10` 这种价格写法不吞行。
 */
function inlineMath(state, silent) {
  const pos = state.pos
  const max = state.posMax
  if (state.src.charCodeAt(pos) !== 0x24 /* $ */) return false

  // `$$…$$` 出现在段落中间（不是独占一行的块）时，按**行内 display 公式**处理。
  // 不处理的话它会被拆成「$ + $x + $$」这种碎片，界面上是裸美元符 —— 用户从
  // Typora 复制一段「单行块级公式」进正文中间，看到的就是这个。
  if (pos + 1 < max && state.src.charCodeAt(pos + 1) === 0x24) {
    const close = state.src.indexOf('$$', pos + 2)
    if (close < 0 || close >= max) return false
    const body = state.src.slice(pos + 2, close)
    // 空内容或跨行都不认（跨行的交给 block 规则，块级必须在行首）
    if (!body.trim() || body.includes('\n')) return false
    if (!silent) {
      const token = state.push('math_inline_display', 'math', 0)
      token.markup = '$$'
      token.content = body
    }
    state.pos = close + 2
    return true
  }

  let end = pos + 1
  let found = -1
  while (end < max) {
    const ch = state.src.charCodeAt(end)
    if (ch === 0x5c /* \ */) { end += 2; continue } // 跳过转义对（\$ / \\）
    if (ch === 0x24) { found = end; break }
    if (ch === 0x0a /* 换行 */) return false // 行内公式不跨行
    end++
  }
  if (found < 0) return false
  const content = state.src.slice(pos + 1, found)
  if (!content.trim()) return false
  if (/^\s/.test(content) || /\s$/.test(content)) return false // 边界 2
  if (/\d/.test(state.src[found + 1] ?? '')) return false // 边界 3

  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.markup = '$'
    token.content = content
  }
  state.pos = found + 1
  return true
}

/**
 * 块级公式：`$$` 独占一行 … `$$` 独占一行，或单行 `$$ x $$`。
 *
 * 为什么支持「单行 $$ x $$」：用户从 Typora 粘贴过来最常见的就是这一形态，
 * 不支持会退化成两个行内公式夹一段普通文本（静默、难归因）。
 */
function blockMath(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const firstMark = state.eMarks[startLine]
  if (start + 2 > firstMark) return false
  if (state.src.slice(start, start + 2) !== '$$') return false
  if (state.src.slice(start, start + 3) === '$$$') return false // 别把 ``` 式围栏写法吃掉

  let lineText = state.src.slice(start + 2, firstMark)
  let found = false
  let next = startLine
  const lines = []

  if (/\$\$\s*$/.test(lineText)) {
    // 单行：`$$ E = mc^2 $$`
    lines.push(lineText.replace(/\$\$\s*$/, '').trim())
    found = true
  } else {
    if (lineText.trim()) lines.push(lineText)
    while (!found) {
      next++
      if (next >= endLine) break
      const bMark = state.bMarks[next] + state.tShift[next]
      const eMark = state.eMarks[next]
      // 缩进不足 = 已经走出当前容器（引用块 / 列表项），终止
      if (bMark < eMark && state.tShift[next] < state.blkIndent) break
      lineText = state.src.slice(bMark, eMark)
      if (/\$\$\s*$/.test(lineText)) {
        const head = lineText.replace(/\$\$\s*$/, '').trim()
        if (head) lines.push(head)
        found = true
        break
      }
      lines.push(lineText)
    }
  }
  if (!found) return false
  if (silent) return true

  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.markup = '$$'
  token.content = lines.join('\n').trim()
  token.map = [startLine, next + 1]
  state.line = next + 1
  return true
}

/**
 * markdown-it 插件入口：`md.use(mathPlugin)`。
 * 注册顺序有讲究：行内规则排在 `escape` 之后，让 `\$` 优先生效（用户要写
 * 字面美元符时不必与公式规则打架）。
 */
export function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', inlineMath)
  md.block.ruler.before('fence', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
  // 输出形态由 render() 每次渲染前写在实例上（同 md._resolveAssets 的既有模式）：
  // 应用内 html / 导出 mathml，见 renderMath 头注。
  const out = (md) => md._mathOutput === 'mathml' ? 'mathml' : 'html'
  md.renderer.rules.math_inline_display = (tokens, idx) => {
    const html = renderMath(tokens[idx].content, { display: true, output: out(md) })
    return html ? `<span class="md-math md-math-display">${html}</span>` : ''
  }
  md.renderer.rules.math_inline = (tokens, idx) => {
    const html = renderMath(tokens[idx].content, { display: false, output: out(md) })
    return html ? `<span class="md-math">${html}</span>` : escapeText(`$${tokens[idx].content}$`)
  }
  md.renderer.rules.math_block = (tokens, idx) => {
    const html = renderMath(tokens[idx].content, { display: true, output: out(md) })
    return html ? `<div class="md-math-block">${html}</div>\n` : ''
  }
}
