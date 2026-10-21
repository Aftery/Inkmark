// smartPunct.js — 智能标点：中文全角修正 + 直角引号（纯函数，零 DOM 依赖）
// ----------------------------------------------------------------------------
// 【为什么单独成文件并且是纯函数】标点替换是「每个按键都跑一遍」的热路径，
// 一旦它依赖编辑器实例就只能靠真机目视；本仓对「只在真机才能验」的逻辑一贯
// 要求下沉（同 tableHint.js / anchors.js 的做法）。这里的输入是
// （光标前字符, 被键入字符, 开关），输出是「该替换成什么」，可被 node:test 直接驱动。
//
// 【为什么不复用输入法】中文输入法在「中文标点」模式下**本来就会**输出全角标点，
// 所以本功能不是替代输入法，而是兜住两类真实场景：
//   ① 用户输入法处于「英文标点」模式（程序员常见），写中文时敲出半角逗号；
//   ② 用户从别处粘贴 / 用英文键盘写中文段落，事后希望统一。
// 因此默认**关闭**（见 prefs.js 的 smartPunct 默认值），由用户在设置里显式开启。
//
// 【绝不碰的范围（硬规则）】
//   - 代码：围栏代码块 / 行内代码内一律不替换（调用方用 isCodeContext 拦）；
//   - ASCII 语境：前一个字符不是 CJK 时不替换 —— 否则英文写作里的 "Hello, world"
//     会被改成全角逗号，这是不可接受的误伤；
//   - 链接/图片 URL：由调用方按语法树跳过（URL 内替换会直接改变跳转目标）。

/** CJK 判定：汉字 / 假名 / 韩文 / 全角标点 / 中文引号 —— 用于「当前处于中文语境」 */
const CJK_RE = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF\u2018\u2019\u201C\u201D]/

/** 半角标点 → 全角（中文语境下的「修正」表） */
const FULLWIDTH = {
  ',': '\uFF0C', // ，
  '.': '\u3002', // 。
  '?': '\uFF1F', // ？
  '!': '\uFF01', // ！
  ':': '\uFF1A', // ：
  ';': '\uFF1B', // ；
  '(': '\uFF08', // （
  ')': '\uFF09', // ）
}

/**
 * 该字符在中文语境下是否有全角对应物。
 * 注意 `"` 不在此表里 —— 引号走 quoteFor() 的成对逻辑（需要知道前后文）。
 */
export function fullwidthOf(ch) {
  return FULLWIDTH[ch] || null
}

/** 光标前一个字符（doc 为纯字符串；pos 为插入点） */
function charBefore(text, pos) {
  if (pos <= 0) return ''
  return text.slice(pos - 1, pos)
}

/** 光标后一个字符（越过既有闭合符时要用） */
export function charAfter(text, pos) {
  return text.slice(pos, pos + 1)
}

/**
 * 中文语境判定：插入点前一个非空白字符是 CJK。
 *
 * 【为什么允许跨空白】中文段落里 `你好 ，` 这种「空格 + 标点」的写法很常见，
 * 只看紧邻一个字符会漏判；跳过连续空白后再判定，误伤面仍然只有「紧邻 ASCII
 * 单词的空格」，而那种情形下前一个非空白字符是 ASCII 字母，判定为英文，安全。
 */
export function isCjkContext(text, pos) {
  let i = pos - 1
  while (i >= 0 && /\s/.test(text[i])) i--
  if (i < 0) return false
  return CJK_RE.test(text[i])
}

/**
 * 智能标点的核心判定。
 *
 * @param {string} text 整篇文档（或至少包含光标前后各一字符的片段）
 * @param {number} pos 插入点（将被键入字符插入的位置）
 * @param {string} ch 被键入的字符（单个字符）
 * @returns {{ch: string, mode: 'fullwidth'|'quote'}|null} 替换结果；null 表示不干预
 *
 * 只处理「单字符键入」，多字符插入（粘贴 / 快照恢复 / 组合提交后的整段）一律
 * 交给调用方放过 —— 批量替换属于「格式化文档」而不是「智能标点」。
 */
export function smartPunctFor(text, pos, ch, style = 'curly') {
  if (typeof ch !== 'string' || ch.length !== 1) return null

  // 引号：直角引号「」与弯引号“”都按「前文是否有未闭合的开引号」决定开/闭
  const q = quoteFor(text, pos, ch, style)
  if (q) return { ch: q, mode: 'quote' }

  const full = FULLWIDTH[ch]
  if (!full) return null
  if (!isCjkContext(text, pos)) return null
  return { ch: full, mode: 'fullwidth' }
}

/**
 * 引号风格（smartPunct 的取值）：
 *   'off'   —— 完全不碰引号（半角直引号保持半角）
 *   'curly' —— 弯引号 “” / ‘’（中文排版的通行选择）
 *   'corner'—— 直角引号 「」 / 『』（港台与日本更常用，也是用户明确点名的一种）
 */
export const QUOTE_STYLES = ['off', 'curly', 'corner']

/** 每种风格下「开 / 闭 / 允许的既有形态」三件套 */
const QUOTE_KINDS = {
  double: {
    curly: ['\u201C', '\u201D', ['\u201C', '\u201D']],
    corner: ['\u300C', '\u300D', ['\u300C', '\u300D']],
  },
  single: {
    curly: ['\u2018', '\u2019', ['\u2018', '\u2019']],
    corner: ['\u300E', '\u300F', ['\u300E', '\u300F']],
  },
}

/**
 * 引号成对判定：把键入的 `"` / `'` 变成「开」或「闭」引号。
 *
 * 【为什么不用简单的「交替」】交替（奇数次=开、偶数次=闭）在「删掉一半引号」
 * 之后会整体反相，是引号转换最经典的 bug。这里改用**就近配平**：
 * 从插入点向前找同一行的未闭合开引号，找到就闭合、找不到就开启。
 * 只扫当前行是刻意的 —— 跨行配平会让「上一段落的引号」吃掉本段的开引号。
 *
 * @param {string} text
 * @param {number} pos
 * @param {string} ch 只对 `"` 与 `'` 生效（含输入法已输出的弯引号）
 * @param {'off'|'curly'|'corner'} [style] 引号风格，默认 curly
 * @returns {string|null} 替换后的字符
 */
export function quoteFor(text, pos, ch, style = 'curly') {
  if (style === 'off') return null
  const which =
    ch === '"' || ch === '\u201C' || ch === '\u201D' || ch === '\u300C' || ch === '\u300D'
      ? 'double'
      : ch === "'" || ch === '\u2018' || ch === '\u2019' || ch === '\u300E' || ch === '\u300F'
        ? 'single'
        : null
  if (!which) return null
  const [openCh, closeCh, existing] = QUOTE_KINDS[which][style === 'corner' ? 'corner' : 'curly']
  // pair[2] 是半角形态（用户可能已手打半角引号，配平时要一起数）
  const kind = { open: openCh, close: closeCh, pair: [...existing, which === 'single' ? "'" : '"'] }
  // 英文语境不动引号：`It's` 里的撇号被改成弯引号是灾难（而且闭合方向也错）
  if (!isCjkContext(text, pos)) return null

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const before = text.slice(lineStart, pos)
  let opens = 0
  let closes = 0
  for (const c of before) {
    if (c === kind.pair[0]) opens++
    else if (c === kind.pair[1]) closes++
    else if (c === kind.pair[2]) {
      // 半角引号：按「剩下的是开还是闭」计，交给配平结果决定方向
      if (opens > closes) closes++
      else opens++
    }
  }
  return opens > closes ? kind.close : kind.open
}
