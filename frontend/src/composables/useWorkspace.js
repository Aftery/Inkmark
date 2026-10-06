// useWorkspace — 界面工作区状态：视图两态 / 专注 / 侧栏 / 打字机 / 窗口置顶
// ----------------------------------------------------------------------------
// 从 App.vue 抽出（行为零变更）。这里只放「与文档内容无关的界面开关」：
// 任何会改动文档的开关（保存 / 导出 / 主题 / 缩放）都不属于本模块。
//
// 【为什么 setViewMode 里没有 requestMeasure】
// 切回编辑态需要 editor.requestMeasure() + 大纲度量失效，两者都是
// 「大纲 / 度量」职责，由 useOutline 自己 watch(viewMode) 完成（见其文件）。
// 本模块若反向依赖大纲层就会形成环：useOutline 需要 viewMode，本模块又需要它。

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { WindowSetAlwaysOnTop } from '../../wailsjs/runtime/runtime'
import { t } from '../i18n/index.js'

const TOP_KEY = 'inkmark-always-on-top'
const TYPEWRITER_KEY = 'inkmark-typewriter'
const FOCUS_HINT_KEY = 'inkmark-focus-hint'

export function useWorkspace({ getEditor, notify }) {
  // 视图两态：'edit'（单栏写作）| 'reading'（专注阅读，隐藏全部 chrome）
  const viewMode = ref('edit')
  const readingFrom = ref(null)

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
  const typewriterOn = ref(localStorage.getItem(TYPEWRITER_KEY) === '1')
  const alwaysOnTop = ref(false)

  function setViewMode(mode) {
    viewMode.value = mode
    if (mode !== 'reading') readingFrom.value = null
  }

  function toggleReading() {
    if (viewMode.value === 'reading') {
      setViewMode(readingFrom.value || 'edit')
      return
    }
    readingFrom.value = viewMode.value
    setViewMode('reading')
  }

  function toggleFocus() {
    if (focusOn.value) {
      focusOn.value = false
      getEditor()?.focus()
      return
    }
    focusOn.value = true
    if (viewMode.value !== 'edit') setViewMode('edit')
    getEditor()?.focus()
    // 首次进入给一次轻提示（之后不再打扰）
    if (localStorage.getItem(FOCUS_HINT_KEY) !== '1') {
      localStorage.setItem(FOCUS_HINT_KEY, '1')
      focusToast.value = true
      focusToastTimer = setTimeout(() => (focusToast.value = false), 3000)
    }
  }

  function showSidebarTab(tab) {
    sidebarTab.value = tab
  }

  function toggleTypewriter() {
    typewriterOn.value = !typewriterOn.value
    localStorage.setItem(TYPEWRITER_KEY, typewriterOn.value ? '1' : '0')
    notify?.(t(typewriterOn.value ? 'toast.typewriterOn' : 'toast.typewriterOff'))
  }

  function toggleAlwaysOnTop() {
    alwaysOnTop.value = !alwaysOnTop.value
    applyAlwaysOnTop(alwaysOnTop.value)
    localStorage.setItem(TOP_KEY, alwaysOnTop.value ? '1' : '0')
  }

  function applyAlwaysOnTop(on) {
    try {
      WindowSetAlwaysOnTop(on)
    } catch {
      // 浏览器预览无窗口 runtime：仅切换界面态
    }
  }

  onMounted(() => {
    if (localStorage.getItem(TOP_KEY) === '1') {
      alwaysOnTop.value = true
      applyAlwaysOnTop(true)
    }
  })
  onBeforeUnmount(() => clearTimeout(focusToastTimer))

  return {
    viewMode, readingFrom, focusOn, focusToast, sidebarOpen, sidebarTab,
    typewriterOn, alwaysOnTop,
    setViewMode, toggleReading, toggleFocus, showSidebarTab,
    toggleTypewriter, toggleAlwaysOnTop,
  }
}
