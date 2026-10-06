// parse-main-menu.mjs — 键位真源的【共享解析器】
// ============================================================================
// 【2026-10-06 真源迁移：main.go buildMenu → useShortcuts.js COMMANDS】
//
// 迁移背景：原生菜单整体下线（main.go 的 buildMenu 与 locales.go 已删除），
// 键位的唯一真源迁到前端命令表 frontend/src/composables/useShortcuts.js。
// 本模块随之改为解析那张表的 COMMANDS 数组。
//
// 【为什么保留本文件而不是直接删掉】
//   下游有两处依赖：
//     1) scripts/verify/verify-shortcuts.mjs —— 跨文件键位一致性（CI job docs-contract）
//     2) frontend/tests/contracts.test.mjs 契约 2 —— 指针用例，显式断言
//        「findAcceleratorDuplicates 仍被导出」。若删掉本文件，那条指针用例
//        会报红并把后人引向「键位唯一性无人负责」的方向。
//   故保留文件与导出签名（参数改为命令表源码），使检查**换实现但不换位置**。
//
// 纯函数、零依赖、只用 node 内置——不引入任何第三方包。
//
// ============================================================================
/** 修饰键常量 → 内部代号（命令表用展示符号书写，这里保留映射以兼容旧调用方） */
const MOD_CONST = {
  CmdOrCtrlKey: 'cmd',
  ShiftKey: 'shift',
  OptionOrAltKey: 'alt',
  ControlKey: 'ctrl',
}

/** 规范修饰键顺序：⌘ → ⇧ → ⌥ → ⌃（文档与命令表共用，保证同一组合只有一种写法） */
export const MOD_ORDER = ['cmd', 'shift', 'alt', 'ctrl']

/** 内部代号 → 展示符号 */
export const MOD_DISPLAY = { cmd: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }

/** 展示符号 → 内部代号（供文档侧归一） */
const DISPLAY_TO_MOD = { '⌘': 'cmd', '⇧': 'shift', '⌥': 'alt', '⌃': 'ctrl' }

/** 非单字符键的展示名 */
const KEY_DISPLAY = { Up: '↑', Down: '↓' }

/** 单字符键归一：'p' → 'P'；符号键（`/ , - = .）原样保留 */
function normKey(k) {
  if (KEY_DISPLAY[k]) return KEY_DISPLAY[k]
  return /^[a-z]$/.test(k) ? k.toUpperCase() : k
}

/**
 * 归一「文档里写的键位」到与命令表相同的规范形式。
 * 文档可能按书写习惯把 ⇧ 放在 ⌘ 前面（'⇧⌘P'），语义与 '⌘⇧P' 相同。
 * @param {string} token 如 '⇧⌘P' / '⌥↑' / '⌘`'
 * @returns {string|null} null 表示该 token 不以修饰键开头
 */
export function canonToken(token) {
  const mods = []
  for (const ch of token) {
    if (DISPLAY_TO_MOD[ch]) mods.push(DISPLAY_TO_MOD[ch])
  }
  if (mods.length === 0) return null
  return formatAccelerator({ mods, key: token.slice(mods.length) })
}

/**
 * 把命令表里的 accel 串（已是书写形态）解析为规范形式。
 * 非法形态抛错 —— 静默当 null 会让「某命令丢了键位」被算成「本来就无键位」。
 */
export function parseAccelerator(accel) {
  if (!accel) return null
  const e = String(accel).trim()
  const mods = []
  let i = 0
  for (; i < e.length; i++) {
    const m = DISPLAY_TO_MOD[e[i]]
    if (!m) break
    mods.push(m)
  }
  if (mods.length === 0) {
    throw new Error(`命令表里的 accel 没有修饰键（命令必须显式写 accel 或 null）：${e}`)
  }
  const key = e.slice(i)
  if (!key) throw new Error(`命令表里的 accel 只有修饰键没有主键：${e}`)
  return { mods, key }
}

/**
 * 把 accel 归一成规范展示形式（按 MOD_ORDER 排序）。
 * @param {{mods: string[], key: string}|null} acc
 * @returns {string|null}
 */
export function formatAccelerator(acc) {
  if (!acc) return null
  const mods = MOD_ORDER.filter((x) => acc.mods.includes(x)).map((x) => MOD_DISPLAY[x]).join('')
  return mods + normKey(acc.key)
}

/**
 * 解析命令表（useShortcuts.js 的 COMMANDS 数组）。
 *
 * 逐条匹配形如：
 *   { id: 'file.save', group: 'file', labelKey: '…', accel: '⌘⇧S', descKey: '…' },
 * accel 为 null 时表示「无快捷键，只能点菜单」。
 *
 * @param {string} src useShortcuts.js 全文
 * @returns {{
 *   items: Array<{
 *     id: string,
 *     group: string,
 *     labelKey: string,
 *     accelerator: string|null,  // 规范展示形式，如 '⌘⇧S'；无则 null
 *     hasAccelerator: boolean,
 *     descKey: string|null,
 *     line: number,              // 1-based
 *   }>,
 *   warnings: string[],
 * }}
 * @throws {Error} 解析出 0 条命令时抛错（空数组会让下游「差集为空 ⇒ 全部一致」假通过）
 */
export function parseCommandTable(src) {
  const warnings = []
  const items = []

  // 命令对象是单行书写的（保持表格可读），故按行匹配；跨行写法则解析不到，
  // 下面的兜底断言会把它报出来。
  const ENTRY = /\{\s*id:\s*'([^']+)'\s*,\s*group:\s*'([^']+)'\s*,\s*labelKey:\s*'([^']+)'\s*,\s*accel:\s*(null|'[^']*')(?:,\s*descKey:\s*(null|'[^']*'))?\s*,?\s*\}/g
  for (const m of src.matchAll(ENTRY)) {
    const line = src.slice(0, m.index).split('\n').length
    const accelRaw = m[4] === 'null' ? null : m[4].slice(1, -1)
    let accelerator = null
    try {
      accelerator = formatAccelerator(parseAccelerator(accelRaw))
    } catch (e) {
      warnings.push(`第 ${line} 行的命令 ${m[1]} 的 accel 无法解析：${e.message}`)
    }
    items.push({
      id: m[1],
      group: m[2],
      labelKey: m[3],
      accelerator,
      hasAccelerator: accelerator !== null,
      descKey: m[6] ? m[6].slice(1, -1) : null,
      line,
    })
  }

  if (items.length === 0) {
    throw new Error(
      '命令表解析出 0 条命令，扫描规则很可能已失效（拒绝假通过）。' +
        '检查 useShortcuts.js 里 COMMANDS 的书写形态是否变了（当前要求每条命令单行书写）。'
    )
  }
  return { items, warnings }
}

/**
 * 命令表内部键位唯一性检查。
 *
 * 【为什么必须独立于文档比对】
 * 键位类 bug 的典型形态是「同一个组合被两条命令占用」。这类问题靠
 * 「文档 ↔ 命令表」集合比对是**看不见**的：下游普遍用 Map/Set 按键归并，
 * 重复项会被 Set 静默去重，于是 diff 显示「一致」、门禁报绿，
 * 而运行时行为不确定。仓库历史上真发生过（⌘P 曾同时被「打印」与「导出 PDF」占用）。
 *
 * @param {string} src useShortcuts.js 全文
 * @returns {{accelerator: string, occurrences: {id: string, line: number}[]}[]}}
 */
export function findAcceleratorDuplicates(src) {
  const { items } = parseCommandTable(src)
  /** @type {Map<string, {id: string, line: number}[]>} */
  const byAccel = new Map()
  for (const it of items) {
    if (!it.hasAccelerator || !it.accelerator) continue
    if (!byAccel.has(it.accelerator)) byAccel.set(it.accelerator, [])
    byAccel.get(it.accelerator).push({ id: it.id, line: it.line })
  }
  const dups = []
  for (const [accelerator, occurrences] of byAccel) {
    if (occurrences.length > 1) dups.push({ accelerator, occurrences })
  }
  // 按 accelerator 排序，保证输出稳定可比对
  dups.sort((a, b) => (a.accelerator < b.accelerator ? -1 : a.accelerator > b.accelerator ? 1 : 0))
  return dups
}

/**
 * 【兼容层】原 buildMenu 的入口名。
 * 保留是为了让「指针用例」与历史调用点不至于因改名而失效 ——
 * 但语义已完全改变：现在返回的是**命令表**而非菜单项。
 * 下游应改用 parseCommandTable。
 */
export function parseBuildMenu(shortcutsSrc) {
  return parseCommandTable(shortcutsSrc)
}
