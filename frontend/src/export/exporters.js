// 导出能力：HTML（走系统保存对话框）+ PDF（打印）
// 依赖 Go 端暴露的 SaveFileDialog / WriteFile（wailsjs 生成绑定）
//
// 设计语言：与预览区（themes/preview.css）一致 —— 三主题（浅 Indigo / 深 Indigo / 纸感赭石）、
// 标题无下划线、引用块无彩色竖线、正文限宽居中、字号行高与编辑区一致。
//
// 裸 hex 说明：本文件是「自包含 HTML 生成器」，导出产物必须脱离编辑器独立可看，
// 因此需要把 Token 值内联为静态值 —— 这与组件层的「禁止裸 hex」约束性质不同，
// 属于 ADR-002 中「token 定义/生成文件」一类（AC-05 豁免，原因见下）。

// 版式宽参数化（phaseC-visual-spec §8.8 / ADR-003 已知坑 19）：
// 同一份模板只暴露**一个**宽度变量 --export-measure，由出口场景注入值 ——
//   HTML 导出 → 46rem（屏幕阅读舒适行宽，维持现状）
//   PDF 导出 → 467px（与 A4 版心宽 467pt 一致，1 CSS px = 1 pt，分页以此为准）
// 禁止用 transform: scale / zoom 凑宽度（会破坏 1 px = 1 pt 的分页假设）。
export const HTML_EXPORT_MEASURE = '46rem'
export const PDF_EXPORT_MEASURE = '467px'
// Linux（GTK 打印到文件）用 96dpi 排版：A4 减去四边 64pt 后的可打印宽
// 467pt ≈ 622px。用 467px 会让正文只占 350pt，左右各多出 ~58pt 空白。
export const PDF_EXPORT_MEASURE_GTK = '622px'

export function buildHtmlDocument(title, bodyHtml, theme, measure = HTML_EXPORT_MEASURE) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
:root{--export-measure:${measure}}
${exportCss}
</style>
</head>
<body>
<article class="preview-body">
${bodyHtml}
</article>
</body>
</html>`
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// 导出用样式：把当前主题的 CSS 变量值内联成静态值，脱离编辑器也能看。
// 三套主题（light / dark / paper）由调用方传入的 theme 参数经 <html data-theme> 选择；
// 取值来源：frontend/src/themes/tokens/design-tokens.css（改动 Token 时同步这里）。
const exportCss = `
:root,
:root[data-theme='light'] {
  --bg:#FFFFFF; --fg:#16171D; --fg-2:#40434E; --muted:#6B6E7A;
  --accent:#4F46E5; --border:#E5E6EC; --surface-warm:#F3F4F8;
  --border-soft:#EEEFF4; --surface-2:#EEF0F4; --border-strong:#D3D5DE;
  --code-bg:#F7F8FA; --code-inline-bg:#F1F2F6; --code-border:#E5E6EC;
  --font-body:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;
  --font-mono:"SF Mono","JetBrains Mono","Fira Code",Menlo,Consolas,monospace;
  --leading-body:1.7;
  --hl-keyword:#A6392A; --hl-string:#4C7A44; --hl-number:#23608F;
  --hl-title:#8A5A24; --hl-comment:#8E8A82; --hl-attr:#6E5A1E;
}
:root[data-theme='dark'] {
  --bg:#14151A; --fg:#E7E8ED; --fg-2:#B4B7C2; --muted:#8A8D99;
  --accent:#6E76F0; --border:#2A2C34; --surface-warm:#1C1E25;
  --border-soft:#20222A; --surface-2:#21232B; --border-strong:#3A3D47;
  --code-bg:#1C1E25; --code-inline-bg:#21232B; --code-border:#2A2C34;
  --leading-body:1.7;
  --hl-keyword:#E08C7C; --hl-string:#A8C68C; --hl-number:#84B4DB;
  --hl-title:#D8B173; --hl-comment:#8A857C; --hl-attr:#C7A86A;
}
:root[data-theme='paper'] {
  --bg:#FAF7F1; --fg:#2A2620; --fg-2:#4E4941; --muted:#6F675A;
  --accent:#9D5A2F; --border:#E5DED0; --surface-warm:#F1EADF;
  --border-soft:#EDE7DB; --surface-2:#EFE8DC; --border-strong:#DAD2C2;
  --code-bg:#F3EEE5; --code-inline-bg:#EFE9DD; --code-border:#E5DED0;
  --font-body:Georgia,"Times New Roman","Songti SC","Noto Serif SC","Source Han Serif SC","STSong",SimSun,serif;
  --font-mono:"SF Mono","JetBrains Mono","Fira Code",Menlo,Consolas,monospace;
  --leading-body:1.8;
  --hl-keyword:#A6392A; --hl-string:#4C7A44; --hl-number:#23608F;
  --hl-title:#8A5A24; --hl-comment:#8E8A82; --hl-attr:#6E5A1E;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg);
  font-family:var(--font-body); font-size:15px; line-height:var(--leading-body);
}
article.preview-body{
  max-width:var(--export-measure); margin:0 auto; padding:40px 24px 64px;
  overflow-wrap:break-word;
}
h1,h2,h3,h4,h5,h6{font-weight:590;line-height:1.3;letter-spacing:-.01em;color:var(--fg)}
h1{font-size:1.875rem;margin:40px 0 16px}
h2{font-size:1.5rem;margin:32px 0 12px}
h3{font-size:1.25rem;margin:24px 0 8px}
h4{font-size:1.0625rem;margin:20px 0 8px}
h5{font-size:1rem;margin:16px 0 8px}
h6{font-size:.9375rem;color:var(--muted);margin:16px 0 8px}
p{margin:12px 0}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:2px}
strong{font-weight:510;color:var(--fg)}
code{
  font-family:var(--font-mono);font-size:.875em;
  background:var(--code-inline-bg);border:1px solid var(--code-border);
  border-radius:6px;padding:.1em .35em;
}
pre{
  background:var(--code-bg);border:1px solid var(--code-border);
  border-radius:8px;padding:12px 16px;overflow-x:auto;margin:16px 0;line-height:1.4;
}
pre code{background:none;border:none;border-radius:0;padding:0;color:var(--fg)}
blockquote{
  margin:16px 0;padding:8px 16px;
  background:var(--surface-warm);border-radius:6px;color:var(--fg-2);
}
blockquote p{margin:4px 0}
/* 嵌套引用分层：三层逐级加深（与 themes/markdown-extras.css 同一规则） */
blockquote blockquote{background:color-mix(in srgb, var(--fg) 4%, var(--surface-warm));margin:8px 0}
blockquote blockquote blockquote{background:color-mix(in srgb, var(--fg) 8%, var(--surface-warm))}
blockquote blockquote blockquote blockquote{background:color-mix(in srgb, var(--fg) 10%, var(--surface-warm))}
ul,ol{padding-left:1.5em;margin:12px 0}
li{margin:4px 0}
li::marker{color:var(--muted)}
table{border-collapse:collapse;width:100%;max-width:100%;margin:16px 0;font-size:.9375em}
th,td{border:1px solid var(--border);padding:10px 14px;text-align:left;vertical-align:top;white-space:normal;word-break:normal;overflow-wrap:break-word}
th{font-weight:510;background:var(--surface-warm)}
hr{border:none;border-top:1px solid var(--border);margin:32px 0}
img{max-width:100%;border-radius:6px}
/* ---- 扩展语法（与 themes/markdown-extras.css 逐条对应） ---- */
details{
  margin:16px 0;padding:8px 16px;
  background:var(--surface-warm);border-radius:6px;border:1px solid var(--border-soft);
}
summary{cursor:pointer;font-weight:510;color:var(--fg);padding:4px 0}
details > *:not(summary){margin-top:8px}
details p:first-of-type{margin-top:8px}
details p:last-child{margin-bottom:4px}
kbd{
  font-family:var(--font-mono);font-size:.8125em;padding:.15em .45em;
  border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:6px;
  background:var(--surface-warm);color:var(--fg);white-space:nowrap;
}
mark{background:color-mix(in srgb, var(--accent) 22%, transparent);color:inherit;padding:0 .15em;border-radius:2px}
sup,sub{font-size:.75em;line-height:0}
small{font-size:.85em;color:var(--fg-2)}
abbr[title]{text-decoration:underline dotted;cursor:help}
.footnotes{margin-top:32px;padding-top:16px;border-top:1px solid var(--border-soft);font-size:.875em;color:var(--fg-2)}
.footnotes-title{font-size:.9375rem;font-weight:510;color:var(--muted);margin:0 0 8px;letter-spacing:0}
.footnotes-list{padding-left:1.25em;margin:0}
.footnote-item{margin:4px 0}
.footnote-item p{margin:0}
sup.footnote-ref{font-size:.75em;line-height:0}
sup.footnote-ref a{text-decoration:none;padding:0 .15em;border-radius:2px}
.footnote-backref{font-size:.875em;text-decoration:none;color:var(--muted);margin-left:.25em}
.md-math{display:inline-block;vertical-align:baseline}
.md-math-display{display:block}
.md-math-block{margin:16px 0;overflow-x:auto;overflow-y:hidden;padding:4px 0}
.md-math-block .katex-display{margin:0}
.katex-error,.md-math-error{color:#B4232A;font-family:var(--font-mono);font-size:.9em}
input[type='checkbox']{margin-right:8px;accent-color:var(--accent)}
li:has(> input[type='checkbox']:checked){color:var(--muted);text-decoration:line-through}
@media print{
  body{background:#fff;color:#000}
  article.preview-body{max-width:none;margin:0;padding:0}
  pre,blockquote,table,details{break-inside:avoid}
  /* 折叠块在纸面上没有「点击」：不强制展开的话，导出 PDF 会只剩 summary 一行，
   * 内容整段消失且不报错（用户以为导出丢了内容）。 */
  details > *:not(summary){display:block}
  .md-math-block{overflow:visible}
}
`
