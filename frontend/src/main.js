import { createApp } from 'vue'
import App from './App.vue'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { initTheme, getTheme, setPreference } from './themes/theme.js'
import { initPrefs } from './themes/prefs.js'
import { initI18n, setLocale, getLocale, onLocaleChange } from './i18n/index.js'

// 样式统一由 App.vue 引入 ./themes/index.css（token → base → preview）

// 主题初始化（必须在 Vue mount 之前）：解析偏好 → 写 <html data-theme> → 挂系统深浅监听。
// <html data-theme> 永远存已解析的具体主题（light|dark|paper），防首帧闪烁的内联脚本在 index.html。
initTheme()

// 排版偏好初始化（同样必须在 Vue mount 之前）：把字体/字号/行距/行宽的偏好落到
// <html> 内联变量。内联优先级高于 paper 主题的属性选择器（C1），且首帧前落好避免排版跳变。
initPrefs()

// 界面语言初始化（同样在 mount 之前）：把 prefs.locale 读进 i18n 的模块级 ref。
// 与 initTheme / initPrefs 同一防闪烁约定 —— 首帧就用最终语言渲染，
// 否则会先闪一下中文再切成目标语言。
// 注意·语言偏好的真源在 themes/prefs.js（第 7 项），这里只读不另存。
initI18n()

// 语言变更 → 通知 Go 侧重建原生菜单（菜单标签也走三语查表）。
// 必须放在 initI18n 之后：initI18n 会用当前偏好对齐一次 ref，但那不构成
// 「用户切换」，无需重建菜单。
//
// 为什么走 window.go 而不是静态 import：SetLocale 绑定由 Wails 在 Go 侧编译后
// 生成到 wailsjs/，若Go 侧尚未重新生成，静态 import 会拿到 undefined 并在
// 调用处抛错 —— setup 期抛错就是白屏（本项目已因 TDZ 犯过一次）。
// 故这里做可选链 + try/catch：绑定缺失时静默跳过，界面语言仍然立即生效，
// 只是原生菜单要等下次重新构建后才跟着变。
onLocaleChange((locale) => {
  try { window.go?.main?.App?.SetLocale?.(locale) } catch { /* 浏览器预览 / 绑定未生成 */ }
})

// 菜单「切换主题」（⌘⇧L）：在当前已解析主题的循环顺序 light → dark → paper → light 上
// 前进一步，并写入用户偏好（手动覆盖 > 跟随系统，之后停止跟随）。
// 走与 App.vue 相同的 safeEventsOn 守卫：浏览器预览下 window.runtime 不存在，
// 不守卫会炸掉 setup 整页白屏。
function safeEventsOn(name, handler) {
  if (window.runtime?.EventsOnMultiple) EventsOn(name, handler)
}
const THEME_CYCLE = ['light', 'dark', 'paper']
safeEventsOn('menu:toggle-theme', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(getTheme()) + 1) % THEME_CYCLE.length]
  setPreference(next)
})

createApp(App).mount('#app')
