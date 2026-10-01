/**
 * theme.js — Inkmark 三主题解析与持久化的唯一入口（Phase C · D-1）
 * ----------------------------------------------------------------------------
 * 设计契约见 docs/design/phaseC-visual-spec.md §1.6「跟随系统实现约定」：
 *
 *  - 持久化 key `inkmark-theme`，存**用户偏好**：'system' | 'light' | 'dark' | 'paper'，
 *    key 缺省视为 'system'（跟随系统是默认）。
 *  - <html data-theme> **永远存已解析的具体主题**（light|dark|paper），绝不存 'system'；
 *    CSS 侧不写 prefers-color-scheme 分支，解析在绘制前由 JS 完成。
 *  - 解析规则：偏好 ∈ {light,dark,paper} 直接落地；偏好 = system 时按
 *    matchMedia('(prefers-color-scheme: dark)') 解析为 dark 或 light（纸感永不自动选中）。
 *  - 优先级：**手动覆盖 > 跟随系统** —— matchMedia 监听只在偏好为 system 时生效，
 *    一旦用户 setPreference 选定具体主题，系统变化不再影响。
 *  - 切换只改 <html data-theme>，CSS 变量自动生效，**不重建编辑器**（AC-07）。
 *
 * 本模块不依赖 Vue / DOM 框架，可在 main.js 挂载前同步初始化。
 *
 * ⚠ 同步硬约束：index.html <head> 里的防闪烁内联脚本是本模块解析规则的
 * **第二份实现**（首帧前无法等 JS 加载）。任一侧改动解析规则/持久化 key，
 * 必须同步另一侧，否则首帧闪跳。
 */

const STORAGE_KEY = 'inkmark-theme'

/** 偏好合法值（含 system） */
const PREFERENCES = ['system', 'light', 'dark', 'paper']
/** 可落地的具体主题 */
const THEMES = ['light', 'dark', 'paper']

/** 主题切换监听器集合（回调收到已解析的具体主题） */
const listeners = new Set()
/** 系统深浅变化监听是否已挂 */
let systemWatched = false

function isTheme(v) {
  return THEMES.includes(v)
}

/** 读用户偏好；非法值 / 存储不可用一律回落 'system'（fail safe） */
export function getPreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return PREFERENCES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** 系统是否偏好深色（matchMedia 不存在时按浅色处理） */
function systemPrefersDark() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 偏好 → 已解析的具体主题 */
export function resolveTheme(pref = getPreference()) {
  if (isTheme(pref)) return pref
  return systemPrefersDark() ? 'dark' : 'light'
}

/** 当前已解析主题（light | dark | paper）——导出/渲染侧一律取这个，不取偏好 */
export function getTheme() {
  return resolveTheme()
}

function applyTheme(resolved) {
  document.documentElement.dataset.theme = resolved
}

function notifyListeners(resolved) {
  listeners.forEach((cb) => {
    try {
      cb(resolved)
    } catch (e) {
      // 单个监听器异常不得阻断其他监听器与主题生效
      console.error('[theme] onThemeChange 回调异常', e)
    }
  })
}

function applyAndNotify() {
  const resolved = resolveTheme()
  applyTheme(resolved)
  notifyListeners(resolved)
}

/**
 * 设置用户偏好并立即落地。
 * 接受 'system'（恢复跟随）或具体主题；非法值静默忽略（返回当前偏好）。
 * 一旦写入具体主题，即完成「手动覆盖」，matchMedia 变化不再影响（AC-08）。
 */
export function setPreference(preference) {
  if (!PREFERENCES.includes(preference)) return getPreference()
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // 存储不可用时仍应用本次选择（不持久化），不抛错阻断 UI
  }
  applyAndNotify()
  return preference
}

/** 订阅主题变化；返回取消订阅函数。回调参数为已解析的具体主题 */
export function onThemeChange(cb) {
  if (typeof cb !== 'function') return () => {}
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 监听系统深浅变化：仅当偏好为 system 时重解析（手动覆盖优先，AC-08） */
function watchSystemTheme() {
  if (systemWatched) return
  systemWatched = true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getPreference() === 'system') applyAndNotify()
  }
  // Safari 14+ 支持 addEventListener；老 API addListener 兜底
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
  else if (typeof mql.addListener === 'function') mql.addListener(onChange)
}

/**
 * 初始化：解析偏好 → 写 <html data-theme> → 挂系统变化监听。
 * 必须在 Vue mount 之前调用（首帧前落好属性，避免闪白）。
 */
export function initTheme() {
  applyAndNotify()
  watchSystemTheme()
}
