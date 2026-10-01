import { createApp } from 'vue'
import App from './App.vue'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { initTheme, getTheme, setPreference } from './themes/theme.js'

// 样式统一由 App.vue 引入 ./themes/index.css（token → base → preview）

// 主题初始化（必须在 Vue mount 之前）：解析偏好 → 写 <html data-theme> → 挂系统深浅监听。
// <html data-theme> 永远存已解析的具体主题（light|dark|paper），防首帧闪烁的内联脚本在 index.html。
initTheme()

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
