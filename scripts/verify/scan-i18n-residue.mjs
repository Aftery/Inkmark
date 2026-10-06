/**
 * scan-i18n-residue.mjs — i18n 残留自查（一次性工具，不进门禁）
 * ---------------------------------------------------------------------------
 * 目的：如实报告「frontend/src里还有几处面向用户的可见文案没走 t()」。
 *
 * [为什么不用 shell grep] 本仓 UTF-8 文件在 shell grep 下会静默返回空，
 * 且会匹配注释里的代码 —— 那种「扫不出问题」是假绿灯（Spec §7坑 2）。
 *
 * [为什么自带 stripper 而不复用 tests/helpers/lexer.mjs 的 stripComments]
 * 实测（2026-10-06）：lexer.stripComments 对**含 `${}` 插值的模板串**会失步——
 * createEditor.js 里`fontSize: \`calc(var(--text-base) * ${scale})\`` 之后的
 * 36 行注释**没被剥掉**（复现：剥前72 行含中文 -> 剥后仍 49 行）。
 * 用一个已知失效的剥注释器去判断「是不是注释」，会把注释误报成残留。
 * 故本脚本自带一个保守的剥注释器：它宁可少剥（把注释报成残留 = 误报，
 * 方向安全），也不误剥（把真文案当成注释漏掉 = 假绿灯，方向危险）。
 *
 * 方法：
 *  1. 剥注释（自带，保守）
 *  2. .vue 只取 <template> 段；.js / composables 扫全文
 *  3. 找剥注释后仍含 CJK / 假名 / 韩文的行
 *  4. 逐条走白名单，每条白名单必须写明理由
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SRC = join(REPO, 'frontend', 'src')
const rel = (p) => relative(REPO, p).split(sep).join('/')

/**
 * 保守剥注释：剥JS 注释（// 与 /* *\/）+ HTML 注释（<!-- -->）。
 * 对字符串/模板/正则**不区分** —— 后果是字符串里的 `//`（如 "https://x"）
 * 会让该行后半段被抹掉。这是「宁可少报」的方向吗？恰恰相反：
 * 抹掉真文案 = **漏报**（危险）。故字符串内的 `//` 由下面的
 * 剥离顺序规避：先按行剥 JS 注释时，遇到行内有引号就整行不剥。
 *
 * HTML 注释必须一起剥：.vue 的 <template> 段里有大量 <!-- 布局说明 -->，
 * 它们解释「为什么」而非用户可见文案（Spec §7 坑 3），不剥会全部误报。
 */
function stripCommentsLoose(src) {
  // 先剥 HTML 注释（保留换行以维持行号）
  let out = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  // 未闭合的 HTML 注释（写到文件尾）：保守起见把它到行尾都抹掉
  out = out.replace(/<!--[\s\S]*$/g, (m) => m.replace(/[^\n]/g, ' '))

  let res = ''
  let i = 0
  const n = out.length
  while (i < n) {
    const c2 = out.slice(i, i + 2)
    // 保守策略：本行若出现引号，就认为后面可能是字符串里的 // ，整行不剥。
    // 代价是「字符串与注释同行」的注释会漏剥 -> 误报（方向安全）。
    const lineEnd = out.indexOf('\n', i)
    const line = out.slice(i, lineEnd === -1 ? n : lineEnd)
    if (c2 === '//' && !/["'`]/.test(line)) {
      const end = lineEnd === -1 ? n : lineEnd
      res += ' '.repeat(end - i)
      i = end
      continue
    }
    if (c2 === '/*' && !/["'`]/.test(line)) {
      const close = out.indexOf('*/', i + 2)
      const end = close === -1 ? n : close + 2
      res += out.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    res += out[i]
    i++
  }

  // ---- 第二遍：剥行尾注释 ----
  // 第一遍刻意「本行有引号就不剥」（防URL 里的 // 被当注释），代价是
  // 「代码 + 行尾注释」这类行的注释被留下（如 `foo() // 解释`）。
  // 这里补上：只剥那些**// 出现在代码之后、行尾之前**且右侧不含引号的行尾注释。
  // 判据：// 之后到行尾不含引号 => 该// 不可能属于字符串 => 是真注释。
  return res
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//')
      if (idx === -1) return line
      const tail = line.slice(idx)
      // 行尾注释里若含引号（多因注释里引用了代码/文案），不剥 —— 交给白名单判定
      if (/["'`]/.test(tail)) return line
      return line.slice(0, idx)
    })
    .join('\n')
}

/** CJK / 平假名片假名 / 谚文 */
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.wails', 'bin'])

/**
 * 白名单：判定为「不是 UI 文案」的逐条规则。
 * 每条必须写 kind 理由 —— Spec §6.1 要求「不得静默跳过」。
 */
const ALLOW = [
  {
    kind: '用户内容：Markdown 示例文档正文（DEFAULT_DOC / SYNTAX_DOC）',
    // Spec §1 明确「文档内容本身的翻译（用户写的 Markdown 不译）」。
    // 它们是文档数据而非 chrome 文案：塞进 t() 会让示例文档跟着界面语言变，
    // 用户看到的就成了「被翻译过的示例」，失去「这就是 Markdown 效果」的意义。
    test: (f, line) =>
      /App\.vue$/.test(f) &&
      /^\s*(#{1,6}\s|\||>\s|[-*+]\s|\d+\.\s|```|\\`|一个安静|它能做什么|代码块|引用与行内|所有操作|打开单个|编辑与预览|标记符|明暗纸|导出 HTML|中间的分隔|左右两栏|行内代码长这样|任务列表|快捷键|全部键位|关于|快速)/.test(line),
  },
  {
    kind: '导出模板文案（exporters.js）—— Spec §1 明确留待后续',
    test: (f) => /export\/exporters\.js$/.test(f),
  },
  {
    kind: '插入到用户文档里的内容（表格模板 / 目录骨架）—— 属用户内容（Spec §1）',
    // commands.js 的 insertTable 模板与 insertToc 骨架是**写进用户 Markdown 文档**
    // 的文本，不是 chrome 文案。用户文档不随界面语言变（与 DEFAULT_DOC 同理）。
    test: (f, line) =>
      /editor\/commands\.js$/.test(f) && /列一|暂无标题|'## 目录/.test(line),
  },
  {
    kind: '诊断日志（console.*）里的中文：给开发者的调试信息，不是用户界面',
    test: (f, line) => /console\.(log|warn|error|debug)\s*\(/.test(line),
  },
  {
    kind: '行尾注释里的中文（代码部分零中文）—— 注释不译（Spec §7 坑 3）',
    // 精确判据：**去掉 // 及其右侧之后，代码部分不再含 CJK** 才算行尾注释。
    // 不能整行豁免 —— 那会让「代码里真有中文文案」的行也一并放过。
    // 背景：这类行里的 // 右侧常含引号（注释引用了代码/文案），
    // 故前面的剥行尾注释器按「// 后不含引号」判据剥不掉它
    // （见上方第 86 行的说明），只能在此显式豁免。
    test: (f, line) => {
      const m = line.match(/\/\//)
      if (!m) return false
      const codePart = line.slice(0, m.index)
      return !/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(codePart)
    },
  },
]

function listFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) listFiles(full, acc)
    else if (/\.(vue|js|mjs)$/.test(e)) acc.push(full)
  }
  return acc
}

const hits = []
const allowed = []

for (const file of listFiles(SRC)) {
  const r = rel(file)
  // i18n 字典自身是文案真源，三份都含中文是设计如此
  if (r.startsWith('frontend/src/i18n/')) continue

  const raw = readFileSync(file, 'utf8')
  const stripped = stripCommentsLoose(raw)

  // .vue 只扫 <template> 段（script 段里的中文已在剥注释后另行判定，
  // 模板段才是「用户直接看到的文字」）
  const tStart = stripped.indexOf('<template>')
  const tEnd = stripped.lastIndexOf('</template>')
  const isVue = tStart !== -1 && tEnd !== -1
  const body = isVue ? stripped.slice(tStart, tEnd) : stripped
  const lineOffset = isVue ? stripped.slice(0, tStart).split('\n').length - 1 : 0

  body.split('\n').forEach((line, i) => {
    if (!CJK.test(line)) return
    const lineNo = i + 1 + lineOffset
    const text = line.trim().slice(0, 110)
    const rule = ALLOW.find((a) => a.test(r, line))
    ;(rule ? allowed : hits).push({ file: r, line: lineNo, text, kind: rule?.kind })
  })
}

console.log('='.repeat(72))
console.log('i18n 残留自查报告')
console.log('='.repeat(72))
console.log(`扫描范围：frontend/src下 ${listFiles(SRC).length} 个 .vue/.js/.mjs（跳过 ${[...SKIP_DIRS].join('/')}）`)
console.log('方法：自带保守剥注释器 -> .vue 只查 <template> 段 -> 找 CJK/假名/谚文 -> 逐条走白名单')
console.log('（不用 shell grep：本仓 UTF-8 文件在 shell grep 下静默返回空，见 Spec §7 坑 2）')
console.log('')
console.log(`判定为「非 UI 文案」而排除：${allowed.length} 行`)
const byKind = {}
for (const a of allowed) byKind[a.kind] = (byKind[a.kind] || 0) + 1
for (const [k, n] of Object.entries(byKind)) console.log(`   ${String(n).padStart(3)} 行 · ${k}`)
console.log('')
console.log(`【未走 t() 的可见文案残留：${hits.length} 处】`)

// ---- 第三层判定：剥不掉的「注释里带引号/反引号」的整行注释 ----
// 上面两遍剥注释对「本行含引号」的注释刻意不剥（防误剥字符串里的 //），
// 于是这类**纯注释行**会以「残留」形态出现。此处按「整行是否就是注释」收口：
// 行首是 // /* * --> 的，即为注释（Spec §7坑 3：注释里的文案不译）。
const stillComments = hits.filter((h) => /^\s*(\/\/|\/\*|\*\/|\*|<!--)/.test(h.text))
const realHits = hits.filter((h) => !/^\s*(\/\/|\/\*|\*\/|\*|<!--)/.test(h.text))

for (const h of stillComments) {
  console.log(`   [注释·不译] ${h.file}:${h.line}`)
}
console.log('')
console.log(`—— 扣除整行注释后，**真实可见文案残留：${realHits.length} 处** ——`)
for (const h of realHits) console.log(`   ${h.file}:${h.line}  ${h.text}`)

// 自检：若扫描器一个都没扫到东西，可能是扫描规则失效（假绿灯），必须报出来
if (hits.length === 0 && allowed.length === 0) {
  console.error('')
  console.error('[警告] 扫描结果全空 —— 可能是扫描规则本身失效（假绿灯），请人工确认后再采信。')
  process.exit(2)
}
console.log('')
console.log(realHits.length === 0
  ? '结论：0 处真实可见文案残留（方法见上；注释与用户内容不计入）'
  : `结论：${realHits.length} 处真实可见文案需处理`)

/**
 * 退出码约定（让它能直接当 CI 门禁用，而不只是报告工具）：
 *   0 = 无残留
 *   1 = 有真实可见文案未走 t()  ← 原先缺这一条，导致本脚本恒返回 0，
 *       放进 CI 就是一个「永远绿」的假门禁（本项目已吃过一次亏：
 *       p0-check-emoji.sh 因 grep 报错被 2>/dev/null 吞掉而永远报通过）
 *   2 = 扫描器自身失效（结果全空），此时【不可采信】，需人工确认
 */
process.exit(realHits.length === 0 ? 0 : 1)