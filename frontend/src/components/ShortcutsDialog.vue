<!-- ShortcutsDialog.vue — 快捷键速查（⌘/ 或「帮助」菜单；Esc 关闭） -->
<!--
  行的数据源是 useShortcutsHelp 的 rows —— 从命令表（useShortcuts.js 的 COMMANDS）
  派生，不是手写副本。2026-06「加粗误写 ⌘B」就是手写表漂移出来的，
  门禁 scripts/verify/verify-shortcuts.mjs 会检查它仍从命令表派生。
-->
<script setup>
import { t } from '../i18n/index.js'

defineProps({
  // [{ id, group, keys, desc }]（keys 已由 fmtAccel 在非 mac 平台转译成 Ctrl/Alt/Shift）
  rows: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])
</script>

<template>
  <div class="dialog-mask" @click.self="emit('close')">
    <div
      class="dialog dialog-wide"
      role="dialog"
      aria-modal="true"
      :aria-label="t('shortcutsDialog.title')"
    >
      <p class="dialog-title">{{ t('shortcutsDialog.title') }}</p>
      <table class="shortcut-table">
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="shortcut-keys">{{ row.keys }}</td>
            <td class="shortcut-desc">{{ row.desc }}</td>
          </tr>
        </tbody>
      </table>
      <div class="dialog-actions">
        <button class="dialog-btn primary" type="button" @click="emit('close')">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shortcut-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.shortcut-table td { padding: 6px 0; border-bottom: 1px solid var(--border-soft); }
.shortcut-table tr:last-child td { border-bottom: none; }
.shortcut-keys {
  width: 42%;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
}
.shortcut-desc { color: var(--fg-2); }

/* 打印：遮罩不得出现在纸面（父级 App.vue 的 @media print 管不到子组件内部） */
@media print {
  .dialog-mask { display: none; }
}
</style>
