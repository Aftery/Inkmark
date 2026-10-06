<!-- AboutDialog.vue — 关于 Inkmark（帮助菜单；版本号来自 Go 单一真源 App.Version()） -->
<!--
  「检查更新」调 Go 侧 CheckUpdate（超时 / 网络失败 / 仓库无 Release 都返回
  status="error"），三态分别提示，绝不谎报「已是最新」。仓库目前尚无 Release，
  提示「无法检查更新：暂无已发布的版本」是预期内的正常降级。
-->
<script setup>
import { CheckUpdate } from '../../wailsjs/go/main/App'
import { t } from '../i18n/index.js'

const REPO_URL = 'https://github.com/Aftery/Inkmark'

const props = defineProps({
  version: { type: String, default: '' },
  notify: { type: Function, default: null },
})
const emit = defineEmits(['close'])

async function checkUpdate() {
  let info
  try {
    info = await CheckUpdate()
  } catch (err) {
    props.notify?.(t('toast.checkUpdateFailed', { error: err?.message || err }), true)
    return
  }
  if (info.status === 'update') {
    props.notify?.(t('toast.newVersion', { version: info.latest }))
    if (info.url) window.open(info.url, '_blank')
  } else if (info.status === 'latest') {
    props.notify?.(info.note || t('toast.alreadyLatest', { version: info.current }))
  } else {
    props.notify?.(info.note || t('toast.updateUnavailable'), true)
  }
}
</script>

<template>
  <div class="dialog-mask" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="t('about.title')">
      <p class="dialog-title">{{ t('about.title') }}</p>
      <p class="about-line">{{ t('about.tagline') }}</p>
      <p class="about-line">{{ t('about.version', { version: props.version || t('common.unknown') }) }}</p>
      <p class="about-line">
        <a class="about-link" href="#" @click.prevent="window.open(REPO_URL, '_blank')">{{ REPO_URL }}</a>
      </p>
      <div class="dialog-actions">
        <button class="dialog-btn" type="button" @click="checkUpdate">
          {{ t('about.checkUpdate') }}
        </button>
        <button class="dialog-btn" type="button" @click="window.open(REPO_URL, '_blank')">
          {{ t('about.repo') }}
        </button>
        <button class="dialog-btn primary" type="button" @click="emit('close')">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-line { margin: var(--space-2) 0 0; font-size: var(--text-sm); color: var(--fg-2); }
.about-link { color: var(--accent); text-decoration: none; }
.about-link:hover { text-decoration: underline; }

/* 打印：遮罩不得出现在纸面（父级 App.vue 的 @media print 管不到子组件内部） */
@media print {
  .dialog-mask { display: none; }
}
</style>
