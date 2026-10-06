<script setup>
/**
 * HistoryPanel — 历史快照面板（从 App.vue 机械搬移，行为零变更）
 * ----------------------------------------------------------------------------
 * 纯展示组件：快照列表 / 立即快照 / 恢复。数据获取与恢复逻辑在
 * composables/useDocumentPersistence.js，经 props + 事件接入。
 * 可见性由父级 v-if 控制（关闭即卸载，Esc 关闭逻辑在父级 onGlobalKeydown）。
 */
import AppIcon from './icons/AppIcon.vue'
import { formatSnapTime, formatSnapSize } from '../composables/useDocumentPersistence'
import { t } from '../i18n/index.js'

defineProps({
  filePath: { type: String, default: '' },
  snapshots: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

defineEmits(['close', 'restore', 'snapshot-now'])
</script>

<template>
  <div class="history-panel" role="dialog" :aria-label="t('history.label')">
    <div class="history-head">
      <span class="history-title">{{ t('history.title') }}</span>
      <button
        v-if="filePath"
        class="history-btn"
        type="button"
        @click="$emit('snapshot-now')"
      >{{ t('history.snapshotNow') }}</button>
      <button class="history-close" type="button" :aria-label="t('common.close')" @click="$emit('close')">
        <AppIcon name="x" size="inline" />
      </button>
    </div>
    <div class="history-body">
      <p v-if="!filePath" class="history-empty">{{ t('history.empty.unsaved') }}</p>
      <template v-else>
        <p v-if="loading" class="history-empty">{{ t('history.empty.loading') }}</p>
        <p v-else-if="!snapshots.length" class="history-empty">
          {{ t('history.empty.none') }}
        </p>
        <ul v-else class="history-list">
          <li v-for="s in snapshots" :key="s.name" class="history-item">
            <span class="history-meta">
              {{ formatSnapTime(s.createdAt) }} · {{ formatSnapSize(s.size) }}
            </span>
            <button class="history-btn" type="button" @click="$emit('restore', s)">{{ t('history.restore') }}</button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  position: fixed;
  top: var(--space-12);
  right: var(--space-6);
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  z-index: 1200; /* toast(1300) 之下、chrome 之上 */
}
.history-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--border-soft);
}
.history-title {
  flex: 1;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}
.history-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.history-close:hover { background: var(--surface-2); color: var(--fg); }
.history-close:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.history-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.history-empty {
  margin: 0;
  padding: var(--space-3) 0;
  color: var(--meta);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}
.history-meta {
  flex: 1;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-btn {
  flex-shrink: 0;
  min-height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg-2);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}
.history-btn:hover { background: var(--surface-2); color: var(--fg); }
.history-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
</style>
