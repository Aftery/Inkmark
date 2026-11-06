<script setup>
/**
 * TabContextMenu — 标签栏的右键菜单（P4）
 * ----------------------------------------------------------------------------
 * 【为什么从 TabBar.vue 里拆出来】`TabBar.vue` 撞了 300 有效行的硬门禁（契约 5：
 * 白名单外的前端源文件一律 ≤300）。菜单是**自带键盘交互与坐标定位**的一整块，
 * 拆出来既降行数、又让「菜单自己的 Esc/↑↓」有明确归属。
 *
 * 【键盘逻辑必须跟着搬进来，不能留在父组件】它依赖菜单内部的 DOM 引用
 * （`menuItemEls`）。留在父组件就变成「父组件拿着子组件内部元素的 ref」——
 * 跨组件传 ref 比搬过来更糟（父组件得在模板里 `ref` 到子组件实例再往下钻）。
 *
 * 【Esc 为什么就地 stopPropagation，而不是去改全局 Esc 层级】
 * `useCommands.onEscKeydown` 是一条「逐层收起最上面那层」的全局链
 * （输入框 > 设置 > 速查 > 关于 > 专注 > 历史）。菜单不在那条链里，也不该进去：
 * 它只在自己开着、且焦点在菜单内时才该吃掉 Esc。就地停掉传播 = 全局链完全不知道
 * 菜单的存在，两边零耦合（与 `InputDialog.vue` 的自持做法同构）。
 *
 * 【print 隐藏为什么要在本组件再写一份】父组件的 scoped 规则**打不到子组件内部**
 * （只能打到子组件的根元素）。菜单是 teleport 到 body 的瞬时 chrome，必须自己声明。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  /** 是否显示 */
  open: { type: Boolean, default: false },
  /** 视口坐标（右键位置，position: fixed 用） */
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  /** [{ action, labelKey, disabled }] —— 禁用态由父组件按活的 sessions 算 */
  items: { type: Array, default: () => [] },
})
const emit = defineEmits(['run', 'close'])

const menuItemEls = ref([])

const style = computed(() => ({ left: `${props.x}px`, top: `${props.y}px` }))

function focusFirst() {
  nextTick(() => menuItemEls.value.find((el) => el && !el.disabled)?.focus())
}

// 每次从关到开都把焦点收进菜单：否则键盘用户按 Esc / ↑↓ 时事件落在编辑器上
// （菜单看着开着，键盘却完全没有响应）
watch(() => props.open, (open) => { if (open) focusFirst() })

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return // Enter / Space 走 button 原生激活
  e.preventDefault()
  e.stopPropagation()
  const els = menuItemEls.value.filter(Boolean)
  const cur = els.indexOf(document.activeElement)
  if (cur < 0) {
    els.find((el) => !el.disabled)?.focus()
    return
  }
  const step = e.key === 'ArrowDown' ? 1 : -1
  for (let k = 1; k <= els.length; k++) {
    const el = els[(cur + step * k + els.length) % els.length]
    if (!el.disabled) { el.focus(); return }
  }
}

/** 点击别处收起。捕获阶段：先于任何 button 的 click 判定，避免「点空处先触发一个命令」 */
function onPointerDownOutside(e) {
  if (!props.open) return
  if (e.target instanceof Element && e.target.closest('.tab-menu')) return
  emit('close')
}

onMounted(() => window.addEventListener('pointerdown', onPointerDownOutside, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDownOutside, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="tab-menu"
      role="menu"
      :aria-label="t('tabbar.menu.label')"
      :style="style"
      @keydown="onKeydown"
    >
      <button
        v-for="(item, i) in items"
        :key="item.action"
        :ref="(el) => { menuItemEls[i] = el }"
        class="tab-menu-item"
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        @click="emit('run', item.action)"
      >
        {{ t(item.labelKey) }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.tab-menu {
  position: fixed;
  /* 层叠：下拉层。高于 chrome(100) 与斜杠面板(200)，低于历史面板(1200)
     及更上的弹层（settings / toast / palette）—— 与仓库既有 z-index 阶一致 */
  z-index: 400;
  min-width: 168px;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--elev-raised);
  --wails-draggable: no-drag;
}

.tab-menu-item {
  display: block;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: default;
}

.tab-menu-item:hover:not(:disabled) { background: var(--surface-2); }
.tab-menu-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.tab-menu-item:disabled { color: var(--meta); }

@media print {
  .tab-menu { display: none !important; }
}
</style>
