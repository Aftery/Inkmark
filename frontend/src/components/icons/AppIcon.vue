<script setup>
/**
 * AppIcon — Inkmark 图标唯一渲染入口
 * ----------------------------------------------------------------------------
 * 全项目只有本组件渲染 <svg>。业务组件禁止直接 import paths.js、禁止内联裸 <svg>。
 *
 * 用法：
 *   <AppIcon name="open-file" size="button" label="打开文件" />   ← 顶栏按钮
 *   <AppIcon name="file" size="inline" />                        ← 文件树叶子（装饰，自动 aria-hidden）
 *
 * Props：
 *   name  —— 语义名（见 paths.js SEMANTICS）；也接受已登记的几何名
 *   size  —— 'inline'(16) | 'button'(20) | number，默认 20
 *   label —— 有语义的图标按钮必传（生成 aria-label + role="img"）；不传则 aria-hidden
 *
 * 描边规范（全项目统一）：stroke-width 1.75 / currentColor / 圆角端点
 */
import { computed, watchEffect } from 'vue'
import { resolveIcon } from './paths.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [String, Number], default: 'button' },
  label: { type: String, default: '' },
})

const SIZE_MAP = { inline: 16, button: 20 }

const px = computed(() => {
  if (typeof props.size === 'number') return props.size
  if (props.size in SIZE_MAP) return SIZE_MAP[props.size]
  const n = parseInt(props.size, 10)
  return Number.isFinite(n) ? n : 20
})

const inner = computed(() => resolveIcon(props.name))

if (import.meta.env?.DEV) {
  // 开发期兜底告警：白名单外的名字会静默变空白，这里主动暴露
  watchEffect(() => {
    if (!inner.value) console.warn(`[AppIcon] 未登记的图标名: "${props.name}"（见 components/icons/paths.js）`)
  })
}
</script>

<template>
  <svg
    class="app-icon"
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    v-html="inner"
  />
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
