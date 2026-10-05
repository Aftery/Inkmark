/**
 * line-metric.mjs — 行数门禁的口径定义（唯一真源）
 * ============================================================================
 * 【口径变更登记 · 2026-10-05】
 *   旧口径：总行数（含注释与空行）—— 注释被计入债务。
 *     后果：棘轮奖励「删注释」而不是「去耦合」，逼人改阈值，与棘轮本意相反。
 *   新口径：有效代码行 = 剥注释（js-scan.stripComments）+ 去空行。
 *     字符串 / 模板字面量内容保留（它们是内容，不是注释）。
 *   总行数不删除，降级为 advisory（非阻断）继续在测试报告里可见，
 *    防止「注释搬家」之类改动把真实体量藏起来。
 *
 * 为什么复用 lexer.stripComments：注释剥离必须对字符串 / 模板 / 正则里的
 * `//` `/*` 免疫，否则 `const url = 'https://x'` 之后的代码会被整段吞掉。
 * 那套扫描骨架已在 TDZ 守卫里验证过，不重复实现第二份。
 */
import { stripComments } from './lexer.mjs'

/** 总行数（wc -l 口径：末尾无换行不计一行）。 */
export function countTotalLines(text) {
  if (text.length === 0) return 0
  const n = text.split('\n').length
  return text.endsWith('\n') ? n - 1 : n
}

/** 有效代码行：剥注释后仍含非空白字符的行数。 */
export function countEffectiveLines(text) {
  const stripped = stripComments(text)
  if (stripped.length === 0) return 0
  let n = 0
  for (const line of stripped.split('\n')) if (line.trim().length > 0) n++
  return n
}

/** 口径登记：门禁用它自证「口径是被显式决定的」，而非悄悄放水。 */
export const LINE_METRIC = {
  name: 'effective-code-lines',
  changedAt: '2026-10-05',
  from: '总行数（含注释与空行）',
  to: '有效代码行（剥注释 + 去空行）',
  reason:
    '注释被计入债务会奖励删注释、逼人改阈值，与棘轮本意相反。' +
    '改为只对有效代码行拦阻；总行数保留在 advisory 继续报，避免真实体量被藏起来。',
}
