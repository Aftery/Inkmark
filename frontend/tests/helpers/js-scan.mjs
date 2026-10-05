/**
 * js-scan.mjs — tdz-guard 的解析原语（在 lexer 掩码之上）。
 * 词法层（注释/字符串/模板/正则感知）在 lexer.mjs；本模块做：
 *   剥出 <script> 区、括号深度、配平、顶层切分、useXxx({...}) 注入解析。
 * 独立分层是为了文件不超 300 行红线，且 maskNonCode / stripComments 共用一套词法。
 */
import { ID_RE } from './lexer.mjs'

/** 取出 <script> 块内容与其在全文中的起始偏移（App.vue 只有一个 script 块）。 */
export function extractScript(source) {
  const open = source.indexOf('<script')
  if (open < 0) return null
  const openEnd = source.indexOf('>', open)
  if (openEnd < 0) return null
  const close = source.indexOf('</script>', openEnd)
  if (close < 0) return null
  return { code: source.slice(openEnd + 1, close), baseOffset: openEnd + 1 }
}

/** 每个位置的括号深度（进入该字符前的深度）。掩码串里只剩真实代码括号。 */
export function computeDepth(masked) {
  const d = new Array(masked.length)
  let cur = 0
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]
    if (c === '{' || c === '(' || c === '[') { d[i] = cur; cur++ }
    else if (c === '}' || c === ')' || c === ']') { cur--; d[i] = cur }
    else d[i] = cur
  }
  return d
}

/** 从 openIdx 处的开括号找到配对的闭括号位置。 */
export function matchPair(s, openIdx, open, close) {
  let depth = 0
  for (let j = openIdx; j < s.length; j++) {
    if (s[j] === open) depth++
    else if (s[j] === close) { depth--; if (depth === 0) return j }
  }
  return -1
}

/** 按顶层逗号切分（忽略 () [] {} 内的逗号）。 */
export function splitTopLevel(str, sep = ',') {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === sep && depth === 0) { parts.push(str.slice(start, i)); start = i + 1 }
  }
  parts.push(str.slice(start))
  return parts
}

/** 找 entry 顶层（深度 0）的第一个冒号，返回下标或 -1。 */
export function topLevelColon(str) {
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ':' && depth === 0) return i
  }
  return -1
}

/**
 * 判断注入值是否为惰性求值（调用时才读标识符）：
 * 箭头函数体、function 表达式。`getEditor: () => editor` 归此类，安全。
 */
function isLazy(value) {
  if (/^(async\s+)?function\b/.test(value)) return true
  return value.includes('=>')
}

/**
 * 解析一个对象字面量条目（或数组元素），返回 { key, kind, name }：
 *   kind = 'immediate'（立即读取的裸标识符，需查顺序）
 *        | 'lazy'（惰性包装 / getter 体，豁免 —— 由 analyzeEntry 的调用方过滤）
 *        | 'complex'（复杂表达式，无法静态判定，跳过）
 *        | 'skip'（不是可识别的属性）
 */
export function analyzeEntry(part) {
  const t = part.trim()
  if (!t) return null
  const colon = topLevelColon(t)
  let key
  let value
  if (colon >= 0) {
    key = t.slice(0, colon).trim()
    if (!ID_RE.test(key)) return { key: t, kind: 'skip' }
    value = t.slice(colon + 1).trim()
  } else {
    key = t
    if (!ID_RE.test(t)) return { key: t, kind: 'skip' }
    value = t
  }
  if (isLazy(value)) return { key, kind: 'lazy', value }
  if (ID_RE.test(value)) return { key, kind: 'immediate', name: value, value }
  return { key, kind: 'complex', value }
}

/** 解析 useXxx(...) 的实参对象里的注入条目。非对象实参返回 []。 */
export function parseInjections(argText) {
  const trimmed = argText.trim()
  if (!trimmed.startsWith('{')) return []
  const open = argText.indexOf('{')
  const close = matchPair(argText, open, '{', '}')
  if (close < 0) return []
  const inner = argText.slice(open + 1, close)
  return splitTopLevel(inner)
    .map(analyzeEntry)
    .filter((e) => e && e.kind !== 'skip')
}

/** 扫描所有 use[A-Z]xxx({...}) 调用。 */
export function findUseCalls(masked, baseOffset, offsetToLine) {
  const re = /\buse[A-Z][\w$]*\s*\(/g
  const calls = []
  let m
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1
    const close = matchPair(masked, open, '(', ')')
    if (close < 0) continue
    const name = /^(use[A-Z][\w$]*)/.exec(m[0])[1]
    calls.push({
      name,
      line: offsetToLine(baseOffset + m.index),
      injections: parseInjections(masked.slice(open + 1, close)),
    })
  }
  return calls
}
