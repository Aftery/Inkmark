import { createApp } from 'vue'
import App from './App.vue'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { SetLocale } from '../wailsjs/go/main/App'
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
// 为什么用静态 import 而非 window.go —— 生成绑定本身就是
// window['go']['main']['App'][...] 的薄封装（wailsjs/go/main/App.js），
// 两者指向同一个对象，但静态 import 的失败模式更好：绑定缺失时会在
// 模块加载阶段就暴露，而不是 `window.go?.App?.SetLocale?.()` 静默跳过
// → 出现「界面已换语言、原生菜单没换、无人察觉」的隐性问题。
//
// try/catch 仍必须保留：浏览器预览（npm run dev + 无头浏览器）下
// window.go 确实不存在，静态 import 的函数体执行会抛 —— 而这里在
// Vue mount 之前，抛错就是白屏（本项目已因 const TDZ 犯过一次）。
onLocaleChange((locale) => {
  try { SetLocale(locale) } catch { /* 浏览器预览：窗口侧无 runtime */ }
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
