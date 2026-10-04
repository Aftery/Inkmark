<script setup>
/**
 * SegmentedControl — 分段单选控件（设置面板专用）
 * ----------------------------------------------------------------------------
 * 纯受控组件：不持有选中态，值由 v-model（modelValue）驱动，选择经
 * update:modelValue 抛给父级。
 *
 * 无障碍：容器 role="radiogroup" + aria-label，子项 role="radio" + aria-checked，
 * 采用 roving tabindex（只有选中项 tabindex=0，方向键在项间移动并即时选中）。
 *
 * 视觉（design-tokens 全 Token 化，accent 零占用）：
 *   容器底 --surface-2 + --radius-md；选中项底 --bg + 字重 --weight-emphasize。
 */
import { nextTick, ref } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  /** [{ value, label }] */
  options: { type: Array, required: true },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const groupEl = ref(null)

function select(value) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

/** 方向键在选项间循环移动并即时选中（radiogroup 键盘规范） */
function onKeydown(e) {
  const DIRS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
  if (!DIRS.includes(e.key)) return
  e.preventDefault()
  const len = props.options.length
  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const next = (idx + dir + len) % len
  const value = props.options[next].value
  emit('update:modelValue', value)
  // 选中项变了 → roving tabindex 跟着变，把焦点移到新选中项
  nextTick(() => {
    groupEl.value?.querySelectorAll('[role="radio"]')[next]?.focus()
  })
}
</script>

<template>
  <div ref="groupEl" class="segmented" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="segmented-item"
      :class="{ active: opt.value === modelValue }"
      type="button"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :tabindex="opt.value === modelValue ? 0 : -1"
      @click="select(opt.value)"
      @keydown="onKeydown"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--surface-2);
  border-radius: var(--radius-md);
}
.segmented-item {
  min-height: 32px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}
.segmented-item:hover { color: var(--fg); }
/* 选中态：--bg 底 + 字重强调，不占 --accent 预算（每屏 accent ≤ 2 处） */
.segmented-item.active {
  background: var(--bg);
  color: var(--fg);
  font-weight: var(--weight-emphasize);
}
.segmented-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
