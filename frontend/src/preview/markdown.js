// 预览渲染：markdown-it + highlight.js
//
// 高亮瘦身：用 lib/core + 按需注册，替代整库导入（原 `highlight.js` 会全量
// 打包约 190 种语言，且默认导出无法被 tree-shake）。此处只注册常用语言，
// 未注册的语言在渲染时 getLanguage 返回 undefined → 退化为纯文本（不高亮，
// 不影响显示与转义）。需要新增语言时，下方加一行 import + 一行注册即可。
//
// 别名无需手动声明：highlight.js 语言模块自带 aliases（如 js/jsx/mjs、
// ts、py、sh/shell/zsh、yml、md、html=xml、c++/cc 等），registerLanguage
// 会自动登记。
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import { createSlugCounter } from '../editor/anchors'

import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import rust from 'highlight.js/lib/languages/rust'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import diff from 'highlight.js/lib/languages/diff'
import markdown from 'highlight.js/lib/languages/markdown'

/** 已注册语言清单：键为规范名，别名由模块自带（见文件头注释）。 */
const LANGUAGES = {
  javascript, typescript, python, go, java, c, cpp, csharp, rust, php,
  ruby, swift, kotlin, json, yaml, xml, css, sql, bash, dockerfile, diff, markdown,
}
for (const [name, lang] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, lang)
}

export function createRenderer() {
  const md = new MarkdownIt({
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
  // 标题写 id（「插入 → 目录」链接的跳转目标）：slug 生成规则在 editor/anchors.js，
  // 与目录插入共用同一套顺序去重计数，两边的 id 严格对应。
  md._slugs = createSlugCounter()
  md.renderer.rules.heading_open = (tokens, idx) => {
    const inline = tokens[idx + 1]
    const text = inline && inline.type === 'inline' ? inline.content : ''
    return `<${tokens[idx].tag} id="${md._slugs.slug(text)}">`
  }
  return md
}

export function render(renderer, markdown) {
  renderer._slugs = createSlugCounter() // 每次渲染重置去重计数，重复标题稳定为 -1/-2…
  return renderer.render(markdown)
}
