// useToast — 轻提示（一次性 / 结果反馈）的唯一实现
// ----------------------------------------------------------------------------
// 从 App.vue 抽出（行为零变更）：一个响应式 toast 状态 + 定时自动消失。
// 消费方：useDocumentState / useFileOps / useFileAssets / useWorkspace /
// useCommands / AboutDialog —— 全部经 notify 注入，不 import 本模块直接调用
// （toast 的 UI 归 App.vue 模板，逻辑归这里）。
// 错误提示停留更久（6000ms）：出错时用户往往正在操作别处，3200ms 来不及读。

import { ref, onBeforeUnmount } from 'vue'

export function useToast() {
  const toast = ref({ show: false, msg: '', isErr: false })
  let timer = null

  /**
   * 弹一条轻提示。
   * @param {string} msg 文案（调用方负责走 t() 国际化）
   * @param {boolean} [isErr] 错误态：红色 + 更长停留
   */
  function showToast(msg, isErr = false) {
    toast.value = { show: true, msg, isErr }
    clearTimeout(timer)
    timer = setTimeout(() => (toast.value.show = false), isErr ? 6000 : 3200)
  }

  onBeforeUnmount(() => clearTimeout(timer))
  return { toast, showToast }
}
