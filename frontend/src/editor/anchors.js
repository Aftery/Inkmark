// 标题锚点 slug 生成（GitHub 风格）：预览区标题 id 与「格式 → 插入 → 目录」
// 共用同一套规则，保证目录链接在预览里可点跳转。
// 关键约束：同一文档内按标题出现顺序计数去重 —— 预览渲染（preview/markdown.js）
// 与目录插入（editor/commands.js）必须按相同顺序调用 slug()，两边的 id 才能对上。

// slugifyHeading：小写 → 去标点（保留 Unicode 字母/数字/空白/连字符，CJK 保留）→ 空白转连字符。
// 空结果兜底为 'section'（纯符号标题仍可跳转）。
export function slugifyHeading(text) {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
  return slug || 'section'
}

// 每份文档渲染/每次插入目录新建一个计数器：
// 首个重复标题用原名，之后的追加 -1 / -2 …（与 GitHub 锚点规则一致）。
export function createSlugCounter() {
  const seen = new Map()
  return {
    slug(text) {
      const base = slugifyHeading(text)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      return n === 0 ? base : `${base}-${n}`
    },
  }
}
