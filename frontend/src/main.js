import { createApp } from 'vue'
import App from './App.vue'
import { initTheme } from './themes/theme.js'
import { initPrefs } from './themes/prefs.js'
import { initI18n } from './i18n/index.js'
import { initPlatform } from './composables/usePlatform.js'

// 样式统一由 App.vue 引入 ./themes/index.css（token → base → preview → app-shell → platform-darwin）

// 平台识别（mount 之前发起）：composables/usePlatform.js 内部先做 navigator
// 同步初判保证首帧布局正确，再用 Wails Environment() 权威确认；
// 结论落到 <html data-platform>，macOS 毛玻璃 CSS（platform-darwin.css）据此生效。
// 异步但不必 await：同步初判已经够用，确认到达后各消费方（TitleBar 的窗口
// 按钮、CSS 适配层）会自动重算。
initPlatform()

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

// 【2026-10-06 单栏重构：原生菜单下线后的启动路径简化】
// 本文件此前还有两处与原生菜单耦合的逻辑，现已整体删除：
//
//  1) onLocaleChange → SetLocale(locale)：把语言同步给 Go 侧，
//     好让 RefreshMenu 重建出另一种语言的原生菜单。菜单既已下线，
//     Go 侧不再持有语言副本，这个同步是纯粹的空转。
//  2) safeEventsOn('menu:toggle-theme', …)：主题循环的第二个入口
//     （⌘⇧L 的 accelerator 由原生菜单注册）。现在唯一入口是
//     usePrefs 的 cycleTheme，由 App.vue 注册到命令表，键位与行为都在前端，
//     不再需要「mount 之前抢注册」这种时序约束。
//
// 保留 initTheme / initPrefs / initI18n 三者的 mount 前初始化不变 ——
// 它们防的是首帧闪烁，与菜单无关。

createApp(App).mount('#app')
