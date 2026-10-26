// editor/blockRanges.js — 「整块渲染」区域的唯一登记处（块级 widget 与行内装饰的分界）
// ----------------------------------------------------------------------------
// 【为什么需要这个模块】编辑器的即时渲染分成两套机制，能力边界完全不同：
//
//   1) 行内装饰（wysiwyg.js 的 ViewPlugin）—— 只能整体替换**同一行内**的区间；
//      跨行替换会被 @codemirror/view 直接拒绝（dist/index.js:2772 抛 RangeError）。
//   2) 块级 widget（StateField 提供的 block 装饰）—— 能跨行整体替换，但只能由
//      StateField 提供，且**与行内装饰落在同一片文本上时会互相踩**。
//
// 折叠块 `<details>…</details>` 与多行公式 `$$ … $$` 都属于第 2 类。于是必然会
// 出现「两套机制抢同一片文本」的问题：行内装饰若照常处理 `</details>` 里的
// `<b>`、或者把 `$$` 当普通文本，会和块 widget 的替换区间重叠 —— CM 侧的表现
// 是构建装饰集时抛错（"Cannot destructure property 'tile'" 一族），或者视觉上
// 出现半截渲染。
//
// 因此把「哪些区间由块级机制独占」做成一个**先于两边存在的契约**：
//   - 本文件负责**扫描**这些区间（纯函数 scanBlockRanges + 一个 StateField）
//   - 块级 widget 侧读它来决定在哪造 widget（tableRender.js 之外的另一个提供者）
//   - 行内装饰侧读 `isBlockCovered()` 来决定**跳过**这些节点
//
// 【为什么扫描要自己按行做，而不是只看语法树节点】
// `<details>` 在 lezer 眼里是**两段互不相连的 HTMLBlock**（开标签一段、闭标签
// 一段），中间夹着普通 Paragraph —— 没有一个节点覆盖整块，只能从开标签行扫到
// 闭标签行。多行 `$$` 更没有节点（lezer 不认 TeX）。故这里按行扫描 + 语法树
// 排除（围栏代码块 / 行内代码里的这些符号是**文本**，不能当块标记）。

import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'

/** 折叠块：开标签行 + 闭标签行之间的所有行（含两端） */
const DETAILS_OPEN = /^\s{0,3}<details\b/i
const DETAILS_CLOSE = /<\/details\s*>/i

/**
 * 对齐块：`<div align="center">` / `<p align="right">` 这类**整行**开标签、配对
 * 闭标签独占一行的块。真机反馈「内嵌 HTML 里 div/p 不渲染」—— 预览侧这些标签
 * 走 html.js 白名单照常渲染，编辑器侧由行内 HTMLTag 兜底只能隐掉配对的行内
 * 标签，整块 div 保持源码。修法与 details 同路：由块级 widget 整块渲染。
 *
 * 【为什么只认「独占一行的开标签」】行内写法 `<p align="center">x</p>` 交给
 * 行内 HTMLTag 隐藏即可，混进来会和行内装饰抢同一片文本（module 头注的
 * 「两套机制抢」正是这里在新 kind 上复刻的坑）。闭标签必须独占一行同理：
 * `</div>` 尾巴上带正文时按「未配对」处理，保持源码可见。
 */
const ALIGN_OPEN = /^\s{0,3}<(div|p)((?:\s[^<>]*?)?)(\/?)>$/i

/**
 * 取一条文字（trim 后）里开标签的标签名；不是独占一行的 div/p 开标签返回 null。
 * 刻意**独立成函数**而不是直接一条正则糊在扫描循环里：闭标签配对、代码块排除、
 * 「开标签必须独占一行」三件事在 update() 的窄循环里互相缠着，站到外面才讲得清。
 */
function alignOpenName(text) {
  const m = ALIGN_OPEN.exec(text.trim())
  if (!m || m[3] === '/') return null // 自闭合不是块开标签
  return m[1].toLowerCase()
}

/**
 * 扫描「必须由块级 widget 独占」的区间。
 *
 * 纯函数（入参是 doc + 语法树），便于直接对真实 EditorState 打靶 —— 块级渲染的
 * 缺陷全是静默的：区间偏一行，界面上只是「折叠块少了一段」或者「公式多出一行
 * 空行」，不抛错、不报红。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {import('@lezer/common').Tree} tree
 * @returns {{from:number,to:number,kind:'details'|'math'}[]} 按 from 升序、互不重叠
 */
export function scanBlockRanges(doc, tree) {
  const codeRanges = []
  tree.iterate({
    enter: (node) => {
      // 围栏代码里的 `<details>` / `$$` 是**内容**，不参与块级渲染
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        codeRanges.push([node.from, node.to])
        return false
      }
      return undefined
    },
  })
  const inCode = (pos) => codeRanges.some(([a, b]) => pos >= a && pos < b)

  const out = []
  let i = 1
  while (i <= doc.lines) {
    const line = doc.line(i)
    if (!inCode(line.from) && DETAILS_OPEN.test(line.text) && !DETAILS_CLOSE.test(line.text)) {
      // 找配对的闭标签行：允许嵌套（计数累加/递减）
      let depth = 1
      let j = i
      while (j < doc.lines) {
        j++
        const l = doc.line(j)
        if (inCode(l.from)) continue
        const opens = (l.text.match(/<details\b/gi) || []).length
        const closes = (l.text.match(/<\/details\s*>/gi) || []).length
        depth += opens - closes
        if (depth <= 0) break
      }
      if (depth <= 0) {
        const close = doc.line(j)
        out.push({ from: line.from, to: close.to, kind: 'details' })
        i = j + 1
        continue
      }
      // 没配对上（用户正写到一半）：不登记 —— 保持源码可见，不吞掉后半篇文档
      i++
      continue
    }
    if (!inCode(line.from) && line.text.trim() === '$$') {
      // 多行公式：`$$` 独占一行开，`$$` 独占一行闭
      let j = i
      let closed = 0
      while (j < doc.lines) {
        j++
        const l = doc.line(j)
        if (inCode(l.from)) break
        if (l.text.trim() === '$$') { closed = j; break }
      }
      if (closed) {
        const close = doc.line(closed)
        out.push({ from: line.from, to: close.to, kind: 'math' })
        i = closed + 1
        continue
      }
      i++
      continue
    }
    // 对齐块（div/p 独占一行的开标签）：找配对的同名闭标签行，允许嵌套
    const openName = !inCode(line.from) && alignOpenName(line.text)
    if (openName) {
      const closeRe = new RegExp('^\\s*</\\s*' + openName + '\\s*>$', 'i')
      let depth = 1
      let j = i
      while (j < doc.lines) {
        j++
        const l = doc.line(j)
        if (inCode(l.from)) continue
        if (alignOpenName(l.text) === openName) depth++
        if (closeRe.test(l.text)) { depth--; if (depth <= 0) break }
      }
      if (depth <= 0) {
        // 闭标签行必须独占一行（closeRe 只认这个形态）；尾巴上带正文时按
        // 「未配对」处理 —— 源码保持可见，不吞后半篇
        out.push({ from: line.from, to: doc.line(j).to, kind: 'html' })
        i = j + 1
        continue
      }
      i++
      continue
    }
    i++
  }
  return out
}

/**
 * 块级区间清单（StateField）。行内装饰侧读它做跳过判定；块 widget 侧读它造 widget。
 *
 * 只在 docChanged 时重扫：区间只取决于文本内容，选区/视口变化不影响它。
 * 全文档扫描的成本与 tableRender 同级（lezer 增量树 + 一次按行遍历），写作场景可接受。
 */
export const blockRangesField = StateField.define({
  create(state) {
    return scanBlockRanges(state.doc, syntaxTree(state))
  },
  update(value, tr) {
    if (!tr.docChanged) return value
    return scanBlockRanges(tr.state.doc, syntaxTree(tr.state))
  },
})

/**
 * 某个位置是否落在块级区间内（不含右端点：右端点是下一块的起点）。
 *
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} pos
 * @param {number} [to] 传入则判定整个 [pos, to) 是否被某一区间覆盖
 */
export function isBlockCovered(state, pos, to = pos) {
  const ranges = state.field(blockRangesField, false) ?? []
  return ranges.some((r) => pos < r.to && to > r.from)
}
