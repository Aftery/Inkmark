<script setup>
/**
 * TabBar — 标签栏（渲染标签 + 脏点 + 点击激活 + 关闭）
 * ----------------------------------------------------------------------------
 * 【P2 的范围】加了关闭按钮；仍不做「+」按钮、拖拽重排、右键菜单、Tab Switcher
 * （P4）。`v-show` 条件由 App.vue 控制（`!focusOn && sessions.length > 1`）——
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
 * 关闭按钮）+ 内层 `<button role="tab">`（承载激活与选中语义）+ 同级关闭按钮。
 * 这样「点标签切过去」与「点 × 关掉」是两个互不干扰的可聚焦目标。
 *
 * 【关闭按钮的 × 走 AppIcon 白名单】
 * `close` 是 SEMANTICS 里已登记的语义名（几何 `x`），故用 `<AppIcon name="close" />`
 * ——不新增图标、不改图标白名单（`scripts/verify/scripts-verify-icons.mjs` 的
 * 「24/24」不受影响），也没有用任何符号字形（P0 禁止 emoji 与字符图标）。
 *
 * 【打印隐藏由 App.vue 的 @media print 负责】`.tab-bar` 是本组件的**根元素**，
 * 父组件的 scoped 规则能打到子组件的根（Vue 会给根元素同时挂父作用域 id），
 * 故这里不重复一份 —— 重复的规则会让人误以为「删一处没事」。
 */
import { t } from '../i18n/index.js'
import AppIcon from './icons/AppIcon.vue'

defineProps({
  /** DocSession[]（只读渲染；数组顺序 = 显示顺序） */
  sessions: { type: Array, required: true },
  activeId: { type: String, default: '' },
})
const emit = defineEmits(['select', 'close'])

/**
 * 标签的语义状态。P2 仍是 clean / dirty 两态；
 * error（保存失败）与 unsaved（未落盘）按 MD-04 的优先级在后续阶段补，
 * 取值口径已按 §4.9 的四个值定好（clean|dirty|unsaved|error）。
 */
function stateOf(s) {
  return s.dirty ? 'dirty' : 'clean'
}
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
        @click="emit('close', s)"
      >
        <AppIcon name="close" size="inline" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 一行 chrome：与标题栏同宽、比它矮一档；内容横向可滚（标签多了不挤压） */
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
    color var(--motion-fast) var(--ease-standard);
}

.tab:hover { background: var(--surface-2); color: var(--fg); }

/* 激活标签用「文档画布色」而不是强调色：标签栏是 chrome，一屏只该有一处
   强调（MEMORY 的样式偏好第 6 条同源纪律）。 */
.tab.is-active {
  background: var(--bg);
  color: var(--fg);
  font-weight: var(--weight-emphasize);
}

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
</style>
