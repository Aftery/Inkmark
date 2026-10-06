// useShortcuts.js — 命令表（键位唯一真源）+ 全局键位分发 + 事件总线
// ----------------------------------------------------------------------------
// 【为什么这个文件存在：原生菜单下线后的真源迁移】
// 2026-10-06 之前，键位的唯一真源是 main.go 的 buildMenu()：菜单项与
// accelerator 写在一起，Wails 负责注册系统快捷键，前端只收事件。
// 原生菜单整体下线后（见 main.go 头注的三条删除理由），那一份真源随之消失，
// 于是本文件成为新的**唯一真源**：
//
//   COMMANDS 表  —— 每条命令的 id / 菜单分组 / 显示名 / 键位 / 说明 key。
//                   菜单（TitleBar.vue）、全局键位、门禁校验三方都读它，
//                   三处不再可能各写一份。
//   matchCommand —— 把 KeyboardEvent 归一成规范键位串并查表。
//   emitCommand  —— 命令总线（菜单点击与快捷键共用同一条路径）。
//
// 【键位书写规范（与旧门禁的 MOD_ORDER 保持一致）】
//   修饰键顺序固定 ⌘ → ⇧ → ⌥ → ⌃，这样同一个组合只有一种写法，
//   文档 / 速查表 / 门禁比对时不会因顺序不同被判成「捏造键位」
//   （旧 parse-main-menu.mjs 的坑 3，同一问题在真源迁移后依然存在）。
//   accel 用 null 表示「无快捷键，只能点菜单」——这类命令必须在 README 里
//   显式标注，否则读者会以为漏了键。
//
// 【正确性由门禁保证，不要手改】
//   node scripts/verify/verify-shortcuts.mjs
// 它比对本表 / README 快捷键节 / 应用内速查表三处，并检查本表内撞键。
// 改键位只改本表，另两处由门禁逼你同步。

import { ref, computed } from 'vue'
import { t } from '../i18n/index.js'

/** 修饰键 → 展示符号（顺序即书写顺序，不可调换） */
const MOD_ORDER = ['⌘', '⇧', '⌥', '⌃']

/** 规范键位串 → 命令 id */
const ACCEL_TO_ID = new Map()
/** 命令 id → 命令定义 */
const ID_TO_COMMAND = new Map()

/**
 * 命令表。字段：
 *   id      唯一标识（emitCommand / 门禁比对都用它）
 *   group   菜单分组：'file' | 'edit' | 'format' | 'view' | 'window' | 'help'
 *   labelKey 菜单显示名的 i18n key
 *   accel   规范键位串，或 null（无快捷键）
 *   descKey 应用内速查表的说明 i18n key；null 表示不进速查表
 */
export const COMMANDS = [
  // ---- 文件 ----
  { id: 'file.new', group: 'file', labelKey: 'titlebar.new', accel: '⌘N', descKey: 'shortcuts.new' },
  { id: 'file.open', group: 'file', labelKey: 'titlebar.open', accel: '⌘O', descKey: 'shortcuts.open' },
  { id: 'file.openFolder', group: 'file', labelKey: 'menu.openFolder', accel: '⌘⇧O', descKey: null },
  { id: 'file.save', group: 'file', labelKey: 'titlebar.save', accel: '⌘S', descKey: 'shortcuts.save' },
  { id: 'file.saveAs', group: 'file', labelKey: 'titlebar.save-as', accel: '⌘⇧S', descKey: null },
  { id: 'file.rename', group: 'file', labelKey: 'menu.rename', accel: null, descKey: null },
  { id: 'file.print', group: 'file', labelKey: 'titlebar.print', accel: '⌘P', descKey: 'shortcuts.print' },
  { id: 'file.exportHtml', group: 'file', labelKey: 'menu.exportHtml', accel: '⌘⇧H', descKey: null },
  { id: 'file.exportPdf', group: 'file', labelKey: 'menu.exportPdf', accel: '⌘⇧P', descKey: 'shortcuts.exportPdf' },

  // ---- 编辑 ----
  { id: 'edit.undo', group: 'edit', labelKey: 'menu.undo', accel: '⌘Z', descKey: null },
  { id: 'edit.redo', group: 'edit', labelKey: 'menu.redo', accel: '⌘⇧Z', descKey: null },
  { id: 'edit.cut', group: 'edit', labelKey: 'menu.cut', accel: '⌘X', descKey: null },
  { id: 'edit.copy', group: 'edit', labelKey: 'menu.copy', accel: '⌘C', descKey: null },
  { id: 'edit.paste', group: 'edit', labelKey: 'menu.paste', accel: '⌘V', descKey: null },
  { id: 'edit.selectAll', group: 'edit', labelKey: 'menu.selectAll', accel: '⌘A', descKey: null },
  { id: 'edit.find', group: 'edit', labelKey: 'menu.find', accel: '⌘F', descKey: 'shortcuts.find' },
  { id: 'edit.findReplace', group: 'edit', labelKey: 'menu.findReplace', accel: '⌘⌥F', descKey: null },
  { id: 'edit.jumpLine', group: 'edit', labelKey: 'menu.jumpLine', accel: '⌘L', descKey: 'shortcuts.jumpLine' },
  { id: 'edit.moveLineUp', group: 'edit', labelKey: 'menu.moveLineUp', accel: '⌥↑', descKey: 'shortcuts.moveLine' },
  { id: 'edit.moveLineDown', group: 'edit', labelKey: 'menu.moveLineDown', accel: '⌥↓', descKey: null },
  { id: 'edit.dupLine', group: 'edit', labelKey: 'menu.dupLine', accel: '⇧⌥↓', descKey: 'shortcuts.dupLine' },
  { id: 'edit.deleteLine', group: 'edit', labelKey: 'menu.deleteLine', accel: '⌘⇧K', descKey: 'shortcuts.deleteLine' },
  { id: 'edit.copyAsHtml', group: 'edit', labelKey: 'menu.copyAsHtml', accel: null, descKey: null },

  // ---- 格式（工具条已下线，这些命令改由斜杠面板与快捷键驱动）----
  { id: 'format.bold', group: 'format', labelKey: 'menu.bold', accel: '⌘⇧B', descKey: 'shortcuts.boldItalic' },
  { id: 'format.italic', group: 'format', labelKey: 'menu.italic', accel: '⌘I', descKey: null },
  { id: 'format.strike', group: 'format', labelKey: 'menu.strike', accel: '⌘⇧X', descKey: null },
  { id: 'format.inlineCode', group: 'format', labelKey: 'menu.inlineCode', accel: '⌘`', descKey: null },
  { id: 'format.link', group: 'format', labelKey: 'menu.link', accel: '⌘K', descKey: 'shortcuts.insertLink' },
  { id: 'format.h1', group: 'format', labelKey: 'menu.h1', accel: '⌘⌥1', descKey: null },
  { id: 'format.h2', group: 'format', labelKey: 'menu.h2', accel: '⌘⌥2', descKey: null },
  { id: 'format.h3', group: 'format', labelKey: 'menu.h3', accel: '⌘⌥3', descKey: null },
  { id: 'format.bulletList', group: 'format', labelKey: 'menu.bulletList', accel: '⌘⇧8', descKey: null },
  { id: 'format.orderedList', group: 'format', labelKey: 'menu.orderedList', accel: '⌘⇧7', descKey: null },
  { id: 'format.todoList', group: 'format', labelKey: 'menu.todoList', accel: '⌘⇧9', descKey: null },
  { id: 'format.quote', group: 'format', labelKey: 'menu.quote', accel: '⌘⇧.', descKey: null },
  { id: 'format.codeBlock', group: 'format', labelKey: 'menu.codeBlock', accel: '⌘⌥C', descKey: null },
  { id: 'format.insertImage', group: 'format', labelKey: 'menu.insertImage', accel: null, descKey: null },
  { id: 'format.insertTable', group: 'format', labelKey: 'menu.insertTable', accel: null, descKey: null },
  { id: 'format.insertHr', group: 'format', labelKey: 'menu.insertHr', accel: null, descKey: null },
  { id: 'format.insertToc', group: 'format', labelKey: 'menu.insertToc', accel: null, descKey: null },
  { id: 'format.clear', group: 'format', labelKey: 'menu.clearFormat', accel: null, descKey: null },

  // ---- 视图（单栏重构后只剩「专注 / 大纲 / 缩放 / 主题」四类）----
  { id: 'view.focus', group: 'view', labelKey: 'menu.focus', accel: '⌘⇧F', descKey: 'shortcuts.focus' },
  { id: 'view.outline', group: 'view', labelKey: 'menu.outline', accel: '⌘B', descKey: 'shortcuts.outline' },
  { id: 'view.zoomIn', group: 'view', labelKey: 'menu.zoomIn', accel: '⌘=', descKey: 'shortcuts.zoom' },
  { id: 'view.zoomOut', group: 'view', labelKey: 'menu.zoomOut', accel: '⌘-', descKey: null },
  { id: 'view.zoomReset', group: 'view', labelKey: 'menu.zoomReset', accel: '⌘0', descKey: null },
  { id: 'view.theme', group: 'view', labelKey: 'menu.theme', accel: '⌘⇧L', descKey: 'shortcuts.theme' },
  { id: 'view.typewriter', group: 'view', labelKey: 'menu.typewriter', accel: null, descKey: null },
  { id: 'view.alwaysOnTop', group: 'view', labelKey: 'menu.alwaysOnTop', accel: null, descKey: null },

  // ---- 窗口 ----
  { id: 'window.minimize', group: 'window', labelKey: 'menu.minimize', accel: '⌘M', descKey: null },
  { id: 'window.zoom', group: 'window', labelKey: 'menu.zoom', accel: null, descKey: null },

  // ---- 帮助 ----
  { id: 'help.shortcuts', group: 'help', labelKey: 'titlebar.shortcuts', accel: '⌘/', descKey: 'shortcuts.list' },
  { id: 'help.about', group: 'help', labelKey: 'titlebar.about', accel: null, descKey: null },
  { id: 'help.syntax', group: 'help', labelKey: 'help.syntax', accel: null, descKey: null },
]

// 建索引：撞键在这里就会暴露（后写覆盖先写，故同时收集冲突清单）
const accelConflicts = []
for (const c of COMMANDS) {
  ID_TO_COMMAND.set(c.id, c)
  if (!c.accel) continue
  if (ACCEL_TO_ID.has(c.accel)) accelConflicts.push([c.accel, ACCEL_TO_ID.get(c.accel), c.id])
  else ACCEL_TO_ID.set(c.accel, c.id)
}

/** 内部：检测出撞键时打警告（不抛错：门禁会拦住，这里只帮助本地调试定位） */
if (accelConflicts.length) {
  console.warn('[shortcuts] 命令表存在重复键位（门禁 verify-shortcuts 会报红）:', accelConflicts)
}

/** 按分组取命令（菜单渲染用；组内顺序即 COMMANDS 声明顺序） */
export function commandsByGroup(group) {
  return COMMANDS.filter((c) => c.group === group)
}

/** 键位展示：mac 用符号，其余平台把 ⌘/⌥/⇧ 换成 Ctrl/Alt/Shift */
export function fmtAccel(accel) {
  if (!accel) return ''
  if (/mac/i.test(navigator.platform || '')) return accel
  return accel.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+')
}

/** 物理键 → 规范单键写法（字母统一大写，符号键原样） */
function normKeyChar(k) {
  if (k === ' ') return 'Space'
  if (k.length === 1 && /[a-z]/i.test(k)) return k.toUpperCase()
  return k
}

/**
 * 把 KeyboardEvent 归一成规范键位串（修饰键按 MOD_ORDER 排序）。
 * 无法归一（无修饰键的裸键）时返回 null —— 裸键不查表，
 * 否则打字时的字母会误触发命令。
 * @returns {string|null}
 */
export function accelFromEvent(e) {
  const mods = []
  if (e.metaKey || e.ctrlKey) mods.push('⌘') // mac 的 ⌘ 与 win/linux 的 Ctrl 归一
  if (e.shiftKey) mods.push('⇧')
  if (e.altKey) mods.push('⌥')
  if (mods.length === 0) return null
  const key = normKeyChar(e.key)
  if (!key || key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null
  return MOD_ORDER.filter((m) => mods.includes(m)).join('') + key
}

/** 事件 → 命令 id；未命中返回 null */
export function matchCommand(e) {
  const accel = accelFromEvent(e)
  if (!accel) return null
  return ACCEL_TO_ID.get(accel) || null
}

export function getCommand(id) {
  return ID_TO_COMMAND.get(id) || null
}

// ---------------------------------------------------------------------------
// 命令总线：菜单点击与快捷键共用同一条分发路径
// ---------------------------------------------------------------------------

const handlers = new Map()

/** 注册命令处理器。同名重复注册时后者覆盖前者（开发期易错，故打警告） */
export function onCommand(id, fn) {
  if (handlers.has(id)) {
    console.warn('[shortcuts] 命令重复注册（后者覆盖前者）:', id)
  }
  handlers.set(id, fn)
}

/** 触发命令；无处理器时返回 false（便于调用方决定是否兜底） */
export function emitCommand(id, payload) {
  const fn = handlers.get(id)
  if (!fn) {
    console.warn('[shortcuts] 命令无处理器:', id)
    return false
  }
  fn(payload)
  return true
}

/**
 * 应用内速查表：取所有带 descKey 的命令，按 accel 排序。
 * 由门禁与 useShortcutsHelp.js 共用，保证速查表与真源同源。
 */
export function shortcutRows() {
  return COMMANDS
    .filter((c) => c.descKey)
    .map((c) => ({ accel: c.accel, descKey: c.descKey, id: c.id }))
    .sort((a, b) => {
      // 无键命令排在最后，保持有键项的阅读连贯
      if (!a.accel) return 1
      if (!b.accel) return -1
      return a.accel < b.accel ? -1 : 1
    })
}

/** 是否有任何命令绑定了该键（供编辑器 keymap 判断是否放行给浏览器） */
export function hasAccel(accel) {
  return ACCEL_TO_ID.has(accel)
}

/**
 * 安装全局键位监听。返回卸载函数。
 *
 * 为什么放在 window 而不是编辑器 keymap：⌘S / ⌘P 这类命令必须在
 * 编辑器失焦时也能用；而 CodeMirror 的 keymap 只在编辑器聚焦时生效。
 * 编辑器内按下的组合键会被这里拦下并 preventDefault，
 * 不会同时触发浏览器默认行为。
 */
export function installGlobalShortcuts() {
  const onKeydown = (e) => {
    if (e.isComposing) return // 输入法组字中不拦截
    const id = matchCommand(e)
    if (!id) return
    e.preventDefault()
    emitCommand(id)
  }
  window.addEventListener('keydown', onKeydown)
  return () => window.removeEventListener('keydown', onKeydown)
}

// 兼容旧引用：视图模式 / 设置 / 关于的可见态统一放这里，供 TitleBar 与快捷键共用
export const uiState = {
  settingsOpen: ref(false),
  shortcutsOpen: ref(false),
  aboutOpen: ref(false),
}

export const settingsOpen = computed(() => uiState.settingsOpen.value)
