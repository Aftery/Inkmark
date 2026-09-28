// 编辑器封装：CodeMirror 6 + Markdown 高亮
// 主题通过 CSS 变量注入，明暗切换时无需重建编辑器
import { EditorView, keymap, highlightActiveLine, lineNumbers, highlightSpecialChars } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import codeLanguages from './markdownHighlight'

// Markdown 语法着色（引用 CSS 变量，自动跟随明暗主题）
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: 'bold' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: 'bold' },
  { tag: t.heading3, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: "'SF Mono', Menlo, monospace" },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.quote, color: 'var(--text-secondary)' },
])

export function createEditor(parent, { doc = '', onDocChange, onScroll }) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onDocChange(update.state.doc.toString())
    if (update.scrollChanged && onScroll) {
      onScroll(update.view.scrollDOM.scrollTop, update.view.scrollDOM.scrollHeight - update.view.scrollDOM.clientHeight)
    }
  })

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages }),
      syntaxHighlighting(mdHighlight, { fallback: true }),
      EditorView.theme({
        '&': {
          height: '100%',
          backgroundColor: 'var(--editor-bg)',
          color: 'var(--editor-text)',
          fontSize: '14px',
        },
        '.cm-content': { fontFamily: "'SF Mono', Menlo, Consolas, monospace", caretColor: 'var(--accent)' },
        '.cm-gutters': {
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-secondary)',
          border: 'none',
          borderRight: '1px solid var(--border)',
        },
        '.cm-activeLine': { backgroundColor: 'var(--bg-secondary)' },
        '.cm-activeLineGutter': { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' },
        '&.cm-focused': { outline: 'none' },
        '.cm-cursor': { borderLeftColor: 'var(--accent)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
        },
      }),
      updateListener,
    ],
  })

  return new EditorView({ state, parent })
}
