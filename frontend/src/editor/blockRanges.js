// editor/blockRanges.js — 记录必须由块级 widget 独占的区间。
//
// 行内装饰不能跨行替换，而 <details>、$$…$$、整块 <div>/<p> 在语法树里都没有
// 覆盖整块的节点，只能按行扫描。块级 widget 与行内装饰若落在同一段文本上，
// CodeMirror 会抛 tile 相关错误，因此两边都以这里的区间为准。

import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'

/** 折叠块：开标签行 + 闭标签行之间的所有行（含两端） */
const DETAILS_OPEN = /^\s{0,3}<details\b/i
const DETAILS_CLOSE = /<\/details\s*>/i

// 独占一行的 <div>/<p> 开标签。行内写法（<p>x</p>）交给行内 HTMLTag，
// 避免两套装饰覆盖同一段文本。
const ALIGN_OPEN = /^\s{0,3}<(div|p)((?:\s[^<>]*?)?)(\/?)>$/i

// 返回独占一行的 div/p 标签名；行内或自闭合标签返回 null。
function alignOpenName(text) {
  const m = ALIGN_OPEN.exec(text.trim())
  if (!m || m[3] === '/') return null // 自闭合不是块开标签
  return m[1].toLowerCase()
}

/**
 * 扫描块级区间，按 from 升序返回，互不重叠。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {import('@lezer/common').Tree} tree
 * @returns {{from:number,to:number,kind:'details'|'math'|'html'}[]}
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
      // 未闭合：保持源码可见，不吞后半篇
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
    // 对齐块：按同名标签配对，允许嵌套
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
        // 闭标签必须独占一行；否则按未配对处理，保留源码
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
