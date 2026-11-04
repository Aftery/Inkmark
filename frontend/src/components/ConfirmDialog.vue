<!-- ConfirmDialog.vue — 关闭脏标签的三选一确认（保存 / 不保存 / 取消） -->
<!--
  【为什么自建而不用系统对话框】「关标签」是应用内操作，用应用内弹层才连贯；
  Go 的 runtime.MessageDialog 是系统级对话框（用于「关窗口」），且它在 Linux/GTK
  上返回值的坑已在 app.go 登记过（见架构 §5.4 与 app.go:362-370），不再引入第二条
  平台差异路径。
  【为什么复用 .dialog-* 而不是自己写尺寸】那套类名在 themes/app-shell.css 里是
  弹层的唯一真源（--dialog-width-sm / --dialog-min-height 等 token 的唯一出口）；
  自己写 min(Npx, Nvw) 会与设置面板/速查表的尺寸脱钩（本仓已收敛过一次）。
  【Esc 为什么由本组件监听，而 InputDialog 不监听】
  InputDialog 属于 useCommands 的全局 Esc 分层路由（dialog > 设置 > 速查 > 关于 >
  专注 > 历史），所以它自己不监听。本对话框**不在那条链上** —— 它由 useTabLifecycle
  直接持有，不属于命令层。若不在这里拦，Esc 会穿透到全局路由，把用户下方的
  「专注模式」或「历史面板」关掉，而确认框还开着：模态壳被击穿。
  故用**捕获阶段 + stopPropagation** 终止传播，且只在 show 时挂监听。
  【初始焦点在「取消」】破坏性操作不该是默认项 —— 回车/Esc 都不该等于「丢弃」。
-->
<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  /** useTabLifecycle 的 confirmState（响应式对象，含 show / title） */
  state: { type: Object, required: true },
})
const emit = defineEmits(['choose'])

const cancelEl = ref(null)

watch(() => props.state.show, (show) => {
  if (!show) return
  // 先渲染再聚焦（与 InputDialog 同：此刻 ref 还是 null，焦点落不进去）
  nextTick(() => cancelEl.value?.focus())
})

function onKeydown(e) {
  if (!props.state.show) return
  if (e.key !== 'Escape') return
  // 捕获阶段拦住：否则全局 Esc 路由会顺手关掉别的层（见文件头）
  e.stopPropagation()
  e.preventDefault()
  emit('choose', 'cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div v-if="props.state.show" class="dialog-mask" @click.self="emit('choose', 'cancel')">
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="t('confirm.title')"
    >
      <p class="dialog-title">{{ t('confirm.title') }}</p>
      <p class="dialog-body">{{ t('confirm.body', { title: props.state.title }) }}</p>
      <div class="dialog-actions">
        <button ref="cancelEl" class="dialog-btn" type="button" @click="emit('choose', 'cancel')">
          {{ t('common.cancel') }}
        </button>
        <button class="dialog-btn" type="button" @click="emit('choose', 'discard')">
          {{ t('confirm.discard') }}
        </button>
        <button class="dialog-btn primary" type="button" @click="emit('choose', 'save')">
          {{ t('confirm.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 正文行：尺寸与颜色全部走 token（禁止硬编码），与 .dialog-title 拉开层级 */
.dialog-body {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
  word-break: break-word;
}

/* 弹层在无边框窗口下不能当拖拽区（--wails-draggable: drag 只在标题栏上，
   这里显式写 no-drag 防止将来有人把弹层挂进标题栏后点按钮变拖窗口） */
.dialog-mask { --wails-draggable: no-drag; }

/* 打印：遮罩与对话框不得出现在纸面（App.vue 的 @media print 打不到子组件内部） */
@media print {
  .dialog-mask { display: none; }
}
</style>
