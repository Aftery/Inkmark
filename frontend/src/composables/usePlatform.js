// usePlatform — 运行平台识别（自绘标题栏跨平台适配的数据源）
// ----------------------------------------------------------------------------
// 两条判定路径，先同步后权威：
//   1) 模块加载时用 navigator 做同步初判 —— 首帧就需要正确布局
//      （macOS 要隐藏右侧窗口按钮、菜单左偏 70px 给红绿灯留白，
//      等异步结果再改布局会跳一下）；
//   2) main.js 调 initPlatform()，用 Wails 的 Environment() 权威确认
//      （浏览器预览无 runtime，调用抛错 → 静默沿用 UA 判定）。
//
// 平台同时落到 <html data-platform="...">：CSS 平台适配层
// （themes/platform-darwin.css 的毛玻璃规则）挂在它上面，
// 组件不各自判定平台、不各写一份 media query。
//
// Environment().platform 的取值（Wails v2 源码）：'darwin' | 'linux' | 'windows'
// | 'browser'（dev 预览里 Wails 也会回 'browser'，与 UA 判定互不冲突——
// 两者都不是 darwin 时行为一致）。

import { ref, watch, computed } from 'vue'
import { Environment } from '../../wailsjs/runtime/runtime'

/** navigator 同步初判（不可用时回落 'unknown'，行为等同非 mac 布局） */
function detectViaUA() {
  if (typeof navigator === 'undefined') return 'unknown'
  const p = navigator.platform || ''
  if (/Mac|iPhone|iPad/.test(p)) return 'darwin'
  if (/Win/.test(p)) return 'windows'
  if (/Linux/.test(p) && !/Android/.test(navigator.userAgent || '')) return 'linux'
  return 'unknown'
}

/** 当前平台（模块级单例真源；Environment 确认后会自我修正） */
export const platform = ref(detectViaUA())

export const isDarwin = computed(() => platform.value === 'darwin')

// 平台变化即落 DOM（immediate：首帧就带上 data-platform，CSS 无跳变）
watch(platform, (p) => {
  if (typeof document !== 'undefined') document.documentElement.dataset.platform = p
}, { immediate: true })

/**
 * 权威确认（main.js 在 mount 前调用）。
 * 失败不抛：浏览器预览 / runtime 未注入时，同步初判已经是够好的答案。
 */
export async function initPlatform() {
  try {
    const env = await Environment()
    if (env?.platform) platform.value = String(env.platform).toLowerCase()
  } catch {
    // 浏览器预览无 window.runtime：沿用 navigator 判定
  }
}
