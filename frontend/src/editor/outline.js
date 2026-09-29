// 大纲数据源：从 CodeMirror 文档纯文本提取标题行。
// 与 App.vue 的 collectEditorAnchors 用同一套围栏状态机（``` / ~~~ 开关），
// 围栏代码块内的 # 不算标题。只做文本扫描、不做任何 DOM 度量（不调 coordsAtPos），
// 因此编辑器处于 display:none（预览态）时同样可用。
// 返回 [{ level, text, pos, line }]：pos 为行首文档偏移（跳转用），line 为 1 起行号。
export function extractOutline(doc) {
  const items = []
  let inCode = false
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const trimmed = line.text.trim()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) inCode = !inCode
    if (inCode) continue
    const m = /^(#{1,6})\s+(.*)$/.exec(line.text)
    if (m) {
      items.push({
        level: m[1].length,
        text: m[2].replace(/\s+/g, ' ').trim(),
        pos: line.from,
        line: i,
      })
    }
  }
  return items
}
