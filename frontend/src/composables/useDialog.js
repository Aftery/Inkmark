/**
 * useDialog — 输入对话框（跳转到行 / 重命名共用）
 * ---------------------------------------------------------------------------
 * 从 App.vue 原样抽出，**行为零变更**。
 *
 * 存在理由：WKWebView 不支持 window.prompt（调用后静默返回 null），
 * 所以本项目自搭一个最小对话框。这块逻辑独立、无外部依赖，
 * 放在 App.vue 里只会让那个文件继续膨胀。
 *
 * 【时序契约，勿改】
 *   askInput() 同步把 dialog.show 置 true 并挂上 Promise 的 resolve；
 *   聚焦改由 InputDialog.vue 的 watch(show) + nextTick 完成（输入框 ref 在
 *   那个组件里）—— 顺序仍是「先渲染再聚焦」，否则 ref 还是 null、焦点不落进去
 *   （WKWebView 下尤其明显）。
 *
 *   closeDialog() 先置 show=false **再** resolve：反过来的话，
 *   业务方的 .then 会在对话框仍可见时同步执行，UI 会出现一帧闪烁。
 */
import { ref } from 'vue'

export function useDialog() {
  const dialog = ref({ show: false, title: '', placeholder: '', value: '', _resolve: null })

  /** 打开输入框；返回 Promise，用户确定时 resolve(输入值)、取消时 resolve(null) */
  function askInput({ title, placeholder = '', value = '' }) {
    return new Promise((resolve) => {
      dialog.value = { show: true, title, placeholder, value, _resolve: resolve }
    })
  }

  /** 关闭输入框；result 为 null 表示取消（Esc / 点遮罩） */
  function closeDialog(result) {
    const d = dialog.value
    if (!d.show) return
    d.show = false
    d._resolve?.(result)
    d._resolve = null
  }

  return { dialog, askInput, closeDialog }
}
