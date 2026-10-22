<script setup>
/**
 * StatusBar —— 底部状态栏（26px，视觉规格 §3）
 * ----------------------------------------------------------------------------
 * 【Typora 化：默认不占屏，但关键反馈绝不消失】
 * 产品向 Typora 靠拢（一条细标题栏 + 默认只有正文），故本栏**默认不显示**。
 * 「让一项能力从界面上消失」是本仓最忌讳的形态，所以隐藏必须**可逆且可发现**：
 *   ① 保存失败 / 表格未渲染提示 → **自动浮现**并常驻到问题消失（静默失败的唯一明示）；
 *   ② 慢保存（超过 SAVING_SURFACE_DELAY_MS）→ 浮现一次，避免「是不是卡住了」；
 *   ③ 缩放变化（⌘= / ⌘- / ⌘0）→ 短暂浮现百分比作为回执；
 *   ④ 找回入口：本栏右端的「自动 / 常显」档位按钮（栏可见时）+ 标题栏
 *      「视图 ▸ 状态栏」菜单项（栏不可见时也能点到）—— 存 localStorage，跨会话生效。
 * 也就是说：**默认隐藏，但永远有两条找回的路**，且两条都写同一份偏好。
 *
 * 三态表达与 i18n 契约不变：
 *   左 = 保存态三态（图标形状 + 文案 + 颜色三重表达，AC-20）。
 *   右 = 缩放；行列 / 字数只在用户明确「常显」时出现 —— 临时浮现只报「刚发生了什么」，
 *        不铺一排常驻数字（那正是 Typora 化要砍掉的噪声）。
 * chrome 字体用 --font-ui（纸感主题下外壳仍无衬线，坑 9）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './icons/AppIcon.vue'
import { t } from '../i18n/index.js'
import { tableHint } from '../composables/useTableHint.js'
import {
  SAVING_SURFACE_DELAY_MS, STATUS_HOLD_MS, shouldSurfaceStatus,
  statusbarPinned, toggleStatusbarPinned,
} from '../composables/useChrome.js'

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

// 「表格没渲染」提示：模块级单例（composables/useTableHint），
// 不经 props 传入 —— App.vue 是 ≤150 行硬上限的装配层，不为它加行。
// 常驻显示而非 toast：这是「用户没察觉」的静默失败，提示必须不消失。
const hintText = computed(() =>
  tableHint.value ? t('statusbar.tableHint', { line: tableHint.value.line }) : ''
)

// ---- 浮现控制（两种来源：常显档开关 / 关键态临时浮现）----
const holdOpen = ref(false)
let holdTimer = null
let savingTimer = null

/** 浮现并至少停留 STATUS_HOLD_MS —— 只闪几十毫秒的反馈肉眼抓不到，等于没做 */
function flash() {
  clearTimeout(holdTimer)
  holdOpen.value = true
  holdTimer = setTimeout(() => { holdTimer = null; holdOpen.value = false }, STATUS_HOLD_MS)
}

/** 必须一直亮着（错误 / 表格提示）：不计时，直到条件消失才转入 flash 收尾 */
const mustSurface = computed(() => shouldSurfaceStatus({
  saveState: props.status,
  hasHint: !!tableHint.value,
}))

watch(mustSurface, (need) => {
  if (need) {
    clearTimeout(holdTimer)
    holdTimer = null
    holdOpen.value = true
  } else if (holdOpen.value) {
    flash() // 问题已解决：让「已保存 / 提示消失」再停留一小会儿
  }
}, { immediate: true })

// 慢保存才浮现：800ms 防抖后的整文件写入常常只有几十毫秒，
// 每次都闪一下底部 = 纯噪声（正是要砍掉的东西）。失败不受此限，见 mustSurface。
watch(() => props.status, (s) => {
  clearTimeout(savingTimer)
  savingTimer = null
  if (s === 'saving') {
    savingTimer = setTimeout(() => {
      savingTimer = null
      if (props.status === 'saving') flash()
    }, SAVING_SURFACE_DELAY_MS)
  }
})

// 缩放回执：⌘= / ⌘- / ⌘0 按下去要看得见百分比变了
watch(() => props.zoom, () => flash())

const visible = computed(() => statusbarPinned.value || holdOpen.value)
onBeforeUnmount(() => {
  clearTimeout(holdTimer)
  clearTimeout(savingTimer)
})

const lineCol = computed(() => t('statusbar.lineCol', { line: props.line, col: props.col }))
const wordsText = computed(() => t('statusbar.words', { count: props.words.toLocaleString() }))
const pinTitle = computed(() => t(statusbarPinned.value ? 'statusbar.unpin' : 'statusbar.pin'))
</script>

<template>
  <footer class="statusbar" :class="[meta.cls, { 'is-veiled': !visible }]">
    <span class="sb-save" role="status">
      <AppIcon :name="meta.icon" size="inline" :label="meta.text.replace(/…$/, '')" />
      <span>{{ meta.text }}</span>
    </span>

    <!-- 表格未渲染提示：常驻直到改对，故给 role=status 让读屏器也能听到 -->
    <span v-if="hintText" class="sb-hint" role="status">{{ hintText }}</span>

    <span class="sb-spring" aria-hidden="true"></span>

    <!-- 行列 / 字数：只在用户明确「常显」时出现（临时浮现只报刚发生的事） -->
    <template v-if="statusbarPinned">
      <span class="sb-item sb-num">{{ lineCol }}</span>
      <span class="sb-dot" aria-hidden="true">·</span>
      <span class="sb-item sb-num">{{ wordsText }}</span>
      <span class="sb-dot" aria-hidden="true">·</span>
    </template>

    <button
      class="sb-item sb-zoom sb-num"
      type="button"
      :title="t('statusbar.zoomTitle')"
      @click="$emit('zoom')"
    >{{ zoom }}%</button>

    <!-- 档位切换：栏可见时的就地出口（栏不可见时的出口在标题栏「视图」菜单） -->
    <button
      class="sb-item sb-pin"
      type="button"
      :title="pinTitle"
      :aria-label="pinTitle"
      :aria-pressed="statusbarPinned"
      @click="toggleStatusbarPinned"
    >{{ t(statusbarPinned ? 'statusbar.always' : 'statusbar.auto') }}</button>
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

/* 收起：连布局一起让出来（display:none 才真把 26px 还给正文）。
   App.vue 的 v-show（专注模式）用**内联** display 覆盖，优先级更高，两者不冲突。 */
.statusbar.is-veiled { display: none; }

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

/* 表格未渲染提示：warn 色 + 与保存态留间距，常驻不消失 */
.sb-hint {
  color: var(--warn);
  margin-left: var(--space-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

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

/* 档位切换：极淡，避免自己成为一条新的常驻噪声（hover / 键盘聚焦时点亮） */
.sb-pin {
  margin-left: var(--space-3);
  padding: 0 var(--space-1);
  border: none;
  background: transparent;
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-small);
  color: var(--meta);
  cursor: pointer;
  transition: color var(--motion-fast) var(--ease-standard);
}
.sb-pin:hover { color: var(--fg); }
.sb-pin:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }

/* 打印：本组件的 scoped 规则（App.vue 的全局规则是第二道，两份都在才保险） */
@media print {
  .statusbar { display: none !important; }
}
</style>
