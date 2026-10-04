/**
 * emoji-pattern.mjs — P0-1 emoji 码点正则的【唯一真源】
 * ============================================================================
 * 依据：专家团 P0 绝对规则「禁止使用 emoji 表情作为功能图标」。
 * 图标必须是统一描边、可矢量缩放、语义明确的 SVG（本项目统一经
 * frontend/src/components/icons/AppIcon.vue 渲染）。
 *
 * ---------------------------------------------------------------------------
 * 【为什么这个文件存在：一次真实的假绿灯事故】
 *
 * 原实现是 scripts/p0-check-emoji.sh 里的单行 `PATTERN='...'`，用 GNU grep 的
 * `-P` + `\x{H}` 码点语法扫描。失效链条（本机可复现，QA 已实测记录）：
 *
 *   1. macOS 自带 grep 是 BSD / toybox（本机 toybox 0.8.13），**不支持 `-P`**，
 *      实测直接报 `grep: invalid option -- P`；
 *   2. 脚本写了 `2>/dev/null` 吞掉 stderr，于是「不支持」这条报错不可见；
 *   3. 又写了 `|| true` 吞掉非零退出码，于是 grep 的失败被当成「无命中」；
 *   4. $HITS 恒为空 → 走「未发现 emoji」分支 → **永远打印「通过」并 exit 0**。
 *
 * 后果：往 frontend/src 注入真实 U+1F600，shell 脚本仍报「✅ 通过」exit 0，
 * 而 node --test 同时报 fail。**AC-07 当时没有任何证据支撑，门禁是装饰品。**
 * POSIX shell + toybox grep 无法可靠做 Unicode 码点扫描，
 * 故把正则与扫描逻辑一并搬到 Node（RegExp 的 u flag 原生支持 \u{H}）。
 *
 * ---------------------------------------------------------------------------
 * 【导出形态：为什么用 RegExp 字面量而不是字符串】
 *
 * frontend/tests/contracts.test.mjs 的 loadEmojiPattern() 支持两种形态：
 *   形态 A：`export const NAME = /.../flags`（RegExp 字面量）
 *   形态 B：`export const NAME = '...'`（字符串，内部再 translatePattern）
 *
 * 本模块【必须】用形态 A。若用形态 B 写 `export const PATTERN = '[\\x{1F300}-...]'`，
 * 文件里的文本是双反斜杠，加载器正则 `([^']+)` 会原样捕获到双反斜杠，
 * 再经 translatePattern 变成 `\\u{1F300}`（两个反斜杠），
 * `new RegExp(..., 'u')` 直接抛 `Range out of order in character class`。
 * （此坑已实测确认，故此处写死形态 A。）
 *
 * ---------------------------------------------------------------------------
 * 【口径不变】
 * 码点区间与原 shell 版【逐字一致】，只是书写形态从 shell 的 `\x{H}` 换成 JS 的
 * `\u{H}`（u flag 下语义等价）。刻意不趁机「修正」或缩减区间——那会让本次改动
 * 同时变成「修 bug」与「改门禁口径」两件事，评审时无法判断命中变化来自哪一项。
 *
 * ---------------------------------------------------------------------------
 * 【双源兼容】
 * scripts/p0-check-emoji.sh 顶部保留一行 `PATTERN='...'` 作为机器可读兼容面：
 * 供 loadEmojiPattern() 回退读取，以及「双源并存则码点区间必须一致」那条交叉校验。
 * **真源在本文件**；改任一处必须同步另一处，否则 contracts.test.mjs 会报红。
 * ============================================================================
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'

/**
 * P0-1 码点正则（形态 A：RegExp 字面量，u flag）。
 * 区间与原 shell 版逐字一致，仅 \x{H} → \u{H}。
 */
export const EMOJI_PATTERN =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u

/** 别名：语义更直白的引用方式（本模块内统一用这个名字） */
export const EMOJI_REGEX = EMOJI_PATTERN

/** 扫描范围：代码文件。含 .go —— 菜单与注释里同样不允许出现 emoji。 */
export const CODE_EXTENSIONS = [
  '.js', '.mjs', '.cjs', '.vue', '.ts', '.jsx', '.tsx', '.html', '.go', '.css',
]

/** 目录名黑名单：依赖与构建产物，扫描无意义且量级大 */
export const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.wails'])

/**
 * 为什么【排除 docs/ 下的 Markdown】：
 * 项目规范 docs/spec/DECISIONS-phaseC-v1.md:67 明确区分「使用」与「引用」——
 * emoji 出现在 UI 代码里承担功能图标职责是「使用」= 违规；而在文档中作为
 * 「违规证据」被列举或论证（如 ADR-001 §14 列出待替换的图标、规范引用需求示例）
 * 是「引用」= 豁免且必须保留，判定标准是「删掉它证据是否失效」。
 * 故 docs/ 下的 Markdown 不纳入扫描；任何【代码文件】都不豁免。
 */
export const DOCS_DIR = 'docs'

/**
 * 递归收集待扫描的代码文件。
 * @param {string} root 扫描根目录
 * @param {{ excludeMarkdown?: boolean }} [opts] excludeMarkdown 默认 true
 * @returns {string[]} 文件路径列表
 */
export function listCodeFiles(root, opts = {}) {
  const { excludeMarkdown = true } = opts
  const out = []

  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 不可读目录（权限 / 竞态删除）跳过，不让扫描整体崩掉
    }
    for (const e of entries) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue
        // docs/ 整目录豁免（见 DOCS_DIR 注释）；.md 在下面按文件后缀再兜一层
        if (excludeMarkdown && e.name === DOCS_DIR) continue
        walk(full)
      } else if (e.isFile()) {
        if (excludeMarkdown && e.name.endsWith('.md')) continue
        if (CODE_EXTENSIONS.some((ext) => e.name.endsWith(ext))) out.push(full)
      }
    }
  }

  walk(root)
  return out
}

/**
 * 扫描一批文件，返回 emoji 命中。
 * 逐行扫描以给出准确行号（门禁报红时要能直接定位）。
 * @param {string[]} files
 * @returns {{file: string, line: number, codepoint: string, text: string}[]}
 */
export function scanFiles(files) {
  const hits = []
  for (const file of files) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // 每行新建一个带 g 的正则：复用带 g 的同一实例会残留 lastIndex 导致漏报
      for (const m of lines[i].matchAll(new RegExp(EMOJI_PATTERN.source, 'gu'))) {
        hits.push({
          file,
          line: i + 1,
          codepoint: 'U+' + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
          text: m[0],
        })
      }
    }
  }
  return hits
}

/** 目标路径是否存在（CLI 用） */
export function pathExists(p) {
  try {
    return statSync(p).isDirectory() || statSync(p).isFile()
  } catch {
    return false
  }
}
