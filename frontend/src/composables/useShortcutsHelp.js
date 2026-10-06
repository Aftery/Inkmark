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
import { ref, computed } from 'vue'
import { t } from '../i18n/index.js'

/** 键位展示：mac 用符号，其余平台把 ⌘/⌥/⇧ 替换为 Ctrl/Alt/Shift */
const IS_MAC = /mac/i.test(navigator.platform || '')

export function useShortcutsHelp() {
  const showShortcuts = ref(false)

  function fmtKey(k) {
    if (IS_MAC) return k
    return k.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+')
  }

  // 速查表渲染成「已翻译的描述」而不是裸 key：SHORTCUTS 是模块级常量，
  // 若在模板里现调 t() 也能跟着切语言，但把翻译收在这里可以顺带保证
  // 弹层标题、表格内容走同一份 t()，且键位串 fmtKey() 不受影响。
  const rows = computed(() => SHORTCUTS.map(([keys, descKey]) => [fmtKey(keys), t(descKey)]))

  return { showShortcuts, fmtKey, rows }
}

/**
 * 快捷键速查表（键位 → 用途描述的 i18n key）。顺序按「文件 / 编辑 / 视图」分组，便于扫读。
 *
 * 注意·第二列存的是 **i18n key 而非译文**：切语言时表格靠 t() 重算描述。
 * 键位串（第一列）**不译**（Spec §7 坑 4：⌘⇧B 这类键位是平台约定，译了反而不准）。
 */
export const SHORTCUTS = [
  ['⌘N', 'shortcuts.new'],
  ['⌘O / ⌘⇧O', 'shortcuts.open'],
  ['⌘S / ⌘⇧S', 'shortcuts.save'],
  ['⌘P', 'shortcuts.print'],
  ['⇧⌘P', 'shortcuts.exportPdf'],
  ['⌘F', 'shortcuts.find'],
  ['⌘L', 'shortcuts.jumpLine'],
  ['⌥↑ / ⌥↓', 'shortcuts.moveLine'],
  ['⇧⌥↑ / ⇧⌥↓', 'shortcuts.dupLine'],
  ['⌘⇧K', 'shortcuts.deleteLine'],
  ['⌘⇧B / ⌘I', 'shortcuts.boldItalic'],
  ['⌘K', 'shortcuts.insertLink'],
  ['⌘1 ~ ⌘4', 'shortcuts.viewModes'],
  ['⌘⇧F', 'shortcuts.focus'],
  ['⌘B', 'shortcuts.outline'],
  ['⌘= / ⌘- / ⌘0', 'shortcuts.zoom'],
  ['⌘⇧L', 'shortcuts.theme'],
  ['⌘,', 'shortcuts.settings'],
  ['⌘/', 'shortcuts.list'],
]
