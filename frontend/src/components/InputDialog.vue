<!-- InputDialog.vue — 输入对话框（跳转到行 / 重命名共用） -->
<!--
  WKWebView 不支持 window.prompt（调用后静默返回 null），故自搭最小对话框。
  状态与 Promise 由 useDialog 持有，本组件只管「渲染 + 聚焦 + 上抛结果」。

  【时序契约】聚焦放在 watch(show) + nextTick：先渲染再聚焦，否则输入框 ref
  还是 null、焦点不会落进去（WKWebView 下尤其明显）。
  【Esc】由 useCommands 的全局 Esc 路由关闭（emit('close', null)），
  这里不重复监听 —— 两个 Esc 监听器会互相抢事件。
-->
<script setup>
import { ref, watch, nextTick } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  // useDialog 的 dialog（响应式对象，含 show / title / placeholder / value）
  dialog: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const inputEl = ref(null)
// 【为什么用本地镜像而不是直接 v-model 绑 props】v-model 展开后是对
// `props.dialog.value` 的**赋值**（Vue 3 编译器产物实测就是这样），属于
// 「子组件改父级数据」：每次敲字都会走 mutating-prop 的告警路径，且把输入态
// 与 useDialog 的内部状态焊死。本地 ref 在打开时从 dialog 取初值，关闭时把
// 结果作为 emit 参数上抛 —— 父级解构 resolve 时用的正是这个参数。
const text = ref('')

watch(() => props.dialog.show, (show) => {
  if (!show) return
  text.value = props.dialog.value ?? ''
  // 先渲染再聚焦：此刻 inputEl 还是 null 的话焦点落不进去（WKWebView 更明显）
  nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div v-if="props.dialog.show" class="dialog-mask" @click.self="emit('close', null)">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="props.dialog.title">
      <p class="dialog-title">{{ props.dialog.title }}</p>
      <input
        ref="inputEl"
        v-model="text"
        class="dialog-input"
        type="text"
        :placeholder="props.dialog.placeholder"
        @keydown.enter.prevent="emit('close', text)"
      />
      <div class="dialog-actions">
        <button class="dialog-btn" type="button" @click="emit('close', null)">
          {{ t('common.cancel') }}
        </button>
        <button class="dialog-btn primary" type="button" @click="emit('close', text)">
          {{ t('common.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 打印：对话框/遮罩不得出现在纸面（父级 App.vue 的 @media print 管不到子组件内部） */
@media print {
  .dialog-mask { display: none; }
}
</style>
