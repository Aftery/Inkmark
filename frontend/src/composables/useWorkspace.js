// useWorkspace — 界面工作区状态：专注 / 侧栏 / 打字机 / 窗口置顶
// ----------------------------------------------------------------------------
// 从 App.vue 抽出（行为零变更）。这里只放「与文档内容无关的界面开关」：
// 任何会改动文档的开关（保存 / 导出 / 主题 / 缩放）都不属于本模块。
//
// 【阅读态已于 2026-10-14 整体移除】产品定位是 Typora 式单栏所见即所得，
// 渲染发生在编辑器内（见 editor/tableRender.js），独立的阅读态不再存在。

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { WindowSetAlwaysOnTop } from '../../wailsjs/runtime/runtime'
import { t } from '../i18n/index.js'

const TOP_KEY = 'inkmark-always-on-top'
const TYPEWRITER_KEY = 'inkmark-typewriter'
const FOCUS_HINT_KEY = 'inkmark-focus-hint'

// localStorage 在隐私模式 / 禁用 cookie 的 webview 里**访问即抛** SecurityError，
// 且一旦抛出就会打断 setup → 整个界面白屏。这几项都是「有更好、没有也能用」的
// 界面偏好，故全部降级为静默读写（与 themes/prefs.js 的内存兜底同一取向）。
function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // 存储不可用：仅本次会话内生效
  }
}

export function useWorkspace({ getEditor, notify }) {
  // 专注模式：叠加在编辑态上的「让位」——隐藏标题栏 / 侧栏 / 状态栏，只留正文。
  // 淡化本体在 createEditor.js（setFocusMode effect）。
  const focusOn = ref(false)
  const focusToast = ref(false)
  let focusToastTimer = null

  // 侧栏（文件 / 大纲 双 tab）。可见性不持久化：默认收起，打开文件夹自动展开。
  const sidebarOpen = ref(false)
  const sidebarTab = ref('files') // 'files' | 'outline'

  // 打字机模式与窗口置顶原先由原生菜单 checkbox 承载，菜单下线后
  // 偏好真源在前端 localStorage，窗口置顶直接调 Wails runtime。
  const typewriterOn = ref(readFlag(TYPEWRITER_KEY))
  const alwaysOnTop = ref(false)

  function toggleFocus() {
    if (focusOn.value) {
      focusOn.value = false
      getEditor()?.focus()
      return
    }
    focusOn.value = true
    getEditor()?.focus()
    // 首次进入给一次轻提示（之后不再打扰）
    if (!readFlag(FOCUS_HINT_KEY)) {
      writeFlag(FOCUS_HINT_KEY, true)
      focusToast.value = true
      focusToastTimer = setTimeout(() => (focusToast.value = false), 3000)
    }
  }

  function showSidebarTab(tab) {
    sidebarTab.value = tab
  }

  function toggleTypewriter() {
    typewriterOn.value = !typewriterOn.value
    writeFlag(TYPEWRITER_KEY, typewriterOn.value)
    notify?.(t(typewriterOn.value ? 'toast.typewriterOn' : 'toast.typewriterOff'))
  }

  function toggleAlwaysOnTop() {
    alwaysOnTop.value = !alwaysOnTop.value
    applyAlwaysOnTop(alwaysOnTop.value)
    writeFlag(TOP_KEY, alwaysOnTop.value)
  }

  function applyAlwaysOnTop(on) {
    try {
      WindowSetAlwaysOnTop(on)
    } catch {
      // 浏览器预览无窗口 runtime：仅切换界面态
    }
  }

  onMounted(() => {
    if (readFlag(TOP_KEY)) {
      alwaysOnTop.value = true
      applyAlwaysOnTop(true)
    }
  })
  onBeforeUnmount(() => clearTimeout(focusToastTimer))

  return {
    focusOn, focusToast, sidebarOpen, sidebarTab,
    typewriterOn, alwaysOnTop,
    toggleFocus, showSidebarTab,
    toggleTypewriter, toggleAlwaysOnTop,
  }
}
