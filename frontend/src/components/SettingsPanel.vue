<script setup>
/**
 * SettingsPanel — 设置面板（排版 / 主题 / 编辑器行为）
 * ----------------------------------------------------------------------------
 * 纯展示 + 事件抛发：偏好读写全部经 themes/prefs.js（唯一真源），主题切换经
 * themes/theme.js（既有 4 档 API）。可见性由父级 v-if 控制（关闭即卸载）。
 * 关闭与焦点回收在父级（App.vue 的 onGlobalKeydown Esc 分支）。
 *
 * 布局：居中弹层（宽 min(560,92vw) / 高 ≤72vh），左侧 120px 分类栏 + 右内容区；
 * 每项一行：左标题 + 灰字说明，右分段控件；项间 1px --border-soft 分隔。
 * 视觉全部走 Token：底 --surface / 描边 --border / 圆角 --radius-lg /
 * 阴影 --elev-raised / 焦点环 --focus-ring。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import SegmentedControl from './SegmentedControl.vue'
import { getPref, getPrefs, setPref, resetPrefs, onPrefsChange } from '../themes/prefs.js'
import { getPreference, setPreference, onThemeChange } from '../themes/theme.js'

const emit = defineEmits(['close'])

const panelEl = ref(null)

// 主题偏好走 theme.js；其余走 prefs.js。两者各自订阅，外部改动（⌘⇧L / 恢复默认）都能回显。
const prefs = ref(getPrefs())
const themePref = ref(getPreference())
const offPrefs = onPrefsChange((p) => (prefs.value = p))
const offTheme = onThemeChange(() => (themePref.value = getPreference()))
onBeforeUnmount(() => { offPrefs(); offTheme() })

const CATEGORIES = [
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
]
const tab = ref('appearance')

// ---- 控件选项（值与 prefs.js / theme.js 白名单严格一致） ----
const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'paper', label: '纸感' },
]
const FONT_FAMILY_OPTIONS = [
  { value: 'system', label: '系统' },
  { value: 'serif', label: '衬线' },
  { value: 'mono', label: '等宽' },
]
const FONT_SIZE_OPTIONS = [12, 14, 15, 16, 18, 20].map((n) => ({ value: n, label: String(n) }))
const LINE_HEIGHT_OPTIONS = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'loose', label: '宽松' },
]
const MEASURE_OPTIONS = [
  { value: 'narrow', label: '窄' },
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽' },
]
const AUTOSAVE_OPTIONS = [
  { value: 0, label: '关' },
  { value: 800, label: '0.8 秒' },
  { value: 2000, label: '2 秒' },
  { value: 5000, label: '5 秒' },
]
const SNAPSHOT_OPTIONS = [
  { value: 0, label: '关' },
  { value: 180000, label: '3 分钟' },
  { value: 600000, label: '10 分钟' },
  { value: 1800000, label: '30 分钟' },
]

// 每项：label/desc + 当前值 getter + 变更 setter（值变更经响应式 prefs / themePref 回显）
const ROWS = {
  appearance: [
    { key: 'theme', label: '主题', desc: '界面配色', options: THEME_OPTIONS, get: () => themePref.value, set: (v) => setPreference(v) },
    { key: 'fontFamily', label: '正文字体', desc: '编辑与预览共用', options: FONT_FAMILY_OPTIONS, get: () => prefs.value.fontFamily, set: (v) => setPref('fontFamily', v) },
    { key: 'fontSize', label: '正文字号', desc: '两栏同步', options: FONT_SIZE_OPTIONS, get: () => prefs.value.fontSize, set: (v) => setPref('fontSize', v) },
    { key: 'lineHeight', label: '行距', desc: '正文行高', options: LINE_HEIGHT_OPTIONS, get: () => prefs.value.lineHeight, set: (v) => setPref('lineHeight', v) },
    { key: 'measure', label: '行宽', desc: '预览正文宽度', options: MEASURE_OPTIONS, get: () => prefs.value.measure, set: (v) => setPref('measure', v) },
  ],
  editor: [
    { key: 'autosave', label: '自动保存', desc: '停手后自动落盘', options: AUTOSAVE_OPTIONS, get: () => prefs.value.autosave, set: (v) => setPref('autosave', v) },
    { key: 'snapshot', label: '快照间隔', desc: '关后仅手动快照', options: SNAPSHOT_OPTIONS, get: () => prefs.value.snapshot, set: (v) => setPref('snapshot', v) },
  ],
}
const rows = computed(() => ROWS[tab.value] ?? [])

// ---- 恢复默认（二次确认） ----
const resetArmed = ref(false)
let disarmTimer = null

function onResetClick() {
  if (!resetArmed.value) {
    resetArmed.value = true
    clearTimeout(disarmTimer)
    disarmTimer = setTimeout(() => (resetArmed.value = false), 4000)
    return
  }
  clearTimeout(disarmTimer)
  resetArmed.value = false
  resetPrefs() // 逐项 removeProperty + 清 localStorage → 实时回到出厂值
}

onBeforeUnmount(() => clearTimeout(disarmTimer))

// 打开时焦点移入面板（第一个可聚焦控件）；关闭后的焦点回收由父级负责
onMounted(() => {
  nextTick(() => panelEl.value?.querySelector('button')?.focus())
})
</script>

<template>
  <div class="settings-mask" @click.self="emit('close')">
    <div ref="panelEl" class="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
      <div class="settings-body">
        <nav class="settings-nav" aria-label="设置分类">
          <button
            v-for="cat in CATEGORIES"
            :key="cat.id"
            class="settings-nav-item"
            :class="{ active: tab === cat.id }"
            type="button"
            :aria-current="tab === cat.id ? 'true' : undefined"
            @click="tab = cat.id"
          >{{ cat.label }}</button>
        </nav>

        <div class="settings-content">
          <div v-for="row in rows" :key="row.key" class="settings-row">
            <div class="settings-info">
              <p class="settings-label">{{ row.label }}</p>
              <p class="settings-desc">{{ row.desc }}</p>
            </div>
            <SegmentedControl
              class="settings-control"
              :model-value="row.get()"
              :options="row.options"
              :aria-label="row.label"
              @update:model-value="row.set"
            />
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="settings-btn" type="button" @click="onResetClick">
          {{ resetArmed ? '确认恢复默认？' : '恢复默认' }}
        </button>
        <button class="settings-btn primary" type="button" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-mask {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--fg) 18%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1400; /* 对话框层（history 1200 / toast 1300 之上） */
}
.settings-panel {
  width: min(560px, 92vw);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-raised);
  overflow: hidden;
}
.settings-body { display: flex; flex: 1; min-height: 0; }

/* ---- 左分类栏 ---- */
.settings-nav {
  width: 120px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  border-right: 1px solid var(--border-soft);
}
.settings-nav-item {
  min-height: 32px;
  padding: 0 var(--space-3);
  text-align: left;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}
.settings-nav-item:hover { background: var(--surface-2); color: var(--fg); }
/* 激活态用底色 + 字重区分，不占 --accent 预算 */
.settings-nav-item.active { background: var(--surface-2); color: var(--fg); font-weight: var(--weight-emphasize); }
.settings-nav-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* ---- 右内容区 ---- */
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-4);
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-soft);
}
.settings-row:last-child { border-bottom: none; }
.settings-info { min-width: 0; }
.settings-label {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}
.settings-desc {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-ui);
  color: var(--muted);
}
.settings-control { flex-shrink: 0; }

/* ---- 底部操作区 ---- */
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-soft);
}
.settings-btn {
  min-height: 32px;
  padding: 0 var(--space-4);
  background: var(--surface-2);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}
.settings-btn:hover { background: var(--accent-soft); border-color: var(--border-strong); }
.settings-btn.primary { background: var(--accent); color: var(--accent-on); border-color: var(--accent); }
.settings-btn.primary:hover { filter: brightness(1.05); }
.settings-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* 打印只输出正文：面板与遮罩一并隐藏（AC-06，与 App.vue 的 @media print 同一处理） */
@media print {
  .settings-mask { display: none !important; }
}
</style>
