// listIndent.js — 列表的 Tab / Shift+Tab 缩进与有序列表自动重编号
// ----------------------------------------------------------------------------
// 【为什么不能直接用 indentWithTab】CM 自带的 indentWithTab 是「代码编辑器语义」：
// 给行加/减缩进单位，仅此而已。落到 Markdown 列表上有两个硬伤：
//   ① 缩进后**序号不更新** —— `1. 2. 3.` 里把第 2 项缩进成子项，剩下的 `3.`
//      渲染出来仍是 3，与屏幕上的「第 2 项」错位（CommonMark 按实际序号渲染）；
//   ② 反缩进只是无脑删空格 —— 删两个空格后可能既没回到父级、也不再是合法子项
//      （4 空格缩进在列表里会撞上「缩进代码块」的边界，这是 CommonMark 的
//      真陷阱，不是审美问题）。
//
// 本模块的做法：
//   - 缩进：统一 +2 空格（2 空格是 Markdown 列表嵌套的通行单位，也是 Typora 默认）；
//   - 反缩进：优先**吸附到父级缩进**（上方最近的更浅列表项），没有父级才减 2。
//     吸附比「删固定宽度」稳：用户手写 3/4 空格缩进时也能一次回到父级；
//   - 重编号：只重排「本次改动波及的组」，且组首行若未被改动则保留其显式起始号
//     （用户写 `3.` 开头的列表不会被动成 `1.`，见 renumberGroup 注释）。
//
// 与既有命令的关系：commands.js 的 toggleOrderedList 把选中行重排成 `1. 2. 3.`
// （从 1 起）—— 本模块沿用同一口径，避免两处编号规则打架。
//
// 纯函数：输入 doc（CM 的 Text）+ 选区 + 方向，输出变更数组，不碰 DOM。
// 单测见 tests/list-indent.test.mjs（真 Text 驱动，不经编辑器）。

/**
 * 列表项解析：缩进 + 标记 + 标记后空白 + 可选任务框。
 * 有序标记允许 `.` 与 `)` 两种分隔符（CommonMark 都合法，改写时按原样保留）。
 */
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/

/** 解析单行列表项；非列表项返回 null */
export function parseListItem(text) {
  const m = LIST_ITEM_RE.exec(text)
  if (!m) return null
  const marker = m[2]
  const ordered = /^\d/.test(marker)
  return {
    indent: m[1].length,
    marker,
    ordered,
    num: ordered ? Number.parseInt(marker, 10) : null,
    delim: ordered ? marker.slice(-1) : '',
    // 任务框是否存在：重写时靠它保住 `[x] `（丢了就是把任务列表降级成普通项）
    task: Boolean(m[4]),
  }
}

/** 用新的缩进/序号重写一行，其余部分（任务框、正文）原样保留 */
function rewrite(text, { indent, num, delim }) {
  const m = LIST_ITEM_RE.exec(text)
  if (!m) return text
  const marker = num == null ? m[2] : `${num}${delim || '.'}`
  const head = m[1].length + m[2].length + m[3].length
  return ' '.repeat(indent) + marker + m[3] + text.slice(head)
}

/**
 * 生成缩进计划。返回 null 表示「本次按键不该由本模块处理」（交回 indentWithTab）。
 *
 * @param {import('@codemirror/state').Text} doc
 * @param {{from:number,to:number}[]} ranges 选区（多光标亦可用）
 * @param {1|-1} dir 1 = 缩进，-1 = 反缩进
 * @returns {Array<{from:number,to:number,insert:string}>|null}
 */
export function listIndentChanges(doc, ranges, dir) {
  /** 行号 → 新文本（只装被改动 / 被重编号的行） */
  const next = new Map()
  const textAt = (n) => next.get(n) ?? doc.line(n).text

  // ---- ① 逐行缩进 / 反缩进 ----
  const touched = new Set()
  let anyListItem = false
  for (const r of ranges) {
    const first = doc.lineAt(r.from).number
    const last = doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) {
      if (touched.has(n)) continue
      const item = parseListItem(textAt(n))
      if (!item) continue
      anyListItem = true
      touched.add(n)
      const indent = dir > 0 ? item.indent + 2 : outdentTarget(doc, n, item.indent, textAt)
      if (indent !== item.indent) next.set(n, rewrite(textAt(n), { ...item, indent }))
    }
  }
  if (!anyListItem) return null // 非列表行：交回 indentWithTab（代码块 / 普通段落）

  // ---- ② 重编号：只处理与改动行同组的连续有序列表 ----
  //
  // 【为什么新旧两个层级都要重排】缩进会把一行从旧组里**摘走**：旧组剩下的
  // 成员若不重排，`1. 2. 3.` 把 2 缩进后会留下 `1. 3.`（渲染出来仍是 1、2，
  // 源码却写着 3 —— 用户按一次 Tab 就觉得文档坏了）。反缩进则相反：被移动的
  // 行**加入**新组，新组也要重排。故两处都收。
  //
  // 旧层级必须用「改动前的文本」求组（那时它还在旧位置），新层级用改动后的。
  const before = new Map()
  for (const n of touched) before.set(n, doc.line(n).text)
  const beforeAt = (n) => before.get(n) ?? doc.line(n).text

  // 每组记录「用哪份文本求出的 + 该组的缩进层级」，重排时才能读到正确的成员行
  const groups = new Map()
  const collect = (textGetter, lineNo, level, source) => {
    const group = findGroup(doc, lineNo, textGetter, level)
    if (!group) return
    const key = `${source}:${group[0]}:${level}`
    if (groups.has(key)) return
    groups.set(key, { group, level, source })
  }
  for (const n of touched) {
    // 旧组：按改动前的缩进层级求（那时它还在旧层）
    const oldLevel = parseListItem(beforeAt(n))?.indent
    if (oldLevel != null) collect(beforeAt, n, oldLevel, 'before')
    // 新组：按改动后的缩进层级求
    collect(textAt, n, undefined, 'after')
  }
  for (const { group, level, source } of groups.values()) {
    // 旧组里已经**离开**该缩进层的行要剔除：它已被移走，不该占据旧组的一个序号
    // （否则 `3. 4.` 把首项缩进后，旧组从被移走那行开始重排，剩下的 4. 会被改回 2.）
    const members =
      source === 'before'
        ? group.filter((i) => {
            const live = next.get(i) ?? doc.line(i).text
            return parseListItem(live)?.indent === level
          })
        : group
    if (!members.length) continue
    renumberGroup(members, source === 'before' ? beforeAt : textAt, next, touched)
  }

  // ---- ③ 只输出真正变化的行 ----
  const changes = []
  for (const [n, text] of next) {
    if (text === doc.line(n).text) continue
    const line = doc.line(n)
    changes.push({ from: line.from, to: line.to, insert: text })
  }
  return changes.sort((a, b) => a.from - b.from)
}

/**
 * 反缩进目标：优先吸附到「上方最近的更浅列表项」的缩进，否则减 2。
 * 例：`  1. a` 在 `- 父项` 下 → 回到父项的 0；没有父项则 2 → 0。
 *
 * 遇到空行即停止上溯：空行是列表边界（CommonMark 的 loose list 之外，
 * 空行之后就是新块），越过它去吸附会把「另一个列表的缩进」当成父级。
 */
function outdentTarget(doc, n, indent, textAt) {
  for (let i = n - 1; i >= 1; i--) {
    const text = textAt(i)
    if (text.trim() === '') break
    const item = parseListItem(text)
    if (item && item.indent < indent) return item.indent
  }
  return Math.max(0, indent - 2)
}

/**
 * 找出第 n 行所在的「同级连续组」：上下邻行里缩进相同、且都是有序列表项的行。
 *
 * 只认同缩进层是有意的：`1. 2.` 与它们下面缩进 2 空格的子列表是**两个**
 * 独立编号序列，把它们并成一组会把子项也重排成父级序号（完全错误的产物）。
 * 中间夹的更深缩进行不打断组，但也不并入组。
 */
function findGroup(doc, n, textAt, indent) {
  const base = parseListItem(textAt(n))
  if (!base || !base.ordered) return null
  // indent 显式传入：求「改动前的旧组」时，组首的缩进必须按**改动前**算，
  // 否则拿改后文本的缩进去比对旧邻居，一个都匹配不上（旧组永远收不到）。
  const level = indent ?? base.indent
  const sameLevel = (i) => {
    const item = parseListItem(textAt(i))
    return Boolean(item) && item.indent === level
  }
  let top = n
  while (top > 1 && sameLevel(top - 1)) top--
  const lines = []
  for (let i = top; i <= doc.lines && sameLevel(i); i++) lines.push(i)
  return lines.length ? lines : null
}

/**
 * 重排一组的序号。
 *
 * 【首项规则】组首行若**不在本次改动集合**里，就保留它原本的显式起始号 ——
 * 用户写 `3.` 开头的列表是有意义的（CommonMark 渲染为 start=3），
 * 不能因为「顺手重编号」把它掰回 1。首行本身被改动（刚缩进/反缩进）时按 1 起：
 * 它已经是一个新组的开头，保留旧号会得到「子列表从 3 开始」的怪产物。
 */
function renumberGroup(group, readText, next, touched) {
  const first = parseListItem(readText(group[0]))
  if (!first || !first.ordered) return
  // 首行被改动（刚缩进/反缩进）→ 它已是新组的开头，从 1 起；
  // 否则保留它原本的显式起始号（用户写 `3.` 开头的列表不应被掰回 1）。
  let seq = touched.has(group[0]) ? 1 : (first.num ?? 1)
  for (const i of group) {
    const item = parseListItem(readText(i))
    if (!item || !item.ordered) continue
    // 缩进用**当前**层级的取值：旧组重排时该行缩进可能已被改动移走，
    // 但被移走的行不会出现在旧组里（findGroup 按旧缩进求组），故取 readText 的即可
    const snapshot = next.get(i) ?? readText(i)
    const live = parseListItem(snapshot) ?? item
    if (live.num !== seq) next.set(i, rewrite(snapshot, { ...live, num: seq }))
    seq++
  }
}
