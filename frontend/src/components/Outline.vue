<script setup>
// 大纲面板：渲染标题层级列表，点击/回车跳转（逻辑在 App.vue 的 jumpToHeading 分流）。
// 视觉：文字 --fg-2、hover --surface-2、当前节 --fg + --weight-emphasize + 左缘 2px
// --accent 竖条（交互 Spec 3.2 定稿视觉）；每级缩进 16px（4px 网格）；
// 行高按触控目标 44px 约束（交互 Spec §5）。零新增颜色与图标。
import { ref, watch, nextTick } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: -1 },
})
const emit = defineEmits(['jump'])
const listEl = ref(null)

// 当前节变化时保证其在面板内可见。
// 手动实现 block:'nearest'、只滚列表自身：原生 scrollIntoView 会滚动祖先链上
// 所有可滚动容器（含页面视口），存在把主区/整页一起带动的风险。
watch(
  () => props.activeIndex,
  async (index) => {
    if (index < 0) return
    await nextTick()
    const list = listEl.value
    const el = list?.children[index]
    if (!list || !el) return
    const lr = list.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    if (er.top < lr.top) list.scrollTop += er.top - lr.top
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom
  },
)

// 键盘可达（交互 Spec §4.3）：列表可 Tab 进入，↑/↓ 在项间移动焦点，
// Enter/空格由 <button> 原生触发 click。
function onKeydown(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const buttons = [...listEl.value.querySelectorAll('button')]
  const current = buttons.indexOf(document.activeElement)
  if (current === -1) return
  e.preventDefault()
  const next =
    e.key === 'ArrowDown' ? Math.min(buttons.length - 1, current + 1) : Math.max(0, current - 1)
  buttons[next]?.focus()
}
</script>

<template>
  <nav class="outline" :aria-label="t('outline.label')">
    <p v-if="!items.length" class="outline-empty">{{ t('outline.empty') }}</p>
    <ul v-else ref="listEl" class="outline-list" @keydown="onKeydown">
      <li
        v-for="(item, index) in items"
        :key="item.pos"
        class="outline-row"
        :style="{ paddingLeft: (item.level - 1) * 16 + 'px' }"
      >
        <button
          class="outline-item"
          :class="{ current: index === activeIndex }"
          type="button"
          :title="item.text"
          @click="emit('jump', item, index)"
        >
          {{ item.text }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.outline {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.outline-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: var(--space-2) var(--space-1);
  list-style: none;
}
.outline-row { min-width: 0; }

.outline-item {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--space-3);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
  color: var(--fg-2);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.outline-item:hover { background: var(--surface-2); color: var(--fg); }
.outline-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* 当前节：--fg 文字 + 字重强调 + 左缘 2px --accent 竖条（交互 Spec 3.2 定稿）。
   accent 预算：竖条 + 编辑区光标 = 每屏 2 处，达标 */
.outline-item.current {
  color: var(--fg);
  font-weight: var(--weight-emphasize);
  box-shadow: inset 2px 0 0 var(--accent);
}
.outline-item.current:hover {
  box-shadow: inset 2px 0 0 var(--accent);
}
.outline-item.current:focus-visible {
  box-shadow: var(--focus-ring), inset 2px 0 0 var(--accent);
}

.outline-empty {
  padding: var(--space-6) var(--space-4);
  color: var(--meta);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
