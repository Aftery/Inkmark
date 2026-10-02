// 编辑器封装：CodeMirror 6 · 写作工具形态
// ----------------------------------------------------------------------------
// 1) 无行号、无整行高亮：这是写作器，不是代码编辑器（行号/活动行属代码定位心智）
// 2) 正文使用 --font-body 15px / 行高 1.7，与预览区完全一致 —— 左右两栏文字基线对齐的前提
// 3) 语法着色全部引用 CSS 变量，明暗切换无需重建编辑器
// 4) Markdown 结构字号与预览区标题阶梯一致（30/24/20/17/16/15 @ 15px 基准），
//    围栏代码与预览区 highlight.js 共用同一套 --hl-* 变量（单一色板）
import { EditorView, keymap, highlightSpecialChars, ViewPlugin, Decoration } from '@codemirror/view'
import { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import codeLanguages from './markdownHighlight'
import { wysiwygField, wysiwygPlugin, wysiwygAtomicRanges } from './wysiwyg'

// 围栏代码块内按 Enter 跳出（真机反馈：光标在代码块内按 Enter 跳不出围栏）。
// 规则：光标位于「紧邻结束围栏的空行」时，在结束围栏之后另起一行并把光标移过去。
// 放行（返回 false 交给默认 Enter）：非空行、代码块中段、未闭合围栏、非空选区。
function exitCodeBlockOnEnter(view) {
  const { state } = view
  if (!state.selection.main.empty) return false
  const pos = state.selection.main.head
  let node = syntaxTree(state).resolveInner(pos, -1)
  while (node && node.name !== 'FencedCode') node = node.parent
  if (!node) return false
  const line = state.doc.lineAt(pos)
  if (line.text.trim() !== '') return false
  const closeLine = state.doc.lineAt(node.to)
  if (line.number !== closeLine.number - 1) return false
  const ct = closeLine.text.trim()
  if (!ct.startsWith('```') && !ct.startsWith('~~~')) return false
  view.dispatch({
    changes: { from: closeLine.to, insert: '\n' },
    selection: { anchor: closeLine.to + 1 },
    scrollIntoView: true,
  })
  return true
}

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

// ---------- 专注模式：淡化光标外段落 ----------
// 开关经 StateEffect 从外部 dispatch（App.vue 只发命令，不感知 Decoration 细节）。
// 淡化本体是 line Decoration：光标所在段落块（连续非空行）全亮，其余视口内行加
// cm-focus-dim。只遍历 visibleRanges（视口内行）是性能关键；opacity 不改布局，
// 对滚动锚点映射零影响。样式与现有 updateListener（上方）并列，互不共享状态。
export const setFocusMode = StateEffect.define()

// 段落块 = 以空行/文档边界分隔的连续非空行（与 CommonMark 段落直觉一致）
function paragraphRange(doc, pos) {
  const line = doc.lineAt(pos)
  if (!line.text.trim()) return [line.from, line.to] // 光标在空行上：块即本行
  let from = line.from
  let to = line.to
  for (let n = line.number - 1; n >= 1 && doc.line(n).text.trim(); n--) from = doc.line(n).from
  for (let n = line.number + 1; n <= doc.lines && doc.line(n).text.trim(); n++) to = doc.line(n).to
  return [from, to]
}

const focusField = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocusMode)) return e.value
    return value
  },
})

const focusPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view)
    }
    update(update) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.field(focusField) !== update.state.field(focusField)
      ) {
        this.decorations = this.build(update.view)
      }
    }
    build(view) {
      if (!view.state.field(focusField)) return Decoration.none
      const [pFrom, pTo] = paragraphRange(view.state.doc, view.state.selection.main.head)
      const builder = new RangeSetBuilder()
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos)
          const active = line.from >= pFrom && line.to <= pTo
          // Decoration.line 必须是点区间（from == to == line.from），见 wysiwyg.js lineClass
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: active ? 'cm-focus-active' : 'cm-focus-dim' }),
          )
          pos = line.to + 1
        }
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------- 缩放：状态栏 90/100/110/125% 用（App.vue 调 setEditorZoom） ----------
const zoomCompartment = new Compartment()

export function setEditorZoom(view, scale) {
  view.dispatch({
    effects: zoomCompartment.reconfigure(
      EditorView.theme({ '&': { fontSize: `calc(var(--text-base) * ${scale})` } }),
    ),
  })
}

// ---------- 整体替换文档（打开文件 / 切换文件 / 恢复快照） ----------
// 用 setState 而非 dispatch 承载「整份替换」，两个理由：
// 1) 语义正确：CM6 对 setState 的说明正是本场景——「新状态并非派生自旧状态」
//    （打开/切换到另一个文件），此时应当整棵重绘，而非走增量复用。
// 2) 规避 tile 复用路径：@codemirror/view 6.43.x 的 tile 增量更新在「整体替换 +
//    行内/行级装饰」下会损坏并抛
//      TypeError: Cannot destructure property 'tile' of 'parents.pop(...)' as it is undefined
//    （上游 changelog 6.43.3 / 6.43.4 / 6.43.6 连续修 tile 树损坏，该路径风险未收敛）。
//    实测：在 line 装饰写法修正前，dispatch 整份替换必崩，且崩溃后 state 已提交而
//    DOM 不刷新、updateListener 不执行 —— 即「编辑器还停在旧文件、预览已是新文件」。
// state 由 view.state.update 派生 → history / focusField（专注）/ zoomCompartment
// （缩放）等字段状态全部保留；但 setState 不是事务、不触发 updateListener，
// 调用方须自行同步依赖文档内容的外部状态（预览、大纲、状态栏行列）。
export function replaceDocument(view, content) {
  if (!view) return
  const tr = view.state.update({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: { anchor: 0 },
  })
  view.setState(tr.state)
}

export function createEditor(parent, { doc = '', onDocChange, onScroll, onUpdate }) {
  // 只监听文档变化。滚动不要在这里监听 —— CM6 的 ViewUpdate 根本没有 scrollChanged
  // 这个属性（真实属性只有 docChanged/selectionSet/focusChanged/viewportChanged/
  // heightChanged/geometryChanged 等），写了永远是 undefined，滚动联动会静默失效。
  // 滚动用下面的原生 scroll 事件，与预览侧的 @scroll 完全对称。
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onDocChange) onDocChange(update.state.doc.toString())
  })
  // 选区/光标变化（状态栏行列、工具条选中态）。与 onDocChange 分开，避免每个
  // 光标移动都触发文档字符串拷贝。
  const selectionListener = onUpdate
    ? EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) onUpdate(update)
      })
    : []

  const state = EditorState.create({
    doc,
    extensions: [
      highlightSpecialChars(),
      history(),
      // 自定义 Enter 键位须排在 defaultKeymap 之前才优先生效（见 exitCodeBlockOnEnter）
      keymap.of([{ key: 'Enter', run: exitCodeBlockOnEnter }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
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
        '.cm-line': {
          padding: '0 var(--space-6)',
          transition: 'opacity var(--motion-base) var(--ease-standard)',
        },
        '.cm-focus-dim': { opacity: '0.4' },
        '.cm-focus-active': { opacity: '1' },
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

        /* ---- WYSIWYG 装饰类（editor/wysiwyg.js 产出）----
           唯一 theme 扩展内追加（§3.6：EditorView.theme 多次提供会同键覆盖，
           禁止为装饰样式另开第二个 theme）。值全部引用语义 Token，无裸 hex。 */
        /* 引用块不做行内底色预览（用户反馈：预览里已有引用底色，左侧保持原
           Markdown 样式、不重复；引用标识仅靠隐藏 ">" 符号即可辨认）。
           .cm-md-quote 由 wysiwyg.js 生成，此处不附着视觉样式；
           若日后需要编辑器内引用底色，恢复此行即可（值：var(--surface-warm)）。 */
        /* 代码块不做行内样式预览（用户反馈：左侧应保持原 Markdown 样式，
           行内样式装饰与右侧完整预览重复，且与「围栏可见」的源码感冲突）。
           装饰类 .cm-md-codeblock 由 wysiwyg.js 生成，此处不附着视觉样式；
           若日后需要代码块底色，恢复此行即可（值：var(--code-bg)）。 */
        '.cm-md-bullet': { color: 'var(--muted)', padding: '0 1px' },
        '.cm-md-listmark': { color: 'var(--muted)' },
        '.cm-md-empty': { color: 'var(--meta)' }, // 空标记弱提示（**** []()）
        '.cm-md-task-box': {
          display: 'inline-block',
          width: '13px',
          height: '13px',
          boxSizing: 'border-box',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          verticalAlign: '-2px',
          margin: '0 4px 0 2px',
        },
        '.cm-md-task-box.checked': {
          backgroundColor: 'var(--accent)',
          borderColor: 'var(--accent)',
        },
        '.cm-md-task-box.checked::after': {
          content: '""',
          display: 'block',
          width: '7px',
          height: '3px',
          margin: '2px auto 0',
          borderLeft: '2px solid var(--accent-on)',
          borderBottom: '2px solid var(--accent-on)',
          transform: 'rotate(-45deg)',
        },
        '.cm-md-task-done': { color: 'var(--muted)', textDecoration: 'line-through' },
      }),
      updateListener,
      selectionListener,
      focusField,
      focusPlugin,
      // WYSIWYG：开关字段 → 装饰插件 → atomicRanges（顺序要求：facet 须能
      // 读到 wysiwygPlugin 实例，见架构 §3.6 扩展顺序建议）
      wysiwygField,
      wysiwygPlugin,
      wysiwygAtomicRanges,
      // 缩放（状态栏 90/100/110/125%）：Compartment 运行时重配，不重建编辑器
      zoomCompartment.of(EditorView.theme({ '&': { fontSize: 'calc(var(--text-base) * 1)' } })),
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
