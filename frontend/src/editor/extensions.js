// extensions.js — 编辑器扩展清单的唯一真源（2026-10-28 从 createEditor.js 抽出）
// ----------------------------------------------------------------------------
// 【为什么要抽出来】多标签页要造 N 份 EditorState，而扩展数组原先内联在
// createEditor 的函数体里（157 行）。抽出来后 N 份 state **共用同一份扩展实例**：
//   - history() / wysiwygField / tableRenderField / blockRangesField 都是
//     模块级 StateField，值随 state 走 → 每个标签一份撤销栈，天然隔离；
//   - 不必为每个标签重建一套扩展实例 → 避免 N 份插件定义漂移。
//
// 【不变式 · 唯一构建点】buildExtensions 是扩展清单的**唯一**构建入口：
// 调用方（useEditorSession）只调一次，把同一份数组交给 createEditor 与
// createEditorState —— **绝不能每个标签各建一份**（那会让撤销栈 / 装饰字段
// 的实例分叉，与本文件存在的理由相反）。
//
// 【本文件只搬不改】内容与 createEditor.js 原样一致（含全部注释与顺序），
// 只做搬家，不改任何一项扩展的行为、优先级或参数。
import { EditorView, keymap, highlightSpecialChars, ViewPlugin, Decoration } from '@codemirror/view'
import { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment } from '@codemirror/state'
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
  moveLineUp, moveLineDown, copyLineUp, copyLineDown, deleteLine,
} from '@codemirror/commands'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import codeLanguages from './markdownHighlight'
import { wysiwygField, wysiwygPlugin, wysiwygAtomicRanges } from './wysiwyg'
import { taskToggleHandlers } from './taskToggle'
import { codeLinePlugin, codeCopyPlugin } from './codeBlock.js'

import { tableRenderField, tableScanKick, tableSelectionGuard } from './tableRender'
import { tableInputGate } from './tableInputGate'
// 块级即时渲染（折叠块 <details> + 多行公式）与它依赖的区间登记处。
// 【顺序】blockRangesField 声明在 wysiwygBlocksField 之前，wysiwygBlocksField 在
// tableRenderField 之后 —— 依赖方向是「区间登记 → 块 widget」「表格区间 → 块 widget」。
// CM 的 StateField 是惰性求值，实测倒序声明也能读到正确的依赖值，所以这不是硬
// 约束而是**可读性约定**：声明顺序与依赖方向一致，读代码时不必回头查谁依赖谁。
import { blockRangesField } from './blockRanges'
import { wysiwygBlocksField, blockScanKick } from './wysiwygBlocks'
import { slashCommandExtension } from './slashCommand'
import { imageDropHandlers } from './imageDrop'
import { smartInputExtension } from './smartInput.js'
import { listIndentExtension } from './listIndentKeymap.js'
import { getPrefs } from '../themes/prefs.js'

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
  /* ---- Markdown 结构：字号对齐预览区标题阶梯，保证左右视觉一致 ----
   * 【为什么是 em，以及为什么必须按 16px 基准换算】
   * 这里的字号要跟着用户的正文字号缩放（18px 档位下 h1 该更大），所以用 em（相对
   * .cm-line 的 font-size），而不是预览区那种固定 rem。代价是：**预览区的标题阶梯
   * （--preview-h*-size，rem 固定值）不随正文字号变**，两侧只在某个正文基准下才吻合。
   * 2026-10-22 默认正文 15px → 16px 时实测发现：旧 em 值（2/1.6/1.333/1.133/1.067/1）
   * 是按 15px 反推的，16px 下 h1 变 32px 而预览仍是 30px，逐级偏大 2.0/1.6/1.3/1.1/1.1/1.0px。
   * 故按下式重基到 16px：em = 预览 px / 16
   *   h1 30/16=1.875  h2 24/16=1.5   h3 20/16=1.25
   *   h4 17/16=1.0625 h5 16/16=1    h6 15/16=0.9375
   * 实测验证：默认 16px 下 h1..h6 与预览区逐级差值均为 0.0px（修复前 16px 下最大偏 2px）。
   * 非默认档位（12/14/18/20px）两侧必然仍有偏差 —— 那是「em 跟随 vs rem 固定」的
   * 固有取舍，不是本处能修的；默认档位对齐是本次的验收标准。 */
  { tag: t.heading1, fontSize: '1.875em',  fontWeight: '590', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.5em',    fontWeight: '590', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.25em',   fontWeight: '510', lineHeight: '1.3' },
  { tag: t.heading4, fontSize: '1.0625em', fontWeight: '510', lineHeight: '1.3' },
  { tag: t.heading5, fontSize: '1em',      fontWeight: '510', lineHeight: '1.3' },
  { tag: t.heading6, fontSize: '0.9375em', fontWeight: '510', color: 'var(--muted)' },
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
// 对滚动锚点映射零影响。样式与现有 updateListener（createEditor.js 侧）并列，互不共享状态。
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
// Compartment 必须与扩展清单里注册的是**同一个实例**，否则 reconfigure 落空 ——
// 故它定义在本模块（扩展清单的所在地），createEditor.js 从这里 import。
export const zoomCompartment = new Compartment()

/**
 * 构建编辑器扩展清单。**整个应用只应有一份**，由调用方构建一次后共享给
 * 所有 EditorState（多标签页的 N 份 state 共用它）。
 *
 * @param {object} deps
 * @param {() => object|null} deps.slashHost 斜杠面板宿主（延迟求值：面板组件在编辑器之后挂载）
 * @param {(file: File|string) => void} [deps.onImageFile] 图片数据 / file URL 落盘回调
 * @param {() => void} [deps.onClipboardImage] 通道③：问系统剪贴板取图片
 * @returns {Array} CM6 扩展数组
 */
export function buildExtensions({ slashHost, onImageFile, onClipboardImage }) {
  return [
    highlightSpecialChars(),
    history(),
    // Slash 命令面板：内部自带 Prec.high（须压过 defaultKeymap 的 Enter/Escape）。
    // 放在 keymap.of([...]) 之前是约定俗成的可读性排序，实际优先级由 Prec 决定。
    // slashHost 由 App.vue 传入 `() => slashRef.value`（延迟求值：面板组件
    // 在编辑器之后挂载，构造期取不到实例）。
    slashCommandExtension(slashHost),
    // 自定义 Enter 键位须排在 defaultKeymap 之前才优先生效（见 exitCodeBlockOnEnter）。
    // searchKeymap：⌘F 查找面板（darwin 无菜单入口，按键直达 WebView）+ Esc 关闭。
    // 行操作键位沿用 VS Code 惯例（⌥↑↓ 移动行、⇧⌥↑↓ 复制行、⌘⇧K 删除行）——
    // darwin 端「编辑」菜单是硬编码 Role，这些能力只能靠键位 + 快捷键速查暴露。
    // 列表智能缩进（Tab / Shift+Tab）。
    // 【顺序契约】必须排在下面的 keymap.of 之前：CM 的 keymap 按扩展**声明
    // 顺序**决定优先级（越靠前越先拿到按键），而 indentWithTab 就在下面那个
    // keymap 里 —— 放到它后面，Tab 永远轮不到列表缩进（静默失效）。
    listIndentExtension(),
    keymap.of([
      { key: 'Enter', run: exitCodeBlockOnEnter },
      { key: 'Mod-Alt-f', run: openSearchPanel },
      { key: 'Alt-ArrowUp', run: moveLineUp },
      { key: 'Alt-ArrowDown', run: moveLineDown },
      { key: 'Shift-Alt-ArrowUp', run: copyLineUp },
      { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
      { key: 'Mod-Shift-k', run: deleteLine },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    // 智能符号补全（成对闭合 / 越过 / 成对退格）+ 可选智能标点。
    // inputHandler 每次按键现读 prefs，设置面板切换开关后立即生效。
    smartInputExtension(() => getPrefs()),
    // 图片粘贴 / 拖拽：仅在拿到图片（数据 / file URL）且注册了对应回调时拦截，其余放行。
    // 通道③ 可选：未注册时行为与加通道③之前完全一致。
    EditorView.domEventHandlers(imageDropHandlers(onImageFile, onClipboardImage)),
    // 任务列表勾选：点勾选框直接翻转 [ ] / [x]（交互在 taskToggle.js，
    // wysiwyg.js 只负责把标记渲染成勾选框，不碰文档）
    EditorView.domEventHandlers(taskToggleHandlers()),
    // 代码块：行号（行装饰 + data-line 属性，CSS attr() 渲染）+ 一键复制按钮
    // （首行行尾 widget）。位置在表格之前：两者互不影响。
    codeLinePlugin,
    codeCopyPlugin,
    markdown({ base: markdownLanguage, codeLanguages }),
    // 只注册 mdHighlight：fallback 样式在存在主样式时会被整体跳过
    //（getHighlighters: main.length ? main : fallback），曾与 defaultHighlightStyle
    // 并列导致 mdHighlight 全程失效；且默认色板与预览区 --hl-* 不同源（单一色板原则）。
    syntaxHighlighting(mdHighlight),
    // 查找/替换面板（⌘F / ⌘⌥F）：面板停靠编辑区顶部
    search({ top: true }),
    // 【软换行：居中定宽的前置条件，不是可选项】
    // 实测：未启用时 .cm-content 的计算样式是 white-space:pre（CM6 baseTheme），
    // 长段落**不换行**而是横向溢出 —— 1600px 视口下一段长中文实测把内容撑到
    // 6798px、横向可滚 5198px。若只给 .cm-content 加 max-width 而不换行，长段落
    // 会变成「在 736px 窄栏里横向滚动」，比现状更难用（实测溢出仍有 5606px）。
    // 必须用官方 lineWrapping 而不是自己写 CSS 换行：CM6 的 heightOracle 靠
    // 内容属性里的 cm-lineWrapping 类名来「预判换行」，自己写 CSS 会让行高测量
    // 走错分支，表现为上下方向键的光标纵向位置漂移（静默、难查）。
    EditorView.lineWrapping,
    EditorView.theme({
      '&': {
        height: '100%',
        backgroundColor: 'var(--bg)',
        color: 'var(--fg)',
        fontFamily: 'var(--font-body-user, var(--font-body))',
        fontSize: 'var(--text-base)',      /* 15px，与预览区一致 */
        lineHeight: 'var(--leading-body)', /* 1.7，与预览区一致 */
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-body-user, var(--font-body))',
        lineHeight: 'var(--leading-body)',
      },
      '.cm-content': {
        fontFamily: 'var(--font-body-user, var(--font-body))',
        lineHeight: 'var(--leading-body)',
        caretColor: 'var(--accent)',
        padding: 'var(--preview-padding-y) 0 var(--space-16)',  /* 与预览区上下留白一致，比例映射才准 */
        /* 【居中定宽：编辑区与预览区共用同一个行宽 token】
         * 此前 .cm-content 铺满整个滚动容器（实测 1600px 视口下内容宽 1590px），
         * 长屏写作时一行长到肉眼难以换行追踪 —— 这是与 Typora 最直观的差距。
         * 这里直接引用 --preview-measure（与 preview.css 的 .preview-body 同一个
         * 变量），而不是另造一个编辑区专属行宽：两者同源，改一处即两边同步，
         * 用户的「行宽」偏好（prefs 写 --preview-measure 内联）也自动同时生效。
         * box-sizing 是 border-box（base.css 全局重置），故 46rem 是含 .cm-line
         * 左右各 24px 内边距的外框宽 —— 与 .preview-body 的 46rem（同为 border-box，
         * 同样含 24px 内边距）逐像素对齐，正文文字列宽两边都是 688px。 */
        maxWidth: 'var(--preview-measure)',
        margin: '0 auto',   /* 定宽后左右均分剩余空间 = 居中 */
      },
      '.cm-line': {
        padding: '0 var(--space-6)',
        /* 【必须 relative：.cm-md-copy / .cm-md-table-bar 的绝对定位锚点】
         * 代码块复制按钮与表格操作条都是 position:absolute，锚点取「最近的已定位
         * 祖先」。CM6 给 .cm-scroller 设了 position:relative，而 .cm-line 一直是
         * static —— 于是这两个浮层实际锚在**整个滚动容器**上，不是各自那一行。
         * 实测取证（1000px 高视口、代码块位于文档 2183px 处）：
         *   修复前 按钮 top=40（贴视口顶），距所在行 -2142px，横向落在栏外 416px；
         *   修复后 按钮 top=2185（距所在行 +2px），横向回到栏内。
         * 也就是说「复制按钮飘在窗口右上角、跟代码块无关」是**改动前就存在**的缺陷，
         * 只是当时正文铺满整宽，横向错位不明显；居中定宽后必须一并修掉，否则
         * 浮层会落在栏外，正是本任务点名要避免的「widget 错位」。
         * 加 relative 不改变文档流（line 本来就是 display:block），无副作用。 */
        position: 'relative',
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
      // WYSIWYG 装饰类（.cm-md-*）的视觉**不在这里** —— 已迁到
      // themes/editor-wysiwyg.css（该文件是 .cm-md-* 的唯一定义处）。
      // 迁移原因见该文件头注：把纯 CSS 塞进本对象会顶破行数棘轮。
      // 引用块 / 代码块刻意不附着行内底色（见 editor-wysiwyg.css 同处注释）。
    }),
    focusField,
    focusPlugin,
    // WYSIWYG：开关字段 → 装饰插件 → atomicRanges（顺序要求：facet 须能
    // 读到 wysiwygPlugin 实例，见架构 §3.6 扩展顺序建议）
    wysiwygField,
    wysiwygPlugin,
    wysiwygAtomicRanges,
    // 表格真渲染（StateField block 装饰 + 可编辑单元格，见 tableRender.js 头注）。
    // tableSelectionGuard：拦「flush 把单元格 DOM 选区搬进主选区」的事务
    //（表格退化成竖线 + 失焦的第二道闸，根因链见 tableRender.js 的守卫头注）。
    tableRenderField,
    tableSelectionGuard,
    // 拦 CM 对单元格内容的默认读回事务（失焦根因第一道闸，见 tableInputGate.js）
    tableInputGate,
    // 语法树补齐后的初始重扫兜底（StateField.create 跑在树就绪之前）
    tableScanKick(),
    // 块级即时渲染：区间登记处 → 块 widget（折叠块 / 多行公式）。
    // 依赖方向：blockRangesField（区间）→ wysiwygBlocksField（读区间 + 读
    // tableRenderField 的 tables 做互斥）。声明顺序与依赖方向一致只为可读性。
    // 根因链见 editor/wysiwygBlocks.js 头注。
    blockRangesField,
    wysiwygBlocksField,
    // 树补齐后的补扫（与 tableScanKick 同构：StateField.create 早于树就绪）
    blockScanKick(),
    // 缩放（状态栏 90/100/110/125%）：Compartment 运行时重配，不重建编辑器
    zoomCompartment.of(EditorView.theme({ '&': { fontSize: 'calc(var(--text-base) * 1)' } })),
  ]
}

/**
 * 造一份可独立存在的 EditorState（多标签页用）。
 * 传入的 extensions 必须是**同一份**共享数组 —— 见本文件头注的「不变式」段。
 *
 * @param {object} opts
 * @param {string} opts.doc 初始文档内容
 * @param {Array} opts.extensions 共享的扩展清单（buildExtensions 的返回值）
 * @param {import('@codemirror/state').EditorSelection} [opts.selection] 初始选区
 */
export function createEditorState({ doc, extensions, selection }) {
  return EditorState.create({ doc, extensions, selection })
}
