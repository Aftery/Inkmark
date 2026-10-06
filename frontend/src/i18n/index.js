/**
 * i18n/index.js — Inkmark 界面文案唯一真源
 * ----------------------------------------------------------------------------
 * 契约见 docs/spec/SPEC-i18n-v1.md §2.1 / §2.2。
 *
 * 【零新增依赖】不引 vue-i18n / intl-msgs。文案总量约 150~200 条，
 * 一个 t(key, params) + 三份字典足够；引库还会与「design-tokens 是样式唯一
 * 真源」形成另一种真源分裂（Spec §2 技术选型）。
 *
 * 【与既有设施的关系】
 *  - 语言偏好的**持久化真源在 themes/prefs.js**（第7 项 `locale`）。
 *    本模块不另建 localStorage —— 两套持久化机制必然漂移。
 *    做法：initI18n() 读 prefs 的当前值，之后订阅 onPrefsChange。
 *    因此 setLocale() 转写成 setPref('locale', ...) —— 一次写入、全链通知。
 *  - 与 themes/theme.js 同为「mount 前可同步初始化」的模块，故不依赖
 *    DOM，可在 main.js 里 initTheme() 之后立刻落定（首帧前，见 AC-01）。
 *
 * 【t() 永不抛错 —— 本项目对 setup 期抛错零容忍】
 * 缺 key 时返回 key 原文 + console.warn，**绝不抛错、绝不返回空串**：
 *   - 抛错 → setup 期异常 → Vue 树不渲染 → 整页白屏（本项目已发生过TDZ 白屏）；
 *   - 空串 → 界面出现无文字的空洞，比报错更难排查。
 * 详见 Spec §7 坑 1。
 */

import { ref, computed } from 'vue'
import { getPref, setPref, onPrefsChange, PREF_OPTIONS } from '../themes/prefs.js'
import zhCN from './zh-CN.js'
import enUS from './en-US.js'
import jaJP from './ja-JP.js'

/** 支持的语言 -> 字典。key 集合必须三份一致（由测试保证，AC-05） */
const DICTIONARIES = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
}

/** 基准语言：缺 key 时的二级回落（与 Go 侧 t() 的回退链一致） */
const FALLBACK_LOCALE = 'zh-CN'

/**
 * 三档显示名，**每种语言用自己语言写自己的名字**（Spec §2.2）。
 *
 * 这是刻意不从字典里取：语言名是专名而非待翻译的文案 ——
 * 用户在 en-US 界面下仍应看到「简体中文」而不是 "Chinese (Simplified)"，
 * 否则切换目标语言时得先认字才能认语言。
 *
 * 取值（value）顺序取自 PREF_OPTIONS.locale（prefs 的唯一真源），
 * 本表只补显示名 —— 免得两处各写一份 locale 列表、加第四种语言时漏改一处。
 */
const LOCALE_LABELS = {
  'zh-CN': '简体中文',
  'en-US': 'English',
  'ja-JP': '日本語',
}

export const LOCALE_OPTIONS = PREF_OPTIONS.locale.map((value) => ({
  value,
  label: LOCALE_LABELS[value] || value,
}))

/** 当前语言（模块级 ref —— 单一真源，组件通过 useI18n() 订阅） */
const locale = ref('zh-CN')

/** 语言变更监听器（SettingsPanel 切语言后要通知 Go 侧重建菜单） */
const listeners = new Set()

/** prefs 订阅的取消函数（initI18n 只装一次，避免重复订阅导致多次刷新） */
let offPrefs = null

function isSupported(v) {
  return typeof v === 'string' && Object.hasOwn(DICTIONARIES, v)
}

/** 当前语言的字典；不支持的 locale 回落基准语言 */
function dictOf(loc) {
  return DICTIONARIES[loc] || DICTIONARIES[FALLBACK_LOCALE]
}

/**
 * 翻译。
 * @param {string} key形如 'toolbar.bold'
 * @param {Record<string, string|number>} [params] 占位符值，如 { line: 12 }
 * @returns {string} 译文；缺 key 时返回 key 原文（永不抛错、永不返回空串）
 */
export function t(key, params) {
  // 兜底 try/catch：t() 被模板与 setup 顶层直接调用，
  // 任何异常都会打断渲染。这里宁可返回 key 也不让界面崩。
  try {
    const dict = dictOf(locale.value)
    let s = dict[key]
    if (typeof s !== 'string') {
      // 二级回落：非基准语言缺 key 时借基准语言（与 Go 侧回退链一致）
      const fb = DICTIONARIES[FALLBACK_LOCALE]
      s = fb[key]
      if (typeof s !== 'string') {
        console.warn(`[i18n] 缺 key: ${key}（locale=${locale.value}）`)
        return key
      }
    }
    if (!params) return s
    // 占位符 {name} 串替换。刻意不用正则回溯替换之外的方案：
    // 未命中的占位符原样保留，便于发现占位符名拼错。
    return s.replace(/\{(\w+)\}/g, (m, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : m
    )
  } catch (e) {
    console.warn('[i18n] t() 异常，回退为 key 原文', key, e)
    return key
  }
}

/** 读当前语言 */
export function getLocale() {
  return locale.value
}

/**
 * 切换语言：一次写入 + 一次全链通知（Spec §3 单次事务原则）。
 * 内部转写 setPref('locale', …) → localStorage 与 prefs 订阅者同步更新，
 * 本模块再由onPrefsChange 收到通知刷新 ref 并通知自己的监听器。
 * 非法值静默忽略（返回当前语言），与 prefs.setPref 的既有约定一致。
 */
export function setLocale(next) {
  if (!isSupported(next)) return getLocale()
  // 已是当前语言：不再触发一次「写入 + 重建菜单」（避免无谓的菜单闪烁）
  if (next === locale.value) return getLocale()
  return setPref('locale', next)
}

/** 订阅语言变化；返回取消订阅函数。回调参数为新语言 */
export function onLocaleChange(cb) {
  if (typeof cb !== 'function') return () => {}
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notifyListeners(next) {
  listeners.forEach((cb) => {
    try {
      cb(next)
    } catch (e) {
      // 单个监听器异常不得阻断其他监听器与语言生效（同 prefs.js / theme.js 的处理）
      console.error('[i18n] onLocaleChange 回调异常', e)
    }
  })
}

/**
 * Vue composable：返回 { t, locale }。
 * `locale` 是 readonly computed —— 组件里写locale.value 之外的东西没有意义，
 * 改语言只能走 setLocale（否则会绕过持久化与 Go 菜单重建）。
 */
export function useI18n() {
  return { t, locale: computed(() => locale.value) }
}

/**
 * 初始化：把 prefs 里的语言偏好读进 ref，并挂上订阅。
 * 必须在 Vue mount 之前调用（与 initTheme / initPrefs 同一防闪烁约定）。
 * 重复调用安全（只装一次 prefs 订阅）。
 */
export function initI18n() {
  const stored = getPref('locale')
  locale.value = isSupported(stored) ? stored : FALLBACK_LOCALE
  if (offPrefs) return
  // 语言偏好的真源在 prefs.js：任何一环改了 locale（设置面板、
  // 「恢复默认」resetPrefs）都会走到这里，故界面与 Go 菜单同步刷新。
  offPrefs = onPrefsChange((p) => {
    if (!isSupported(p.locale) || p.locale === locale.value) return
    locale.value = p.locale
    notifyListeners(locale.value)
  })
}