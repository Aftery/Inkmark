// 导出能力：HTML（走系统保存对话框）+ PDF（打印）
// 依赖 Go 端暴露的 SaveFileDialog / WriteFile（wailsjs 生成绑定）
//
// 设计语言：与预览区（themes/preview.css）一致 —— 赭石墨配色、
// 标题无下划线、引用块无彩色竖线、正文限宽居中、字号行高与编辑区一致。
//
// 裸 hex 说明：本文件是「自包含 HTML 生成器」，导出产物必须脱离编辑器独立可看，
// 因此需要把 Token 值内联为静态值 —— 这与组件层的「禁止裸 hex」约束性质不同，
// 属于 ADR-002 中「token 定义/生成文件」一类（AC-05 豁免，原因见下）。

export function buildHtmlDocument(title, bodyHtml, theme) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
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
// 取值来源：frontend/src/themes/tokens/design-tokens.css（改动 Token 时同步这里）。
const exportCss = `
:root[data-theme='light'] {
  --bg:#FFFFFF; --fg:#1E1D1B; --fg-2:#4A4844; --muted:#8B877F;
  --accent:#B45309; --border:#E6E4E0; --surface-warm:#F6F5F3;
  --code-bg:#F6F5F3; --code-inline-bg:#F1EFEC; --code-border:#E6E4E0;
  --font-body:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;
  --font-mono:"SF Mono","JetBrains Mono","Fira Code",Menlo,Consolas,monospace;
  --hl-keyword:#A6392A; --hl-string:#4C7A44; --hl-number:#23608F;
  --hl-title:#8A5A24; --hl-comment:#8E8A82; --hl-attr:#6E5A1E;
}
:root[data-theme='dark'] {
  --bg:#1F1F1E; --fg:#E7E4DF; --fg-2:#B3AFA8; --muted:#857F76;
  --accent:#D98B4A; --border:#35332F; --surface-warm:#262523;
  --code-bg:#262523; --code-inline-bg:#2B2A27; --code-border:#35332F;
  --hl-keyword:#E08C7C; --hl-string:#A8C68C; --hl-number:#84B4DB;
  --hl-title:#D8B173; --hl-comment:#8A857C; --hl-attr:#C7A86A;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg);
  font-family:var(--font-body); font-size:15px; line-height:1.7;
}
article.preview-body{
  max-width:46rem; margin:0 auto; padding:40px 24px 64px;
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
ul,ol{padding-left:1.5em;margin:12px 0}
li{margin:4px 0}
li::marker{color:var(--muted)}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:.9375em}
th,td{border:1px solid var(--border);padding:8px 12px;text-align:left}
th{font-weight:510;background:var(--surface-warm)}
hr{border:none;border-top:1px solid var(--border);margin:32px 0}
img{max-width:100%;border-radius:6px}
input[type='checkbox']{margin-right:8px;accent-color:var(--accent)}
li:has(> input[type='checkbox']:checked){color:var(--muted);text-decoration:line-through}
@media print{
  body{background:#fff;color:#000}
  article.preview-body{max-width:none;margin:0;padding:0}
  pre,blockquote,table{break-inside:avoid}
}
`
