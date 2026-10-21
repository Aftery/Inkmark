// headingLevel.js — 标题升降级（⌘1~⌘6 定级 + ⌘⇧= / ⌘⇧- 逐级升降）
// ----------------------------------------------------------------------------
// 【为什么单独成文件】commands.js 已到 264 有效行（棘轮阈值 264，只许降不许升），
// 而标题定级/升降是一组自洽的新命令（含"正文"这一档），单独成文件既不顶破
// 行数门禁，也让「级数运算」这段最容易出错的逻辑可被纯函数测试直接驱动。
//
// 【级数模型】0 = 正文（无 #），1~6 = ATX 标题。这条 0 档很重要：
//   - ⌘0 在 Typora 是「正文」，但本仓 ⌘0 已被「重置缩放」占用（既有契约，不改），
//     故正文档落在 ⌘⌥0；
//   - 逐级升降是「相对」语义，需要单调阶梯：正文(0) ←→ h6 ←→ h5 ←→ … ←→ h1。
//     从正文按「升级」得到 h6 而不是 h1 —— 这是「字号变大一级」的直观，
//     连按六次走到 h1，与 Word 的「增大一级」一致。
//
// 【为什么 setHeading 与 shiftHeading 两个函数而不是一个】语义不同：
//   - setHeading(3)：把行变成 h3；已经是 h3 则**还原正文**（toggle，与现有
//     commands.js 的 toggleHeading 同语义，避免同一功能两种手感）；
//   - shiftHeading(+1)：单调升一级（h3 → h2，正文 → h6），到顶/到底另见 clamp。
//
// 纯函数集中在这几个：levelOf / withLevel / nextLevel。

const HEADING_RE = /^(\s*)(#{1,6})(\s+)/

/** 行文本 → 标题级数（0 = 正文） */
export function levelOf(text) {
  const m = HEADING_RE.exec(text)
  return m ? m[2].length : 0
}

/**
 * 把一行改成指定级数。0 = 去掉标题标记（保留缩进与正文）。
 * 保留原缩进：列表里 / 引用里的标题虽然罕见，但抹掉缩进会改变块结构。
 */
export function withLevel(text, level) {
  const indent = (/^\s*/.exec(text) || [''])[0]
  const body = text.slice(indent.length).replace(/^#{1,6}\s+/, '')
  if (level <= 0) return indent + body
  return indent + '#'.repeat(Math.min(6, level)) + ' ' + body
}

/**
 * 单调升降一级。阶梯（字号由小到大）：正文(0) → h6 → h5 → … → h1。
 *
 * @param {number} level 当前级数（0 = 正文）
 * @param {number} dir +1 = 升级（字号变大），-1 = 降级（字号变小）
 *
 * 【为什么不循环】循环会在 h1 再按「升级」时跳到正文 —— 用户按了「变大」
 * 却看见字变小，是这个交互最容易被骂的形态（Typora / Word 都是 clamp）。
 * 【为什么正文升级到 h6 而不是 h1】这是「字号大一级」的直观：连按六次走到 h1，
 * 与 Word 的「增大一级」一致；直接跳 h1 会把「想把一段话提成小节」的情况做错。
 */
export function nextLevel(level, dir) {
  if (dir > 0) return level === 0 ? 6 : Math.max(1, level - 1)
  return level === 0 ? 0 : level === 6 ? 0 : level + 1
}

/**
 * 计算一次升降级需要的行变更。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {number} lineNo 起始行号（1 起）
 * @param {number} lineTo 结束行号（1 起，含）
 * @param {number} dir +1 升级 / -1 降级
 * @returns {Array<{from:number,to:number,insert:string}>}
 *
 * 【整块同级的裁决】选区跨多行时，以**首行级数为基准**统一升降，而不是每行
 * 各自相对升降。理由：混排（h2 与 h3 同时选中）时逐行相对升降会保持两者差距，
 * 用户按三次也拉不齐；统一到同一级才是「把这批行当成一节」的预期。
 * 首行是正文（0）时，其余有标题的行也统一降到正文 —— 语义自洽：选中一块按
 * 「降级」= 把它们都变成正文。
 */
export function headingChanges(doc, lineNo, lineTo, dir) {
  const first = levelOf(doc.line(lineNo).text)
  const target = nextLevel(first, dir)
  const changes = []
  for (let n = lineNo; n <= lineTo; n++) {
    const line = doc.line(n)
    const next = withLevel(line.text, target)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  return changes
}

// ---------------------------------------------------------------------------
// CM 命令：给 useCommands 的命令注册面直接 exec
// ---------------------------------------------------------------------------

/** 选区覆盖的行号闭区间 */
function selectedLineRange(state) {
  return [
    state.doc.lineAt(state.selection.main.from).number,
    state.doc.lineAt(state.selection.main.to).number,
  ]
}

/**
 * 逐级升降（⌘⌥↑ / ⌘⌥↓）：单调升/降一级，两端 clamp（见 nextLevel）。
 * 返回 false 表示文档不需要变化（已在 h1 再升级 / 正文再降级）—— 让调用方
 * 知道「按了但没效果」，而不是假装成功。
 */
export function shiftHeading(dir) {
  return (view) => {
    const [from, to] = selectedLineRange(view.state)
    const changes = headingChanges(view.state.doc, from, to, dir)
    if (!changes.length) return false
    view.dispatch({ changes, userEvent: 'input.format.heading' })
    return true
  }
}

/** 升级（字号变大）：h3 → h2，正文 → h6 */
export const promoteHeading = shiftHeading(1)
/** 降级（字号变小）：h2 → h3，h6 → 正文 */
export const demoteHeading = shiftHeading(-1)

