/**
 * tdz-guard.mjs — 静态顺序守卫（零依赖，纯文本分析）
 * ============================================================================
 * 事故：2026-10-05 抽 composable 后启动白屏。
 *   App.vue 某行 `const {...} = useFileOps({ ..., askInput, ... })`
 *   读取了 `askInput`，但 `const askInput = ...`（经 useDialog 解构）声明在其后。
 *   setup 期读取未初始化的 const -> ReferenceError -> Vue 树不渲染 -> 白屏。
 *
 * 本模块的断言（Spec §2.1）：
 *   App.vue 中每个 `useXxx({ ... })` 调用注入的标识符，其声明行号必须早于调用行号。
 *   - const / let / import 绑定：参与判定
 *   - function 声明：有提升（hoisting），豁免（否则 syncAfterDocReplace 会被误报）
 *   - 惰性包装 `key: () => expr` / `key: function () {}`：函数体调用时才求值，豁免
 *   - 找不到声明：报红「来源不明，可能是 TDZ 风险或漏了 import」
 *
 * 底层剥注释 / 括号配平 / 注入解析原语见 js-scan.mjs（拆文件以守住 300 行红线）。
 */
import {
  ID_RE, extractScript, maskNonCode, computeDepth, matchPair,
  splitTopLevel, topLevelColon, findUseCalls,
} from './js-scan.mjs'

export { extractScript, maskNonCode, computeDepth } from './js-scan.mjs'

/** 解析 import 绑定（逐语句累积，支持多行 import）。 */
export function findImportBindings(code) {
  const map = new Map()
  const lines = code.split('\n')
  let buf = ''
  let startLine = 0
  const add = (names, line) => { for (const n of names) if (!map.has(n)) map.set(n, { line, kind: 'import' }) }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (!buf && !/^\s*import\b/.test(line)) continue
    if (!buf) startLine = li
    buf += (buf ? '\n' : '') + line
    if (/from\s*['"][^'"]*['"]/.test(buf)) {
      const m = /import\s+([\s\S]*?)\s+from\s*['"]/.exec(buf)
      if (m) add(parseImportSpecifiers(m[1]), startLine + 1)
      buf = ''
    } else if (/import\s*['"][^'"]*['"]/.test(buf)) {
      buf = ''
    }
  }
  return map
}

function parseImportSpecifiers(spec) {
  const out = []
  const brace = /\{([\s\S]*)\}/.exec(spec)
  if (brace) {
    for (const part of brace[1].split(',')) {
      const p = part.trim()
      if (!p) continue
      const as = p.split(/\s+as\s+/)
      const name = as[as.length - 1].trim()
      if (ID_RE.test(name)) out.push(name)
    }
  }
  const head = brace ? spec.slice(0, spec.indexOf('{')) : spec
  for (const part of head.split(',')) {
    let p = part.trim()
    p = p.replace(/^\*\s+as\s+/, '')
    if (ID_RE.test(p)) out.push(p)
  }
  return out
}

/** 提取一个声明语句段里被声明的名字（支持解构 / 默认值 / rest / 重命名）。 */
export function parseDeclaredNames(segment) {
  const names = []
  const push = (raw) => {
    let s = raw.trim()
    if (!s) return
    if (s.startsWith('...')) s = s.slice(3).trim()
    const ei = s.indexOf('=')
    if (ei >= 0) s = s.slice(0, ei).trim()
    if (ID_RE.test(s)) names.push(s)
  }
  for (const decl of splitTopLevel(segment)) {
    const d = decl.trim()
    if (!d) continue
    if (d.startsWith('{') || d.startsWith('[')) {
      const open = d[0]
      const close = open === '{' ? '}' : ']'
      const end = matchPair(d, 0, open, close)
      if (end < 0) continue
      for (const item of splitTopLevel(d.slice(1, end))) {
        const it = item.trim()
        if (!it) continue
        const colon = topLevelColon(it)
        push(colon >= 0 ? it.slice(colon + 1) : it)
      }
    } else {
      push(d)
    }
  }
  return names
}

/** 扫描 setup 顶层（深度 0）的 function / const / let / var 声明。 */
export function findDeclarations(code, masked, depth, baseOffset, offsetToLine) {
  const map = new Map()
  const put = (name, line, kind) => { if (!map.has(name)) map.set(name, { line, kind }) }

  for (const [n, v] of findImportBindings(code)) map.set(n, v)

  const fnRe = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g
  let m
  while ((m = fnRe.exec(masked))) {
    if (depth[m.index] === 0) put(m[1], offsetToLine(baseOffset + m.index), 'function')
  }

  const kwRe = /\b(const|let|var)\s+/g
  while ((m = kwRe.exec(masked))) {
    if (depth[m.index] !== 0) continue
    const start = m.index + m[0].length
    let end = start
    let d = 0
    for (; end < masked.length; end++) {
      const c = masked[end]
      if (c === '(' || c === '[' || c === '{') d++
      else if (c === ')' || c === ']' || c === '}') d--
      else if (d === 0 && (c === ';' || c === '\n')) break
    }
    const segment = masked.slice(start, end)
    for (const name of parseDeclaredNames(segment)) put(name, offsetToLine(baseOffset + m.index), m[1])
  }
  return map
}

function tdzMessage(name, call, decl) {
  return (
    `const 暂时性死区：${name} 声明在第 ${decl.line} 行，晚于 ` +
    `${call.name}({...}) 的调用（第 ${call.line} 行）。` +
    `setup 期读取未初始化的 ${decl.kind} 会抛 ReferenceError: Cannot access '${name}' ` +
    `before initialization，Vue 树不渲染 -> 启动白屏。` +
    `修法：把声明上移到调用之前，或把注入改成惰性包装 ` +
    `${name}: (...a) => ${name}(...a)。`
  )
}

function unknownMessage(name, call) {
  return (
    `来源不明：${call.name}({...})（第 ${call.line} 行）注入的 ${name} ` +
    `在当前文件内找不到声明（const / let / import）。` +
    `这可能是 TDZ 风险，或漏了 import。`
  )
}

/**
 * 主入口：检查源码里的 useXxx({...}) 注入顺序。
 * 返回 { ok, calls, injections, violations }。
 */
export function checkTdz(source, { file = 'App.vue' } = {}) {
  const script = extractScript(source)
  if (!script) {
    return { file, ok: false, calls: [], injections: [], violations: [{ kind: 'no-script', message: `${file} 里找不到 <script> 块。` }] }
  }
  const { code, baseOffset } = script
  const masked = maskNonCode(code)
  const depth = computeDepth(masked)
  const offsetToLine = (off) => source.slice(0, off).split('\n').length
  const decls = findDeclarations(code, masked, depth, baseOffset, offsetToLine)
  const calls = findUseCalls(masked, baseOffset, offsetToLine)

  const injections = []
  const violations = []
  for (const call of calls) {
    for (const inj of call.injections) {
      if (inj.kind !== 'immediate') continue
      const name = inj.name
      const rec = { name, key: inj.key, useName: call.name, callLine: call.line }
      const decl = decls.get(name)
      if (!decl) {
        const v = { ...rec, declLine: null, declKind: null, kind: 'unknown', message: unknownMessage(name, call) }
        injections.push(v); violations.push(v); continue
      }
      rec.declLine = decl.line
      rec.declKind = decl.kind
      injections.push(rec)
      if (decl.kind === 'function' || decl.kind === 'import') continue // 提升 / 顶层可用
      if (decl.line > call.line) {
        violations.push({ ...rec, kind: 'tdz', message: tdzMessage(name, call, decl) })
      }
    }
  }
  return { file, ok: violations.length === 0, calls, injections, violations }
}
