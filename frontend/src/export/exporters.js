// 导出能力：HTML（走系统保存对话框）+ PDF（打印）
// 依赖 Go 端暴露的 SaveFileDialog / WriteFile（wailsjs 生成绑定）

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

// 导出用样式：把当前主题的 CSS 变量值内联成静态值，脱离编辑器也能看
const exportCss = `
:root[data-theme='light'] {
  --bg-primary:#fff; --bg-secondary:#f5f6f8; --text-primary:#1f2329;
  --text-secondary:#646a73; --accent:#3370ff; --border:#dee0e3; --code-bg:#f2f3f5;
}
:root[data-theme='dark'] {
  --bg-primary:#1a1b1e; --bg-secondary:#232427; --text-primary:#e8e9eb;
  --text-secondary:#9ca0a6; --accent:#4d7fff; --border:#3a3b3f; --code-bg:#2a2b2e;
}
body { background: var(--bg-primary); color: var(--text-primary);
  font-family: -apple-system, 'PingFang SC', sans-serif; max-width: 820px;
  margin: 0 auto; padding: 40px 24px; }
.preview-body { line-height: 1.7; font-size: 15px; }
h1{font-size:1.8em;border-bottom:1px solid var(--border);padding-bottom:.3em;margin:1em 0 .6em}
h2{font-size:1.45em;border-bottom:1px solid var(--border);padding-bottom:.3em;margin:1em 0 .5em}
h3{font-size:1.2em;margin:.8em 0 .4em} p{margin:.6em 0}
a{color:var(--accent);text-decoration:none}
code{background:var(--code-bg);border-radius:4px;padding:.15em .4em;
  font-family:'SF Mono',Menlo,monospace;font-size:.88em}
pre{background:var(--code-bg);border-radius:8px;padding:14px 16px;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--accent);color:var(--text-secondary);
  padding:2px 0 2px 14px;margin:.8em 0}
ul,ol{padding-left:1.6em} table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--border);padding:6px 12px} th{background:var(--bg-secondary)}
img{max-width:100%}
@media print { body { background: #fff; color: #000; } pre, blockquote { break-inside: avoid; } }
`
