// 编辑器侧代码围栏的语言映射。
// 必须返回 Language（LanguageSupport.language）；返回 LanguageSupport 会让
// lang-markdown 静默退化成纯文本。
// 只使用已安装的 @codemirror/lang-*；rust/bash/yaml 等没有官方包，预览区由
// highlight.js 高亮，编辑器内保持纯文本。
import { javascript } from '@codemirror/lang-javascript'
import { java } from '@codemirror/lang-java'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { sql, MySQL, PostgreSQL as postgresql, SQLite as sqlite, MSSQL } from '@codemirror/lang-sql'

// 复用同一个 LanguageSupport 工厂函数，避免每次调用都重建扩展对象
const ts = () => javascript({ typescript: true })

const map = {
  // ---- JavaScript / TypeScript 家族 ----
  js: javascript, javascript, mjs: javascript, cjs: javascript,
  jsx: () => javascript({ jsx: true }),
  ts, typescript: ts, mts: ts, cts: ts,
  tsx: () => javascript({ typescript: true, jsx: true }),

  // ---- Java ----
  java,

  // ---- HTML / XML 家族（lang-html 能内嵌 css/js，也覆盖常见模板语法）----
  html, htm: html, xhtml: html, xml: html, svg: html,
  vue: html, svelte: html, astro: html, hbs: html, handlebars: html,

  // ---- CSS 家族 ----
  css, scss: css, less: css, sass: css, stylus: css,

  // ---- JSON 家族（json5 / jsonc / jsonl 都按 json 解析）----
  json, json5: json, jsonc: json, jsonl: json,

  // ---- Python ----
  py: python, python, pyw: python, pyi: python,

  // ---- C / C++ 家族 ----
  c: cpp, h: cpp, cpp, cc: cpp, cxx: cpp, 'c++': cpp,
  hpp: cpp, hh: cpp, hxx: cpp,

  // ---- Go ----
  go, golang: go,

  // ---- SQL 家族 ----
  sql,
  mysql: () => sql({ dialect: MySQL }),
  postgresql: () => sql({ dialect: postgresql }), postgres: () => sql({ dialect: postgresql }),
  sqlite: () => sql({ dialect: sqlite }),
  mssql: () => sql({ dialect: MSSQL }),
}

export default function codeLanguages(info) {
  if (!info) return null
  // 围栏信息串可能带额外参数（```js title="x"），只取第一个词
  const support = map[info.trim().toLowerCase().split(/\s+/)[0]]
  return support ? support().language : null
}
