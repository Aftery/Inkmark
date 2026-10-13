// verify-visual-checklist.mjs — 目视验收清单同步守卫（真源 = docs/HANDOFF.md §6）
// ============================================================================
// 【这个脚本为什么存在】
// docs/HANDOFF.md §6 是「真机目视验收」那 22 项的【唯一真源】。为了让这份清单
// 可勾选、可存档、可导出，另做了一份单文件 docs/qa/visual-checklist.html —— 它天然
// 是「§6 的副本」。副本一旦与真源脱节，就会重演本仓反复吃过的亏：**清单悄悄失真、
// 没人发现**（同族：README 键位漂移、恒绿的假用例、只写在文档里却无从核对的人工项）。
// 故把「§6 的编号条目集合 == HTML 内嵌清单数据集合」变成机器门禁：
//
//   1) §6 里删/加/改标题 → 若 HTML 未同步 → 报红（HTML 是过期的副本）
//   2) HTML 里删/加/改条目 → 若 §6 未同步 → 报红（副本擅自偏离真源）
//
// 比对的是 **(编号, 标题) 的集合**，且**项数必须相等**。正文要点允许在 HTML 里
// 精简（§6 正文可读性优先，HTML 可压短），故只比对编号与标题，不比对整段正文。
//
// ---------------------------------------------------------------------------
// 【为什么【不】接入 CI（由总监决定是否接）】
// 本脚本按任务要求可本地跑通、退出码语义完整；是否入 ci.yml 由总监裁决。
// 若要接，命令即：node scripts/verify/verify-visual-checklist.mjs
//
// ---------------------------------------------------------------------------
// 【变异自证（本项目铁律：只认机械证据，不认「我改对了」的一句话）】
// 交付前必须两次注入违规、确认报红、再逐字还原，并用 git diff --stat 证明干净：
//   注入 A：在 HTML 的 <script id="inkmark-checklist-source"> 里删掉一项（如 n=22）
//            → 期望退出码 1，报「§6 有、HTML 无」。
//   注入 B：在 HANDOFF §6 里给某条改标题（如把「菜单」改成「菜单（变异）」）
//            → 期望退出码 1，报「标题不一致」。
//   还原：两次均逐字还原，git diff --stat 对 docs/HANDOFF.md 与
//         docs/qa/visual-checklist.html 应无输出（证明零残留）。
//
// ---------------------------------------------------------------------------
// 【退出码】
//   0 = 一致
//   1 = 漂移（差异已逐条打印，含编号与两侧标题，便于直接定位）
//   2 = 脚本自身失效（任一侧解析为空 / 边界找不到）——此时【结论不可采信】，
//       与 scan-i18n-residue.mjs 的约定一致：解析器坏了绝不能假装「通过」。
//
// 【用法】node scripts/verify/verify-visual-checklist.mjs
// ============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const HANDOFF = 'docs/HANDOFF.md'
const HTML = 'docs/qa/visual-checklist.html'

/* ============================================================================
 * 一、解析 HANDOFF §6 的编号条目（真源侧）
 *   形态：`N. **标题**：正文…`（标题与编号同行，正文可续到后续缩进行）
 * ==========================================================================*/

function parseHandoffSection6(text) {
  // 用换行前缀定位标题，避免匹配到正文里偶然出现的 `## 6.` 字样
  const start = text.indexOf('\n## 6.')
  const end = text.indexOf('\n## 7.')
  if (start === -1) return { error: `在 ${HANDOFF} 里找不到「## 6.」小节标题` }
  if (end === -1) return { error: `在 ${HANDOFF} 里找不到「## 7.」小节标题` }
  if (end <= start) return { error: `§6 与 §7 的边界顺序异常（§7 出现在 §6 之前）` }

  const section = text.slice(start, end)
  const items = []
  // 行首「编号 + . + 空白 + **粗体标题**」。缩进的内容行不匹配（^ 只在行首）。
  const re = /^(\d+)\.\s+\*\*(.+?)\*\*/gm
  for (const m of section.matchAll(re)) {
    items.push({ n: Number(m[1]), title: m[2].trim() })
  }
  return { section, items }
}

/* ============================================================================
 * 二、解析 HTML 内嵌的清单数据（副本侧）
 *   形态：<script type="application/json" id="inkmark-checklist-source">[…]</script>
 *   用 JSON 而非可执行 JS：file:// 下可直接读 textContent，且本脚本能 JSON.parse。
 * ==========================================================================*/

function parseHtmlChecklist(html) {
  const re = /<script[^>]*\bid="inkmark-checklist-source"[^>]*>([\s\S]*?)<\/script>/
  const m = html.match(re)
  if (!m) {
    return { error: `在 ${HTML} 里找不到内嵌清单数据（<script id="inkmark-checklist-source">）` }
  }
  let data
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    return { error: `${HTML} 的内嵌清单数据不是合法 JSON：${e.message}` }
  }
  if (!Array.isArray(data)) {
    return { error: `${HTML} 的内嵌清单数据不是数组` }
  }
  const items = []
  for (const it of data) {
    if (!it || typeof it.n !== 'number' || typeof it.title !== 'string') {
      return { error: `${HTML} 的清单条目缺少可用的 n / title 字段：${JSON.stringify(it)}` }
    }
    items.push({ n: it.n, title: it.title.trim() })
  }
  return { items }
}

/* ============================================================================
 * 三、比对：集合逐项一致 + 项数相等
 * ==========================================================================*/

function compare(srcItems, htmlItems) {
  const problems = []
  const note = (kind, n, detail) => problems.push({ kind, n, detail })

  const srcByN = new Map(srcItems.map((it) => [it.n, it]))
  const htmlByN = new Map(htmlItems.map((it) => [it.n, it]))

  // 项数（先报，便于一眼看清整体缺口）
  if (srcItems.length !== htmlItems.length) {
    note('项数不等', '-',
      `HANDOFF §6 = ${srcItems.length} 项，HTML 内嵌 = ${htmlItems.length} 项`)
  }

  // §6 有、HTML 无 → 副本漏了（HTML 过期）
  for (const it of srcItems) {
    if (!htmlByN.has(it.n)) {
      note('§6 有、HTML 无（副本漏项）', it.n, `标题：「${it.title}」`)
    }
  }
  // HTML 有、§6 无 → 副本凭空多出（HTML 擅自偏离真源）
  for (const it of htmlItems) {
    if (!srcByN.has(it.n)) {
      note('HTML 有、§6 无（副本多出）', it.n, `标题：「${it.title}」`)
    }
  }
  // 同编号标题不一致
  for (const it of srcItems) {
    const other = htmlByN.get(it.n)
    if (other && other.title !== it.title) {
      note('同编号标题不一致', it.n,
        `HANDOFF §6：「${it.title}」\n            HTML     ：「${other.title}」`)
    }
  }
  // 编号重复（任一侧出现两个相同编号）
  for (const [label, arr] of [['HANDOFF §6', srcItems], ['HTML', htmlItems]]) {
    const seen = new Set()
    for (const it of arr) {
      if (seen.has(it.n)) note('编号重复', it.n, `${label} 里出现两个编号 ${it.n}`)
      seen.add(it.n)
    }
  }
  return problems
}

/* ============================================================================
 * 四、报告
 * ==========================================================================*/

const handoffText = read(HANDOFF)
const htmlText = read(HTML)

const src = parseHandoffSection6(handoffText)
const html = parseHtmlChecklist(htmlText)

console.log('目视验收清单同步守卫（真源 = docs/HANDOFF.md §6）')
console.log('='.repeat(64))

// —— 解析失败即退出码 2：解析器坏了，结论不可采信（防「扫不到 = 通过」的假绿灯）
if (src.error || html.error) {
  if (src.error) console.error(`[解析失败] ${src.error}`)
  if (html.error) console.error(`[解析失败] ${html.error}`)
  console.error('')
  console.error('结论：无法比对 —— 脚本自身失效，本次结果【不可采信】。')
  process.exit(2)
}

if (src.items.length === 0) {
  console.error(`[解析失败] ${HANDOFF} §6 解析出 0 个编号条目 —— 判据可能已失效，结果不可采信。`)
  process.exit(2)
}
if (html.items.length === 0) {
  console.error(`[解析失败] ${HTML} 内嵌清单解析出 0 个条目 —— 判据可能已失效，结果不可采信。`)
  process.exit(2)
}

console.log(`§6 编号条目:            ${src.items.length} 项`)
console.log(`HTML 内嵌清单条:        ${html.items.length} 项`)
console.log(`比对字段:               编号 + 标题（集合逐项一致，且项数相等）`)
console.log('')

const problems = compare(src.items, html.items)

if (problems.length === 0) {
  console.log('一致：0 处漂移。HTML 清单是 §6 的忠实副本（编号与标题逐项对齐）。')
  process.exit(0)
}

console.log(`发现 ${problems.length} 处漂移：`)
for (const p of problems) {
  console.log(`  [${p.kind}] 编号 ${p.n}`)
  console.log(`            ${p.detail}`)
}
console.log('')
console.log('修法：以 docs/HANDOFF.md §6 为准，把差异同步回 docs/qa/visual-checklist.html')
console.log('      的内嵌清单数据（<script id="inkmark-checklist-source"> 的 n / title 字段）。')
process.exit(1)
