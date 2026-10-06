// verify-shortcuts.mjs — 键位三方一致性门禁（真源 = 前端命令表）
// ============================================================================
// 【这个脚本为什么存在】
// 键位漂移是本仓真实发生过两次的错误（2026-10-04，同一天内两处）：
//   1) README.md 写「导出 PDF | ⌘P」，而命令表里 ⌘P 早已是「打印」，导出 PDF 降为 ⇧⌘P；
//   2) 应用内速查表写「['⌘B / ⌘I', '加粗 / 斜体']」，但加粗实际是 ⌘⇧B
//      （D-4 裁决后 ⌘B 归「大纲」），于是同一张表里 ⌘B 出现两次且含义冲突。
// 两处都是「人肉比对没发现、用户直接看到」的错误。所以这不是过度设计，
// 是把已经真实发生过的 bug 变成机器门禁。
//
// 【真源迁移：2026-10-06】
// 原生菜单下线前，真源是 main.go 的 buildMenu()；现在真源是
// frontend/src/composables/useShortcuts.js 的 COMMANDS 表。
// 校验的两个目标不变：README「快捷键」节 + 应用内速查表（后者已改为从命令表
// 派生，故实际是三方比对：命令表 ↔ README ↔ 速查表渲染结果）。
//
// 比对的是**源码里的原始字符串**（如 '⌘⇧B'），不是 fmtAccel() 在 Windows 上
// 转译出的显示值（'Ctrl+Shift+B'）——转译值会掩盖真实绑定。
//
// 【退出码】0 = 一致；1 = 漂移（输出里给出具体不一致项与原文行，便于直接定位）
//
// 【用法】node scripts/verify/verify-shortcuts.mjs
// ============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// 键位真源：前端命令表
const SHORTCUTS_SRC = 'frontend/src/composables/useShortcuts.js'
const shortcutsSrc = read(SHORTCUTS_SRC)
const readme = read('README.md')
// 应用内速查表的数据源：与命令表同源（useShortcutsHelp.js 读 COMMANDS），
// 故这里校验的是「派生链路是否完好」—— 命令表里带 descKey 的命令是否都还在。
const helpSrc = read('frontend/src/composables/useShortcutsHelp.js')

/* ============================================================================
 * 一、解析命令表，得到 accelerator 真源集合
 * ==========================================================================*/

const { parseCommandTable, canonToken, findAcceleratorDuplicates } =
  await import('./parse-main-menu.mjs')

const { items: commands, warnings: parseWarnings } = parseCommandTable(shortcutsSrc)

/** accelerator → 命令 id（真源集合） */
const srcAccel = new Map()
/** 无 accelerator 的命令 id（用于「必须显式标注无快捷键」检查） */
const noAccelIds = []

for (const c of commands) {
  if (c.accelerator) srcAccel.set(c.accelerator, c.id)
  else noAccelIds.push(c.id)
}

for (const w of parseWarnings) console.warn(`[解析告警] ${w}`)

/* ============================================================================
 * 二、显式豁免白名单（带理由，不靠「扫不到就不管」）
 * ==========================================================================*/

// A) 编辑器 keymap 承接：这些键不进全局分发表，由 CodeMirror 的 keymap 处理
//    （编辑器聚焦时 window keydown 也会触发，但编辑器的 keymap 优先且语义更准，
//    故命令表里不重复登记，避免同一组合两处绑定）。
//    格式：展示键 → [承载方, 代码里的绑定字面量]
const KEYMAP = new Map([
  ['⌥↑', ['editor keymap createEditor.js', 'Alt-ArrowUp']],
  ['⌥↓', ['editor keymap createEditor.js', 'Alt-ArrowDown']],
  ['⇧⌥↑', ['editor keymap createEditor.js', 'Shift-Alt-ArrowUp']],
  ['⇧⌥↓', ['editor keymap createEditor.js', 'Shift-Alt-ArrowDown']],
  ['⌘⇧K', ['editor keymap createEditor.js', 'Mod-Shift-k']],
  ['⌘⌥F', ['editor keymap createEditor.js', 'Mod-Alt-f']],
  ['⌘F', ['CM searchKeymap + 全局分发 edit.find', "k === 'f'"]],
  ['⌘L', ['全局分发 edit.jumpLine', "k === 'l'"]],
])

/** 键位是否被显式豁免；返回理由或 null */
function exemptionReason(k) {
  if (KEYMAP.has(k)) return KEYMAP.get(k)[0]
  return null
}

/* ============================================================================
 * 三、抽取目标的键位集合
 * ==========================================================================*/

// 键字符集含 ` ：行内代码的 ⌘` 是真键（命令表里 inlineCode 就是 ⌘`）
const KEYCHARS = 'A-Za-z0-9.,`/=↑↓-'
// 必须【至少一个修饰键】+【恰好一个键字符】：
// 否则会吞掉正文里的裸字母（如 Esc、Ctrl、Alt 等平台名）造成假键位。
const TOKEN = new RegExp(`[⌘⇧⌥⌃]+[${KEYCHARS}]`, 'g')

/**
 * 把文档里写的键位归一到与命令表相同的规范形式（MOD_ORDER 排序）。
 * 区间写法（⌘1 … ⌘6）先展开。
 */
function extractKeys(text) {
  const expanded = text
    .replace(/⌘⌥1\s*…\s*⌘⌥6/g, '⌘⌥1 ⌘⌥2 ⌘⌥3 ⌘⌥4 ⌘⌥5 ⌘⌥6')
    .replace(/⌘1\s*~\s*⌘4/g, '⌘1 ⌘2 ⌘3 ⌘4')
  const found = new Map() // 归一键 → 原文行
  for (const rawLine of expanded.split('\n')) {
    // 表格行里的行内代码定界符（如 `⌘`）偶数个是定界符，剥掉；
    // 奇数个说明其中一个是真键（`⌘`），保留并按真键解析。
    const ticks = (rawLine.match(/`/g) || []).length
    const line = ticks % 2 === 0 ? rawLine.replace(/`/g, '') : rawLine
    for (const m of line.matchAll(TOKEN)) {
      const k = canonToken(m[0])
      if (k && !found.has(k)) found.set(k, rawLine.trim())
    }
  }
  return found
}

// A) README「快捷键」节 —— 只取表格行（散文里 `⌘` 这类单独提及修饰符的
//    行内代码，其闭合反引号会被误读成键字符，产出 ⌥` / ⇧` 之类的假键位）
const readmeSection = readme.slice(
  readme.indexOf('## 快捷键'),
  readme.indexOf('## 目录结构'),
)
const readmeKeys = new Map()
for (const line of readmeSection.split('\n')) {
  if (!/^\s*\|/.test(line)) continue
  for (const [k, src] of extractKeys(line)) if (!readmeKeys.has(k)) readmeKeys.set(k, src)
}

// B) 应用内速查表：已改为从命令表派生，故这里校验「派生链路完好」——
//    useShortcutsHelp.js 必须 import COMMANDS（而不是自带一张表）。
//    旧实现里那张手写表是漂移源头（2026-06 加粗误写 ⌘B 即由此而来）。
const helpUsesCommandTable = /import\s*\{[^}]*COMMANDS[^}]*\}\s*from\s*'\.\/useShortcuts\.js'/.test(helpSrc)
const helpHasHardcodedTable = /const\s+SHORTCUTS\s*=\s*\[/.test(helpSrc)

/* ============================================================================
 * 四、校验
 * ==========================================================================*/

const problems = []
const note = (kind, key, detail) => problems.push({ kind, key, detail })

// 检查 1：README 里出现但命令表无 accelerator、也不在显式豁免里 → 凭空捏造
for (const [k, src] of readmeKeys) {
  if (srcAccel.has(k) || exemptionReason(k)) continue
  note('捏造键位（命令表无此键且不在豁免白名单）', k,
    `README.md 快捷键节\n            原文行: ${src}`)
}

// 检查 2：README 应完整覆盖命令表的全部 accelerator
for (const [k, id] of srcAccel) {
  if (readmeKeys.has(k)) continue
  note('README 漏写该键位', k, `未收录命令「${id}」`)
}

// 检查 3：README 必须把「无 accelerator」的命令显式标注出来，
//         否则读者会以为漏了快捷键（本次漂移正是这种「静默失真」）。
const NO_SHORTCUT_MUST_BE_LABELED = [
  ['重命名', '走应用内输入对话框'],
  ['复制选区为 HTML', '仅菜单入口'],
  // 清单项用**命令表 labelKey 对应的实际文案**，不是命令 id：
  // 判据是「README 那一行里找得到这个词」，文案不符就会假报缺失。
  // 「图片…」来自 i18n 的 menu.insertImage（沿用原 Go 侧 locales.go 的 insert.image 文案）。
  ['图片…', '斜杠命令面板可插入，命令表未分配键位'],
  ['打字机模式', '开关项，未分配键位'],
  ['窗口置顶', '开关项，未分配键位'],
  ['Markdown 语法示例', '仅菜单'],
]
for (const [label, why] of NO_SHORTCUT_MUST_BE_LABELED) {
  const row = readmeSection.split('\n').find((l) => l.includes(label))
  if (!row) { note('README 未提及该无快捷键项', label, why); continue }
  if (!/无快捷键/.test(row)) {
    note('README 未标注「无快捷键」', label,
      `${why}\n            原文行: ${row.trim()}`)
  }
}

// 检查 4：应用内速查表必须从命令表派生（不得自带第二份）
if (!helpUsesCommandTable) {
  note('速查表未从命令表派生', 'useShortcutsHelp.js',
    'useShortcutsHelp.js 没有 import COMMANDS —— 速查表可能又变成了一份手写副本，' +
    '而手写副本正是 2026-06「加粗误写 ⌘B」漂移的根源。')
}
if (helpHasHardcodedTable) {
  note('速查表仍存在硬编码表', 'SHORTCUTS',
    'useShortcutsHelp.js 里仍有 `const SHORTCUTS = [` —— 该常量必须删除，' +
    '速查表一律从命令表的 descKey 派生。')
}

// 检查 5：命令表内部键位唯一性（**独立于文档比对**，理由见 parse-main-menu 注释）
for (const dup of findAcceleratorDuplicates(shortcutsSrc)) {
  const where = dup.occurrences
    .map((o) => `useShortcuts.js:${o.line} 「${o.id}」`)
    .join('\n            ')
  note('命令表内键位重复绑定', dup.accelerator,
    `该组合被绑了 ${dup.occurrences.length} 次：\n            ${where}\n` +
    '同键绑定两项会导致触发行为不确定（且不会报错）。' +
    '修法：改其中一条的 accel，或设为 null（表示仅菜单入口）。')
}

// 检查 6：原生菜单已下线，main.go 不得再有菜单构建（防双份入口复活）
const goSrc = read('main.go')
if (/func\s+buildMenu/.test(goSrc)) {
  note('原生菜单残留', 'main.go buildMenu',
    'main.go 里仍有 buildMenu —— 原生菜单已下线，残留会与自绘标题栏形成双份入口' +
    '（且 macOS 上菜单会浮到屏幕顶部脱离窗口）。')
}

/* ============================================================================
 * 五、报告
 * ==========================================================================*/

console.log('快捷键契约校验（真源 = useShortcuts.js COMMANDS）')
console.log('='.repeat(64))
console.log(`命令表命令数:                 ${commands.length} 条`)
console.log(`其中有 accelerator:           ${srcAccel.size} 项`)
console.log(`无 accelerator（仅菜单入口）:  ${noAccelIds.length} 项（须在 README 显式标注）`)
console.log(`显式豁免（编辑器 keymap 承接）: ${KEYMAP.size} 项`)
console.log(`README 快捷键节键位:          ${readmeKeys.size} 项`)
console.log(`速查表数据源:                 ${helpUsesCommandTable ? '命令表派生（COMMANDS）' : '未知（未从命令表派生！）'}`)
console.log('')

if (problems.length === 0) {
  console.log('一致：0 处漂移。README 与命令表的键位已对齐，速查表同源派生。')
  process.exit(0)
}

console.log(`发现 ${problems.length} 处漂移：`)
for (const p of problems) {
  console.log(`  [${p.kind}] ${p.key}`)
  console.log(`            ${p.detail}`)
}
console.log('')
console.log('修法：改 useShortcuts.js 的 COMMANDS（真源）后，同步 README「快捷键」节。')
process.exit(1)
