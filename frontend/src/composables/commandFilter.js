// commandFilter.js — 命令面板的过滤纯逻辑（唯一真源，可被 node 直接测）
// ----------------------------------------------------------------------------
// 【为什么单独成文件，而不是写在 CommandPalette.vue 里】
// 本仓的铁律是「判据要能跑」。SFC 里的 <script setup> 无法被 node 直接 import
// （需要 @vue/compiler-sfc + 运行时），过滤逻辑一旦写进组件，就只能靠真机点按验证
// ——而那正是「能跑≠能被测」。把过滤抽成无副作用的纯函数后，
// tests/command-palette.test.mjs 可以直接断言它的行为契约。
//
// 【搜什么】三项联合：
//   ① 命令 id（如 file.saveAs）—— 英文输入习惯 / 记忆 id 的用户
//   ② 已翻译的显示名（中文用户直接打「保存」）
//   ③ 键位串（打 ⌘S 或 S 都能命中）—— 这是「知道键但记不住菜单在哪」的捷径
// 空查询返回全部（面板一打开就应该是「能看见有什么」，不是空白列表）。
//
// 【为什么是「分词 AND」而不是简单子串】
// 输入「保存 pdf」应当命中「导出 PDF」这类跨词命中的项：真实使用中用户
// 常常记得两个碎片词，却记不住它们是否连续。故按空白切词，每词都必须在
// 某一字段里出现（AND 语义）。单字中文输入也能命中（子串匹配天然支持）。

/**
 * 一条命令的「可搜索文本」集合（小写化）。导出以便测试直接断言字段口径。
 * @param {{id:string, label:string, accel?:string|null}} item
 * @returns {string[]}
 */
export function searchableFields(item) {
  const out = [String(item.id || ''), String(item.label || '')]
  if (item.accel) out.push(String(item.accel))
  return out.map((s) => s.toLowerCase())
}

/**
 * 过滤命令列表。
 *
 * @param {string} query 用户输入（原样，内部自己 trim / 小写 / 切词）
 * @param {Array<{id:string,label:string,accel?:string|null}>} commands 候选（已带翻译后的 label）
 * @returns {Array} 命中的命令，保持入参顺序（顺序由调用方按 group 决定，这里不重排）
 */
export function filterCommands(query, commands) {
  const list = Array.isArray(commands) ? commands : []
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return list.slice()
  // 按空白切词（含全角空格：中文输入法下常见 U+3000）
  const terms = q.split(/[\s\u3000]+/).filter(Boolean)
  if (terms.length === 0) return list.slice()
  return list.filter((item) => {
    const fields = searchableFields(item)
    return terms.every((term) => fields.some((f) => f.includes(term)))
  })
}

/**
 * 把命中结果按「选中下标」夹回合法范围。
 *
 * 【为什么需要它】过滤是在用户每次按键后重算的：原来是第 5 项被选中，
 * 打完一个字只剩 2 项，若不夹取，Enter 会落到 undefined 上（表现为
 * 「按了回车什么都没发生」——本仓最恨的静默失败）。命中为空时统一回 0。
 *
 * @param {number} index 当前选中下标
 * @param {number} length 过滤后长度
 * @returns {number} 合法下标（length 为 0 时返回 0）
 */
export function clampIndex(index, length) {
  if (!Number.isFinite(length) || length <= 0) return 0
  const i = Number.isFinite(index) ? Math.trunc(index) : 0
  if (i < 0) return 0
  if (i >= length) return length - 1
  return i
}

/**
 * 方向键移动后的下一个下标（循环）。
 * @param {number} index 当前下标
 * @param {number} delta +1 / -1（也可传更大步长）
 * @param {number} length 列表长度
 * @returns {number} 新下标；长度为 0 时返回 0
 */
export function moveIndex(index, delta, length) {
  if (!Number.isFinite(length) || length <= 0) return 0
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0
  const base = clampIndex(index, length)
  return ((base + step) % length + length) % length
}
