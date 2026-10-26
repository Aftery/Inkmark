// markdown/html.js — 原始 HTML 的「白名单渲染」唯一口径
// ----------------------------------------------------------------------------
// 【为什么需要它】用户要在 Markdown 里写 HTML（`<kbd>`、`<mark>`、`<sup>`、
// `<details>`、`<p align="center">` —— 这份语法清单是 Typora / GitHub 用户的
// 肌肉记忆）。markdown-it 的 `html: false` 会把这些当**普通文本转义**输出，
// 界面上就是一堆裸露的尖括号（真机反馈「HTML 标签不支持」）。
//
// 但把 `html: true` 直接打开等于给文档开了 XSS 后门：`<img onerror=…>`、
// `<script>`、`javascript:` 链接全部进 DOM。本仓是桌面应用（webview 里有
// wails 绑定），注入的风险不是「别人的网页」而是「打开一份别人给的 .md」。
//
// 故这里的策略是**白名单**：认识的标签按属性白名单重建（属性值重新转义），
// 不认识的一律转义回文本（用户至少还能看到自己写了什么，不会静默消失）。
//
// 【为什么在 token 层净化，而不是渲染完整篇 HTML 再净化】
// 数学公式由 KaTeX 产出大量 `<span class="katex" style="height:…">`；若整篇
// 过净化，KaTeX 的产物会被当成「未白名单 HTML」整段转义掉（公式变成一长串
// 源码）。故净化只作用于 markdown-it 的 `html_inline` / `html_block` 两种 token
// —— 那才是**用户手写**的原始 HTML，其余 token 的产物一律不碰。
//
// 【与编辑器的关系】编辑器 WYSIWYG 要「隐藏标签、保留文字并上样式」，它需要的
// 是同一份「哪些标签算认识」的清单（EDITOR_TAG_CLASS）。清单在本文件出现一次，
// 两侧同源 —— 否则编辑器认、导出不认（或反过来）会让同一份文档两处不同。

// 【为什么 label / input 在这里（它们不是「用户想写的 HTML」）】GFM 任务列表的
// 勾选框由 markdown-it-task-lists 以 html_inline token 的形式注入
// （带 label:true 时输出 `<label><input …></label>`）。一旦 html:true，这些
// token 也走本文件的白名单 —— 若不认，勾选框会被整体转义成文本，任务列表
// 直接退化成「一堆字面尖括号」。它们按**插件产物**对待，属性另行收窄。
const INLINE_ALLOWED = new Set([
  'span', 'kbd', 'mark', 'sup', 'sub', 'small', 'br', 'b', 'strong', 'i', 'em',
  'u', 's', 'del', 'ins', 'abbr', 'q', 'cite', 'var', 'samp', 'code', 'a', 'img',
  'label', 'input',
])

const BLOCK_ALLOWED = new Set([
  'p', 'div', 'details', 'summary', 'center', 'blockquote', 'hr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption', 'pre', 'section', 'article', 'header', 'footer',
])

/** 所有允许出现的标签（两侧同源清单之一） */
export const ALLOWED_TAGS = new Set([...INLINE_ALLOWED, ...BLOCK_ALLOWED])

/**
 * 编辑器侧「隐藏标签 + 给文字上样式」的标签 → CSS 类名。
 * 值只写语义类名，样式定义在 themes/editor-wysiwyg.css（单一出处）。
 */
export const EDITOR_TAG_CLASS = Object.freeze({
  kbd: 'cm-md-kbd',
  mark: 'cm-md-mark',
  sup: 'cm-md-sup',
  sub: 'cm-md-sub',
  small: 'cm-md-small',
  b: 'cm-md-strong',
  strong: 'cm-md-strong',
  i: 'cm-md-em',
  em: 'cm-md-em',
  u: 'cm-md-underline',
  s: 'cm-md-strike',
  del: 'cm-md-strike',
  ins: 'cm-md-underline',
  abbr: 'cm-md-abbr',
  q: 'cm-md-quote-inline',
  cite: 'cm-md-em',
  var: 'cm-md-em',
  samp: 'cm-md-inline-code',
  code: 'cm-md-inline-code',
  a: 'cm-md-link',
})

/**
 * 只出现在块位置、靠「整块」处理的标签：编辑器里由 blockRanges.js 的区间扫出来
 * 交给块级 widget（`<details>` 折叠块），或由行内装饰按「开标签 + 闭标签两处
 * 分别隐藏、内容居中」处理（`<p align="center">`）。
 *
 * 与 EDITOR_TAG_CLASS 分开的理由：行内标签是「隐藏标签 + 给文字上类」，块标签
 * 是「整块换 DOM」，两套机制的实现与失效表现完全不同，混在一张表里会让
 * 后来者以为 `details` 也可以按行内处理（那会直接触发 CM6 的跨行替换禁令）。
 */
export const EDITOR_BLOCK_TAGS = new Set(['details', 'summary', 'p', 'div'])

const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr'])

/** style 里允许保留的 CSS 属性（只留「视觉微调」类，去掉一切能引外部资源/执行脚本的） */
const STYLE_PROPS = new Set([
  'color', 'background-color', 'text-align', 'font-weight', 'font-style',
  'text-decoration', 'vertical-align', 'font-size',
])

/** 每标签额外允许的属性；未列出的属性一律丢弃 */
const TAG_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'align'],
  td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  tr: ['align', 'valign'],
  table: ['align', 'width', 'border', 'cellpadding', 'cellspacing'],
  p: ['align'],
  div: ['align'],
  h1: ['align'], h2: ['align'], h3: ['align'], h4: ['align'], h5: ['align'], h6: ['align'],
  hr: ['align', 'width'],
  details: ['open'],
  abbr: ['title'],
  label: ['for', 'class'],
  input: ['type', 'checked', 'disabled', 'class'],
  ol: ['start', 'type'],
  li: ['value'],
  center: [],
  span: [],
  summary: [],
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
function escapeAttr(s) {
  return escapeHtml(s)
}

/** URL 只放行 http(s) / mailto / 站内锚点 / 相对路径与 data:image（禁 javascript: / vbscript:） */
function safeUrl(v) {
  // 先去掉控制字符与首尾空白：`java\tscript:` 是经典绕过
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!s) return null
  const low = s.toLowerCase()
  if (/^(javascript|vbscript|file|data:text\/html)/.test(low)) return null
  if (low.startsWith('data:image/')) {
    return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(s) ? s : null
  }
  if (/^(https?:|mailto:|#|\/|\.{0,2}\/|[^:]*$)/i.test(s)) return s
  return null
}

/** 解析 style 声明串，只留白名单属性且值里不得出现 url( / expression( / 注释等 */
function safeStyle(v) {
  const kept = []
  for (const decl of String(v).split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const val = decl.slice(i + 1).trim()
    if (!STYLE_PROPS.has(prop) || !val) continue
    if (/url\(|expression\(|javascript:|@import|\/\*|\\/i.test(val)) continue
    // 值只允许「颜色 / 关键字 / 数字 / 常见分隔符」这一小类字符
    if (!/^[#\w\s,.%()\-+'"]+$/.test(val)) continue
    kept.push(`${prop}: ${val}`)
  }
  return kept.length ? kept.join('; ') : null
}

/** 拆属性串（引号内的 `>` 不当作标签结束）；只在已经确认是标签头之后调用 */
function parseAttrs(src) {
  const out = []
  let i = 0
  const n = src.length
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++
    if (i >= n) break
    let name = ''
    while (i < n && /[^\s=/>]/.test(src[i])) name += src[i++]
    if (!name) { i++; continue }
    while (i < n && /\s/.test(src[i])) i++
    let value = null
    if (src[i] === '=') {
      i++
      while (i < n && /\s/.test(src[i])) i++
      const quote = src[i]
      if (quote === '"' || quote === "'") {
        i++
        let v = ''
        while (i < n && src[i] !== quote) v += src[i++]
        i++ // 跳过闭合引号
        value = v
      } else {
        let v = ''
        while (i < n && !/[\s>]/.test(src[i])) v += src[i++]
        value = v
      }
    }
    out.push({ name: name.toLowerCase(), value })
  }
  return out
}

/**
 * 重建单个标签；不认识或属性全被丢掉时返回 null（调用方决定转义）。
 * @param {string} name 小写标签名
 * @param {string} rawAttrs 标签名之后的原文
 * @param {boolean} closing 是否闭合标签
 */
function rebuildTag(name, rawAttrs, closing) {
  if (!ALLOWED_TAGS.has(name)) return null
  if (closing) return VOID_TAGS.has(name) ? '' : `</${name}>`
  if (VOID_TAGS.has(name) && (name === 'br' || name === 'hr')) {
    // br / hr 允许的属性极少，这里直接产出规范形态即可
    return `<${name}>`
  }
  const allowed = TAG_ATTRS[name] ?? []
  const kept = []
  for (const { name: attr, value } of parseAttrs(rawAttrs)) {
    if (/^on/i.test(attr)) continue // 事件处理器一律丢弃
    if (attr === 'style') {
      const style = safeStyle(value ?? '')
      if (style) kept.push({ name: 'style', value: style })
      continue
    }
    if (!allowed.includes(attr)) continue
    if (value == null) {
      // 布尔属性（如 details 的 open）
      kept.push({ name: attr, value: null })
      continue
    }
    if (attr === 'href' || attr === 'src') {
      const url = safeUrl(value)
      if (!url) continue
      kept.push({ name: attr, value: url })
      continue
    }
    // input 只放行「任务列表勾选框」这一种形态：type 必须 checkbox，
    // class 只允许插件那个类名。其余 input（text/password/file…）一律丢属性，
    // 免得一份来路不明的 .md 在预览里摆出可输入的假登录框。
    if (name === 'input') {
      if (attr === 'type' && value !== 'checkbox') continue
      if (attr === 'class' && value !== 'task-list-item-checkbox') continue
    }
    if (name === 'label' && attr === 'class' && value !== 'task-list-item-label') continue
    if (attr === 'width' || attr === 'height' || attr === 'colspan' || attr === 'rowspan') {
      if (!/^\d{1,4}(%|px)?$/.test(value.trim())) continue
      kept.push({ name: attr, value: value.trim() })
      continue
    }
    kept.push({ name: attr, value })
  }
  const attrs = kept
    .map(({ name: k, value: v }) => (v == null ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`))
    .join('')
  return `<${name}${attrs}>`
}

/**
 * 净化一段**用户手写**的原始 HTML（markdown-it 的 html_inline / html_block token）。
 *
 * @param {string} html 原始片段
 * @returns {string} 白名单重建后的 HTML；被拒绝的标签转义成文本保留下来
 */
export function sanitizeHtml(html) {
  if (!html) return ''
  // 先把危险容器（连同内容）整段删掉 —— 里面的文本也不该以任何形式留下
  let src = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[^>]*>/gi, '')

  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { out += escapeHtml(src.slice(i)); break }
    out += escapeHtml(src.slice(i, lt))

    // 找标签结束的 `>`：跳过引号内的内容（`<span style="a>b">` 这种）
    let j = lt + 1
    let quote = ''
    while (j < n) {
      const ch = src[j]
      if (quote) { if (ch === quote) quote = '' } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j++
    }
    if (j >= n) {
      // 没有闭合的 `>`：后面的内容全当文本
      out += escapeHtml(src.slice(lt))
      break
    }
    const inner = src.slice(lt + 1, j)
    // 注释 / doctype / 处理指令：丢弃
    if (/^\s*[!?]/.test(inner)) { i = j + 1; continue }
    const m = /^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner)
    if (!m) { out += escapeHtml(src.slice(lt, j + 1)); i = j + 1; continue }
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    const rebuilt = rebuildTag(name, inner.slice(m[0].length), closing)
    out += rebuilt === null ? escapeHtml(src.slice(lt, j + 1)) : rebuilt
    i = j + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// 危险容器的「行内」清剿：为什么必须在 token 流上做，而不是在字符串上做
// ---------------------------------------------------------------------------
// 【缺陷本体 —— 2026-10-25 QA 变异自证时发现】markdown-it 把**行内**的开标签与
// 闭标签拆成**两个独立的 html_inline token**，中间的内容是普通 text token：
//
//   `前 <iframe src=…>载荷</iframe> 后`
//     → text("前 ") + html_inline("<iframe …>") + text("载荷")
//       + html_inline("</iframe>") + text(" 后")
//
// 于是 sanitizeHtml 里那条「危险容器连同内容整段删除」的正则跨不了 token：
// 每个 token 单独净化时，开标签被删、内容留下、闭标签被**转义成可见文本**。
// 界面上就是「前 载荷&lt;/iframe&gt; 后」—— 安全上没问题（无活标签、无执行
// 载体），但用户看到一段尖括号残渣，很容易再次反馈「HTML 标签不支持」。
// 块级形态（独占一行的 `<script>`）不受影响：它整体是一个 html_block token，
// 正则能跨过去。
//
// 修法：在 core 阶段扫一遍 inline token 的 children，按「容器开 → 容器闭」整段
// 丢弃（含中间内容），孤立闭标签也一并丢弃。**不做字符串拼接** —— 一旦把多个
// token 拼回字符串再净化，行内代码 / 自动链接等 token 的边界就没了。

/** 危险容器标签名（连同内容整段丢弃） */
const DANGEROUS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript'])

/** 从一个 html_inline token 的 content（形如 `<iframe …>` / `</iframe>`）取标签信息 */
function tagInfoOf(content) {
  // 开头的 `<` 必须吃掉：html_inline 的 content 是**含尖括号的原文**，
  // 不含 `<` 的正则对它恒不匹配（实测踩过：规则挂上了却一条都没丢）。
  const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(content)
  return m ? { closing: m[1] === '/', name: m[2].toLowerCase() } : null
}

/**
 * 从一段 inline children 里剔除危险容器（含内容）。
 *
 * 用 depth 计数而不是「找到同名闭标签就丢」：`<iframe><iframe>…</iframe>x</iframe>`
 * 这种畸形嵌套若只丢到第一个闭标签，后半截会漏出来变成文本。
 *
 * @param {object[]} children markdown-it 的 inline token 子节点（会被就地过滤）
 * @returns {number} 丢弃的 token 数（0 表示没动 —— 调用方据此避免无谓改动）
 */
export function stripDangerousRuns(children) {
  let depth = 0
  let dropped = 0
  const kept = []
  for (const tok of children) {
    if (tok.type === 'html_inline') {
      const info = tagInfoOf(tok.content)
      if (info && DANGEROUS.has(info.name)) {
        dropped++
        if (info.closing) {
          if (depth > 0) depth--
        } else {
          depth++
        }
        continue
      }
    }
    if (depth > 0) { dropped++; continue }
    kept.push(tok)
  }
  if (!dropped) return 0
  children.length = 0
  children.push(...kept)
  return dropped
}

/**
 * markdown-it 规则安装（html_inline / html_block 两处 token 层净化）。
 *
 * 与任务列表插件的补丁**必须共存**：markdown-it-task-lists 在 enabled:true 下
 * 产出的 `<input class="task-list-item-checkbox"type="checkbox">` 缺一个空格
 * （已知缺陷，见 preview/markdown.js 的历史注释）。而 `input` 不在白名单里，
 * 会被净化成文本 —— 故含该 marker 的 chunk 走「补空格 + 原样放行」分支。
 *
 * @param {import('markdown-it')} md
 */
export function installHtmlSanitizer(md) {
  const TASK_RE = /class="task-list-item-checkbox"(?: checked="")?type=/
  const clean = (content) => {
    if (TASK_RE.test(content)) {
      // 任务勾选框：只做缺空格修补，不做白名单重建（它是插件产物，不是用户手写）
      return content.replace(/(class="task-list-item-checkbox"(?: checked="")?)type=/g, '$1 type=')
    }
    return sanitizeHtml(content)
  }
  md.renderer.rules.html_inline = (tokens, idx) => clean(tokens[idx].content)
  md.renderer.rules.html_block = (tokens, idx) => clean(tokens[idx].content)

  // core 阶段清剿行内危险容器（见上方 stripDangerousRuns 的根因说明）。
  // 排在 inline 之后：此时 inline token 的 children 已经解析完，能整段丢。
  md.core.ruler.after('inline', 'html_dangerous_runs', (state) => {
    for (const tok of state.tokens) {
      if (tok.type === 'inline' && tok.children) stripDangerousRuns(tok.children)
    }
  })
}
