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
// 图片 src 的文档相对路径 → /doc-assets/ 改写（唯一口径在 assetUrl.js）；
// 不改写的话 src 会落到构建产物目录，图片永远是碎图占位
import { resolveAssetSrc } from './assetUrl.js'
// 改写口径的版本号：文档路径变化不产生事务，装饰必须靠它判「过期了」。
// 同步点与版本号都在 assetContext.js（文件头有完整根因说明）。
import { assetVersion } from './assetContext.js'

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

// ---------- 分割线：把 `---` 替换成一条真实的横线 ----------
// 为什么用 widget 而不是只给隐藏后的行加边框：hide() 之后行内没有任何内容，
// 行高会塌到 0（CM6 的空行高度由 .cm-line 的 line-height 决定，替换成空
// widget 更矮），而分割线需要一条**占位且撑开高度**的可见线。用 widget
// 同时拿到「不占字符」与「有高度」两个性质。
class HrWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-hr'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() { return true }
}
const hrDeco = Decoration.replace({ widget: new HrWidget() })

/**
 * 构建图片预览的 DOM（占位框态含在内）。
 * 独立成导出函数的原因：ImageWidget 的 toDOM 要按「构造期 / 构建期」两个
 * 时点解析 src（见 ImageWidget 头注的定格缺陷），测试也需要一个能注入
 * document stub 直接驱动的入口 —— 它就是图片装饰的**唯一 DOM 组装点**。
 *
 * @param {string} rawSrc Markdown 里的原始 src（占位框文案用它，与旧实现一致）
 * @param {string} resolved 已按 assetUrl 口径改写的 src（img 实际加载的地址）
 * @param {string} alt
 */
export function buildImageDOM(rawSrc, resolved, alt) {
  const wrap = document.createElement('span')
  wrap.className = 'cm-md-img'
  const img = document.createElement('img')
  img.src = resolved
  img.alt = alt
  img.loading = 'lazy'
  img.addEventListener('error', () => {
    // 远程图常因离线 / 防盗链失败：留一个可读的占位而不是碎图标。
    // tip 文案用**原始** src（用户写进 Markdown 的路径），不是改写后的
    // /doc-assets/… —— 占位框是给「看 Markdown 的人」读的。
    wrap.classList.add('is-broken')
    img.remove()
    const tip = document.createElement('span')
    tip.className = 'cm-md-img-tip'
    tip.textContent = alt || rawSrc
    wrap.appendChild(tip)
  })
  wrap.appendChild(img)
  return wrap
}

// ---------- 图片：`![alt](url)` 换成图片预览 ----------
// 只在「非活跃行」替换（活跃行保持源码，见 §3.2 显形判定）：用户正在编辑
// 那一行时把它变成图片反而挡路。加载失败不抛——onError 把 <img> 摘掉，
// 由 CSS 的 .is-broken 呈现占位框（并保留 alt 文本于 title）。
//
// 【eq/toDOM 为什么带着 resolvedSrc —— 2026-10-23 真机回归「图片占位框显示
// assets/ 路径而不是图片」的根因，勿回退】
// 改写依赖 assetUrl 的模块级开关，而 widget 是**构造期快照**：插图时文档往往
// 还没落盘（开关关着）⇒ toDOM 拿到未改写的 assets/… ⇒ 404 ⇒ 占位框。此后文档
// 落盘、开关打开，但 eq() 只比 src/alt（两者不变）⇒ CM 复用旧 DOM ⇒ 破损态
// 永久定格。另一条路径是跨目录切换，toDOM 读到的是上一个文档的开关状态。
// 修法 = 让「改写口径」参与复用判定（构造期解析出的 resolvedSrc 进 eq）；但仅此
// 不够 —— 路径变化**不产生 CM 事务**，装饰根本不会重算，故另需 assetContext.js
// 的版本号与刷新信号（见该文件头与 shouldRebuildDecorations）。
class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super()
    this.src = src
    this.alt = alt
    // eq 键带 resolvedSrc：否则文档路径状态变化时 widget 被判「没变」，
    // 上一次按旧开关解析出的地址（多半是 404）会被一直复用（见上）。
    this.resolvedSrc = resolveAssetSrc(src)
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt
      && other.resolvedSrc === this.resolvedSrc
  }
  toDOM() {
    // toDOM 可能在构造之后很久才被 CM 调用（视口外惰性构建），此时再读一次
    // 当前开关；构造期已解析的 this.resolvedSrc 作为兜底 —— 两个时点都不漏。
    const resolved = resolveAssetSrc(this.src) || this.resolvedSrc
    return buildImageDOM(this.src, resolved, this.alt)
  }
  ignoreEvent() { return false }
}

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

/**
 * 从 Image 节点里取出 URL 与 alt 文本。
 * 不用正则去 `![]()` 上抠（会误伤嵌套括号与转义），而是走子节点：
 * URL 节点是解析器给出的权威区间，LinkLabel 里是 alt。
 * 两个都要在直接子节点里找 —— Image 的子结构随内容变
 * （`![](a.png)` 没有 LinkLabel，`![说明](a.png)` 有）。
 *
 * 【坑，勿改】SyntaxNode 上**没有** .state / .doc 属性（只有 from/to/name/
 * node/nextSibling 等）。取文本必须用闭包里的 doc（build() 的 state.doc）。
 * 曾写成 node.state.doc 直接把插件打崩（CodeMirror plugin crashed）。
 */
function findChild(node, name) {
  const n = node.node
  if (!n) return null
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === name) return c
  }
  return null
}
function urlOf(node, doc) {
  const url = findChild(node, 'URL')
  if (!url) return null
  // URL 节点含尖括号包裹时 slice 出来是 <a.png>，去掉
  return doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
}

/**
 * 取图片的 alt 文本。
 *
 * 【为什么不能只认 LinkLabel 子节点 —— 2026-10-24 实测】lezer 对**行内式**
 * `![alt](url)` **不产出 LinkLabel 节点**（Image 的子节点只有
 * LinkMark/LinkMark/LinkMark/URL/LinkMark），只有**引用式** `![alt][ref]` 才有。
 * 旧实现只查后者 ⇒ 行内图片的 alt 恒为 ''：占位框丢掉用户写的说明、退化成裸
 * 路径，eq 的 alt 项也永远不生效（两侧都是空串）。故行内式改从 Image 的**头两个
 * LinkMark 之间**取（`![` 之后到 `]` 之前）—— 那就是 alt 的权威区间，比在
 * `![]()` 上跑正则可靠（不误伤嵌套括号与转义）。
 */
function altOf(node, doc) {
  const label = findChild(node, 'LinkLabel')
  if (label) return doc.sliceString(label.from, label.to).replace(/^\[|\]$/g, '')
  const n = node.node
  if (!n) return ''
  // 第一个 LinkMark 是 `![`，第二个是 `]`；两者之间即 alt
  const marks = []
  for (let c = n.firstChild; c && marks.length < 2; c = c.nextSibling) {
    if (c.name === 'LinkMark') marks.push(c)
  }
  if (marks.length < 2) return ''
  return doc.sliceString(marks[0].to, marks[1].from)
}

// ---------- 装饰构建：只遍历 visibleRanges ----------
/**
 * 构建整份装饰集（唯一构建入口）。
 *
 * 形参是 state + 可见区间而**不是** view：本函数只用到这两样，收窄签名后
 * 「同一份文档 + 两种改写口径」可以在 node 里直接对比（见
 * tests/image-asset-context.test.mjs —— 缺陷本体就是「两种口径下产出的装饰
 * 应当不同」，而它此前完全没有覆盖）。
 *
 * @param {import('@codemirror/state').EditorState} state
 * @param {readonly {from:number,to:number}[]} visibleRanges
 */
export function buildDecorations(state, visibleRanges) {
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

  for (const { from: visFrom, to: visTo } of visibleRanges) {
    syntaxTree(state).iterate({
      from: visFrom,
      to: visTo,
      enter: (node) => {
        const name = node.name
        const parent = parentName(node)

        // 块容器：行级底色（不改布局，仅背景，与专注模式 line 类叠加共存）
        if (name === 'Blockquote') { lineClass(node, 'cm-md-quote', visFrom, visTo); return }
        if (name === 'FencedCode') { lineClass(node, 'cm-md-codeblock', visFrom, visTo); return }

        // 分隔线：整行替换为横线 widget。必须**整节点**替换且在活跃行显形
        // （否则光标停在那一行时横线消失，位置感错乱）。
        if (name === 'HorizontalRule') {
          if (canHide(node.from)) {
            const d = hrDeco
            decoRanges.push({ from: node.from, to: node.to, value: d })
            atomicRanges.push({ from: node.from, to: node.to, value: d })
            lastReplacedTo = node.to
          }
          return
        }

        // 表格：整体移交 tableRender.js（StateField block 装饰 + 可编辑单元格）。
        // Bear 式管道隐藏已退役 —— 本插件只有行内装饰、做不了真表格（文件头 §1），
        // 跳过整个子树避免与 block 装饰重复处理同一片内容。
        if (name === 'Table') return false

        // 图片：非活跃行替换为图片预览。父 Image 的 from/to 覆盖整个
        // `![alt](url)`，一次整体替换（内部 LinkMark/URL/LinkTitle 的
        // 隐藏靠 lastReplacedTo 被拦掉，不会与本条产生重叠区间）。
        if (name === 'Image') {
          if (canHide(node.from)) {
            const src = urlOf(node, doc) ?? ''
            const alt = altOf(node, doc) ?? ''
            if (src) {
              const d = Decoration.replace({ widget: new ImageWidget(src, alt) })
              decoRanges.push({ from: node.from, to: node.to, value: d })
              atomicRanges.push({ from: node.from, to: node.to, value: d })
              lastReplacedTo = node.to
              return
            }
          }
          return
        }

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

/**
 * 是否需要重算装饰集。
 *
 * 【为什么单列成导出函数】「文档路径变化」这一类更新**不带任何 CM 可见信号**
 * （docChanged / selectionSet / viewportChanged 全为 false），旧实现在这个
 * 判据里就丢掉了它 —— 而这段逻辑无法靠目视验证：漏判的表现是「图片停在旧
 * 地址」，装饰集本身完全合法。收窄成纯函数后可以拿真实 EditorState 逐条打靶
 * （tests/image-asset-context.test.mjs）。
 *
 * @param {object} u ViewUpdate 形态（测试里用真实 Transaction 拼）
 * @param {number} prevAssetVersion 上次构建时记下的改写口径版本
 */
export function shouldRebuildDecorations(u, prevAssetVersion) {
  return (
    // 改写口径变了（文档路径变了）：图片 src 的整体口径随之变化。
    // 这一条必须排在最前 —— 它对应的更新里其余判据全为 false。
    prevAssetVersion !== assetVersion() ||
    u.docChanged ||
    u.selectionSet ||
    u.viewportChanged ||
    u.startState.field(wysiwygField) !== u.state.field(wysiwygField)
  )
}

export const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      const built = buildDecorations(view.state, view.visibleRanges)
      this.decorations = built.deco
      this.atomic = built.atomic
      // 装饰是按**当下**的改写口径构建的，把口径版本记下来（assetContext.js）。
      // 构造期取版本而不是比较旧装饰里的 widget —— widget 的 resolvedSrc 只能
      // 反映它自己那一次 resolve，判定「整个装饰集是否过期」还得看这个全局量。
      this.assetVersion = assetVersion()
    }
    update(update) {
      // IME 保护（AC-04）：合成期间冻结装饰重算，沿用上一次装饰集。
      // 绝不在合成中途改动 DOM，否则候选窗/预编辑文本可能被清掉。
      // 【注意本行必须在版本号判定之前】合成期整笔跳过 ⇒ this.assetVersion
      // 保持旧值，合成结束后（下一笔事务）仍判定为过期、补一次重建 ——
      // 过期信息不会因跳过而丢失（见 assetContext.js 文件头最后一段）。
      if (update.view.composing) return
      if (!shouldRebuildDecorations(update, this.assetVersion)) return
      const built = buildDecorations(update.view.state, update.view.visibleRanges)
      this.decorations = built.deco
      this.atomic = built.atomic
      this.assetVersion = assetVersion()
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
