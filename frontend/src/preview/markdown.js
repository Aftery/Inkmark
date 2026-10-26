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
import { createSlugCounter } from '../editor/anchors.js'
import { resolveAssetSrc } from '../editor/assetUrl.js'
// 扩展语法（HTML 白名单 / 表情 / 脚注 / 公式）全部经 markdown/ 下的模块接入。
// 为什么是「模块」而不是散在本文件里：编辑器 WYSIWYG 侧要用同一份口径
// （标签清单、短码表、KaTeX 选项、脚注编号），两边各写一份必然漂移。
import { installHtmlSanitizer } from '../markdown/html.js'
import { emojiPlugin } from '../markdown/emoji.js'
import { installFootnote } from '../markdown/footnote.js'
import { mathPlugin } from '../markdown/math.js'

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
    // html 开成 true 才能渲染 <kbd> / <mark> / <details> / <span style="color:red">
    // 这类用户手写标签（真机反馈「HTML 标签不支持」）。**安全性不靠这个开关**，
    // 靠 markdown/html.js 的白名单重建：认识的标签按属性白名单重写、其余转义成
    // 文本。原文关着它时这些语法会以裸尖括号显示，用户以为「编辑器不支持 HTML」。
    html: true,
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
  // GFM 任务列表
  md.use(taskLists, { enabled: true, label: true, labelAfter: false })
  // 扩展语法。顺序有讲究：
  //   · 任务列表先装 —— installHtmlSanitizer 的 html_inline 规则里保留了
  //     「勾选框缺空格」的定点修补（见 markdown/html.js 的 clean()）。
  //   · 脚注在 emoji 之前装：脚注定义行 `[^1]: …` 的内容也要能写表情。
  //   · 公式最后装：`$…$` 规则挂在 escape 之后，与脚注/链接的 `[` `]` 不冲突。
  installHtmlSanitizer(md)
  installFootnote(md)
  emojiPlugin(md)
  mathPlugin(md)
  // 标题写 id（「插入 → 目录」链接的跳转目标）：slug 生成规则在 editor/anchors.js，
  // 与目录插入共用同一套顺序去重计数，两边的 id 严格对应。
  md._slugs = createSlugCounter()
  md.renderer.rules.heading_open = (tokens, idx) => {
    const inline = tokens[idx + 1]
    const text = inline && inline.type === 'inline' ? inline.content : ''
    return `<${tokens[idx].tag} id="${md._slugs.slug(text)}">`
  }
  // 图片 src 改写（仅预览面，见 render 的 resolveAssets 开关与 assetUrl.js 文件头）：
  // webview 里文档相对路径解析不到磁盘文件，必须经 /doc-assets/ 由 Go 读盘。
  // 导出 HTML/PDF 走默认分支不改写 —— 落盘 HTML 与文档同级，相对路径在浏览器
  // 里本来就能加载，写死 wails 内部 URL 反而把导出产物弄坏。
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (md._resolveAssets) {
      const src = token.attrGet('src')
      if (src) token.attrSet('src', resolveAssetSrc(src))
    }
    return self.renderToken(tokens, idx, options)
  }
  return md
}

/**
 * @param {object} renderer createRenderer() 的产物
 * @param {string} markdown 原文
 * @param {{resolveAssets?: boolean, mathOutput?: 'html'|'mathml'}} [opts]
 *   resolveAssets —— 应用内预览为 true（图片走 /doc-assets/），导出为 false
 *   mathOutput    —— 应用内 'html'（KaTeX 自带字体随包），导出 'mathml'
 *                    （自包含，不依赖导出目录里有字体，见 markdown/math.js 头注）
 */
export function render(renderer, markdown, { resolveAssets = false, mathOutput = 'html' } = {}) {
  renderer._slugs = createSlugCounter() // 每次渲染重置去重计数，重复标题稳定为 -1/-2…
  renderer._resolveAssets = resolveAssets
  renderer._mathOutput = mathOutput
  // env 必须每篇一份：markdown-it-footnote 把脚注清单存在 env.footnotes 里，
  // 复用同一个 env 对象会让上一篇文档的脚注串到下一篇（打开第二个文件时
  // 底部突然多出上一个文件的脚注，且编号从 3 开始）。
  return renderer.render(markdown, {})
}
