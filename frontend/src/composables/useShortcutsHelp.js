/**
 * useShortcutsHelp — 应用内「帮助 → 快捷键速查」弹层
 * ---------------------------------------------------------------------------
 * 【SHORTCUTS 常量已删除：速查表现在从命令表派生】
 * 此前本文件手写一张 SHORTCUTS 表，与 README「快捷键」节、main.go buildMenu
 * 构成同一事实的三个副本 —— 2026-10-04 就因「加粗误写成 ⌘B」撞上大纲的 ⌘B。
 * 原生菜单下线后，键位真源迁到 useShortcuts.js 的 COMMANDS 表，
 * 本文件改为**直接读那张表**：速查表与真源从此不可能漂移。
 *
 * 仍然保留的门禁：scripts/verify/verify-shortcuts.mjs 比对
 * 「COMMANDS ↔ README 快捷键节 ↔ 本弹层渲染结果」三处，
 * 并检查命令表内部撞键。改键位只改 useShortcuts.js 的 COMMANDS。
 */
import { ref, computed } from 'vue'
import { t } from '../i18n/index.js'
import { COMMANDS, fmtAccel } from './useShortcuts.js'

export function useShortcutsHelp() {
  const showShortcuts = ref(false)

  // 取所有带 descKey 的命令（即「值得进速查表」的精选子集）。
  // 排序：先按分组原序（命令表即按 文件/编辑/格式/视图/窗口/帮助 声明），
  // 组内保持声明顺序 —— 与旧表按分组手写的阅读顺序一致。
  const GROUP_ORDER = ['file', 'edit', 'format', 'view', 'window', 'help']
  const rows = computed(() => COMMANDS
    .filter((c) => c.descKey)
    .map((c) => ({
      id: c.id,
      group: c.group,
      // 键位串不译（Spec §7 坑 4：⌘⇧B 这类键位是平台约定，译了反而不准），
      // 只在非 mac 平台把符号换成 Ctrl/Alt/Shift
      keys: fmtAccel(c.accel),
      // 描述走 t()，切语言自动重算
      desc: t(c.descKey),
    }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)))

  return { showShortcuts, rows }
}
