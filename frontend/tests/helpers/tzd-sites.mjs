/**
 * tzd-sites.mjs — 通用 TDZ 读取点识别：找出「setup 顶层会立即求值」的
 * 对象 / 数组字面量里的裸标识符读取（含 if 块内的），并排除惰性上下文。
 *
 * 规则（team-lead 裁决）：
 *   setup 顶层（含 `if (...) {}`、对象/数组字面量、useXxx({...}) 实参）中
 *   **立即读取**的标识符，其 const/let 声明必须早于读取点。
 *   - function/var 有提升 -> 豁免（由 tdz-guard 的声明表处理）
 *   - `get x(){}` 与箭头函数体内属惰性求值 -> 豁免
 *   - useXxx({...}) 实参归注入检查负责，本模块跳过（避免重复报）
 *
 * 只识别「能静态判定是立即读取」的形态（裸标识符 / shorthand），
 * 复杂表达式一律跳过：宁可漏报也不误报（误报会让门禁失去信任）。
 */
import { analyzeEntry, matchPair, splitTopLevel } from './js-scan.mjs'

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])
const KEYWORD_PRECEDERS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'case', 'delete', 'void', 'yield', 'await', 'do', 'else',
])
// 这些字符之后出现的 `{` 视为对象字面量；`)` `}` `;` `>`(=>) 之后的 `{` 视为语句块
const OBJECT_PRECEDERS = new Set(['(', '[', ',', ':', '=', '?', '!', '&', '|', '+', '-', '*', '/', '%', '<', '>', '^', '~'])
const KEYWORD_OBJECT_PRECEDERS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'case', 'delete', 'void', 'yield', 'await'])
const ARRAY_PRECEDERS = new Set(['(', '[', ',', ':', '=', '?', '!', '&', '|'])

/** 向前找上一个有效记号（跳过空白）：返回 { ch, word }。 */
function prevToken(masked, idx) {
  let j = idx - 1
  while (j >= 0 && /\s/.test(masked[j])) j--
  if (j < 0) return { ch: '', word: '', at: -1 }
  const ch = masked[j]
  if (/[\w$]/.test(ch)) {
    let k = j
    while (k >= 0 && /[\w$]/.test(masked[k])) k--
    return { ch: 'ID', word: masked.slice(k + 1, j + 1), at: k + 1 }
  }
  return { ch, word: '', at: j }
}

/** 从 closeIdx 处的闭括号向前找配对的最近开括号。 */
function matchBack(masked, closeIdx, open, close) {
  let depth = 0
  for (let j = closeIdx; j >= 0; j--) {
    if (masked[j] === close) depth++
    else if (masked[j] === open) { depth--; if (depth === 0) return j }
  }
  return -1
}

/** 判断 idx 处的 `{` 是否开启一个函数体（function/方法/箭头块体）。 */
function opensFunctionBody(masked, idx) {
  const p = prevToken(masked, idx)
  if (p.ch === '>') return true // `=> {`
  if (p.ch === ')') {
    const open = matchBack(masked, p.at, '(', ')')
    if (open < 0) return false
    const before = prevToken(masked, open)
    if (before.ch === 'ID' && CONTROL_KEYWORDS.has(before.word)) return false // if(...) {
    return true // function f(...) { / foo(...) {
  }
  return false
}

/** 收集所有函数体区间 [start,end]（这些区间内的读取都属惰性/调用时才求值）。 */
export function findFunctionBodyRanges(masked) {
  const ranges = []
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '{') continue
    if (!opensFunctionBody(masked, i)) continue
    const end = matchPair(masked, i, '{', '}')
    if (end < 0) continue
    ranges.push([i, end])
    i = end
  }
  return ranges
}

const inRanges = (ranges, idx) => ranges.some(([a, b]) => idx >= a && idx <= b)

/**
 * 找出通用读取点（对象 / 数组字面量里的裸标识符），跳过函数体与 useXxx 实参。
 * @returns {Array<{name:string, line:number, key:string, kind:'immediate', site:'object'|'array'}>}
 */
export function findGenericReadSites(masked, baseOffset, offsetToLine, functionRanges) {
  const sites = []
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]
    if (ch !== '{' && ch !== '[') continue
    if (inRanges(functionRanges, i)) continue
    const p = prevToken(masked, i)
    let groupKind = null
    if (ch === '{') {
      if (p.word === 'const' || p.word === 'let' || p.word === 'var' || p.word === 'import') continue // 解构 / import 绑定
      if (p.ch === ')' || p.ch === '>') continue // 语句块 / 箭头块体
      if (OBJECT_PRECEDERS.has(p.ch) || KEYWORD_OBJECT_PRECEDERS.has(p.word)) groupKind = 'object'
    } else {
      if (p.ch === ')' || p.ch === ']' || p.ch === 'ID') continue // 索引 / 取成员（arr[i]、foo()[i]）
      if (ARRAY_PRECEDERS.has(p.ch) || KEYWORD_OBJECT_PRECEDERS.has(p.word)) groupKind = 'array'
    }
    if (!groupKind) continue
    // 跳过 useXxx({...}) 实参：那一路由注入检查负责
    if (p.ch === '(') {
      const calleeIdx = p.at - 1
      let k = calleeIdx
      while (k >= 0 && /\s/.test(masked[k])) k--
      if (masked[k] === undefined) { /* noop */ } else if (/[\w$]/.test(masked[k])) {
        let m = k
        while (m >= 0 && /[\w$]/.test(masked[m])) m--
        if (/^use[A-Z]/.test(masked.slice(m + 1, k + 1))) continue
      }
    }
    const close = matchPair(masked, i, ch, ch === '{' ? '}' : ']')
    if (close < 0) continue
    const inner = masked.slice(i + 1, close)
    for (const part of splitTopLevel(inner)) {
      const e = analyzeEntry(part)
      if (!e || e.kind !== 'immediate') continue
      sites.push({ name: e.name, key: e.key, line: offsetToLine(baseOffset + i), site: groupKind })
    }
  }
  return sites
}
