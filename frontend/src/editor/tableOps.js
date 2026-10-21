// tableOps.js — 表格行列增删（纯 model 变换）+ 悬停操作条的 DOM 构建
// ----------------------------------------------------------------------------
// 【为什么单独成文件】tableRender.js 已经承载「解析 / 序列化 / 语法树扫描 /
// StateField / 可编辑单元格 / 键盘导航」，再加行列操作就过 300 有效行的门禁
// 红线（契约 5）。按职责切分后：
//   - tableRender.js：表格**怎么显示、怎么编辑单元格**
//   - tableOps.js   ：表格**结构怎么变**（插/删行列），以及触发它的操作条
// 两者只通过 model（parseTable 的产物）通信，互不 import 内部实现。
//
// 【为什么操作 model 而不是 DOM】列数散布在 header / aligns / delimRaw / 每一行
// 四处，直接改 DOM 再同步时只要有一处列数跟不上，产出的就是**非法 Markdown**：
// GFM 要求分隔行与表头列数一致，不一致时整表退化为普通段落（用户看到表格突然
// 变成一堆竖线）。故在 model 上三处一起改到自洽，再由 serializeTable 统一输出。

import { t } from '../i18n/index.js'

// ---------------- 纯函数：行列增删 ----------------
//
// 这几个函数只改传入的 model（原地），不做 IO、不碰 DOM、不依赖编辑器 ——
// 因此可被 node:test 直接驱动，语义由测试钉死。

/** 对齐枚举 → 分隔行里的写法（与 parseTable 的解析口径互为逆运算） */
function delimToken(align) {
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

/** 分隔行整体重建（列数/对齐变了之后，原来的字符串必然作废） */
function rebuildDelim(model) {
  model.delimRaw = '| ' + model.aligns.map(delimToken).join(' | ') + ' |'
}

/**
 * 在第 idx 列位置插入一列空列（0 ≤ idx ≤ 列数）。
 * 表头、每一行、对齐三处同步插入；分隔行按新对齐重建。
 */
export function insertColumn(model, idx) {
  const at = Math.max(0, Math.min(idx, model.header.length))
  for (const cells of [model.header, ...model.rows]) cells.splice(at, 0, '')
  model.aligns.splice(at, 0, 'left')
  rebuildDelim(model)
  return model
}

/** 删除第 idx 列；调用方负责保证列数 > 1（最少保留一列）。 */
export function removeColumn(model, idx) {
  const at = Math.max(0, Math.min(idx, model.header.length - 1))
  for (const cells of [model.header, ...model.rows]) cells.splice(at, 1)
  model.aligns.splice(at, 1)
  rebuildDelim(model)
  return model
}

/**
 * 在第 idx 行（表体 0 基）插入一行空行；idx 等于现有行数时追加到末尾。
 * 表头不带行概念 —— 新增行一律进表体。
 */
export function insertRow(model, idx) {
  const at = Math.max(0, Math.min(idx, model.rows.length))
  model.rows.splice(at, 0, Array(model.header.length).fill(''))
  return model
}

/** 删除第 idx 行；调用方负责保证行数 > 1（最少保留一行）。 */
export function removeRow(model, idx) {
  const at = Math.max(0, Math.min(idx, model.rows.length - 1))
  model.rows.splice(at, 1)
  return model
}

/**
 * 把第 from 列移动到第 to 列（拖拽排序列的落点）。
 *
 * 【为什么是「移动」不是「交换」】拖拽的直觉是插入：把 a 拖到 c 右侧，
 * 结果应是 b c a（a 插到目标位置），而不是 a 与 c 互换。交换会让「拖一下
 * 顺序全乱」，是这个交互最容易踩的语义坑。
 *
 * to 的下标语义：**目标位置**（移动后该列的最终下标）。内部先把元素抽出
 * 再插入，故 to > from 时不需要手动 -1（抽出后目标位自然前移一位）。
 */
export function moveColumn(model, from, to) {
  const n = model.header.length
  const a = Math.max(0, Math.min(from, n - 1))
  const b = Math.max(0, Math.min(to, n - 1))
  if (a === b) return model
  const moveIn = (arr) => {
    const [v] = arr.splice(a, 1)
    arr.splice(b, 0, v)
  }
  for (const cells of [model.header, ...model.rows]) moveIn(cells)
  moveIn(model.aligns)
  rebuildDelim(model)
  return model
}

/** 把第 from 行移动到第 to 行（表体 0 基；表头不参与，列序不受影响）。 */
export function moveRow(model, from, to) {
  const n = model.rows.length
  const a = Math.max(0, Math.min(from, n - 1))
  const b = Math.max(0, Math.min(to, n - 1))
  if (a === b) return model
  const [v] = model.rows.splice(a, 1)
  model.rows.splice(b, 0, v)
  return model
}

// ---------------- 对齐 ----------------

/** 对齐枚举的循环顺序：左 → 中 → 右 → 左（按钮单击一轮换一遍） */
export const ALIGN_CYCLE = ['left', 'center', 'right']

/** 下一个对齐档（未知值一律回到 left，避免历史脏数据让按钮卡死） */
export function nextAlign(align) {
  const i = ALIGN_CYCLE.indexOf(align)
  return ALIGN_CYCLE[(i + 1) % ALIGN_CYCLE.length]
}

/**
 * 设置第 idx 列的对齐，并重建分隔行。
 *
 * 【为什么改完必须重建 delimRaw】GFM 的对齐信息**只存在于分隔行**（`:---:`），
 * 只改内存里的 aligns 而不改分隔行，写回文档后对齐会立刻丢失 —— 用户看到的
 * 是「点了按钮，表头变了一下，一切回去又没了」。
 */
export function setColumnAlign(model, idx, align) {
  const n = model.header.length
  const at = Math.max(0, Math.min(idx, n - 1))
  model.aligns[at] = ALIGN_CYCLE.includes(align) ? align : 'left'
  rebuildDelim(model)
  return model
}

// ---------------- 操作条 DOM ----------------

/** 对齐按钮的三种形态（图标用字符而非 SVG：与既有 +/- 按钮同一套视觉策略） */
const ALIGN_BUTTONS = [
  { align: 'left', glyph: '\u2261', labelKey: 'table.alignLeft' },
  { align: 'center', glyph: '\u2261', labelKey: 'table.alignCenter' },
  { align: 'right', glyph: '\u2261', labelKey: 'table.alignRight' },
]

/** 操作条上的一组按钮：action 名 → [显示字符, i18n key, 是否破坏性] */
const ACTIONS = [
  { action: 'add-row', glyph: '+', labelKey: 'table.addRow' },
  { action: 'del-row', glyph: '\u2212', labelKey: 'table.deleteRow' },
  { action: 'add-col', glyph: '+', labelKey: 'table.addColumn' },
  { action: 'del-col', glyph: '\u2212', labelKey: 'table.deleteColumn' },
]

/**
 * 构建悬停操作条，并把它接到 onAction 回调上。
 *
 * 【为什么用 mousedown + preventDefault 而不是 click】单元格是
 * contenteditable：click 之前的 mousedown 会把焦点从单元格移走，触发
 * focusout → 同步 → 重渲染，按钮可能已经在 DOM 上被换掉，click 就丢了。
 * 在 mousedown 里阻止默认行为 = 焦点不动、widget 不重建，动作必然命中。
 *
 * @param {(action: string) => void} onAction 收到 add-row / del-row / add-col / del-col
 * @param {AbortSignal} signal 随 widget 销毁一起解绑，无需手工 removeEventListener
 * @returns {HTMLElement}
 */
export function createActionBar(onAction, signal) {
  const bar = document.createElement('div')
  bar.className = 'cm-md-table-bar'
  bar.setAttribute('role', 'toolbar')
  // 用户可见文案（屏幕阅读器会读），必须走 i18n
  bar.setAttribute('aria-label', t('table.actions'))

  // 对齐段：三档按钮，当前列的对齐档由调用方经 setAlignIndicator 高亮
  ALIGN_BUTTONS.forEach(({ align, glyph, labelKey }) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-md-table-btn cm-md-align-btn'
    btn.dataset.align = align
    btn.textContent = glyph
    btn.title = t(labelKey)
    btn.setAttribute('aria-label', t(labelKey))
    // 三个按钮用同一个 glyph 时视觉不可分辨 —— 由 CSS 按 data-align 换字重/对齐
    bar.appendChild(btn)
  })

  const sep0 = document.createElement('span')
  sep0.className = 'cm-md-table-sep'
  sep0.setAttribute('aria-hidden', 'true')
  bar.appendChild(sep0)

  ACTIONS.forEach(({ action, glyph, labelKey }, i) => {
    // 行操作与列操作之间插一条分隔线（纯装饰，对读屏隐藏）
    if (i === 2) {
      const sep = document.createElement('span')
      sep.className = 'cm-md-table-sep'
      sep.setAttribute('aria-hidden', 'true')
      bar.appendChild(sep)
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-md-table-btn'
    btn.dataset.action = action
    btn.textContent = glyph
    btn.title = t(labelKey)
    btn.setAttribute('aria-label', t(labelKey))
    bar.appendChild(btn)
  })

  bar.addEventListener(
    'mousedown',
    (e) => {
      const btn = e.target.closest?.('.cm-md-table-btn')
      if (!btn) return
      e.preventDefault() // 保住单元格焦点（见上）
      e.stopPropagation() // 别让编辑器把这次按下当成点击文档
      if (btn.dataset.align) onAction(`align:${btn.dataset.align}`)
      else onAction(btn.dataset.action)
    },
    { signal },
  )

  return bar
}

/**
 * 刷新对齐按钮的高亮：当前列的 align（left/center/right）落在哪个档，
 * 哪个按钮就带 aria-pressed。视觉由 CSS 的 [aria-pressed='true'] 接管。
 */
export function setAlignIndicator(bar, align) {
  if (!bar) return
  for (const btn of bar.querySelectorAll('.cm-md-align-btn')) {
    const on = btn.dataset.align === align
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}
