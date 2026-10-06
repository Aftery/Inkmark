// usePrefs.js — 排版偏好 / 主题 / 视图缩放的响应式入口
// ----------------------------------------------------------------------------
// 定位：themes/prefs.js 与 themes/theme.js 的【薄封装】，不是第二套真源。
// 持久化、校验、CSS 变量落地全部复用既有单一真源，本层只做三件事：
//   1) 把命令式 API 变成响应式状态（模块级单例，多处消费共享同一份）；
//   2) 提供 cycleTheme / changeZoom 两个交互动词；
//   3) 缩放同时写 --zoom-scale（预览/阅读侧 CSS）与编辑器 Compartment
//      （编辑区侧），两处都不重建编辑器。
//
// 【为什么变量名沿用既有契约，而不是新造 --font-size-user】
//   - 字号必须【成对】写 --text-base（编辑区）与 --text-md（预览区），
//     两者不等会导致两处文字错位（C2 不变量，prefs.js 头注）；
//   - 行宽走 --preview-measure / --reading-measure，paper 主题正是用
//     属性选择器覆写后者来收窄纸面行宽的 —— 新造一个 --line-width-user
//     会绕开这套机制，paper 主题的排版身份就丢了；
//   - 全部写 <html> 内联样式（C1）：写进样式表会被 [data-theme="paper"]
//     静默压掉，且不报错。
//   - --zoom-scale 与基础字号【正交】（C3），本模块是它的唯一写入者。
//
// 【单一写入者纪律】
//   --zoom-scale 由本模块唯一写入。App.vue 不得再用 :style 绑定同一个变量
//   （两个写入者会让切换时出现跳变，且失效方向不可预测）。

import { ref } from 'vue'
import { getPrefs, onPrefsChange, setPref as setPrefRaw } from '../themes/prefs.js'
import {
  getPreference, resolveTheme, setPreference, onThemeChange,
} from '../themes/theme.js'
import { setEditorZoom } from '../editor/createEditor.js'

// 缩放档位：80%~150%，步进 10。独立持久化 key —— 缩放是**视图状态**而非文档
// 排版，不并入 prefs 的 7 项 schema（避免给既有校验表加字段引发面板联动改动）。
const ZOOM_KEY = 'inkmark-zoom'
const ZOOM_MIN = 80
const ZOOM_MAX = 150
const ZOOM_STEP = 10

// 主题循环顺序：system → light → dark → paper → system
const THEME_CYCLE = ['system', 'light', 'dark', 'paper']

/** 读上次缩放；非法值 / 存储不可用一律回落 100（fail safe） */
function readZoom() {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY))
    return Number.isInteger(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 100
  } catch {
    return 100
  }
}

function createUsePrefs(getEditor) {
  // ---- 排版偏好：快照式响应（真值在 prefs.js，通知时整体刷新快照） ----
  const prefs = ref(getPrefs())
  onPrefsChange((p) => { prefs.value = p })

  // ---- 主题：偏好档位 + 已解析的具体主题（data-theme 永远存后者） ----
  // themePref 每次 cycle 都现读 getPreference()（SettingsPanel 可能直接调
  // setPreference，缓存会过期）；resolvedTheme 由 theme.js 的通知驱动。
  const themePref = ref(getPreference())
  const resolvedTheme = ref(resolveTheme())
  onThemeChange((resolved) => { resolvedTheme.value = resolved })

  // ---- 缩放：--zoom-scale + 编辑器 Compartment 的唯一写入方 ----
  const zoom = ref(readZoom())

  // 模块初始化阶段**刻意不碰编辑器**（editorToView 返回 null）。
  // 原因：App.vue 顶部的 usePrefs() 在 onMounted 之前执行，此刻编辑器实例
  // 尚未创建；若无条件读 getEditor()，会命中 App.vue 里 `let editor` 的暂时性死区
  // （ReferenceError: Cannot access 'editor' before initialization → 白屏）。
  // 编辑器侧的缩放在 createEditor 之后由 syncZoomToEditor() 补一次。
  // 【不要用 try/catch 包住 getEditor()】—— 那会把 TDZ 这类真错误一起吞掉，
  // 表现为「兜底成功、实际白屏或行为异常」，是本仓最怕的假绿灯形态。
  function editorToView() {
    if (typeof getEditor !== 'function') return null
    return getEditor() || null
  }

  /** 把当前缩放同步到编辑器 Compartment（编辑器就绪后调用一次） */
  function syncZoomToEditor() {
    const view = editorToView()
    if (view) setEditorZoom(view, zoom.value / 100)
  }

  function applyZoom(level, { persist = true } = {}) {
    zoom.value = level
    const scale = level / 100
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--zoom-scale', String(scale))
    }
    // 编辑器侧是独立的 Compartment（createEditor.js），只重配字体缩放、不重建实例
    const view = editorToView()
    if (view) setEditorZoom(view, scale)
    if (persist) {
      try {
        localStorage.setItem(ZOOM_KEY, String(level))
      } catch {
        // 存储不可用（隐私模式 / 配额满）：本次会话仍已生效，只是不持久化
      }
    }
  }

  // 初始化：只把上次缩放落到 CSS 变量（编辑器此时必然还不存在）
  applyZoom(zoom.value, { persist: false })

  /** 步进缩放，自动夹在 [80, 150]；返回生效后的档位 */
  function changeZoom(step = ZOOM_STEP) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value + step))
    if (next !== zoom.value) applyZoom(next)
    return next
  }

  function resetZoom() {
    applyZoom(100)
    return 100
  }

  function setTheme(preference) {
    setPreference(preference)
    themePref.value = preference
  }

  /** 循环切换主题；'system' 会先被解析成具体明暗色再前进 */
  function cycleTheme() {
    const cur = getPreference()
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length]
    setTheme(next)
    return next
  }

  function setPref(key, value) { return setPrefRaw(key, value) }

  return {
    prefs, themePref, resolvedTheme, zoom,
    setPref, setTheme, cycleTheme, changeZoom, resetZoom, syncZoomToEditor,
  }
}

// 模块级单例：标题栏 / 设置面板 / 状态栏多处消费同一份状态。
// getEditor 是延迟求值的函数 —— 编辑器在 onMounted 才创建，先期调用不报错。
let singleton = null
export function usePrefs(getEditor) {
  if (!singleton) singleton = createUsePrefs(getEditor)
  return singleton
}
