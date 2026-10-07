// 让 CodeMirror 的 markdown 代码围栏识别常见语言。
// 注意：codeLanguages 回调必须返回 Language 本身（LanguageSupport.language），
// 不能返回 LanguageSupport——lang-markdown 的 getCodeParser 取的是 found.parser，
// LanguageSupport 没有 .parser 属性，返回它会静默退化为纯文本（无高亮无颜色）。
import { javascript } from '@codemirror/lang-javascript'
import { java } from '@codemirror/lang-java'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'

const map = {
  js: javascript, javascript, mjs: javascript, cjs: javascript,
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  java,
  html, xml: html, xhtml: html, svg: html, vue: html, svelte: html,
  css, scss: css, less: css, sass: css, stylus: css,
  json, json5: json, jsonc: json,
  py: python, python, pyw: python, pyi: python,
}

export default function codeLanguages(info) {
  if (!info) return null
  const support = map[info.trim().toLowerCase().split(/\s+/)[0]]
  return support ? support().language : null
}
