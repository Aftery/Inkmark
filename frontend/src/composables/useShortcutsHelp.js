/**
 * useShortcutsHelp — 应用内「帮助 → 快捷键速查」弹层
 * ---------------------------------------------------------------------------
 * 从 App.vue 原样抽出，**行为零变更**。
 *
 * 【SHORTCUTS 的正确性由门禁保证，不要手改】
 * 这张表与应用内速查弹层、以及 README「快捷键」节是**同一事实的三个副本**。
 * 手改这里而不改代码，会造成「用户看到的速查表与真实键位不符」——
 * 2026-10-04 就真发生过：加粗误写成 ⌘B，与同表的大纲 ⌘B 撞键、含义冲突。
 *
 * 改 accelerator 的唯一真源是 main.go 的 buildMenu()，改完必须跑：
 *   node scripts/verify/verify-shortcuts.mjs
 * 它会比对 SHORTCUTS / README 与 main.go 三处，漏改任一处即报红。
 * 该脚本还会检测同一张表内「同一键两义」的撞键。
 */
import { ref } from 'vue'

/** 键位展示：mac 用符号，其余平台把 ⌘/⌥/⇧ 替换为 Ctrl/Alt/Shift */
const IS_MAC = /mac/i.test(navigator.platform || '')

export function useShortcutsHelp() {
  const showShortcuts = ref(false)

  function fmtKey(k) {
    if (IS_MAC) return k
    return k.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+')
  }

  return { showShortcuts, fmtKey, SHORTCUTS }
}

/** 快捷键速查表（键位 → 用途）。顺序按「文件 / 编辑 / 视图」分组，便于扫读。 */
export const SHORTCUTS = [
  ['⌘N', '新建文件'],
  ['⌘O / ⌘⇧O', '打开文件 / 打开文件夹'],
  ['⌘S / ⌘⇧S', '保存 / 另存为'],
  ['⌘P', '打印'],
  ['⇧⌘P', '导出 PDF'],
  ['⌘F', '查找（⌘⌥F 查找替换）'],
  ['⌘L', '跳转到行'],
  ['⌥↑ / ⌥↓', '上移 / 下移行'],
  ['⇧⌥↑ / ⇧⌥↓', '在上方 / 下方复制当前行'],
  ['⌘⇧K', '删除当前行'],
  ['⌘⇧B / ⌘I', '加粗 / 斜体'],
  ['⌘K', '插入链接'],
  ['⌘1 ~ ⌘4', '编辑 / 预览 / 双栏 / 阅读'],
  ['⌘⇧F', '专注模式（Esc 退出）'],
  ['⌘B', '显示 / 隐藏大纲'],
  ['⌘= / ⌘- / ⌘0', '放大 / 缩小 / 重置缩放'],
  ['⌘⇧L', '切换主题'],
  ['⌘,', '设置'],
  ['⌘/', '快捷键速查'],
]
