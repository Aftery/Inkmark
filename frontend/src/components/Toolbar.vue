<script setup>
/**
 * Toolbar —— 编辑区顶部格式工具条（38px，视觉规格 §2）
 * ----------------------------------------------------------------------------
 * 四组按钮（历史 / 行内 / 块级 / 插入）+ 右端「更多」溢出。
 * 窄窗按阈值从右往左折叠进「更多」菜单（不横向滚动）：
 *   ≥720px 全展开；<720 折 3；<600 折 7；<460 折 10（G1/G2 常驻）。
 * 选中态 = --fg 满对比图标 + 常驻内描边（不用 --accent，不靠颜色单独传达）。
 * 图标全部经 AppIcon（lucide 语义名），禁止裸 SVG / emoji。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps({
  active: { type: Object, default: () => ({}) }, // activeFormats(state) 产出
})
const emit = defineEmits(['command'])

const ITEMS = [
  { id: 'undo', icon: 'undo-2', label: '撤销', group: 0 },
  { id: 'redo', icon: 'redo-2', label: '重做', group: 0 },
  { id: 'bold', icon: 'bold', label: '加粗', group: 1, toggle: true },
  { id: 'italic', icon: 'italic', label: '斜体', group: 1, toggle: true },
  { id: 'strike', icon: 'strikethrough', label: '删除线', group: 1, toggle: true },
  { id: 'code', icon: 'code', label: '行内代码', group: 1, toggle: true },
  { id: 'heading', icon: 'heading', label: '标题', group: 2, menu: true },
  { id: 'quote', icon: 'quote', label: '引用', group: 2, toggle: true },
  { id: 'ul', icon: 'list', label: '无序列表', group: 2, toggle: true },
  { id: 'ol', icon: 'list-ordered', label: '有序列表', group: 2, toggle: true },
  { id: 'task', icon: 'list-todo', label: '任务列表', group: 2, toggle: true },
  { id: 'link', icon: 'link', label: '链接', group: 3 },
  { id: 'image', icon: 'image', label: '图片', group: 3 },
  { id: 'codeblock', icon: 'square-code', label: '代码块', group: 3 },
  { id: 'table', icon: 'table', label: '表格', group: 3 },
  { id: 'hr', icon: 'minus', label: '分隔线', group: 3 },
]

// 折叠顺序（先折 → 后折），视觉规格 §2.6：undo/redo 与 bold/italic 最后折叠
const COLLAPSE_ORDER = ['hr', 'table', 'codeblock', 'image', 'link', 'task', 'ol', 'ul', 'quote', 'heading']

const HEADING_ITEMS = [
  { id: 'h0', label: '正文' },
  { id: 'h1', label: '标题 1' },
  { id: 'h2', label: '标题 2' },
  { id: 'h3', label: '标题 3' },
]

const barEl = ref(null)
const barWidth = ref(1024)
const headMenuOpen = ref(false)
const moreOpen = ref(false)
let resizeObserver = null

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    for (const e of entries) barWidth.value = e.contentRect.width
  })
  if (barEl.value) resizeObserver.observe(barEl.value)
  document.addEventListener('pointerdown', onOutsidePointer, true)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('pointerdown', onOutsidePointer, true)
})

// 宽度阈值 → 折叠数量（§2.6 表）
const collapsedSet = computed(() => {
  const w = barWidth.value
  const n = w < 460 ? 10 : w < 600 ? 7 : w < 720 ? 3 : 0
  return new Set(COLLAPSE_ORDER.slice(0, n))
})

const visibleItems = computed(() => ITEMS.filter((it) => !collapsedSet.value.has(it.id)))
const overflowItems = computed(() => ITEMS.filter((it) => collapsedSet.value.has(it.id)))
// 「更多」菜单里是否需要渲染标题子项（heading 被折叠时）
const overflowHasHeading = computed(() => collapsedSet.value.has('heading'))

function onOutsidePointer(e) {
  if (barEl.value && !barEl.value.contains(e.target)) {
    headMenuOpen.value = false
    moreOpen.value = false
  }
}

function clickItem(item) {
  headMenuOpen.value = false
  moreOpen.value = false
  if (!item.menu) emit('command', item.id)
  else headMenuOpen.value = !headMenuOpen.value
}

function pickHeading(id) {
  headMenuOpen.value = false
  moreOpen.value = false
  emit('command', id)
}

function isActive(item) {
  if (item.id === 'heading') return (props.active.heading || 0) > 0
  return !!props.active[item.id]
}
</script>

<template>
  <div ref="barEl" class="editor-toolbar" role="toolbar" aria-label="格式化工具条">
    <template v-for="(item, i) in visibleItems" :key="item.id">
      <span
        v-if="i > 0 && item.group !== visibleItems[i - 1].group"
        class="tb-sep"
        aria-hidden="true"
      ></span>
      <button
        class="tb-btn"
        :class="{ selected: item.toggle && isActive(item) }"
        type="button"
        :aria-label="item.label"
        :title="item.label"
        :aria-pressed="item.toggle ? isActive(item) : undefined"
        @click="clickItem(item)"
      >
        <AppIcon :name="item.icon" size="button" />
      </button>
    </template>

    <span class="tb-spring" aria-hidden="true"></span>

    <button
      v-if="overflowItems.length"
      class="tb-btn"
      :class="{ selected: moreOpen }"
      type="button"
      aria-label="更多格式"
      title="更多格式"
      :aria-expanded="moreOpen"
      @click="moreOpen = !moreOpen"
    >
      <AppIcon name="ellipsis" size="button" />
    </button>

    <!-- 标题下拉（文本菜单项，视觉规格 §2.2） -->
    <div v-if="headMenuOpen" class="tb-menu" role="menu" aria-label="标题级别">
      <button
        v-for="h in HEADING_ITEMS"
        :key="h.id"
        class="tb-menu-item"
        :class="{ current: (active.heading || 0) === Number(h.id.slice(1)) }"
        type="button"
        role="menuitem"
        @click="pickHeading(h.id)"
      >{{ h.label }}</button>
    </div>

    <!-- 溢出菜单：图标 + 文本标签（菜单不是纯图标位） -->
    <div v-if="moreOpen" class="tb-menu" role="menu" aria-label="更多格式">
      <button
        v-for="item in overflowItems"
        :key="item.id"
        v-show="!item.menu"
        class="tb-menu-item"
        type="button"
        role="menuitem"
        @click="clickItem(item)"
      >
        <AppIcon :name="item.icon" size="button" />
        <span>{{ item.label }}</span>
      </button>
      <template v-if="overflowHasHeading">
        <div class="tb-menu-group" role="separator">标题</div>
        <button
          v-for="h in HEADING_ITEMS"
          :key="'m-' + h.id"
          class="tb-menu-item"
          type="button"
          role="menuitem"
          @click="pickHeading(h.id)"
        >{{ h.label }}</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.editor-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: var(--editor-toolbar-height);
  padding: 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border-soft);
  overflow: hidden; /* 内容溢出不横向滚动：折叠策略兜底 */
  --wails-draggable: no-drag;
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}
.tb-btn:hover { background: var(--surface-2); color: var(--fg); }
.tb-btn:active { background: var(--surface-2); color: var(--fg); }
.tb-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
/* 选中态：--fg 满对比 + 常驻 1px 内描边（不用 accent、不靠颜色单独传达） */
.tb-btn.selected {
  background: var(--surface-2);
  color: var(--fg);
  box-shadow: inset 0 0 0 1px var(--border);
}

.tb-sep {
  width: 1px;
  height: 16px;
  flex-shrink: 0;
  margin: 0 var(--space-1);
  background: var(--border);
}

.tb-spring { flex: 1; }

/* 下拉 / 溢出菜单（z-index 1000：Token 阶梯 dropdown 层） */
.tb-menu {
  position: absolute;
  top: calc(100% + 2px);
  right: var(--space-2);
  min-width: 140px;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--space-1);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  z-index: 1000;
}
.tb-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 32px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.tb-menu-item:hover { background: var(--surface-2); color: var(--fg); }
.tb-menu-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.tb-menu-item.current { color: var(--fg); font-weight: var(--weight-emphasize); }
.tb-menu-group {
  padding: var(--space-2) var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  color: var(--meta);
}

/* 触控 / 窄屏：按钮放大到 40×40（视觉规格 §2.4 对 44px 的有据偏离） */
@media (pointer: coarse) {
  .tb-btn { width: 40px; height: 40px; }
}
</style>
