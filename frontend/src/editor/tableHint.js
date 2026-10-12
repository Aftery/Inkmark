/**
 * tableHint.js — 「看起来像表格但没被解析」的检测（纯逻辑，无副作用）
 * ---------------------------------------------------------------------------
 * 【为什么需要它】GFM 表格要求分隔行（`| --- |`）严格合法。若用户写
 * `| a | b |` 后直接换行接 `| c | d |`（没有分隔行），或分隔行里有非法字符
 * （如 `|-ds-|`），解析器会**把它们当普通段落 Paragraph**，不报错、不渲染 ——
 * 管道符裸露。这是纯静默失败（构建绿、测试绿、运行时无异常），用户只能靠猜。
 *
 * 【为什么放在这里而不是 wysiwyg.js】wysiwyg.js 的架构约束明令**禁用 block 装饰**
 * （CM6 会抛 RangeError），无法在正文里插提示条；且它只负责渲染装饰，
 * 不该承担「诊断」职责。本模块是独立纯函数，供状态栏消费。
 *
 * 【核心判定：必须用 GFM 解析器】编辑器的 markdown() 传的是
 * `base: markdownLanguage`（GFM 扩展），而**默认** `markdown()` 是 commonmark ——
 * 后者没有表格语法，会把合法表格也判成 Paragraph。本模块接收 EditorState，
 * 直接读它的语法树（与编辑器同一解析器），**不自建解析器**，杜绝口径分裂。
 */

// 一个行是否「像表格行」：trim 后以竖线开头，且至少有两个竖线（表头/数据行）。
// 注：分隔行 `| --- | --- |` 也满足此条件（它也应被视作表格的一部分）。
function isPipeRow(text) {
  const t = text.trim()
  return t.startsWith('|') && (t.match(/\|/g) || []).length >= 2
}

/**
 * 检测文档中是否存在「看起来像表格、但实际不是合法 GFM 表格」的段落。
 *
 * 判据（在语法树上做，而不是正则扫全文）：
 *   - 遍历**顶层 Paragraph 节点**（真实合法表格会被解析成 Table 节点，
 *     根本不会走到这里 —— 这正是我们要抓的那一类）；
 *   - 该段落跨 ≥2 行，且**连续 ≥2 行**都是 pipeRow → 强烈暗示用户在写表格；
 *   - 返回**第一处**命中的行号（1-based）与该段落的行数，供提示定位。
 *
 * 【为什么要求连续 ≥2 行】孤立一行 `| a | b |` 也可能是合法的管道文本/代码，
 * 不该误报。连续两行才是表格意图的可靠信号。
 *
 * @param {import('@codemirror/state').EditorState} state 编辑器状态
 * @returns {{ line: number, lines: number } | null} 命中则返回第一处行号与该块行数；否则 null
 */
export function detectSuspectTable(state) {
  const tree = state && state.tree ? state.tree : null
  if (!tree) return null

  const doc = state.doc
  let hit = null

  // 只看顶层节点（parent 为 Document）——列表/引用内部的管道文本不算
  tree.iterate({
    enter: (node) => {
      if (hit) return // 已命中，后续不再找（取第一处）
      const name = node.name
      // 顶层 Paragraph：真实表格是 Table 节点，不会是 Paragraph
      if (name !== 'Paragraph') return
      // 顶层性：SyntaxNodeRef 没有直接的 parent 引用，用 nodeStart 判断父名。
      // 简化：只处理 parent 为 Document 的段落。tree.iterate 的 enter 回调
      // 拿到的是 ref，其 .node.parent 才是父节点。
      const n = node.node
      if (!n || !n.parent || n.parent.name !== 'Document') return

      // 收集该段落覆盖的行文本
      const fromLine = doc.lineAt(n.from).number
      const toLine = doc.lineAt(Math.max(n.from, n.to - 1)).number
      // 【这条分支是性能短路，不是正确性保证】删掉它，判定结果不变 ——
      // 单行段落即使进了下面的循环，maxRun 也只有 1，照样不命中。
      // 保留的理由：单行段落占文档绝大多数，跳过它们能省掉绝大多数的
      // 逐行取文本调用（每次编辑都要重扫）。
      // （变异自证实测：删掉本分支，测试仍全绿 —— 故这里如实写成性能说明，
      //  不谎称它在保证正确性。）
      if (toLine - fromLine + 1 < 2) return // 单行段落直接跳过（见上方「性能短路」说明）

      // 找连续 pipeRow 的最大长度 ≥2
      let run = 0
      let maxRun = 0
      for (let ln = fromLine; ln <= toLine; ln++) {
        const line = doc.line(ln)
        if (isPipeRow(line.text)) {
          run += 1
          if (run > maxRun) maxRun = run
        } else {
          run = 0
        }
      }
      if (maxRun >= 2) {
        hit = { line: fromLine, lines: toLine - fromLine + 1 }
      }
    },
  })

  return hit
}

export const __test__ = { isPipeRow }