<script setup>
/**
 * StatusBar —— 底部状态栏（26px，视觉规格 §3）
 * ----------------------------------------------------------------------------
 * 左 = 保存态三态（图标形状 + 文案 + 颜色三重表达，AC-20）。
 * 右 = 行列 · 字数 · 缩放（tabular-nums 等宽数字，中点分隔）。
 * chrome 字体用 --font-ui（纸感主题下外壳仍无衬线，坑 9）。
 */
import { computed } from 'vue'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps({
  status: { type: String, default: 'saved' }, // 'saved' | 'saving' | 'unsaved' | 'error'
  line: { type: Number, default: 1 },
  col: { type: Number, default: 1 },
  words: { type: Number, default: 0 },
  zoom: { type: Number, default: 100 },
})
defineEmits(['zoom'])

// 三态三重表达：图标形状不同 + 文案不同 + 颜色不同（色盲/灰度下仍可区分）
const META = {
  saved: { icon: 'circle-check', text: '已保存', cls: 'is-ok' },
  saving: { icon: 'loader', text: '保存中…', cls: 'is-busy' },
  unsaved: { icon: 'circle-dot', text: '未保存', cls: 'is-warn' },
  error: { icon: 'circle-dot', text: '保存失败', cls: 'is-err' },
}
const meta = computed(() => META[props.status] || META.saved)
</script>

<template>
  <footer class="statusbar" :class="meta.cls">
    <span class="sb-save" role="status">
      <AppIcon :name="meta.icon" size="inline" :label="meta.text.replace(/…$/, '')" />
      <span>{{ meta.text }}</span>
    </span>

    <span class="sb-spring" aria-hidden="true"></span>

    <span class="sb-item sb-num">Ln {{ line }}, Col {{ col }}</span>
    <span class="sb-dot" aria-hidden="true">·</span>
    <span class="sb-item sb-num">{{ words.toLocaleString() }} 字</span>
    <span class="sb-dot" aria-hidden="true">·</span>
    <button
      class="sb-item sb-zoom sb-num"
      type="button"
      title="切换缩放（90 / 100 / 110 / 125%）"
      @click="$emit('zoom')"
    >{{ zoom }}%</button>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: var(--statusbar-height);
  padding: 0 var(--space-3);
  background: var(--surface);
  border-top: 1px solid var(--border-soft);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-small);
  line-height: var(--leading-ui);
  color: var(--meta);
  --wails-draggable: no-drag;
}

.sb-save {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
/* 颜色只作三重表达之一（图标形状 + 文案已独立可辨） */
.is-ok .sb-save { color: var(--success); }
.is-busy .sb-save { color: var(--muted); }
.is-warn .sb-save { color: var(--warn); }
.is-err .sb-save { color: var(--danger); }

/* 保存中：loader 旋转；尊重系统减少动效偏好 */
.is-busy .sb-save :deep(.app-icon) {
  animation: sb-spin 1s linear infinite;
}
@keyframes sb-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .is-busy .sb-save :deep(.app-icon) { animation: none; }
}

.sb-spring { flex: 1; }

.sb-item { color: var(--muted); }
.sb-num {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.sb-dot { color: var(--meta); margin: 0 var(--space-2); }

.sb-zoom {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  letter-spacing: var(--tracking-small);
  transition: color var(--motion-fast) var(--ease-standard);
}
.sb-zoom:hover { color: var(--fg); }
.sb-zoom:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }
</style>
