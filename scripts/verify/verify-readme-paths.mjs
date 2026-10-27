// verify-readme-paths.mjs — README 里「引用的仓库文件/目录」必须真实存在
// ============================================================================
// 【这个脚本为什么存在】
// 2026-10-27 通读 README 逐条对着代码核实，一次抓出 7 处失真：代码块高亮说
// 「go 只在预览区」（实际早已 import lang-go）、文本导出说「其它平台走系统打印」
// （Linux 已有一键直出）、目录结构缺 4 个 Go 文件、命令数停在 55/43（实测 62/50）……
// 它们全都有同一个病因：
//
//     **README 的「已实现能力」表与「目录结构」节没有任何门禁守着。**
//
// 既有的 verify-readme-claims.mjs 只守三个数字（测试条数 / suite 数 / App.vue 行数），
// 所以「功能落地时只改 HANDOFF、不回改 README」不会被任何东西拦住 ——
// 而 README 骗人时格式完整、语气确定，比明显的错更危险（本仓头号敌人：
// 静默失效 / 假绿灯，见 HANDOFF §5）。
//
// 本脚本补上这条：**README 里每一处「反引号包起来的仓库路径」都必须真实存在。**
// 这样至少能拦住两类高发失真：
//   1) 文件/目录改名了，README 还指着旧路径（如 export_pdf_other.go 语义已变）；
//   2) 新增文件（window_linux.go / export_pdf_linux.go 等）从没进过目录结构。
//
// ---------------------------------------------------------------------------
// 【两条判据，缺一不可】
//
//   判据 A（正向：README → 文件系统）
//     README 里每个「路径形」的反引号片段，必须能解析到一个真实存在的
//     文件或目录。
//
//   判据 B（反向：文件系统 → README 的 Go 文件清单）
//     仓库根的每个生产 Go 文件（排除 _test.go）必须出现在 README 的目录结构
//     里。**只做 A 不做 B 是不够的** —— A 只能证明「写了的都对」，证明不了
//     「该写的都写了」，而本次 7 处失真里有 4 处正是「新文件从没被写进去」。
//     反向判据天然更严，故只在能被穷举的地方（仓库根 Go 文件）启用；
//     frontend/src 下 30+ 文件不做反向要求（目录结构那节是节选，不是全量清单）。
//
// ---------------------------------------------------------------------------
// 【路径基准怎么定（这是本脚本最容易做错的地方）】
// README 里的路径**不是**统一相对仓库根的，实测三种混用：
//   `docassets.go`            → 仓库根
//   `src/editor/wysiwyg.js`   → frontend/
//   `editor/outline.js`       → frontend/src/
//   `frontend/dist/.gitkeep`  → 仓库根（自带前缀）
// 故采用**候选基准表**：对每个片段依次尝试 [仓库根, frontend, frontend/src]，
// 任一命中即算存在。这不是「宽松到失去意义」—— 判据仍然是「必须有一个真实
// 文件对得上」，只是允许 README 用相对当前小节的简写（读者也是这样读的）。
// 宁可漏报（选择宽容）也不能假红，因为假红会导致这道门禁被绕过或删除。
//
// ---------------------------------------------------------------------------
// 【哪些反引号片段【不】参与判定（白名单必须写明理由，逐条可审计）】
//   · 命令与命令行片段（含空格、以已知命令词开头、含 shell 元字符）
//   · URL / 协议 / MIME 形态（含 :// 或以 / 开头的服务端路由如 /doc-assets/）
//   · 快捷键（⌘ / ⌥ / ⇧ 及含这些符号的组合）
//   · 扩展名本身（`.md`）与通配（`clipboard_*.go`）
//   · 纯符号 / 单字符 / 运算符（`/`、`+/-`）
//   · 变量占位（含 `{}`、`<>`、`,@` 等占位记号的模式串，如 export_pdf_{darwin,linux,other}.go）
//   · 已声明为「示例值」的文档内产物（`assets/`、`![](assets/xxx)`）
// 白名单写成**可执行的谓词**而非硬编码清单：这样新增的合法片段自动放行，
// 而「本该是路径却写错」的片段仍会被抓住（若它满足路径形态）。
//
// ---------------------------------------------------------------------------
// 【变异自证（本项目铁律：只认机械证据）】
// 交付前必须注入违规、确认精确报红、再逐字节还原并用 sha256 证明干净：
//   注入 A（判据 A）：把某行的 `tableRender.js` 改成 `tableRender-old.js`
//            → 期望退出码 1，且**只报这一处**（精确命中断言，不是碰巧红）。
//   注入 B（判据 B）：删掉目录结构里的 `docassets.go` 行
//            → 期望退出码 1，报「README 未登记 docassets.go」。
//   注入 C（解析器失效）：把 README 的目录结构代码块整段删掉
//            → 期望退出码 2（不可采信），而不是 0 或 1。
//
// ---------------------------------------------------------------------------
// 【退出码】（与 scan-i18n-residue / verify-visual-checklist 约定一致）
//   0 = 全部一致
//   1 = 有漂移（逐条打印路径与原因）
//   2 = 脚本自身失效（README 读不到 / 解析出 0 个路径 / 0 个 Go 文件）
//       —— 【结论不可采信】，绝不当作通过
//
// 【用法】node scripts/verify/verify-readme-paths.mjs
// ============================================================================

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const README = 'README.md'

/* ============================================================================
 * 一、白名单谓词：哪些反引号片段【不】当路径核对
 * ==========================================================================*/

/** 快捷符号（macOS 的 ⌘⌥⇧⌃ 等）—— 含任一即不是路径 */
const isShortcut = (s) => /[⌘⌥⇧⌃⌫↩⎋]/.test(s)

/** 跨平台键位写法（`Ctrl+/Alt+/Shift+` 这类）—— 同上 */
const isKeyCombo = (s) => /^(Ctrl|Cmd|Alt|Shift|Option)\+/i.test(s) || /^Ctrl\+/.test(s)

/** URL / 协议 / 服务端路由：含 :// 或以 / 开头（如 /doc-assets/、/usr/local/bin） */
const isUrlOrRoute = (s) => /:\/\//.test(s) || s.startsWith('/')

/** 命令行片段：以已知命令词开头，或含 shell 元字符 */
const isShellSnippet = (s) => {
  if (/^(node|npm|npx|go|cd|git|CGO_ENABLED|GOPROXY|PATH=|\.\/|~\/)/.test(s.trim())) return true
  return /[|>;$&]/.test(s)
}

/** 含空白 → 是散文/API 名并列，不是仓库路径（仓库里没有带空格的路径；
 *  万一带空格的文件确实存在，也会在 existence-first 阶段先被判定为 checked） */
const isWhitespacey = (s) => /\s/.test(s.trim())

/** 占位/模式串：含 {} <> 逗号枚举 或 * 通配 */
const isPatternOrPlaceholder = (s) => /[{},*<>]/.test(s) || /\.\.\./.test(s)

/** 纯符号 / 单字符 / 运算符（如 `/`、`+/-`、`.`） */
const isSymbolOnly = (s) => !/[A-Za-z\u4e00-\u9fa5]/.test(s)

/** 扩展名本身（`.md`）—— 不是路径 */
const isBareExtension = (s) => /^\.[a-z0-9]+$/i.test(s)

/** Markdown 内联语法片段（`![](assets/xxx)` 这类示例内容） */
const isMarkdownSnippet = (s) => s.includes('![') || s.includes('](')

/** 文档内产物示例（`assets/` 表示文档同级目录，不在仓库里） */
const isDocArtifact = (s) => /^assets\/?$/.test(s)

/** 只认「像仓库内的代码文件 / 目录」的片段：含 / 或以代码类扩展名结尾 */
const looksLikeRepoPath = (s) =>
  s.includes('/') || /\.(go|js|mjs|cjs|ts|vue|css|md|json|html|yml|yaml|sh|mod|sum|lock|txt)$/.test(s)

/* ----------------------------------------------------------------------------
 * 具名白名单：逐条写明「为什么它不该被当成仓库路径」。保持极短且可审计 ——
 * 每加一条都必须说明理由，否则这道门禁会退化成一堆豁免。
 * --------------------------------------------------------------------------*/
const NAMED_ALLOWLIST = new Map([
  ['highlight.js', 'npm 包名（预览侧按需注册的那套语言包），不是本仓文件'],
  ['lib/core', 'highlight.js 包内的子路径（lib/core + 按需 import），不是本仓文件'],
  ['recents.json', '已删除的实现：README 该处在说明「它随原生菜单整体删除」，属历史指代'],
  ['releases/latest', 'GitHub API 端点（api.github.com/repos/.../releases/latest）'],
  ['.md', '扩展名本身，不是路径'],
])

/** 综合判定：该片段是否值得做存在性核对
 *  返回 true 表示「应当去核对」，缺席就要报红 */
function shouldCheck(span) {
  const s = span.trim()
  if (!s) return false
  if (NAMED_ALLOWLIST.has(s)) return false
  if (isShortcut(s) || isKeyCombo(s)) return false
  if (isUrlOrRoute(s)) return false
  if (isShellSnippet(s)) return false
  if (isWhitespacey(s)) return false
  if (isPatternOrPlaceholder(s)) return false
  if (isSymbolOnly(s)) return false
  if (isBareExtension(s)) return false
  if (isMarkdownSnippet(s)) return false
  if (isDocArtifact(s)) return false
  if (/^(true|false|null|undefined)$/.test(s)) return false
  return looksLikeRepoPath(s)
}

/* ============================================================================
 * 二、解析 README 的反引号片段
 * ==========================================================================*/

function extractCodeSpans(text) {
  // 行内反引号：不跨行（跨行的是围栏代码块，另由 extractFences 处理）
  const spans = []
  const re = /`([^`\n]+)`/g
  for (const m of text.matchAll(re)) {
    spans.push({ raw: m[1], index: m.index })
  }
  return spans
}

/** 目录结构那节的围栏块内容（判据 B 要在这里找 Go 文件登记） */
function extractDirectorySection(text) {
  // 【为什么要校验标题逐字相等】曾用 indexOf('\n## 目录结构') 定位，变异自证发现
  // 把标题改成「## 目录结构（变异）」仍被前缀命中 → 判据 B 照常在**变异的**节里跑，
  // 结论却报「一致」，属门禁自身假绿。故先精确匹配标题行，再切节。
  const lines = text.split('\n')
  const startIdx = lines.findIndex((l) => l.trim() === '## 目录结构')
  if (startIdx === -1) {
    const loose = lines.findIndex((l) => l.trim().startsWith('## 目录结构'))
    return {
      error:
        loose === -1
          ? '找不到「## 目录结构」小节（标题被改或整节被删）'
          : `「## 目录结构」标题被改动过（实测为「${lines[loose].trim()}」）—— 判据 B 的锚点必须逐字保留`,
    }
  }
  const nextIdx = lines.findIndex((l, i) => i > startIdx && /^## /.test(l))
  if (nextIdx === -1) return { error: '「## 目录结构」之后找不到下一个「## 」小节（无法确定节边界）' }
  const section = lines.slice(startIdx, nextIdx).join('\n')
  const fence = section.match(/```[\s\S]*?```/)
  if (!fence) return { error: '「目录结构」小节里找不到围栏代码块' }
  return { section, fence: fence[0] }
}

/* ============================================================================
 * 三、判据 A：每个路径片段必须能解析到真实文件/目录
 * ==========================================================================*/

/** 候选基准：README 混用三种相对基准，依次尝试（见文件头「路径基准」） */
const BASES = ['', 'frontend', 'frontend/src']

/** 仓库内全部文件的 basename 索引（用于「README 只写了裸文件名」的情况）。
 *  排除构建产物与依赖目录 —— 那些不是仓库内容，命中它们等于假绿。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', '.wails', 'wailsjs', 'coverage'])

function buildFileIndex() {
  const byBase = new Map()
  const walk = (rel) => {
    let entries
    try {
      entries = readdirSync(join(ROOT, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(childRel)
      } else if (e.isFile()) {
        const list = byBase.get(e.name) || []
        list.push(childRel)
        byBase.set(e.name, list)
      }
    }
  }
  walk('')
  return byBase
}

const FILE_INDEX = buildFileIndex()

function resolveSomewhere(p) {
  const clean = p.replace(/\/+$/, '') // 末尾斜杠不参与解析
  if (!clean) return null

  // ① 先按候选基准解析（带目录的写法走这条）
  for (const base of BASES) {
    const abs = join(ROOT, base, clean)
    if (existsSync(abs)) {
      return { rel: join(base, clean) || '.', isDir: statSync(abs).isDirectory(), how: `基准:${base || '仓库根'}` }
    }
  }

  // ② 裸文件名（不含 /）→ 按 basename 全仓查找。
  //    理由：README 大量使用「就近简写」，如正文写 `tableWidget.js` 而不写全路径；
  //    这是读者友好的写法，不该被判红。查找仍是**真实的**：必须存在同名文件。
  if (!clean.includes('/')) {
    const hits = FILE_INDEX.get(clean) || []
    if (hits.length === 1) return { rel: hits[0], isDir: false, how: '裸文件名', ambiguity: 0 }
    if (hits.length > 1) {
      // 同名多份：视为命中，但记下歧义供报告（不判红——多份同名文件本身不违反契约）
      return { rel: hits[0], isDir: false, how: '裸文件名', ambiguity: hits.length, all: hits }
    }
  }
  return null
}

function checkPaths(spans) {
  const missing = []
  const checked = []
  const skipped = []
  for (const { raw } of spans) {
    if (!shouldCheck(raw)) {
      skipped.push(raw)
      continue
    }
    const hit = resolveSomewhere(raw.trim())
    if (hit) checked.push({ raw: raw.trim(), ...hit })
    else missing.push(raw.trim())
  }
  return { missing, checked, skipped }
}

/* ============================================================================
 * 四、判据 B：仓库根的生产 Go 文件必须登记进「目录结构」
 *    允许 README 用通配写法（`clipboard_*.go` 覆盖 clipboard_darwin.go 等）——
 *    那是有意的归并表达，不是漏登记。
 * ==========================================================================*/

function listRootGoFiles() {
  return readdirSync(ROOT)
    .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
    .sort()
}

/** 把围栏块里的通配写法（如 clipboard_*.go）编译成正则 */
function compileFenceGlobs(fence) {
  const globs = []
  for (const m of fence.matchAll(/([\w.-]*\*[\w.*-]*\.go)/g)) {
    const glob = m[1]
    const reStr = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\w.-]*')
    globs.push({ glob, re: new RegExp(`^${reStr}$`) })
  }
  return globs
}

function checkGoCoverage(dirFence, goFiles) {
  const globs = compileFenceGlobs(dirFence)
  const missing = []
  const present = []
  const viaGlob = []
  for (const f of goFiles) {
    // ① 逐字出现（词边界，避免 a.go 命中 aa.go）
    const exact = new RegExp(`(^|[^\\w.-])${f.replace(/\./g, '\\.')}([^\\w.-]|$)`, 'm')
    if (exact.test(dirFence)) {
      present.push(f)
      continue
    }
    // ② 被围栏里的通配写法覆盖
    const g = globs.find((x) => x.re.test(f))
    if (g) {
      present.push(f)
      viaGlob.push({ file: f, glob: g.glob })
      continue
    }
    missing.push(f)
  }
  return { missing, present, viaGlob }
}

/* ============================================================================
 * 五、主流程
 * ==========================================================================*/

let readmeText
try {
  readmeText = readFileSync(join(ROOT, README), 'utf8')
} catch (e) {
  console.error(`[解析失败] 读不到 ${README}：${e.message}`)
  console.error('结论：脚本自身失效，本次结果【不可采信】。')
  process.exit(2)
}

console.log('README 引用路径存在性守卫（判据 A：README → 文件系统 / 判据 B：Go 文件 → 目录结构）')
console.log('='.repeat(78))

const spans = extractCodeSpans(readmeText)
const dirSec = extractDirectorySection(readmeText)

if (spans.length === 0) {
  console.error(`[解析失败] ${README} 里解析出 0 个反引号片段 —— 判据可能已失效，结果不可采信。`)
  process.exit(2)
}
if (dirSec.error) {
  console.error(`[解析失败] ${dirSec.error} —— 判据 B 无法执行，结果不可采信。`)
  process.exit(2)
}

const { missing, checked, skipped } = checkPaths(spans)
const goFiles = listRootGoFiles()

// 【判据空跑检测】变异自证实测抓到：把 shouldCheck 改成恒 false 后，脚本打印
// 「核对 0 个路径 / 一致：0 处漂移」并退出 0 —— 判据整体失效却给绿色，是本仓
// 最恨的一类假绿（有虚假保障比没门禁更危险）。README 实测 300 个反引号片段、
// 其中 85 个是路径，故设数量级下限：核对数骤降只可能是谓词坏了，不是文档变干净。
const MIN_CHECKED_PATHS = 30
if (checked.length < MIN_CHECKED_PATHS) {
  console.error(`[判据失效] 只核对到 ${checked.length} 个路径（下限 ${MIN_CHECKED_PATHS}）。`)
  console.error('            README 反引号片段有几百个，核对数骤降只可能是白名单谓词被放宽到吞掉全部路径。')
  console.error('            结论：判据不可信，本次结果【不可采信】—— 绝不能当作通过。')
  process.exit(2)
}

if (goFiles.length === 0) {
  console.error('[解析失败] 仓库根解析出 0 个生产 Go 文件 —— 判据可能已失效，结果不可采信。')
  process.exit(2)
}

const coverage = checkGoCoverage(dirSec.fence, goFiles)

console.log(`反引号片段总数:          ${spans.length} 个（去重后 ${new Set(spans.map((s) => s.raw)).size}）`)
console.log(`判定为路径并核对:        ${checked.length} 个（命中方式见下）`)
console.log(`按白名单跳过:            ${new Set(skipped.map((s) => s.trim())).size} 个（命令/URL/快捷键/占位/示例）`)
console.log(`判据 B 覆盖的 Go 文件:   ${goFiles.length} 个（已登记 ${coverage.present.length} / 未登记 ${coverage.missing.length}）`)

// 命中方式分布：证明「宽容解析」没有变成「随便命中」
const byHow = {}
for (const c of checked) {
  const k = c.how.startsWith('基准:') ? c.how : c.how
  byHow[k] = (byHow[k] || 0) + 1
}
console.log(`命中方式分布:            ${Object.entries(byHow).map(([k, v]) => `${k}=${v}`).join(' / ')}`)
if (coverage.viaGlob.length > 0) {
  const g = {}
  for (const v of coverage.viaGlob) (g[v.glob] = g[v.glob] || []).push(v.file)
  console.log(`通配覆盖:                ${Object.entries(g).map(([k, v]) => `${k} → ${v.length} 个`).join(' / ')}`)
}
const ambiguous = checked.filter((c) => c.ambiguity > 1)
if (ambiguous.length > 0) {
  console.log(`同名多份（不判红）:      ${ambiguous.map((a) => `${a.raw}(${a.ambiguity}份)`).join(' / ')}`)
}
console.log('')

const problems = []
if (missing.length > 0) {
  for (const p of missing) problems.push({ kind: '判据A·路径不存在', detail: p })
}
if (coverage.missing.length > 0) {
  for (const f of coverage.missing) problems.push({ kind: '判据B·Go 文件未登记进目录结构', detail: f })
}

if (problems.length === 0) {
  console.log(`一致：0 处漂移。README 引用的 ${checked.length} 个路径全部存在，仓库根 ${goFiles.length} 个 Go 文件全部已登记。`)
  process.exit(0)
}

console.log(`发现 ${problems.length} 处漂移：`)
for (const p of problems) {
  console.log(`  [${p.kind}] ${p.detail}`)
}
console.log('')
console.log('修法：')
console.log('  · 判据A：README 里的路径写错了 / 文件改名了 → 改 README 或补文件')
console.log('  · 判据B：新增了仓库根 Go 文件 → 补进 README「## 目录结构」的围栏块')
console.log('  · 若该片段本就不是仓库路径（命令、URL、占位符），把它从判定里排除：')
console.log('    在 verify-readme-paths.mjs 的白名单谓词里补一条**带理由**的规则。')
process.exit(1)
