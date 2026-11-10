/**
 * html-comment.test.mjs — 编辑器里 HTML 注释必须不可见（对齐 GitHub 预览）
 * ---------------------------------------------------------------------------
 * 预览侧 markdown/html.js 的净化器会整段删掉 `<!-- … -->`（浏览器里本来就
 * 不显示），编辑器侧若保留源码，同一份文档就出现「编辑时看得见、预览里没有」
 * 的分叉。判据分两类：
 *   - 注释本体（单行 / 多行）被整段隐藏，且隐藏区间不跨行（插件跨行 replace
 *     会被 CodeMirror 直接抛 RangeError）；
 *   - 注释两侧的正文一个字符都不许被连带隐藏（「把用户正文吃掉」是最坏结果）。
 * 走真实 EditorState + buildDecorations，不拿源码正则假装验证。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { buildDecorations, wysiwygField } from '../src/editor/wysiwyg.js'
import { createRenderer, render } from '../src/preview/markdown.js'
import { initI18n } from '../src/i18n/index.js'

initI18n()

const SENTINEL = '\n\n哨兵\n'

function mkState(doc) {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage }), wysiwygField],
  })
}

/** 只返回「整段隐藏」装饰（widget === null），用来区分隐藏与替换 */
function hiddenOf(body) {
  const doc = body + SENTINEL
  const state = mkState(doc)
  const { deco } = buildDecorations(state, [{ from: 0, to: doc.length }])
  const hidden = []
  deco.between(0, doc.length, (from, to, val) => {
    if (!val.widget && to > from) hidden.push({ from, to, text: doc.slice(from, to) })
  })
  return { hidden, doc }
}

/** 整行是否被隐藏装饰完整覆盖（行尾换行不算） */
function lineHidden(hidden, doc, lineText) {
  const start = doc.indexOf(lineText)
  assert.ok(start >= 0, `文档里找不到这一行：${JSON.stringify(lineText)}`)
  const end = start + lineText.length
  return hidden.some((h) => h.from <= start && h.to >= end)
}

describe('HTML 注释 · 编辑器侧不可见', () => {
  test('独占一行的注释整行隐藏，不留源码', () => {
    const { hidden, doc } = hiddenOf('<!-- 这是注释 -->\n正文\n')
    assert.ok(lineHidden(hidden, doc, '<!-- 这是注释 -->'), '单行注释没有隐藏')
    assert.equal(hidden.length, 1, `只应隐藏注释这一段，实际 ${hidden.length} 段`)
  })

  test('多行注释逐行隐藏（隐藏区间绝不跨行）', () => {
    const body = '<!--\n  第一行注释\n  第二行注释\n-->\n正文\n'
    const { hidden, doc } = hiddenOf(body)
    for (const line of ['<!--', '  第一行注释', '  第二行注释', '-->']) {
      assert.ok(lineHidden(hidden, doc, line), `多行注释的 ${JSON.stringify(line)} 没有隐藏`)
    }
    for (const h of hidden) {
      assert.ok(!h.text.includes('\n'), `隐藏区间跨行了：${JSON.stringify(h.text)}`)
    }
  })

  test('行内注释只隐藏注释本体，两侧正文保留', () => {
    const { hidden } = hiddenOf('前面<!-- 隐藏 -->后面\n')
    assert.deepEqual(
      hidden.map((h) => h.text),
      ['<!-- 隐藏 -->'],
      '行内注释两侧的正文被连带隐藏了'
    )
  })

  test('代码块里的 `<!-- -->` 是代码，必须保持可见', () => {
    const { hidden, doc } = hiddenOf('```html\n<!-- 示例 -->\n```\n')
    // 围栏行本身由代码块渲染接管（隐藏围栏标记），这里只关心注释那一行
    assert.ok(!hidden.some((h) => h.text.includes('<!--')), '围栏代码块里的注释被隐藏了')
    assert.ok(
      !lineHidden(hidden, doc, '<!-- 示例 -->'),
      '围栏代码块里的注释行被整行隐藏了 —— 代码块内容应原样可见'
    )
  })

  test('光标所在行（活跃行）保持源码，便于编辑或删除注释', () => {
    const doc = '<!-- 要改的注释 -->\n正文\n'
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), wysiwygField],
    })
    const { deco } = buildDecorations(state, [{ from: 0, to: doc.length }])
    const hidden = []
    deco.between(0, doc.length, (from, to, val) => {
      if (!val.widget && to > from) hidden.push(doc.slice(from, to))
    })
    assert.deepEqual(hidden, [], '活跃行上的注释被隐藏了 —— 用户没法点到它')
  })

  test('渲染器侧同样不可见：输出里没有注释源码与内容', () => {
    const html = render(createRenderer(), '前<!-- 注释 -->后\n\n<!-- 整段 -->\n正文\n')
    assert.ok(!html.includes('<!--'), '预览输出里仍带注释标记')
    assert.ok(!html.includes('注释'), '预览输出里仍带注释内容')
    assert.match(html, /前后/, '注释两侧的正文被净化器吃掉了')
    assert.match(html, /正文/, '注释之后的正文丢了')
  })
})
