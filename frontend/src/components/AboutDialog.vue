<!-- AboutDialog.vue — 关于 Inkmark（帮助菜单；版本号来自 Go 单一真源 App.Version()） -->
<!--
  「检查更新」调 Go 侧 CheckUpdate（超时 / 网络失败 / 仓库无 Release 都返回
  status="error"），三态分别提示，绝不谎报「已是最新」。仓库目前尚无 Release，
  提示「无法检查更新：暂无已发布的版本」是预期内的正常降级。
-->
<script setup>
import { CheckUpdate } from '../../wailsjs/go/main/App'
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
import { t } from '../i18n/index.js'

const REPO_URL = 'https://github.com/Aftery/Inkmark'

/**
 * 在系统浏览器里打开外链。
 *
 * 【为什么不能用 window.open】两道坑叠在一起：
 *  ① 模板表达式里 `window` **不是**允许的全局名 —— Vue 会编译成
 *     `_ctx.window.open(...)`，而实例上并没有 window，点击必抛 TypeError
 *     （直接表现就是「仓库链接点了没反应」）。
 *  ② 即便在 <script> 里调，WKWebView 也不会开新窗口：Wails v2 的 macOS 前端
 *     没有实现 createWebViewWithConfiguration: 新窗口 delegate，调用被静默丢弃。
 * 故走 Wails runtime 的 BrowserOpenURL（三平台齐备，交给系统默认浏览器）。
 * 浏览器预览（vite dev，无 wails runtime）下退回 window.open 作为兜底。
 */
function openRepo() {
  openExternal(REPO_URL)
}

function openExternal(url) {
  if (!url) return
  try {
    BrowserOpenURL(url)
  } catch {
    window.open(url, '_blank')
  }
}

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
    if (info.url) openExternal(info.url)
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
        <a class="about-link" href="#" @click.prevent="openRepo">{{ REPO_URL }}</a>
      </p>
      <div class="dialog-actions">
        <button class="dialog-btn" type="button" @click="checkUpdate">
          {{ t('about.checkUpdate') }}
        </button>
        <button class="dialog-btn" type="button" @click="openRepo">
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
