// 编辑器封装：CodeMirror 6 · 写作工具形态
// ----------------------------------------------------------------------------
// 1) 无行号、无整行高亮：这是写作器，不是代码编辑器（行号/活动行属代码定位心智）
// 2) 正文使用 --font-body 15px / 行高 1.7，与预览区完全一致 —— 左右两栏文字基线对齐的前提
// 3) 语法着色全部引用 CSS 变量，明暗切换无需重建编辑器
// 4) Markdown 结构字号与预览区标题阶梯一致（30/24/20/17/16/15 @ 15px 基准），
//    围栏代码与预览区 highlight.js 共用同一套 --hl-* 变量（单一色板）
import { EditorView, keymap, highlightSpecialChars } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import codeLanguages from './markdownHighlight'

// 语法着色：Markdown 结构 + 围栏代码
const mdHighlight = HighlightStyle.define([
  /* ---- Markdown 结构：字号对齐预览区标题阶梯，保证左右视觉一致 ---- */
  { tag: t.heading1, fontSize: '2em',     fontWeight: '590', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.6em',   fontWeight: '590', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.333em', fontWeight: '510', lineHeight: '1.3' },
  { tag: t.heading4, fontSize: '1.133em', fontWeight: '510', lineHeight: '1.3' },
  { tag: t.heading5, fontSize: '1.067em', fontWeight: '510', lineHeight: '1.3' },
  { tag: t.heading6, fontSize: '1em',     fontWeight: '510', color: 'var(--muted)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '510' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.quote, color: 'var(--fg-2)' },

  /* ---- 围栏代码：与 preview.css 的 .hljs-* 映射一一对应 ---- */
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword,
          t.definitionKeyword, t.modifier],
    color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.special(t.variableName)],
    color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.atom],
    color: 'var(--hl-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    color: 'var(--hl-title)' },
  { tag: [t.typeName, t.className, t.namespace],
    color: 'var(--hl-title)' },
  { tag: [t.propertyName, t.attributeName, t.attributeValue, t.labelName],
    color: 'var(--hl-attr)' },
  { tag: [t.variableName, t.definition(t.variableName)],
    color: 'var(--hl-attr)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--muted)' },
  { tag: t.invalid, color: 'var(--danger)' },
])

export function createEditor(parent, { doc = '', onDocChange, onScroll }) {
  // 只监听文档变化。滚动不要在这里监听 —— CM6 的 ViewUpdate 根本没有 scrollChanged
  // 这个属性（真实属性只有 docChanged/selectionSet/focusChanged/viewportChanged/
  // heightChanged/geometryChanged 等），写了永远是 undefined，滚动联动会静默失效。
  // 滚动用下面的原生 scroll 事件，与预览侧的 @scroll 完全对称。
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onDocChange) onDocChange(update.state.doc.toString())
  })

  const state = EditorState.create({
    doc,
    extensions: [
      highlightSpecialChars(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages }),
      syntaxHighlighting(mdHighlight, { fallback: true }),
      EditorView.theme({
        '&': {
          height: '100%',
          backgroundColor: 'var(--bg)',
          color: 'var(--fg)',
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-base)',      /* 15px，与预览区一致 */
          lineHeight: 'var(--leading-body)', /* 1.7，与预览区一致 */
        },
        '.cm-scroller': {
          fontFamily: 'var(--font-body)',
          lineHeight: 'var(--leading-body)',
        },
        '.cm-content': {
          fontFamily: 'var(--font-body)',
          lineHeight: 'var(--leading-body)',
          caretColor: 'var(--accent)',
          padding: 'var(--preview-padding-y) 0 var(--space-16)',  /* 与预览区上下留白一致，比例映射才准 */
        },
        '.cm-line': { padding: '0 var(--space-6)' },
        '&.cm-focused': { outline: 'none' },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--accent)',
          borderLeftWidth: '2px',
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
        },
        '.cm-scroller::-webkit-scrollbar': { width: '10px', height: '10px' },
        '.cm-scroller::-webkit-scrollbar-thumb': {
          backgroundColor: 'var(--border-strong)',
          borderRadius: 'var(--radius-pill)',
        },
      }),
      updateListener,
    ],
  })

  const view = new EditorView({ state, parent })

  // 滚动联动（编辑区 → 预览区）：用原生 scroll 事件，与预览侧的 @scroll 对称
  if (onScroll) {
    view.scrollDOM.addEventListener('scroll', () => {
      onScroll(view.scrollDOM.scrollTop,
               view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
    })
  }

  return view
}
