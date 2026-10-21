<!-- AboutDialog.vue — 关于 Inkmark（帮助菜单；版本号来自 Go 单一真源 App.Version()） -->
<!--
  「检查更新」调 Go 侧 CheckUpdate（超时 / 网络失败 / 仓库无 Release 都返回
  status="error"），三态分别提示，绝不谎报「已是最新」。仓库目前尚无 Release，
  提示「无法检查更新：暂无已发布的版本」是预期内的正常降级。
-->
<script setup>
import { ref } from 'vue'
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

/** 检查更新的就地反馈（见模板注释：全局 toast 会被弹层遮罩压住） */
const checking = ref(false)
const status = ref('')
const statusIsErr = ref(false)

/**
 * Go 侧返回的 note 是**中文硬编码**，只适合作为日志/兜底；界面文案必须走 i18n，
 * 否则切到 English / 日本語 后这一条仍是中文（与 SPEC-i18n-v1 的「用户可见
 * 文案一律走 t()」冲突）。故按 status + 一个**稳定的 reason 代码**选文案，
 * note 仅在未知 reason 时才兜底显示。
 */
const REASON_KEYS = {
  no_release: 'toast.updateNoRelease',
  network: 'toast.updateNetwork',
  server: 'toast.updateServer',
  parse: 'toast.updateParse',
  version: 'toast.updateBadVersion',
}

function reasonText(reason) {
  const key = REASON_KEYS[reason]
  return key ? t(key) : null
}

async function checkUpdate() {
  if (checking.value) return
  checking.value = true
  status.value = ''
  try {
    let info
    try {
      info = await CheckUpdate()
    } catch (err) {
      const msg = t('toast.checkUpdateFailed', { error: err?.message || err })
      status.value = msg
      statusIsErr.value = true
      props.notify?.(msg, true)
      return
    }
    if (info.status === 'update') {
      status.value = t('toast.newVersion', { version: info.latest })
      statusIsErr.value = false
      props.notify?.(status.value)
      if (info.url) openExternal(info.url)
    } else if (info.status === 'latest') {
      status.value = t('toast.alreadyLatest', { version: info.current })
      statusIsErr.value = false
      props.notify?.(status.value)
    } else {
      // 优先用 reason 选本地化文案；未知 reason 才退回 Go 的 note（可能是中文）
      const localized = reasonText(info.reason)
      status.value = localized || info.note || t('toast.updateUnavailable')
      statusIsErr.value = true
      props.notify?.(status.value, true)
    }
  } finally {
    checking.value = false
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
      <!--
        结果就地显示，而不是只靠全局 toast。
        【为什么】toast 的 z-index 是 1300，弹层遮罩是 1400 —— 从弹层里触发的
        toast 会被自己的遮罩压在下面，用户点了「检查更新」**看不到任何反馈**，
        观感就是「这个按钮没反应」（这正是它此前「不能用」的真实原因）。
        把结论落在按钮下方一行，既绕开层级，也让「刚才那次检查的结果」在弹层
        关闭前一直可见（toast 3 秒就消失，本来就留不住）。
      -->
      <p v-if="status" class="about-status" :class="{ 'is-err': statusIsErr, 'is-ok': !statusIsErr }" role="status">
        {{ status }}
      </p>
      <div class="dialog-actions">
        <button class="dialog-btn" type="button" :disabled="checking" @click="checkUpdate">
          {{ checking ? t('about.checking') : t('about.checkUpdate') }}
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
/* 检查更新结果：与正文同色系，错误走 --danger（沿用 focus-toast.is-err 的配色口径） */
.about-status {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-ui);
  color: var(--meta);
}
.about-status.is-err { color: var(--danger); }
.about-status.is-ok { color: var(--fg); }
/* 检查中禁用按钮，避免连点并发（每次都会新建一个 5s 超时的请求） */
.dialog-btn:disabled { opacity: 0.6; cursor: default; }

/* 打印：遮罩不得出现在纸面（父级 App.vue 的 @media print 管不到子组件内部） */
@media print {
  .dialog-mask { display: none; }
}
</style>
