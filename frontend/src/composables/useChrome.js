// useChrome.js — chrome（界面外壳）可见性开关的唯一真源
// ----------------------------------------------------------------------------
// 【为什么需要这个模块】
// 产品向 Typora 靠拢后，状态栏**默认不显示**（Typora 的默认是「只有正文」）。
// 这样一项能力从界面上消失，用户必须能找回来 —— 入口在标题栏，而状态栏由
// 另一个组件画，两者是**兄弟组件**。
//
// 本仓的接线纪律：App.vue 是 ≤150 行的纯装配层（contracts.test.mjs:920 铁律），
// 不可能为「一个布尔值」再加两行 props。故采用仓内既有范式 ——
// 模块级单例 ref + 消费方自行 import（先例：composables/useTableHint.js 的
// tableHint、composables/usePlatform.js 的 isDarwin，都是同一取向）。
//
// 【为什么不用 themes/prefs.js 存这个开关】
// prefs.js 是「排版 / 编辑器偏好」的 schema（7 项白名单 + 每项都必须落到内联
// CSS 变量的应用契约，见其头注 C1~C3）。本项是**视图开关**：不写任何 CSS 变量、
// 不进设置面板的排版分组。仓内「界面开关」的既有范式是 useWorkspace.js 的
// inkmark-typewriter / inkmark-always-on-top 一类布尔旗标（readFlag/writeFlag
// + 存储不可用时静默降级）。这里沿用同一范式，避免把两种性质不同的东西混进
// 同一 schema（那会让 prefs.test.mjs 的「受管变量面」断言与
// settings-panel-spec 的项数声明一起失真）。
//
// 【存储不可用的降级】localStorage 在隐私模式 / 禁用 cookie 的 webview 里
// **访问即抛** SecurityError，且一旦抛出会打断 setup → 白屏。故读写一律
// 静默兜底（与 useWorkspace 同源代码取向）：本次会话内仍生效，只是不跨进程。

import { ref } from 'vue'

/** 持久化 key。与 prefs.js 的 inkmark-prefs 刻意分开：两者 schema 不同源 */
export const STATUSBAR_KEY = 'inkmark-statusbar'

/**
 * 关键态「最小停留」时长（ms）。
 *
 * 【为什么必须有】状态栏收起后，若「已保存 / 出错已处理」只按真实时长一闪，
 * 用户的眼睛根本抓不到那次反馈 —— 等于把反馈做成「真机不可见」。
 * 所以浮现后至少停留这么久，让一次反馈可被读到，随后自动收起（默认仍是
 * 无状态栏的干净写作面）。取值 1s：短于 toast 的 3.2s，不喧宾夺主。
 */
export const STATUS_HOLD_MS = 1000

/**
 * 「保存中」的浮现延迟（ms）。
 *
 * 【为什么不是一进入 saving 就浮现】自动保存是 800ms 防抖 + 一次整文件 IPC，
 * 真实写入通常只有几十毫秒。若按真实时长浮现，写作过程里每次停顿都会在底部
 * 闪一条状态栏（出现→消失 < 50ms）—— 那是**纯噪声**，恰好是 Typora 化要消灭
 * 的东西。故：短于本阈值的保存不浮现（它也确实快到无从反馈），
 * 只有「慢到用户会怀疑卡住」的保存才浮现。保存**失败**不在此列，
 * 它是立即且常驻的（见 shouldSurfaceStatus）。
 */
export const SAVING_SURFACE_DELAY_MS = 250

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
    // 存储不可用：仅本次会话内生效（与 useWorkspace 的降级同一取向）
  }
}

/** 状态栏是否「常显」。默认 false = 跟随关键态临时浮现（Typora 式无状态栏） */
export const statusbarPinned = ref(readFlag(STATUSBAR_KEY))

/** 写入并持久化状态栏常显开关 */
export function setStatusbarPinned(on) {
  statusbarPinned.value = !!on
  writeFlag(STATUSBAR_KEY, statusbarPinned.value)
}

/** 取反（标题栏按钮与状态栏内按钮共用同一条路径，状态必然一致） */
export function toggleStatusbarPinned() {
  setStatusbarPinned(!statusbarPinned.value)
}

/**
 * 状态栏在「非常显」时是否**必须**浮现 —— 纯函数，供 StatusBar 计算与测试直测。
 *
 * 判据只收「用户必须看见、且不能等」的两件事：
 *   - 保存失败（error）：只读目录等场景的唯一明示，绝不静默（AC-20）；
 *   - 表格未渲染提示（hasHint）：常驻型静默失败提示，必须一直可见
 *     （它「常驻到改对为止」的语义与「默认隐藏」直接冲突，故优先级最高）。
 * 刻意**不收**：
 *   - saved / unsaved：已保存是常态（不打扰）；未保存由标题栏的脏圆点承担
 *     （tb-dirty），两处都显示等于重复表达同一件事；
 *   - saving：见 SAVING_SURFACE_DELAY_MS —— 快到无从感知的保存不复现噪声，
 *     慢保存由 StatusBar 用延迟计时器另行浮现。
 *
 * @param {{ saveState?: string, hasHint?: boolean }} s
 * @returns {boolean}
 */
export function shouldSurfaceStatus({ saveState, hasHint } = {}) {
  if (hasHint) return true
  return saveState === 'error'
}
