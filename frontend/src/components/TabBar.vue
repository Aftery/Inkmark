<script setup>
/**
 * TabBar — 标签栏：渲染 / 脏点 / 激活 / 关闭 / 拖拽重排 / 右键菜单 / Tab Switcher
 * ----------------------------------------------------------------------------
 * `v-show` 条件由 App.vue 控制（`!focusOn && sessions.length > 1`）——
 * 只开着一个文档时不出现整条 chrome。
 *
 * 【脏点为什么用 --meta（MD-04 裁决）】实测对比度（各自对 --surface）：
 *     --meta   三主题 3.11 / 3.66 / 3.07 : 1
 *     --muted  三主题 4.78 / 5.70 / 4.83 : 1
 *   即 --muted 反而**更强**，「降级用 --muted」不构成降级（--muted ÷ --danger
 *   只有 0.86~0.94×）；--meta ÷ --danger = 0.55~0.60× 才是真正的「明显更弱」。
 *   裁决先由 PM 用实算推翻、team-lead 复核改判，留痕见 MD-04 与架构 §4.9。
 *
 * 【状态不得只靠颜色传达（WCAG 1.4.1）】两条非颜色信道：
 *   ① 每个标签根元素带 data-state="clean|dirty"（也是测试 AC-72 的机检信号，
 *      要求两态取值**精确不等**，而不是比对比度倍数）；
 *   ② 脏点带 role="img" + aria-label，读屏能读出「未保存」。
 *
 * 【为什么标签不是一个 <button>】
 * 关闭按钮是第二个可点元素，而 HTML 不允许按钮嵌套按钮（嵌套后内层既拿不到
 * 焦点、点击语义也不确定）。故结构是：外层 div（承载 data-state / 脏点 /
 * 关闭按钮 / 拖拽与右键）+ 内层 `<button role="tab">` + 同级关闭按钮。
 *
 * 【P4：三个交互为什么都挂在标签栏这一层】
 * App.vue 是 ≤150 行硬上限且余量已是 0（contracts.test.mjs 契约 5）。新增交互
 * 只有两条路：下沉到 composable，或长在**已被装配的组件**内部。这三件都是
 * 「标签栏的局部 UI」——菜单与浮层已各自拆成子组件（`TabContextMenu.vue` /
 * `TabSwitcher.vue`，理由同为本文件撞 300 有效行门禁），本文件只保留**状态与分发**。
 * **行为**（关闭 / 落点 / 已关闭栈 / 重排）一律走 emit，本组件不碰会话注册表：
 * 它是纯展示层，没有一条业务规则落在 .vue 里。
 *
 * 【本组件必须保持单根】父组件 App.vue 的 scoped 规则要靠「根元素带父作用域 id」
 * 才能打到 `.tab-bar`（打印时隐藏它就是靠这一条）。多根会让它**静默失效**。
 */
import { computed, reactive, ref } from 'vue'
import { t } from '../i18n/index.js'
import { tabSwitcher } from '../composables/useShortcuts.js'
import AppIcon from './icons/AppIcon.vue'
import TabContextMenu from './TabContextMenu.vue'
import TabSwitcher from './TabSwitcher.vue'

const props = defineProps({
  /** DocSession[]（只读渲染；数组顺序 = 显示顺序） */
  sessions: { type: Array, required: true },
  activeId: { type: String, default: '' },
})
const emit = defineEmits(['select', 'close', 'move', 'close-others', 'close-right'])

/**
 * 标签的语义状态。P4 仍是 clean / dirty 两态；
 * error（保存失败）与未落盘（unsaved）按 MD-04 的优先级在后续阶段补，
 * 取值口径已按 §4.9 的四个值定好（clean|dirty|unsaved|error）。
 */
function stateOf(s) {
  return s.dirty ? 'dirty' : 'clean'
}

// ---------- 拖拽重排 ----------
// 用原生 HTML5 拖拽：不引依赖（P4 边界），WKWebView 对 dragstart/drop 的支持
// 是完整的（不能用的只有 iOS 触屏）。
const dragId = ref('')
const dropId = ref('')

function onDragStart(s, e) {
  dragId.value = s.id
  // 必须 setData：部分 WebView 在没有负载数据时不会触发 drop
  try {
    e.dataTransfer.setData('text/plain', s.id)
    e.dataTransfer.effectAllowed = 'move'
  } catch { /* 旧 WebView 无 dataTransfer 时仍允许拖（只是不发数据） */ }
}

function onDragOver(s) {
  if (dragId.value && s.id !== dragId.value) dropId.value = s.id
}

function onDragLeave(s) {
  if (dropId.value === s.id) dropId.value = ''
}

/** 落点语义 = 「放到这一格的位置上」（由 useEditorSession.reorder 做 splice） */
function onDrop(s) {
  const from = dragId.value
  resetDrag()
  if (from && from !== s.id) emit('move', from, s.id)
}

function resetDrag() {
  dragId.value = ''
  dropId.value = ''
}

// ---------- 右键菜单（渲染与键盘在 TabContextMenu.vue，这里只管状态与分发）----------
const menu = reactive({ show: false, x: 0, y: 0, tabId: '' })

const MENU_ACTIONS = [
  { action: 'close', labelKey: 'tabbar.menu.close' },
  { action: 'others', labelKey: 'tabbar.menu.closeOthers' },
  { action: 'right', labelKey: 'tabbar.menu.closeRight' },
]

/**
 * 三项的禁用态（每次都按**当前活的** sessions 重算，不是打开菜单那一刻的快照）：
 *   - 关闭其他：只剩一个标签时点了等于没反应 → 禁用
 *   - 关闭右侧：点在最右那个上同理 → 禁用
 */
const menuModel = computed(() => {
  const list = props.sessions
  const i = list.findIndex((s) => s.id === menu.tabId)
  return MENU_ACTIONS.map((m) => ({
    ...m,
    disabled: m.action === 'others'
      ? list.length <= 1
      : m.action === 'right' ? (i < 0 || i === list.length - 1) : false,
  }))
})

function openMenu(s, e) {
  menu.show = true
  menu.tabId = s.id
  menu.x = e.clientX
  menu.y = e.clientY
}

function closeMenu() {
  menu.show = false
}

function runMenu(action) {
  const id = menu.tabId
  closeMenu()
  if (action === 'close') emit('close', id)
  if (action === 'others') emit('close-others', id)
  if (action === 'right') emit('close-right', id)
}

// ---------- Tab Switcher 浮层 ----------
// 数据来自 useShortcuts 的 tabSwitcher：**按下瞬间的 MRU 快照**（MD-10）。
// 组件只负责把 id 解析成会话对象，不参与取快照的时机（见 useCommands.cycleTab）。
const switcherRows = computed(() => tabSwitcher.ids.value
  .map((id) => props.sessions.find((s) => s.id === id))
  .filter(Boolean))
</script>

<template>
  <div class="tab-bar" role="tablist" :aria-label="t('tabbar.label')">
    <div
      v-for="s in sessions"
      :key="s.id"
      class="tab"
      :class="{ 'is-active': s.id === activeId }"
      :data-tab-id="s.id"
      :data-state="stateOf(s)"
      :data-dragging="dragId === s.id ? 'true' : 'false'"
      :data-drop-target="dropId === s.id ? 'true' : 'false'"
      draggable="true"
      @dragstart="onDragStart(s, $event)"
      @dragover.prevent="onDragOver(s)"
      @dragleave="onDragLeave(s)"
      @drop.prevent="onDrop(s)"
      @dragend="resetDrag"
      @contextmenu.prevent="openMenu(s, $event)"
    >
      <button
        class="tab-main"
        type="button"
        role="tab"
        :aria-selected="s.id === activeId"
        :title="s.path || s.title"
        @click="emit('select', s)"
      >
        <span class="tab-title">{{ s.title }}</span>
        <!-- 脏点：纯 CSS 圆点，不用任何符号字形（P0-1 零 emoji / 零字符图标） -->
        <span
          v-if="s.dirty"
          class="tab-dot"
          role="img"
          :aria-label="t('common.unsaved')"
        ></span>
      </button>
      <button
        class="tab-close"
        type="button"
        :aria-label="t('tabbar.close')"
        :title="t('tabbar.close')"
        @click="emit('close', s.id)"
      >
        <AppIcon name="close" size="inline" />
      </button>
    </div>

    <TabContextMenu
      :open="menu.show"
      :x="menu.x"
      :y="menu.y"
      :items="menuModel"
      @run="runMenu"
      @close="closeMenu"
    />
    <TabSwitcher
      :open="tabSwitcher.open.value && switcherRows.length > 1"
      :rows="switcherRows"
      :active-id="activeId"
    />
  </div>
</template>

<style scoped>
/* 一行 chrome：与标题栏同宽、比它矮一档；内容横向可滚（标签多了不挤压）。
   注意它同时是一个**裁剪容器**（overflow-x: auto）—— 菜单与浮层因此 teleport 到
   body 并用 position: fixed，不放在本元素内部做绝对定位。 */
.tab-bar {
  flex: none;
  display: flex;
  align-items: stretch;
  gap: var(--space-1);
  height: 34px;
  padding: 0 var(--space-3);
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  --wails-draggable: no-drag;
}

/* 标签容器：承载背景与关闭按钮；点击/激活语义在内层 button 上 */
.tab {
  display: flex;
  align-items: center;
  flex: none;
  max-width: 260px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  color: var(--fg-2);
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    opacity var(--motion-fast) var(--ease-standard);
}

.tab:hover { background: var(--surface-2); color: var(--fg); }

/* 激活标签用「文档画布色」而不是强调色：标签栏是 chrome，一屏只该有一处
   强调（MEMORY 的样式偏好第 6 条同源纪律）。 */
.tab.is-active {
  background: var(--bg);
  color: var(--fg);
  font-weight: var(--weight-emphasize);
}

/* 拖拽反馈：被拖的那格变淡（数据仍在预览里），落点用一条 inset 竖线当插入位置。
   两个信号都不靠颜色单独传达（透明度 / 位置），且都只用既有 token。 */
.tab[data-dragging='true'] { opacity: 0.45; }
.tab[data-drop-target='true'] { box-shadow: inset 2px 0 0 var(--accent); }

.tab-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 0 var(--space-2) 0 var(--space-3);
  border: none;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: default;
}

.tab-main:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* MD-04：5px 实心圆点，低调、不抢焦点（比标题栏的 7px 更小一档 —— 标签栏
   同时有多个标签，标记过于显眼会让整条栏变成「一排红绿灯」） */
.tab-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--meta);
}

/* 关闭按钮：平时隐去（多个标签时一排 × 太吵），悬停标签或键盘聚焦时出现。
   opacity:0 仍可聚焦，故必须给 :focus-visible 一条显形规则，否则键盘用户
   会「聚焦到一个看不见的按钮」。 */
.tab-close {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  margin-right: var(--space-1);
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-2);
  cursor: default;
  opacity: 0;
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.tab:hover .tab-close,
.tab.is-active .tab-close,
.tab-close:focus-visible { opacity: 1; }

.tab-close:hover { background: var(--danger-soft); color: var(--danger); }
.tab-close:focus-visible { outline: none; box-shadow: var(--focus-ring); }

@media (prefers-reduced-motion: reduce) {
  .tab, .tab-close { transition: none; }
}
</style>
