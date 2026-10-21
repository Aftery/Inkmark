// smartInput.js — 智能符号补全（成对符号自动闭合 + 越过 + 成对退格）
// ----------------------------------------------------------------------------
// 【为什么自己写而不用 closeBrackets】@codemirror/autocomplete 自带 closeBrackets，
// 但它的配对标是「代码括号」语义，拿不到 Markdown 的三条关键约束：
//   ① `_` 在 `snake_case` 里绝不能配对（CommonMark 的 intraword emphasis 规则）；
//   ② 行首裸 `*` 是列表标记，不是强调标记 —— 配对后按空格会写出 `* |*`；
//   ③ ``` 行首要展开成围栏代码块，而代码块**内部**不许再配对。
// 另一个现实理由：本仓依赖面是刻意收着的（package.json 未登记 autocomplete，
// 它只是 codemirror 元包的传递依赖），直接 import 传递依赖会在 lockfile 抖动时
// 静默断链。故按本仓一贯做法：纯函数 + 可测，逻辑自己写。
//
// 【接入点为什么是 inputHandler 而不是 keymap】inputHandler 是 CM6 给
// 「改写即将插入的文本」准备的钩子（EditorView.inputHandler，dist 的
// applyDOMChangeInner 里调用），拿得到 beforeinput 的范围与文本，覆盖
// 「键入 / 输入法提交 / 拖放文本」多条来源；keymap 只有 keydown，而中文输入法
// 提交的字符在 keydown 里是 'Process'，根本匹配不上。
//
// 【与 IME 的关系（硬规则）】组合期间（view.composing）一律放行 —— 组合中的
// 文本由输入法自己维护，此时插字符会把候选窗与已上屏内容拆散（同 wysiwyg.js
// 的 AC-04 裁决）。
//
// 可测性：decide() / backspacePlan() 是纯函数，输入「局部文本 + 区间 + 字符」，
// 输出「变更 + 新选区」，不碰 EditorState / DOM（见 tests/smart-input.test.mjs）。

import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { smartPunctFor } from './smartPunct.js'

/**
 * 成对符号表：开 → 闭。`*` `_` `` ` `` `"` `'` 为对称符号（开闭同形）。
 */
const PAIRS = {
  '*': '*',
  _: '_',
  '`': '`',
  '[': ']',
  '(': ')',
  '{': '}',
  '"': '"',
  "'": "'",
  '\uFF08': '\uFF09', // （）
  '\u3010': '\u3011', // 【】
  '\u300C': '\u300D', // 「」
  '\u300E': '\u300F', // 『』
}

/** 弯引号：中文语境下由 smartPunct 产出，闭合方向由它自己决定 */
const QUOTE_CLOSERS = { '\u201C': '\u201D', '\u2018': '\u2019' }

/** 闭合符（type-over 用）：异形配对取配对值，对称符号取自身 */
function closerOf(ch) {
  if (QUOTE_CLOSERS[ch]) return QUOTE_CLOSERS[ch]
  return PAIRS[ch] || null
}

/** 该字符本身是否是「闭合符」（即可以越过） */
function isCloser(ch) {
  if (QUOTE_CLOSERS[ch]) return true
  return Object.values(PAIRS).includes(ch)
}

const WORD = /[A-Za-z0-9_]/

/** 行首列表标记位：只含空白，或已有列表标记后只剩空白 */
function atListMarkerSlot(prefix) {
  return /^\s*$/.test(prefix) || /^\s*(?:[-*+]\s+|\d+\.\s+)$/.test(prefix)
}

/** 位置 pos 上的字符是否被反斜杠转义（偶数个反斜杠 = 未转义） */
function isEscaped(text, pos) {
  let n = 0
  for (let i = pos; i >= 0 && text[i] === '\\'; i--) n++
  return n % 2 === 1
}

/**
 * 三连反引号展开为围栏代码块。
 * 判定：本行光标前恰好是 ```` `` ````（刚敲下第三个反引号）、后文为空。
 * 调用方负责排除「已在代码块内」的情形。
 */
function fencePlan(text, from) {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  const prefix = text.slice(lineStart, from)
  if (!/^\s*``$/.test(prefix)) return null
  const lineEnd = text.indexOf('\n', from)
  const suffix = text.slice(from, lineEnd === -1 ? text.length : lineEnd)
  if (suffix.trim() !== '') return null
  // 区间到 from 为止（被键入的第三个反引号由本次拦截吞掉，不落文档）；
  // 光标落在两块围栏之间的空行上，直接可写代码
  return {
    changes: [{ from: lineStart, to: from, insert: '```\n\n```' }],
    selection: { anchor: lineStart + 4, head: lineStart + 4 },
  }
}

/**
 * 核心判定：决定「要不要改写这次插入」。
 *
 * @param {string} text 局部文本（起始行首 → 结束行尾 + 1 字符；位置按该片段计）
 * @param {number} from 插入起点
 * @param {number} to 插入终点（> from = 有选区）
 * @param {string} ch 被键入的单个字符
 * @param {{autoPair?: boolean, smartPunct?: boolean, inCode?: boolean}} opts
 * @returns {{changes: Array<{from:number,to?:number,insert:string}>|null,
 *            selection: {anchor:number, head:number}}|null}
 *   null = 不干预（交回 CM 默认插入）
 */
export function decide(text, from, to, ch, opts = {}) {
  const { autoPair = true, smartPunct = false, inCode = false } = opts
  if (typeof ch !== 'string' || ch.length !== 1) return null
  // 代码里不做任何符号补全：`arr[0]`、`a * b` 的正确输入不该被配对打断
  if (inCode) return null

  // ---- ⓪ 智能标点先把字符映射成「中文语境下的正确形态」----
  // smartPunct 取值：false/'off' = 关闭；'curly' / 'corner' = 引号形态；
  // true 是历史布尔写法（等价 curly），保留兼容以免旧调用点静默失效
  const punctStyle = smartPunct === true ? 'curly' : smartPunct
  const sp = punctStyle && punctStyle !== 'off' ? smartPunctFor(text, from, ch, punctStyle) : null
  const eff = sp ? sp.ch : ch
  /** 兜底：字符被智能标点改写过、又没有命中任何配对规则时，至少把替换落下去 */
  const replaced = () =>
    eff === ch ? null : { changes: [{ from, to, insert: eff }], selection: { anchor: from + eff.length } }

  // ---- ① 三连反引号 → 围栏代码块（先于普通配对：长度判定不同）----
  if (autoPair && to === from && ch === '`') {
    const fence = fencePlan(text, from)
    if (fence) return fence
  }

  // ---- ② 越过已存在的闭合符 ----
  // 条件严格：光标后一位正是**期望的闭合符**，且未被反斜杠转义。
  // 不越过的话，自动补出来的闭合符会越打越多（`**粗体***`）。
  if (to === from && isCloser(eff)) {
    const expected = closerOf(eff) || eff
    const next = text.slice(from, from + 1)
    if (next === expected && !isEscaped(text, from - 1)) {
      return { changes: null, selection: { anchor: from + 1, head: from + 1 } }
    }
  }

  const close = autoPair ? closerOf(eff) : null
  if (!close) return replaced()

  // ---- ③ 有选区 → 包裹选区（而不是把用户选中的文字替换掉）----
  if (to > from) {
    const selected = text.slice(from, to)
    // 跨行时只允许行内语义的包裹；跨行强调会产出不渲染的源码，交给用户自己决定
    if (selected.includes('\n') && (eff === '`' || eff === '*' || eff === '_')) return null
    return {
      changes: [
        { from, to: from, insert: eff },
        { from: to, to, insert: close },
      ],
      // 选区保持在内容上：继续输入即替换，点一下即可取消
      selection: { anchor: from + eff.length, head: to + eff.length },
    }
  }

  // ---- ④ 空光标：按「不该配对」的规则先筛一遍 ----
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  const prefix = text.slice(lineStart, from)
  const next = text.slice(from, from + 1)

  // a. 行首裸 * 是列表标记位（否则按空格会写出 `* |*`）
  if (eff === '*' && atListMarkerSlot(prefix)) return null
  // b. `_` 在词内不配对（snake_case；CommonMark 也不把它当强调）
  if (eff === '_' && WORD.test(prefix.slice(-1))) return null
  // c. `'` 在词内是撇号（don't / it's），配对会写出 don''t
  if (eff === "'" && WORD.test(prefix.slice(-1))) return null
  // d. 左括号后紧接单词字符时不配对（VS Code 同款启发式：用户更可能想把
  //    已存在的文字包起来，而不是在新括号里继续写）
  if ('[({'.includes(eff) && WORD.test(next)) return null
  // e. 已被反斜杠转义的字符按字面量走
  if (isEscaped(text, from - 1)) return null

  return {
    changes: [{ from, to, insert: eff + close }],
    selection: { anchor: from + eff.length, head: from + eff.length },
  }
}

/**
 * 成对退格：光标夹在空配对中间时，一次退格把两侧一起删掉。
 * 这是自动配对的**配套**能力 —— 没有它，用户要么删两次、要么留下半个标记。
 *
 * 只对「中间确实为空」的配对生效：`**|**` 中间无内容但两侧都是同形符号，
 * 说明用户在写更长的标记（加粗），交给默认退格，避免误删两个星号。
 *
 * @param {string} text 局部文本
 * @param {number} pos 光标位置
 * @returns {{from:number, to:number, insert:string}|null}
 */
export function backspacePlan(text, pos) {
  if (pos <= 0) return null
  const before = text.slice(pos - 1, pos)
  const after = text.slice(pos, pos + 1)
  if (!before || !after) return null
  const close = closerOf(before)
  if (!close || close !== after) return null
  // 对称符号：`*|*` 是空配对；`**|**` 不是（两侧还有同形字符，用户在写长标记）
  if (close === before) {
    const before2 = text.slice(pos - 2, pos - 1)
    const after2 = text.slice(pos + 1, pos + 2)
    if (before2 === before || after2 === after) return null
  }
  return { from: pos - 1, to: pos + 1, insert: '' }
}

// ---------------------------------------------------------------------------
// 语法树判定：当前插入点是否在代码里
// ---------------------------------------------------------------------------

/** 这些祖先节点内一律不做符号补全（围栏代码 / 行内代码） */
const CODE_NODES = new Set(['FencedCode', 'CodeText', 'InlineCode', 'CodeBlock'])

/**
 * 从 pos 向上找是否有代码类祖先。
 * 直接走 node.parent 链（SyntaxNode 上**没有** .state / .doc，别写成 node.state）。
 */
export function inCodeAt(tree, pos) {
  if (!tree) return false
  let node = tree.resolveInner(pos, -1)
  while (node) {
    if (CODE_NODES.has(node.name)) return true
    node = node.parent
  }
  return false
}

/**
 * 组装 CM 扩展：inputHandler（插入改写）+ keymap（成对退格）。
 *
 * @param {() => {smartPair?: boolean, smartPunct?: boolean}} getPrefs
 *   每次按键现读偏好 —— 设置面板切换开关后立即生效，无需重建编辑器
 * @returns {import('@codemirror/state').Extension}
 */
export function smartInputExtension(getPrefs) {
  const handler = EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing) return false // 组合中：交给输入法（见文件头）
    if (text.length !== 1) return false // 粘贴 / 批量插入不参与
    const prefs = getPrefs() || {}
    const autoPair = prefs.smartPair !== false
    const punct = prefs.smartPunct && prefs.smartPunct !== 'off'
    // 两个开关都关时直接放行（零开销，保证「关掉 = 行为与没有本扩展时一致」）
    if (!autoPair && !punct) return false

    // 局部窗口：起始行首 → 结束行尾 + 1，避免每次按键拷整份文档
    const lineFrom = view.state.doc.lineAt(from).from
    const lineTo = view.state.doc.lineAt(to)
    const sliceEnd = Math.min(view.state.doc.length, lineTo.to + 1)
    const local = view.state.doc.sliceString(lineFrom, sliceEnd)
    const offset = from - lineFrom

    const plan = decide(local, offset, to - lineFrom, text, {
      autoPair,
      smartPunct: prefs.smartPunct || 'off',
      inCode: inCodeAt(syntaxTree(view.state), from),
    })
    if (!plan) return false

    const shift = (n) => n + lineFrom
    view.dispatch({
      changes: (plan.changes ?? []).map((c) => ({
        from: shift(c.from),
        to: shift(c.to ?? c.from),
        insert: c.insert,
      })),
      selection: { anchor: shift(plan.selection.anchor), head: shift(plan.selection.head) },
      userEvent: 'input.type',
    })
    return true
  })

  // 成对退格：只在光标夹在空配对中间时拦截，其余一律放行给 defaultKeymap
  const backspace = keymap.of([
    {
      key: 'Backspace',
      run: (view) => {
        if (view.composing) return false
        const { main } = view.state.selection
        if (!main.empty) return false
        const pos = main.head
        if (pos <= 0) return false
        const lineFrom = view.state.doc.lineAt(pos).from
        const local = view.state.doc.sliceString(lineFrom, Math.min(view.state.doc.length, pos + 2))
        const plan = backspacePlan(local, pos - lineFrom)
        if (!plan) return false
        view.dispatch({
          changes: { from: shift(plan.from, lineFrom), to: shift(plan.to, lineFrom), insert: '' },
          selection: { anchor: shift(plan.from, lineFrom) },
          userEvent: 'delete.backward',
        })
        return true
      },
    },
  ])

  return [handler, backspace]
}

const shift = (n, base) => n + base
