// WYSIWYG 即时模式装饰器（D-2 默认编辑形态）
// ----------------------------------------------------------------------------
// 架构依据：docs/spec/phaseC-architecture.md §3（逐条照做）。
//
// 核心约束（@codemirror/view@6.43.13 实测，勿凭文档记忆改写）：
// 1) 插件提供的装饰「不得 block、不得跨行替换」（dist/index.js:2772-2776 会抛
//    RangeError）。本文件只用行内 Decoration.replace / Decoration.mark / 行内
//    widget / Decoration.line，绝无 block 装饰。
// 2) 装饰只在 visibleRanges 内计算（禁止全文档扫描，AC-05 大文档性能）。
// 3) IME 保护：view.composing 为 true 时冻结重算（AC-04 中文输入硬需求）。
// 4) atomicRanges 必需：光标必须跳过隐藏区，否则方向键「按了不动」。
// 5) 内容零篡改（AC-03）：本模块只产装饰，永不 dispatch 文档变更。
//
// 显形判定（§3.2）：「活跃」= 与任一 selection range 相交的行。活跃行的所有
// 隐藏型替换一律跳过（显形 = 保持源码原样）；行级样式类（引用底色等）照常应用。
//
// 样式：.cm-md-* 全部定义在 createEditor.js 的单一 EditorView.theme 内
// （§3.6：不得新建第二个 theme 扩展）。

import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
// 任务列表 checkbox 的无障碍标签要随界面语言走 —— 它是 span[role=checkbox] 的
// aria-label，屏幕阅读器会读出来，属于货真价实的用户可见文案。
// （此文件此前未被 i18n 覆盖，是 Spec §5 组件清单的一处遗漏，已补上。）
import { t } from '../i18n/index.js'

// ---------- 开关：StateField + StateEffect（与 createEditor.js 的 setFocusMode 同构） ----------
// 默认开启：即时模式是 D-2 的默认编辑形态。
export const setWysiwyg = StateEffect.define()

export const wysiwygField = StateField.define({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setWysiwyg)) return e.value
    return value
  },
})

// ---------- 行内 widget：列表圆点 / 任务勾选框 ----------
class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = '\u2022' /* U+2022 圆点，替代原文的破折/星号/加号符号 */
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() { return false }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked }
  eq(other) { return other.checked === this.checked }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-task-box' + (this.checked ? ' checked' : '')
    s.setAttribute('role', 'checkbox')
    s.setAttribute('aria-checked', this.checked ? 'true' : 'false')
    s.setAttribute('aria-label', t(this.checked ? 'task.done' : 'task.unchecked'))
    return s
  }
  ignoreEvent() { return false }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() })
const taskDeco = (checked) => Decoration.replace({ widget: new TaskCheckboxWidget(checked) })
const emptyHintDeco = Decoration.mark({ class: 'cm-md-empty' })
const listmarkDeco = Decoration.mark({ class: 'cm-md-listmark' })

// ---------- 活跃行集合（§3.2）：与任一选区相交的行号，扩展上下各 1 行 ----------
// 扩展原因（真机反馈）：只含选区行时，光标移到相邻行瞬间该行标记从「隐藏+原子」
// 突变为可见，atomicRanges 动态变化导致方向键跳跃感明显。扩展后相邻行标记
// 已处于可见态（非原子），跨行移动平滑；隔行以上才遇原子区，频率大幅降低。
function activeLineSet(doc, selection) {
  const active = new Set()
  for (const r of selection.ranges) {
    const from = Math.max(1, doc.lineAt(r.from).number - 1)
    const to = Math.min(doc.lines, doc.lineAt(r.to).number + 1)
    for (let n = from; n <= to; n++) active.add(n)
  }
  return active
}

const parentName = (ref) => (ref.node && ref.node.parent ? ref.node.parent.name : '')

// ---------- 装饰构建：只遍历 visibleRanges ----------
function build(view) {
  const state = view.state
  if (!state.field(wysiwygField)) {
    return { deco: Decoration.none, atomic: Decoration.none }
  }
  const doc = state.doc
  const active = activeLineSet(doc, state.selection)
  const decoRanges = []
  const atomicRanges = []
  let lastReplacedTo = -1 // 防 replace 区间重叠（重叠 replace 会抛 RangeError）

  // 活跃行 → 不隐藏（显形）；已在隐藏区之后 → 跳过（防重叠）
  const canHide = (from) =>
    !active.has(doc.lineAt(from).number) && from >= lastReplacedTo

  const hide = (from, to) => {
    if (!canHide(from)) return
    const d = Decoration.replace({})
    decoRanges.push({ from, to, value: d })
    atomicRanges.push({ from, to, value: d })
    lastReplacedTo = to
  }

  // 行级样式（引用底色 / 代码块底色）：Decoration.line 允许经插件提供。
  // 注意 range 必须是**点区间**（from == to == line.from）——line 装饰的语义是
  // 「给该行加样式」，CM6 只读 from。若写成 {from: line.from, to: line.to} 的
  // 非点区间，tile 构建会把行装饰当作跨整行的区间处理，导致根节点 length 与
  // 子节点总长失配，随后首次 measure 的 docView.update 就会在
  // TilePointer.advance 抛 "Cannot destructure property 'tile' of 'parents.pop(...)'"。
  const lineClass = (node, cls, visFrom, visTo) => {
    const from = Math.max(node.from, visFrom)
    const to = Math.min(node.to, visTo)
    if (from >= to) return
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      decoRanges.push({ from: line.from, to: line.from, value: Decoration.line({ class: cls }) })
      pos = line.to + 1
    }
  }

  for (const { from: visFrom, to: visTo } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visFrom,
      to: visTo,
      enter: (node) => {
        const name = node.name
        const parent = parentName(node)

        // 块容器：行级底色（不改布局，仅背景，与专注模式 line 类叠加共存）
        if (name === 'Blockquote') { lineClass(node, 'cm-md-quote', visFrom, visTo); return }
        if (name === 'FencedCode') { lineClass(node, 'cm-md-codeblock', visFrom, visTo); return }

        switch (name) {
          case 'HeaderMark': { // # ~ ######（含其后一个空格）
            let to = node.to
            if (doc.sliceString(to, to + 1) === ' ') to += 1
            hide(node.from, to)
            return
          }
          case 'EmphasisMark': {
            // **bold**（父长 > 4 才有内容）/ *em*（父长 > 2）
            const min = parent === 'StrongEmphasis' ? 4 : 2
            const p = node.node.parent
            if (p && p.to - p.from > min) hide(node.from, node.to)
            else if (!active.has(doc.lineAt(node.from).number))
              decoRanges.push({ from: node.from, to: node.to, value: emptyHintDeco })
            return
          }
          case 'StrikethroughMark': {
            const p = node.node.parent
            if (p && p.name === 'Strikethrough' && p.to - p.from > 4) hide(node.from, node.to)
            return
          }
          case 'CodeMark': {
            if (parent === 'InlineCode') {
              const p = node.node.parent
              if (p && p.to - p.from > 2) hide(node.from, node.to) // `x` 空码不隐藏
            } else if (parent === 'FencedCode') {
              // 围栏整行（含 CodeInfo 语言名）行内替换为空；to == line.to 不触发跨行禁令
              const line = doc.lineAt(node.from)
              hide(node.from, line.to)
            }
            return
          }
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle': {
            // 只隐藏 Link/Image 内的 [ ] ( ) 与 URL / 标题；保留 LinkLabel 文本
            if (parent === 'Link' || parent === 'Image') hide(node.from, node.to)
            return
          }
          case 'QuoteMark': { // > （含其后一个空格）
            let to = node.to
            if (doc.sliceString(to, to + 1) === ' ') to += 1
            hide(node.from, to)
            return
          }
          case 'ListMark': {
            if (parent === 'BulletList' && canHide(node.from)) {
              decoRanges.push({ from: node.from, to: node.to, value: bulletDeco })
              atomicRanges.push({ from: node.from, to: node.to, value: bulletDeco })
              lastReplacedTo = node.to
            } else if (parent === 'OrderedList' && canHide(node.from)) {
              // 有序列表序号保形着色（不换内容，无需 atomic）
              decoRanges.push({ from: node.from, to: node.to, value: listmarkDeco })
            }
            return
          }
          case 'TaskMarker': { // [ ] / [x] → 勾选框 widget
            if (!canHide(node.from)) return
            const inner = doc.sliceString(node.from + 1, node.to - 1).trim().toLowerCase()
            const checked = inner === 'x'
            const d = taskDeco(checked)
            decoRanges.push({ from: node.from, to: node.to, value: d })
            atomicRanges.push({ from: node.from, to: node.to, value: d })
            lastReplacedTo = node.to
            if (checked) lineClass(node, 'cm-md-task-done', visFrom, visTo)
            return
          }
        }
      },
    })
  }

  return {
    deco: Decoration.set(decoRanges, true),
    atomic: Decoration.set(atomicRanges, true),
  }
}

// ---------- ViewPlugin：函数式装饰提供者（视口计算之后调用，天然 O(可见行数)） ----------
export const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      const built = build(view)
      this.decorations = built.deco
      this.atomic = built.atomic
    }
    update(update) {
      // IME 保护（AC-04）：合成期间冻结装饰重算，沿用上一次装饰集。
      // 绝不在合成中途改动 DOM，否则候选窗/预编辑文本可能被清掉。
      if (update.view.composing) return
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.field(wysiwygField) !== update.state.field(wysiwygField)
      ) {
        const built = build(update.view)
        this.decorations = built.deco
        this.atomic = built.atomic
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------- atomicRanges（§3.3）：光标跳过隐藏区，可用性前提 ----------
// 原子区不阻止程序化 selection 更新（jumpToHeading 等 dispatch 不受影响）。
// facet 输入是 (view) => RangeSet；须在 wysiwygPlugin 之后注册（createEditor.js）。
export const wysiwygAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(wysiwygPlugin)?.atomic ?? Decoration.none,
)
