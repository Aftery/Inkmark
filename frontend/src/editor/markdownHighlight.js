// 让 CodeMirror 的 markdown 代码围栏识别常见语言
// @codemirror/lang-markdown 的 codeLanguages 需要一个 (info) => LanguageSupport 的函数
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'

const map = {
  js: javascript, javascript, jsx: javascript, ts: javascript, typescript: javascript, tsx: javascript,
  html, xml: html, vue: html,
  css, scss: css, less: css,
  json, jsonc: json,
  py: python, python,
}

export default function codeLanguages(info) {
  if (!info) return null
  const lang = map[info.trim().toLowerCase().split(/\s+/)[0]]
  return lang ? lang() : null
}
