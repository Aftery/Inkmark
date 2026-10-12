/**
 * useTableHint — 「表格没渲染」的常驻提示（模块级单例）
 * ---------------------------------------------------------------------------
 * 【它解决的静默失败】用户写了 `| a | b |` / `| c | d |` 却看不到表格 ——
 * 因为 GFM 要求中间有分隔行 `| --- |`。解析器把整块当普通段落，**不报错**、
 * **测试全绿**，只有用户知道「表格没出来」。这类问题必须主动提示。
 *
 * 【为什么用状态栏而不是 toast / 编辑器内联】
 *   - 编辑器内联（Decoration）不行：wysiwyg.js 的架构约束**禁用 block 装饰**
 *     （CM6 会抛 RangeError），插不进一条独立提示行；
 *   - toast 不行：3200ms 自动消失，而这是个「用户没察觉」的问题 ——
 *     上一轮就是「没渲染 + 完全静默」，用户反复重试才来问。提示必须**常驻**，
 *     直到用户把表格改对为止。状态栏常驻可见，且已有一行放行/列/字数。
 *
 * 【为什么是模块级单例】useEditorSession（写入方）与 StatusBar（读取方）
 * 分属不同装配位置，但本项目**禁止在 App.vue 加行**（≤150 行硬上限），
 * 不能通过 props 串起来。故采用与 usePlatform 同构的「模块级 ref +
 * 消费方自行 import」模式（有先例：TitleBar 直接 import isDarwin）。
 *
 * 【零文档篡改】本模块只读语法树、只写自己的 ref，永不 dispatch。
 */

import { ref } from 'vue'
import { detectSuspectTable } from '../editor/tableHint.js'

/**
 * 当前提示：null 表示无问题；
 * 否则 { line, lines } —— line 为第一处疑似块的行号（1-based），供状态栏定位。
 */
export const tableHint = ref(null)

/**
 * 在编辑器状态变化时检查一遍并更新提示。
 *
 * @param {import('@codemirror/state').EditorState} state 编辑器当前状态
 * @returns {{ line: number, lines: number } | null} 本次检测结果（供调用方调试）
 */
export function checkTableHint(state) {
  const found = detectSuspectTable(state)
  // 逐字段比较后再赋值：每次输入都写 ref 会让状态栏无谓重渲染
  const cur = tableHint.value
  if (found === null && cur === null) return null
  if (
    found && cur &&
    found.line === cur.line && found.lines === cur.lines
  ) return found
  tableHint.value = found
  return found
}

/** 清空提示（切换文档 / 销毁编辑器时调用，防止上一份文档的提示残留） */
export function clearTableHint() {
  tableHint.value = null
}