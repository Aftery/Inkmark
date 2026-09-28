// 预览渲染：markdown-it + highlight.js
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

export function createRenderer() {
  return new MarkdownIt({
    html: false,          // 不渲染原始 HTML，防注入（本地工具可开，默认关）
    linkify: true,        // 自动识别 URL
    breaks: true,         // 单个换行转成 <br>，符合写作直觉
    typographer: true,    // 智能标点："quotes" → “curly”
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value
        } catch { /* 落到下面的转义分支 */ }
      }
      return '' // 空串 = 让 markdown-it 自己做转义
    },
  })
}

export function render(renderer, markdown) {
  return renderer.render(markdown)
}
