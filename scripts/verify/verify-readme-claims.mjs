// verify-readme-claims.mjs — README 里的数字声明 ↔ 实测同步守卫
// ============================================================================
// 【这个脚本为什么存在】
// 本仓吃过三次同族的亏，都是「**文档里写死的数字悄悄过期了**，而门禁全绿」：
//   ① README 快捷键表与命令表脱节  → 已有 verify-shortcuts.mjs 守着
//   ② 目视清单副本与 HANDOFF §6 脱节 → 已有 verify-visual-checklist.mjs 守着
//   ③ README 的「221 条测试 / 44 个 suite」在第十四轮加到 239/50 之后**没跟改**
//
// ③ 这一处此前**无任何门禁**：而这类数字的杀伤力在于——它让读者以为「测试规模
// 还停在 221」，据此判断改动风险；实际已经 239。数字失真比没有数字更坏。
//
// 本脚本把两类「README 散文里的实测数字」变成机器门禁：
//   A) 前端测试条数 / suite 数 ↔ 真跑一遍 npm test 的实测值
//   B) App.vue 行数声明 ↔ 按门禁同口径（countTotalLines）实测的行数
//
// ---------------------------------------------------------------------------
// 【为什么不静态数 test() 调用】
//   因为静态数会在这些地方立刻失真：参数化测试循环、describe 嵌套、条件跳过、
//   以及 t.skip/t.todo。**唯一诚实的实测口径是 node --test 自己报的数**，
//   故本脚本真跑一遍测试网并解析其 reporter 输出（耗时约 4s，与 npm test 同源）。
//   反过来，这也意味着本脚本【必须能访问 frontend/node_modules】（三条测试从
//   @codemirror/* 导入），因此它挂在 CI 的 frontend job（有 npm ci）之下，
//   而不是 docs-contract job（后者不装依赖、跑不了测试网）。
//
// ---------------------------------------------------------------------------
// 【为什么 B 项要用 countTotalLines 而不是自己 split('\n')】
//   门禁（contracts.test.mjs 契约 5）用的是 helpers/line-metric.mjs 的
//   countTotalLines（wc -l 口径：末尾无换行不计一行）。口径必须单一真源，
//   否则会出现「门禁说 148、本脚本说 149」的荒谬对撞。故直接 import 该 helper。
//   附带守一条**口径声明**：README 原文写的是「门禁口径是剥注释后的有效行」，
//   而 App.vue 那条铁律实际用的是**总行数**（更严）。这是本脚本上线时实测到的
//   既有失真——「口径写反」比数字过时更误导，故一并纳入判据。
//
// ---------------------------------------------------------------------------
// 【变异自证（本项目铁律：只认机械证据，不认「我改对了」的一句话）】
//   交付前必须注入违规、确认报红、再逐字还原，并用 git diff --stat 证明干净：
//     注入 A：把 README 的「239 条测试」改成「240 条测试」
//            → 期望退出码 1，报「实测 239 / 声明 240」。
//     注入 B：把 README 的 App.vue「当前 148 行」改成「当前 140 行」
//            → 期望退出码 1，报「实测 148 / 声明 140」。
//     注入 C：把 README App.vue 那行的「总行数」删掉（退回旧失真说法）
//            → 期望退出码 1，报「口径声明缺失」。
//     注入 D：删掉任一锚点所在整行（如「期望 239/239」那行）
//            → 期望退出码 2（判据锚点消失，结论不可采信，不得假绿）。
//   还原：4 次均逐字还原，git diff --stat 对 README.md 应无输出。
//
// ---------------------------------------------------------------------------
// 【退出码】
//   0 = 全部一致
//   1 = 漂移（逐条打印，含实测值、声明值与所在行号，便于直接定位）
//   2 = 测量基失败或解析失效 —— 此时【结论不可采信】，
//       与 verify-visual-checklist.mjs / scan-i18n-residue.mjs 的约定一致：
//       测量器坏了绝不能假装「通过」。
//
// 【用法】node scripts/verify/verify-readme-claims.mjs
// ============================================================================

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { countTotalLines } from '../../frontend/tests/helpers/line-metric.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const README = 'README.md'
const APP_VUE = 'frontend/src/App.vue'

const readme = readFileSync(join(ROOT, README), 'utf8')

/* ============================================================================
 * 一、实测：真跑一遍测试网，解析 node --test 的 reporter 输出
 *   reporter 固定用 spec（其尾部稳定输出 `ℹ tests N` / `ℹ suites N`）。
 *   ⚠ 与 package.json 的 test 脚本同源同参数（node --test 加 tests 下的 glob），
 *     只多一个 --test-reporter=spec 以锁定输出形态。
 * ==========================================================================*/

function measureTestSuite() {
  let stdout
  try {
    stdout = execFileSync(
      process.execPath,
      ['--test', '--test-reporter=spec', 'tests/**/*.test.mjs'],
      { cwd: join(ROOT, 'frontend'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  } catch (e) {
    // 测试网本身失败 → 无法测量，退出码 2（不得拿半截输出当实测值）
    return { error: `测试网未通过，无法取得实测值：\n${(e.stdout || '') + (e.stderr || '')}`.trim() }
  }
  const tests = stdout.match(/^ℹ tests (\d+)$/m)
  const suites = stdout.match(/^ℹ suites (\d+)$/m)
  if (!tests || !suites) {
    return { error: '无法从 node --test 输出里解析出 tests / suites（reporter 形态可能已变）' }
  }
  return { tests: Number(tests[1]), suites: Number(suites[1]) }
}

/* ============================================================================
 * 二、声明侧：从 README 里按「锚点正则」抽取数字声明
 *
 *   ⚠ 为什么用锚点而不是「全文找所有数字」：
 *   README 里同形数字大量存在且语义不同——「期望 24/24」是图标规格条数、
 *   「8/8」是 theme 自检断言数；HANDOFF 里还有 121→126 这类**历史轮次记录**
 *   （那不是漂移，是史料）。所以每条判据都必须锚定到
 *   「**那一句独有的上下文**」上，锚点找不到即退出码 2。
 * ==========================================================================*/

const ANCHORS = [
  {
    key: 'tree',
    name: '目录树注释（tests/ 那行）',
    re: /（(\d+) 条测试 \/ (\d+) 个 suite/,
    take: (m) => ({ tests: Number(m[1]), suites: Number(m[2]) }),
  },
  {
    key: 'frontendSection',
    name: '前端小节（npm test 那行）',
    // 必须与「npm test #」同行锚定：裸匹配「测试网（N 条测试」会被目录树那行
    // 抢先命中（它同样以「测试网（」开头），导致行号归属错误、同处漂移重复上报。
    re: /npm test\s+# 测试网（(\d+) 条测试/,
    take: (m) => ({ tests: Number(m[1]) }),
  },
  {
    key: 'gateList',
    name: '门禁脚本清单（期望 N/N）',
    // 必须与 npm test 同行，避开「期望 24/24」「期望 8/8」两条同形声明
    re: /npm test[^\n]*?期望 (\d+)\/(\d+)/,
    take: (m) => ({ tests: Number(m[1]), denominator: Number(m[2]) }),
  },
]

function collectTestClaims() {
  const claims = []
  const problems = []
  for (const a of ANCHORS) {
    const m = readme.match(a.re)
    if (!m) {
      problems.push({ kind: '锚点消失', detail: `README 里找不到「${a.name}」的声明（正则：${a.re}）` })
      continue
    }
    claims.push({ ...a.take(m), line: readme.slice(0, m.index).split('\n').length, name: a.name })
  }
  return { claims, problems }
}

/* App.vue 那行的声明：行内同时出现「App.vue」与「当前 N 行」，全仓仅此一行。 */
function collectAppVueClaim() {
  const line = readme.split('\n').find((l) => l.includes('`App.vue`') && /当前 \d+ 行/.test(l))
  if (!line) {
    return { error: 'README「已知问题」表里找不到 App.vue 的行数声明（形如「当前 N 行」）' }
  }
  const n = line.match(/当前 (\d+) 行/)
  const lineNo = readme.split('\n').indexOf(line) + 1
  // 口径判据必须锚定「门禁口径」那句本身，而不是行内任意位置出现过「总行数」。
  // 早期版本只判 line.includes('总行数')，变异自证立刻抓到它的假绿：
  // 那行前半还有「硬上限 **总行数** 150 行」，把后半的口径失真说法删掉照样命中。
  const metric = line.match(/门禁口径是(.{0,12})/)
  return {
    declared: Number(n[1]),
    lineNo,
    line,
    metricText: metric ? metric[0] : null,
    // 只有当「门禁口径是…」这句本身把口径说成总行数时才算守住了
    saysTotal: !!metric && /总行数/.test(metric[1]),
  }
}

function measureAppVue() {
  try {
    return countTotalLines(readFileSync(join(ROOT, APP_VUE), 'utf8'))
  } catch (e) {
    return { error: `读不到 ${APP_VUE}：${e.message}` }
  }
}

/* ============================================================================
 * 三、比对
 * ==========================================================================*/

function compareTestClaims(claims, actual) {
  const problems = []
  const note = (kind, detail) => problems.push({ kind, detail })

  for (const c of claims) {
    if (c.tests !== actual.tests) {
      note('测试条数漂移',
        `README 第 ${c.line} 行（${c.name}）声明 ${c.tests} 条，实测 ${actual.tests} 条`)
    }
    if (c.suites !== undefined && c.suites !== actual.suites) {
      note('suite 数漂移',
        `README 第 ${c.line} 行（${c.name}）声明 ${c.suites} 个 suite，实测 ${actual.suites} 个`)
    }
    // 「期望 N/N」的分母自身也是声明：必须是自洽的 N/N
    if (c.denominator !== undefined && c.denominator !== c.tests) {
      note('声明自相矛盾',
        `README 第 ${c.line} 行（${c.name}）写成 ${c.tests}/${c.denominator}，分子分母不一致`)
    }
  }
  return problems
}

/* ============================================================================
 * 四、报告
 * ==========================================================================*/

console.log('README 数字声明同步守卫（实测 ↔ 声明）')
console.log('='.repeat(64))

const measuredTests = measureTestSuite()
if (measuredTests.error) {
  console.error(`[测量基失败] ${measuredTests.error}`)
  console.error('')
  console.error('结论：无法测量 —— 本次结果【不可采信】，不得当作通过。')
  process.exit(2)
}

const measuredAppVue = measureAppVue()
if (measuredAppVue.error) {
  console.error(`[测量基失败] ${measuredAppVue.error}`)
  console.error('')
  console.error('结论：无法测量 —— 本次结果【不可采信】，不得当作通过。')
  process.exit(2)
}

const { claims, problems: anchorProblems } = collectTestClaims()
const appVueClaim = collectAppVueClaim()

// —— 判据自身失效即退出码 2：锚点没了 = 这条门禁其实没在检查任何东西
if (anchorProblems.length > 0) {
  for (const p of anchorProblems) console.error(`[解析失败] ${p.detail}`)
  console.error('')
  console.error('结论：判据锚点失效 —— 本次结果【不可采信】（静默不检查比报错更坏）。')
  process.exit(2)
}
if (appVueClaim.error) {
  console.error(`[解析失败] ${appVueClaim.error}`)
  console.error('')
  console.error('结论：判据锚点失效 —— 本次结果【不可采信】。')
  process.exit(2)
}

console.log(`实测测试条数:            ${measuredTests.tests} 条（node --test 真跑）`)
console.log(`实测 suite 数:           ${measuredTests.suites} 个`)
console.log(`README 声明锚点命中:     ${claims.length} 处（${claims.map((c) => c.name).join('、')}）`)
console.log(`实测 App.vue 总行数:     ${measuredAppVue} 行（countTotalLines，与契约 5 同口径）`)
console.log(`README App.vue 声明:     ${appVueClaim.declared} 行（第 ${appVueClaim.lineNo} 行）`)
console.log('')

const problems = [...anchorProblems, ...compareTestClaims(claims, measuredTests)]

if (appVueClaim.declared !== measuredAppVue) {
  problems.push({
    kind: 'App.vue 行数漂移',
    detail: `README 第 ${appVueClaim.lineNo} 行声明「当前 ${appVueClaim.declared} 行」，` +
      `实测 ${measuredAppVue} 行（总行数口径）`,
  })
}
if (!appVueClaim.saysTotal) {
  problems.push({
    kind: '门禁口径声明失真',
    detail: `README 第 ${appVueClaim.lineNo} 行的「门禁口径是…」未说成总行数` +
      `（实测读到：${appVueClaim.metricText ?? '（该句已消失）'}）；` +
      '契约 5 实为总行数（含注释与空行，比有效行更严），口径写反会误导改动成本判断',
  })
}

if (problems.length === 0) {
  console.log('一致：0 处漂移。README 的测试条数、suite 数、App.vue 行数与实测逐项吻合。')
  process.exit(0)
}

console.log(`发现 ${problems.length} 处漂移：`)
for (const p of problems) console.log(`  [${p.kind}] ${p.detail}`)
console.log('')
console.log('修法：以实测值为准改 README —— 加/删测试后同步这三处声明：')
console.log(`      ① 目录树注释  ② 前端小节 npm test 说明  ③ 门禁脚本清单的「期望 N/N」`)
process.exit(1)
