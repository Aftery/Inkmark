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
import taskLists from 'markdown-it-task-lists'
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
// 补充常用语言（别名由模块自带）
import shell from 'highlight.js/lib/languages/shell'
import ini from 'highlight.js/lib/languages/ini'
import makefile from 'highlight.js/lib/languages/makefile'
import cmake from 'highlight.js/lib/languages/cmake'
import graphql from 'highlight.js/lib/languages/graphql'
import protobuf from 'highlight.js/lib/languages/protobuf'
import lua from 'highlight.js/lib/languages/lua'
import perl from 'highlight.js/lib/languages/perl'
import r from 'highlight.js/lib/languages/r'
import scala from 'highlight.js/lib/languages/scala'
import haskell from 'highlight.js/lib/languages/haskell'
import elixir from 'highlight.js/lib/languages/elixir'
import dart from 'highlight.js/lib/languages/dart'
import fsharp from 'highlight.js/lib/languages/fsharp'
import powershell from 'highlight.js/lib/languages/powershell'
import nginx from 'highlight.js/lib/languages/nginx'
import http from 'highlight.js/lib/languages/http'
import properties from 'highlight.js/lib/languages/properties'
import vim from 'highlight.js/lib/languages/vim'
import groovy from 'highlight.js/lib/languages/groovy'
import latex from 'highlight.js/lib/languages/latex'
import asciidoc from 'highlight.js/lib/languages/asciidoc'
import julia from 'highlight.js/lib/languages/julia'
import matlab from 'highlight.js/lib/languages/matlab'
import ocaml from 'highlight.js/lib/languages/ocaml'
import fortran from 'highlight.js/lib/languages/fortran'
import ada from 'highlight.js/lib/languages/ada'
import vhdl from 'highlight.js/lib/languages/vhdl'
import verilog from 'highlight.js/lib/languages/verilog'
import x86asm from 'highlight.js/lib/languages/x86asm'
import tcl from 'highlight.js/lib/languages/tcl'
import autohotkey from 'highlight.js/lib/languages/autohotkey'
import vbscript from 'highlight.js/lib/languages/vbscript'
import crystal from 'highlight.js/lib/languages/crystal'
import elm from 'highlight.js/lib/languages/elm'
import gherkin from 'highlight.js/lib/languages/gherkin'
import puppet from 'highlight.js/lib/languages/puppet'
import sas from 'highlight.js/lib/languages/sas'
import stan from 'highlight.js/lib/languages/stan'
import mathematica from 'highlight.js/lib/languages/mathematica'
import awk from 'highlight.js/lib/languages/awk'
import dos from 'highlight.js/lib/languages/dos'
import basic from 'highlight.js/lib/languages/basic'
import vbnet from 'highlight.js/lib/languages/vbnet'
import apache from 'highlight.js/lib/languages/apache'
import armasm from 'highlight.js/lib/languages/armasm'
import avrasm from 'highlight.js/lib/languages/avrasm'
import mipsasm from 'highlight.js/lib/languages/mipsasm'
import autoit from 'highlight.js/lib/languages/autoit'
import d from 'highlight.js/lib/languages/d'
import nim from 'highlight.js/lib/languages/nim'
import clojure from 'highlight.js/lib/languages/clojure'
import erlang from 'highlight.js/lib/languages/erlang'
import lisp from 'highlight.js/lib/languages/lisp'
import scheme from 'highlight.js/lib/languages/scheme'
import prolog from 'highlight.js/lib/languages/prolog'
import smalltalk from 'highlight.js/lib/languages/smalltalk'

/** 已注册语言清单：键为规范名，别名由模块自带（见文件头注释）。 */
const LANGUAGES = {
  javascript, typescript, python, go, java, c, cpp, csharp, rust, php,
  ruby, swift, kotlin, json, yaml, xml, css, sql, bash, dockerfile, diff, markdown,
  shell, ini, makefile, cmake, graphql, protobuf, lua, perl, r, scala,
  haskell, elixir, dart, fsharp, powershell, nginx, http, properties, vim,
  groovy, latex, asciidoc, julia, matlab, ocaml, fortran, ada, vhdl, verilog,
  x86asm, tcl, autohotkey, vbscript, crystal, elm, gherkin, puppet, sas, stan,
  mathematica, awk, dos, basic, vbnet, apache, armasm, avrasm, mipsasm, autoit,
  d, nim, clojure, erlang, lisp, scheme, prolog, smalltalk,
}
for (const [name, lang] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, lang)
}

export function createRenderer() {
  const md = new MarkdownIt({
    html: false,          // 不渲染原始 HTML，防注入（本地工具可开，默认关）
    linkify: true,        // 自动识别 URL
    breaks: true,         // 单个换行转成 <br>，符合写作直觉
    typographer: true,    // 智能标点：”quotes” → “curly”
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value
        } catch { /* 落到下面的转义分支 */ }
      }
      return '' // 空串 = 让 markdown-it 自己做转义
    },
  })
  // GFM 任务列表
  md.use(taskLists, { enabled: true, label: true, labelAfter: false })
  // 标题写 id（「插入 → 目录」链接的跳转目标）：slug 生成规则在 editor/anchors.js，
  // 与目录插入共用同一套顺序去重计数，两边的 id 严格对应。
  md._slugs = createSlugCounter()
  md.renderer.rules.heading_open = (tokens, idx) => {
    const inline = tokens[idx + 1]
    const text = inline && inline.type === 'inline' ? inline.content : ''
    return `<${tokens[idx].tag} id=”${md._slugs.slug(text)}”>`
  }
  return md
}

export function render(renderer, markdown) {
  renderer._slugs = createSlugCounter() // 每次渲染重置去重计数，重复标题稳定为 -1/-2…
  return renderer.render(markdown)
}
