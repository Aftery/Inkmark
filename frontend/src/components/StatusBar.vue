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
import { t } from '../i18n/index.js'

const props = defineProps({
  status: { type: String, default: 'saved' }, // 'saved' | 'saving' | 'unsaved' | 'error'
  line: { type: Number, default: 1 },
  col: { type: Number, default: 1 },
  words: { type: Number, default: 0 },
  zoom: { type: Number, default: 100 },
})
defineEmits(['zoom'])

// 三态三重表达：图标形状不同 + 文案不同 + 颜色不同（色盲/灰度下仍可区分）
// text 存 i18n key 而非译文：META 是模块级常量，直接存译文会让切语言时
// 这段文案永久停在初始语言（模块级常量不参与 Vue 响应式重算）。
const META = {
  saved: { icon: 'circle-check', key: 'common.saved', cls: 'is-ok' },
  saving: { icon: 'loader', key: 'common.saving', cls: 'is-busy' },
  unsaved: { icon: 'circle-dot', key: 'common.unsaved', cls: 'is-warn' },
  error: { icon: 'circle-dot', key: 'common.saveFailed', cls: 'is-err' },
}
// 在 computed 里读 t() → 依赖 i18n 的 locale ref，切语言即重算
const meta = computed(() => {
  const m = META[props.status] || META.saved
  return { ...m, text: t(m.key) }
})
</script>

<template>
  <footer class="statusbar" :class="meta.cls">
    <span class="sb-save" role="status">
      <AppIcon :name="meta.icon" size="inline" :label="meta.text.replace(/…$/, '')" />
      <span>{{ meta.text }}</span>
    </span>

    <span class="sb-spring" aria-hidden="true"></span>

    <span class="sb-item sb-num">{{ t('statusbar.lineCol', { line, col }) }}</span>
    <span class="sb-dot" aria-hidden="true">·</span>
    <span class="sb-item sb-num">{{ t('statusbar.words', { count: words.toLocaleString() }) }}</span>
    <span class="sb-dot" aria-hidden="true">·</span>
    <button
      class="sb-item sb-zoom sb-num"
      type="button"
      :title="t('statusbar.zoomTitle')"
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
