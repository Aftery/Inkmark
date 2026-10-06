/**
 * lexer.mjs — 低层词法原语：注释 / 字符串 / 模板 / 正则感知的扫描骨架。
 * ============================================================================
 * 为什么独立成文件：maskNonCode 与 stripComments 是同一套扫描骨架的两种用法
 *   - maskNonCode：把非代码（含字面量内容）掩成空白，供「按括号深度找声明」用
 *   - stripComments：只掩注释、保留字面量内容，供「有效代码行」口径用
 * 二者必须共用同一套字符串 / 模板 / 正则识别，否则 `const u = 'https://x'`
 * 会因把 `//` 当注释而吞掉后续代码 —— 那正是本仓记录过的「看起来像就是是」类坑。
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
  // 字符串 / 模板 / 正则字面量 / 标识符 / 数字 / ) ] } 之后，`/` 是除号而非正则
  const valueEnders = new Set(['ID', 'NUM', 'STR', 'TPL', 'RE', ')', ']', '}'])
  return !valueEnders.has(lastSig)
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

/**
 * 只剥注释（保留字符串 / 模板字面量内容），保留换行与原长度。
 * 供行数口径使用：有效代码行 = 剥注释后仍有非空白字符的行。
 */
export function stripComments(src) {
  const out = src.split('')
  const n = src.length
  const blank = (j) => { if (out[j] !== '\n') out[j] = ' ' }
  const stack = [{ t: 'code' }]
  let i = 0
  let lastSig = ''
  let lastWord = ''
  while (i < n) {
    const ctx = stack[stack.length - 1]
    if (ctx.t === 'template') {
      if (src[i] === '\\') { i += 2; continue }
      if (src[i] === '`') { i++; stack.pop(); continue }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; stack.push({ t: 'code', inInterp: true }); continue }
      i++; continue
    }
    if (src[i] === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { blank(i); i++ } continue }
    if (src[i] === '/' && src[i + 1] === '*') {
      blank(i); blank(i + 1); i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++ }
      if (i < n) { blank(i); blank(i + 1); i += 2 }
      continue
    }
    if (src[i] === "'" || src[i] === '"') {
      const q = src[i]; i++
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '\n') break
        i++
      }
      if (i < n && src[i] === q) i++
      lastSig = 'STR'; lastWord = ''
      continue
    }
    if (src[i] === '`') { i++; stack.push({ t: 'template' }); lastSig = 'TPL'; lastWord = ''; continue }
    if (src[i] === '/' && regexAllowed(lastSig, lastWord)) {
      i++
      let inClass = false
      while (i < n) {
        const c = src[i]
        if (c === '\\') { i += 2; continue }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) { i++; break }
        else if (c === '\n') break
        i++
      }
      while (i < n && /[a-z]/i.test(src[i])) i++
      lastSig = 'RE'; lastWord = ''
      continue
    }
    const c = src[i]
    // [注意] 模板插值闭合：${ … } 里的 '}' 必须弹回 template 态。
    //   漏了这一步会怎样（实测踩过）：stack 只进不出 → 越堆越深 →
    //   之后所有字符都被当作 code 里的普通内容，**注释再也不会被识别**
    //   （createEditor.js 剥前 72 行含中文，剥后仍剩 49 行）。
    //   症状是「行数门禁把注释算成有效代码行」，棘轮基线虚高。
    //   注意只在 code 态且处于插值里才弹；不能写成见到 '}' 就弹 ——
    //   对象字面量 `const a = { b: 1 }` 的 '}' 也在 code 态。
    if (c === '}' && ctx.t === 'code' && ctx.inInterp) { stack.pop(); i++; continue }
    if (ID_START.test(c)) { let j = i; while (j < n && ID_PART.test(src[j])) j++; lastWord = src.slice(i, j); lastSig = 'ID'; i = j; continue }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; lastSig = 'NUM'; lastWord = ''; i = j; continue }
    if (!/\s/.test(c)) { lastSig = c; lastWord = '' }
    i++
  }
  return out.join('')
}
