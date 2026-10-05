/**
 * js-scan.mjs — tdz-guard 的底层「剥注释 / 括号配平 / 解析 useXxx 注入」原语。
 * 独立成文件是为了让每个测试助手文件都不超 300 行红线（拆分本身不改行为）。
 *
 * 【解析器哲学】先剥注释与字符串/模板字面量，再数括号深度：
 * 只在深度 0（setup 顶层）找声明，避免把函数体里的局部 const 当成外层声明。
 * 模板字面量里的 `${}` 表达式仍按代码处理，其余文本按空白掩掉，
 * 这样 DEFAULT_DOC 里那些 `function foo() {}` 示例不会污染括号计数。
 */

export const ID_RE = /^[A-Za-z_$][\w$]*$/
const ID_START = /[A-Za-z_$]/
const ID_PART = /[\w$]/
// 正则字面量判定：上一个有效记号不是「值」时才可能是正则（否则是除号）。
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
])

function regexAllowed(lastSig, lastWord) {
  if (lastSig === '') return true
  if (lastWord && REGEX_PRECEDING_KEYWORDS.has(lastWord)) return true
  return !(lastSig === 'ID' || lastSig === 'NUM' || lastSig === ')' || lastSig === ']' || lastSig === '}')
}

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

/**
 * 把注释、字符串、模板字面量文本掩成空格（保留换行与原长度，偏移不变）。
 * 模板里的 `${...}` 表达式保留为代码，以便括号深度仍正确。
 */
export function maskNonCode(src) {
  const out = src.split('')
  const n = src.length
  const blank = (j) => { if (out[j] !== '\n') out[j] = ' ' }
  const stack = [{ t: 'code', depth: 0 }]
  let i = 0
  let lastSig = ''
  let lastWord = ''
  while (i < n) {
    const ctx = stack[stack.length - 1]
    if (ctx.t === 'template') {
      if (src[i] === '\\') { blank(i); i++; if (i < n) { blank(i); i++ } continue }
      if (src[i] === '`') { blank(i); i++; stack.pop(); continue }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(i); blank(i + 1); i += 2; stack.push({ t: 'code', depth: 0 }); continue
      }
      blank(i); i++; continue
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { blank(i); i++ }
      continue
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      blank(i); blank(i + 1); i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++ }
      if (i < n) { blank(i); blank(i + 1); i += 2 }
      continue
    }
    if (src[i] === "'" || src[i] === '"') {
      const q = src[i]; blank(i); i++
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { blank(i); i++; if (i < n) { blank(i); i++ } continue }
        if (src[i] !== '\n') blank(i)
        i++
      }
      if (i < n) { blank(i); i++ }
      lastSig = 'STR'; lastWord = ''
      continue
    }
    if (src[i] === '`') { blank(i); i++; stack.push({ t: 'template' }); lastSig = 'TPL'; lastWord = ''; continue }
    // 正则字面量：字符类里可能有引号 / 斜杠，不识别会把后续代码误当字符串吞掉。
    if (src[i] === '/' && regexAllowed(lastSig, lastWord)) {
      blank(i); i++
      let inClass = false
      while (i < n) {
        const c = src[i]
        if (c === '\\') { blank(i); i++; if (i < n) { blank(i); i++ } continue }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) { blank(i); i++; break }
        else if (c === '\n') break
        blank(i); i++
      }
      while (i < n && /[a-z]/i.test(src[i])) { blank(i); i++ }
      lastSig = 'RE'; lastWord = ''
      continue
    }
    const c = src[i]
    if (ID_START.test(c)) {
      let j = i
      while (j < n && ID_PART.test(src[j])) j++
      lastWord = src.slice(i, j)
      lastSig = 'ID'
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < n && /[\w.]/.test(src[j])) j++
      lastSig = 'NUM'; lastWord = ''
      i = j
      continue
    }
    if (c === '{') { ctx.depth++; lastSig = '{'; lastWord = ''; i++; continue }
    if (c === '}') {
      if (ctx.depth === 0 && stack.length > 1) { blank(i); i++; stack.pop(); lastSig = '}'; lastWord = ''; continue }
      ctx.depth--; lastSig = '}'; lastWord = ''; i++; continue
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = '' }
    i++
  }
  return out.join('')
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
 * 解析一个对象字面量条目，返回 { key, kind, name }：
 *   kind = 'immediate'（立即读取的裸标识符，需查顺序）
 *        | 'lazy'（惰性包装，豁免）
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
