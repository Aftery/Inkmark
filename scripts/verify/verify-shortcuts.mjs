// verify-shortcuts.mjs — 快捷键文档 / 内联速查表 与 main.go 菜单 accelerator 的一致性门禁
// ============================================================================
// 【这个脚本为什么存在】
// 2026-10-04 真的发生过一次键位漂移，同一天内两处：
//   1) README.md 写「导出 PDF | ⌘P」，而 main.go 的 ⌘P 早已是「打印」，导出 PDF 降为 ⇧⌘P；
//   2) App.vue 的内联速查表 SHORTCUTS 写「['⌘B / ⌘I', '加粗 / 斜体']」，
//      但 main.go 的加粗是 ⌘⇧B（D-4 裁决后 ⌘B 归「大纲」），于是同一张表里 ⌘B
//      出现两次且含义冲突。
// 两处都是「人肉比对没发现、用户直接看到」的错误。所以这不是过度设计，
// 是把已经真实发生过的 bug 变成机器门禁。
//
// 【校验两个目标】
//   A. README.md 的「快捷键」节
//   B. frontend/src/App.vue 的 SHORTCUTS 数组（应用内「帮助 → 快捷键速查」的数据源）
// 比对的是**源码里的原始字符串**（如 '⌘⇧B'），不是 fmtKey() 在 Windows 上
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

const goSrc = read('main.go')
const readme = read('README.md')
const appVue = read('frontend/src/App.vue')
const editorSrc = read('frontend/src/editor/createEditor.js')

/* ============================================================================
 * 一、解析 main.go 的 buildMenu()，得到 accelerator 真源集合
 *
 * 解析逻辑已抽到共享模块 scripts/verify/parse-main-menu.mjs —— 与
 * frontend/tests/contracts.test.mjs 共用同一份实现，避免两处独立解析
 * main.go 语法、各自失效（历史上已因实参切分与引号判断出过 3 次静默假绿，
 * 详见共享模块顶部注释）。本文件只保留「accelerator ↔ 文档」这一层的校验。
 * ==========================================================================*/

const { parseBuildMenu, canonToken, findAcceleratorDuplicates } = await import('./parse-main-menu.mjs')

const menu = parseBuildMenu(goSrc)

/** accelerator → 菜单项标签（真源集合） */
const goAccel = new Map()
/** 无 accelerator 的菜单项标签（用于「必须显式标注无快捷键」检查） */
const noAccelLabels = []

for (const it of menu.items) {
  if (it.accelerator) goAccel.set(it.accelerator, it.label ?? it.rawAccelerator)
  // 动态标签（如最近打开的 labels[i]）无法静态枚举，不进「须标注无快捷键」清单
  else if (it.label && !it.labelIsDynamic) noAccelLabels.push(it.label)
}

/* ============================================================================
 * 二、显式豁免白名单（带理由，不靠「扫不到就不管」）
 * ==========================================================================*/

// A) 系统 EditMenu Role：main.go 在 darwin 分支 append(menu.EditMenu())，
//    这六项由 macOS 原生 selector（undo:/cut:/copy:/paste:/selectAll:）提供，
//    本仓 main.go 里【没有】对应的 AddText，故不出现在 goAccel 中。
const SYSTEM_ROLE = new Map([
  ['⌘Z', '系统 EditMenu Role（原生 undo: selector）'],
  ['⌘⇧Z', '系统 EditMenu Role（原生 redo: selector）'],
  ['⌘X', '系统 EditMenu Role（原生 cut: selector）'],
  ['⌘C', '系统 EditMenu Role（原生 copy: selector）'],
  ['⌘V', '系统 EditMenu Role（原生 paste: selector）'],
  ['⌘A', '系统 EditMenu Role（原生 selectAll: selector）'],
])

// B) 编辑器 keymap 承接：darwin 的 WailsMenu.m 对 EditMenu Role 是硬编码展开，
//    自定义子项追加进去会被无视（main.go:54-59 注释已记录该实测限制），
//    所以这些键在 macOS 上由 createEditor.js 的 keymap / App.vue 全局 keydown 承接。
//    格式：展示键 → [承载方, 代码里的绑定字面量]
const KEYMAP = new Map([
  ['⌥↑', ['editor keymap createEditor.js', 'Alt-ArrowUp']],
  ['⌥↓', ['editor keymap createEditor.js', 'Alt-ArrowDown']],
  ['⇧⌥↑', ['editor keymap createEditor.js', 'Shift-Alt-ArrowUp']],
  ['⇧⌥↓', ['editor keymap createEditor.js', 'Shift-Alt-ArrowDown']],
  ['⌘⇧K', ['editor keymap createEditor.js', 'Mod-Shift-k']],
  ['⌘⌥F', ['editor keymap createEditor.js', 'Mod-Alt-f']],
  ['⌘F', ['App.vue 全局 keydown + CM searchKeymap', "k === 'f'"]],
  ['⌘L', ['App.vue 全局 keydown', "k === 'l'"]],
])

/** 键位是否被显式豁免；返回理由或 null */
function exemptionReason(k) {
  if (SYSTEM_ROLE.has(k)) return SYSTEM_ROLE.get(k)
  if (KEYMAP.has(k)) return KEYMAP.get(k)[0]
  return null
}

/* ============================================================================
 * 三、抽取两个目标的键位集合
 * ==========================================================================*/

// 键字符集含 ` ：行内代码的 ⌘` 是真键（main.go keys.CmdOrCtrl("`")）
const KEYCHARS = 'A-Za-z0-9.,`/=↑↓-'
// 必须【至少一个修饰键】+【恰好一个键字符】：
// 否则会吞掉正文里的裸字母（如 Esc、Ctrl、Alt 等平台名）造成假键位。
const TOKEN = new RegExp(`[⌘⇧⌥⌃]+[${KEYCHARS}]`, 'g')

/**
 * 把文档里写的键位归一到与 main.go 相同的规范形式 —— 由共享模块提供。
 * 必须做：文档可能按习惯写成 '⇧⌘P'，而 main.go 侧产出 '⌘⇧P'，
 * 同一组合却因修饰键顺序不同被判成「捏造键位」的假警报。
 * （macOS 官方书写惯例正是 ⌘⇧P 在前，此处以共享模块的 MOD_ORDER 为准。）
 */

/** 从一段文本里抽键位（已归一）；区间写法（⌘1 … ⌘4）先展开 */
function extractKeys(text) {
  const expanded = text
    .replace(/⌘⌥1\s*…\s*⌘⌥6/g, '⌘⌥1 ⌘⌥2 ⌘⌥3 ⌘⌥4 ⌘⌥5 ⌘⌥6')
    .replace(/⌘1\s*~\s*⌘4/g, '⌘1 ⌘2 ⌘3 ⌘4')
  const found = new Map() // 归一键 → 原文行
  for (const rawLine of expanded.split('\n')) {
    // 表格行与数组行都可能有行内代码定界符（如 `⌘`）；偶数个反引号是定界符，剥掉；
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

// A) README「快捷键」节 —— 只取表格行（散文里 `⌘` / `Ctrl` 这类单独提及修饰符的
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

// B) App.vue 的 SHORTCUTS 数组（应用内速查弹层的数据源）
//    按【行】截取到独立的收尾 `]`：不能用 indexOf(']')，数组第一行 ['⌘N', …]
//    里就含 `]`，会把整段切成 35 字符（第一版踩过，只读到 1 个键位）。
const shortcutsStart = appVue.indexOf('const SHORTCUTS = [')
const shortcutsEnd = appVue.indexOf('\n]', shortcutsStart)
if (shortcutsStart === -1 || shortcutsEnd === -1) {
  console.error('无法定位 App.vue 的 SHORTCUTS 数组（格式已变？）')
  process.exit(1)
}
const shortcutsBlock = appVue.slice(shortcutsStart, shortcutsEnd + 2)
const shortcutsKeys = extractKeys(shortcutsBlock)

/* ============================================================================
 * 四、校验
 * ==========================================================================*/

const problems = []
const note = (kind, key, detail) => problems.push({ kind, key, detail })

const TARGETS = [
  { name: 'README.md 快捷键节', keys: readmeKeys, requireComplete: true },
  { name: "App.vue SHORTCUTS（应用内速查表）", keys: shortcutsKeys, requireComplete: false },
]

for (const t of TARGETS) {
  // 检查 1：文档里出现但 main.go 无 accelerator、也不在显式豁免里 → 凭空捏造
  for (const k of t.keys.keys()) {
    if (goAccel.has(k) || exemptionReason(k)) continue
    note('捏造键位（无 accelerator 且不在豁免白名单）', k,
      `${t.name}\n            原文行: ${t.keys.get(k)}`)
  }
  // 检查 2：README 应完整覆盖 main.go 的全部 accelerator（内联速查表是精选子集，不要求）
  if (t.requireComplete) {
    for (const [k, label] of goAccel) {
      if (t.keys.has(k)) continue
      note('README 漏写该 accelerator', k, `${t.name}  未收录菜单项「${label}」`)
    }
  }
}

// 检查 3：README 必须把「无 accelerator」的菜单项显式标注出来，
//         否则读者会以为漏了快捷键（本次漂移正是这种「静默失真」）。
const NO_SHORTCUT_MUST_BE_LABELED = [
  ['重命名', '走应用内输入对话框'],
  ['历史快照', 'ADR-004：低频入口，避免误触'],
  ['复制选区为 HTML', '仅菜单入口'],
  ['目录', '插入子菜单，无 accelerator'],
  ['滚动联动', 'checkbox 勾选项'],
  ['打字机模式', 'checkbox 勾选项'],
  ['窗口置顶', 'checkbox 勾选项'],
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

// 检查 4：内联速查表自身的键位冲突（同一个键在同一张表里出现两次）——
//         2026-06 加粗写成 ⌘B 就撞上了大纲的 ⌘B，此检查即为此设。
{
  const seen = new Map() // 键 → 标签
  for (const line of shortcutsBlock.split('\n')) {
    const m = line.match(/\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/)
    if (!m) continue
    const keyStr = m[1]
    const label = m[2]
    for (const [k] of extractKeys(keyStr)) {
      if (seen.has(k) && seen.get(k) !== label) {
        note('内联速查表键位冲突（同一键两义）', k,
          `App.vue SHORTCUTS：「${seen.get(k)}」与「${label}」都绑到 ${k}\n            原文行: ${line.trim()}`)
      } else if (!seen.has(k)) {
        seen.set(k, label)
      }
    }
  }
}

// 检查 5：main.go 内部 accelerator 唯一性（**独立于文档比对**）。
//         为什么必须单独一道：下游按 accelerator 归并用的是 Map/Set，
//         重复项会被 Set 静默去重 → 「文档 ↔ main.go」diff 仍显示一致、
//         门禁报绿，而运行时行为不确定。这是键位 bug 的典型形态，
//         仓库历史上真发生过（⌘P 曾同时被打印与导出 PDF 占用）。
for (const dup of findAcceleratorDuplicates(goSrc)) {
  const where = dup.occurrences
    .map((o) => `main.go:${o.line} 「${o.label ?? '(动态标签)'}」${o.rawAccelerator}`)
    .join('\n            ')
  note('main.go 内 accelerator 重复绑定', dup.accelerator,
    `该组合被绑了 ${dup.occurrences.length} 次：\n            ${where}\n` +
    '同键绑定两项会导致点击行为不确定（后注册者可能覆盖前者），且不会报错。' +
    '修法：改 main.go 让两者不同（注意 ⌘P 与 ⇧⌘P 是不同组合，不算冲突）。')
}

/* ============================================================================
 * 五、报告
 * ==========================================================================*/

console.log('快捷键契约校验（真源 = main.go buildMenu()）')
console.log('='.repeat(64))
console.log(`main.go 声明的 accelerator: ${goAccel.size} 项`)
console.log(`无 accelerator 的菜单项:     ${noAccelLabels.length} 项（须在 README 显式标注）`)
console.log(`显式豁免:                   系统 Role ${SYSTEM_ROLE.size} 项 + 编辑器 keymap ${KEYMAP.size} 项`)
console.log(`README 快捷键节键位:         ${readmeKeys.size} 项`)
console.log(`App.vue SHORTCUTS 键位:      ${shortcutsKeys.size} 项`)
console.log('')

if (problems.length === 0) {
  console.log('一致：0 处漂移。README 与内联速查表的键位均与 main.go 对齐。')
  process.exit(0)
}

console.log(`发现 ${problems.length} 处漂移：`)
for (const p of problems) {
  console.log(`  [${p.kind}] ${p.key}`)
  console.log(`            ${p.detail}`)
}
console.log('')
console.log('修法：改 main.go 的 accelerator（真源）后，同步 README「快捷键」节与 App.vue SHORTCUTS。')
process.exit(1)
