<script setup>
/**
 * TabBar — 标签栏（P1 骨架：渲染标签 + 脏点 + 点击激活）
 * ----------------------------------------------------------------------------
 * 【P1 明确不做】关闭按钮 / 「+」按钮 / 拖拽重排 / 右键菜单 / Tab Switcher。
 * 关闭按钮被挪到 P2，理由是它需要「脏确认 + 快照留底 + 落点选择 + Go 侧
 * ForgetDoc」，而应用内确认对话框组件还不存在 —— 现在放一个关闭按钮，
 * 只会得到「要么丢数据、要么撒谎」的按钮。
 *
 * 【脏点为什么用 --meta（MD-04 裁决）】实测对比度（各自对 --surface）：
 *     --meta   三主题 3.11 / 3.66 / 3.07 : 1
 *     --muted  三主题 4.78 / 5.70 / 4.83 : 1
 *   即 --muted 反而**更强**，「降级用 --muted」不构成降级（--muted ÷ --danger
 *   只有 0.86~0.94×）；--meta ÷ --danger = 0.55~0.60× 才是真正的「明显更弱」。
 *   裁决先由 PM 用实算推翻、team-lead 复核改判，留痕见架构方案 §4.9。
 *   教训：判断「视觉强弱」要查 token 的实际对比度，不要凭 token 名字的字面意思。
 *
 * 【状态不得只靠颜色传达（WCAG 1.4.1）】两条非颜色信道：
 *   ① 每个标签根元素带 data-state="clean|dirty"（也是测试 AC-72 的机检信号，
 *      要求两态取值**精确不等**，而不是比对比度倍数）；
 *   ② 脏点带 role="img" + aria-label，读屏能读出「未保存」。
 *
 * 【打印隐藏由 App.vue 的 @media print 负责】`.tab-bar` 是本组件的**根元素**，
 * 父组件的 scoped 规则能打到子组件的根（Vue 会给根元素同时挂父作用域 id），
 * 故这里不重复一份 —— 重复的规则会让人误以为「删一处没事」。
 *
 * 【no-drag 显式声明】`--wails-draggable: drag` 只挂在 TitleBar 的根节点上、
 * 由子元素继承，标签栏不在其内；这里仍显式写 no-drag —— 将来若有人把标签栏
 * 挪进标题栏，点标签才不会变成拖窗口。
 */
import { t } from '../i18n/index.js'

defineProps({
  /** DocSession[]（只读渲染；数组顺序 = 显示顺序） */
  sessions: { type: Array, required: true },
  activeId: { type: String, default: '' },
})
const emit = defineEmits(['select'])

/**
 * 标签的语义状态。P1 只有 clean / dirty 两态；
 * error（保存失败）与 unsaved（未落盘）按 §4.9 的 MD-04 优先级在 P2 补。
 */
function stateOf(s) {
  return s.dirty ? 'dirty' : 'clean'
}
</script>

<template>
  <div class="tab-bar" role="tablist" :aria-label="t('tabbar.label')">
    <button
      v-for="s in sessions"
      :key="s.id"
      class="tab"
      :class="{ 'is-active': s.id === activeId }"
      type="button"
      role="tab"
      :aria-selected="s.id === activeId"
      :data-tab-id="s.id"
      :data-state="stateOf(s)"
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

.tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  max-width: 220px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--fg-2);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: default;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.tab:hover { background: var(--surface-2); color: var(--fg); }
.tab:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* 激活标签用「文档画布色」而不是强调色：标签栏是 chrome，一屏只该有一处
   强调（MEMORY 的样式偏好第 6 条同源纪律）。 */
.tab.is-active {
  background: var(--bg);
  color: var(--fg);
  font-weight: var(--weight-emphasize);
}

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
</style>
