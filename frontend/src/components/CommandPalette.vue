<!--
  CommandPalette.vue — ⌘K 命令面板（61 条命令模糊搜索直达）
  ============================================================================
  【为什么需要它】
  原生菜单下线后（见 main.go 头注的三条裁决理由），61 条命令的唯一入口是
  标题栏里六个下拉菜单 —— 找一条命令要「先猜它在哪个组、再展开、再扫」。
  Typora 之所以「简洁高效」，一半靠功能集克制，另一半靠**不翻菜单**。
  Inkmark 的功能集不会变小（61 条都是有主的），所以正确解法不是删命令，
  而是把「找命令」这件事从「翻三层菜单」压成「打两个字」。

  【数据源：绝不复制第二份命令清单】
  直接读 composables/useShortcuts.js 的 COMMANDS，并在运行时把 labelKey
  经 t() 求值。这保证「菜单里有的、面板里一定有」「改一条命令只改一处」。
  这也是 verify-shortcuts.mjs 门禁所依赖的同源前提。

  【为什么组件自包含（不吃 open prop）】
  App.vue 总行数有 ≤150 行铁律（contracts.test.mjs 的架构契约），而本组件
  需要一个「⌘K 打开」的全局监听。若让 App.vue 传 props，至少要多两行接线。
  故本组件挂载后自己装 window 级 keydown 监听，自己管开关 —— App.vue 只需
  一行 `<CommandPalette />`。命令执行仍走 useShortcuts 的 emitCommand 总线，
  与菜单点击、快捷键是**同一条路径**，不另起炉灶。

  【键位真源】⌘K 绑定登记在 COMMANDS 里（id: view.commandPalette）。
  本组件不自己硬编码判断 "k"，而是读该命令的 accel 再比对 KeyboardEvent，
  这样改键位只改真源，面板自动跟随（不会出现「速查表写 ⌘K、实际不生效」）。
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../i18n/index.js'
import {
  COMMANDS, accelFromEvent, emitCommand, fmtAccel, getCommand, uiState,
} from '../composables/useShortcuts.js'
import { clampIndex, filterCommands, moveIndex } from '../composables/commandFilter.js'

/** 面板命令的 id（与本组件在 COMMANDS 里登记的那条一致） */
const PALETTE_ID = 'view.commandPalette'

/**
 * 开合状态来自 useShortcuts.js 的 uiState（模块级 ref，跨组件单一真源）。
 * 【为什么不自己持有一个 ref】命令处理器必须注册在 useCommands.js（契约 1 只扫
 * 那个文件），处理器与面板若各持一份状态，就会出现「按 ⌘⇧A 打开了 but 菜单点了没反应」
 * 这类双真源 bug。收敛到 uiState 后，三条入口（键位 / 菜单 / 总线）改的是同一个值。
 */
const open = uiState.paletteOpen
const query = ref('')
const selected = ref(0)
const inputEl = ref(null)
/** 打开前的焦点元素：关闭时还回去，键盘用户不会掉到 body 上 */
let restoreFocus = null

/** 命令的分组展示顺序（与标题栏菜单一致，降低认知切换成本） */
const GROUP_ORDER = ['file', 'edit', 'format', 'view', 'window', 'help']

/**
 * 候选命令：把 COMMANDS 求值成带译文与键位的可搜索项。
 * 用 computed 而不是 setup 期一次求值 —— 切语言时 t() 必须重新求值，
 * 否则面板停在初始语言（与 SettingsPanel 里 CATEGORIES 的处理同理）。
 */
const items = computed(() =>
  COMMANDS.map((c) => ({
    id: c.id,
    group: c.group,
    label: t(c.labelKey),
    accel: c.accel,
    kbd: fmtAccel(c.accel),
  })),
)

/** 过滤结果（纯逻辑在 composables/commandFilter.js，可被 node 直接测） */
const filtered = computed(() => filterCommands(query.value, items.value))

/** 按分组切成渲染块：一组一个小标题，视觉上比一长条平铺好扫 */
const groups = computed(() => {
  const byGroup = new Map()
  for (const it of filtered.value) {
    if (!byGroup.has(it.group)) byGroup.set(it.group, [])
    byGroup.get(it.group).push(it)
  }
  return GROUP_ORDER
    .filter((g) => byGroup.has(g))
    // 分组名复用标题栏菜单的同一批 key（titlebar.file / titlebar.edit …）：
    // 不新造 key，也保证面板里的组名与菜单栏按钮**逐字一致**（同一处改，两处同变）
    .map((g) => ({ id: g, label: t(`titlebar.${g}`), items: byGroup.get(g) }))
})

/** 扁平下标：键盘导航要跨分组连续移动，故需要「组内项 → 全局下标」的映射 */
const flat = computed(() => groups.value.flatMap((g) => g.items))

/** 某条命令在扁平列表里的下标（模板里给 option 编号用） */
function indexOf(id) {
  return flat.value.findIndex((it) => it.id === id)
}

// 过滤结果变短时把选中项夹回合法范围（否则 Enter 落到 undefined，"按了没反应"）
watch(filtered, () => {
  selected.value = clampIndex(selected.value, flat.value.length)
})

function show() {
  if (open.value) return
  restoreFocus = document.activeElement
  open.value = true
}

function close() {
  if (!open.value) return
  open.value = false
}

/**
 * 开合副作用统一在这里做。
 *
 * 【为什么不在 show()/close() 里直接重置】open 现在由 useCommands 翻转
 * （菜单、⌘⇧A、总线三条入口），组件内的 show()/close() 只是其中一种触发方式。
 * 若把「重置 query / 聚焦 / 还焦点」写在 show() 里，外部翻转 ref 就走不到，
 * 表现为「从菜单打开面板时输入框没焦点、还留着上次的搜索词」。
 * 收敛到 watch(open) 后，**任何**打开路径都得到同一套初始化。
 */
watch(open, (isOpen) => {
  if (isOpen) {
    restoreFocus = document.activeElement
    query.value = ''
    selected.value = 0
    // 等遮罩渲染完再聚焦输入框（否则 ref 还是 null）
    nextTick(() => inputEl.value?.focus())
    return
  }
  query.value = ''
  // 焦点还给打开前的元素：不还的话键盘用户会掉到 document.body，
  // 后续 Tab 从页首重新开始（无障碍回归，同 TitleBar 的 Esc 处理）
  const back = restoreFocus
  restoreFocus = null
  if (back && typeof back.focus === 'function' && back.isConnected) back.focus()
})

function run(item) {
  if (!item) return
  // 先关面板再执行：命令可能打开设置面板等弹层，若面板还开着会盖住它
  close()
  // 走统一总线：与菜单点击 / 快捷键是同一条路径，不另起炉灶。
  // 返回 false = 该命令尚未注册处理器（开发期常见），此时给一条可见日志。
  if (!emitCommand(item.id)) {
    console.warn('[palette] 命令无处理器:', item.id)
  }
}

function onMove(delta) {
  selected.value = moveIndex(selected.value, delta, flat.value.length)
  // 滚动跟随：键盘移动时把选中项带进视口（长列表必需）
  nextTick(() => {
    const el = document.querySelector('.palette-item.is-active')
    el?.scrollIntoView?.({ block: 'nearest' })
  })
}

function onConfirm() {
  const item = flat.value[selected.value]
  if (item) run(item)
}

/**
 * 全局键盘监听：只做两件事 —— 「按 ⌘K 打开」与「面板开着时接管按键」。
 * 面板开着时不拦截会导致：输入框里打字同时触发编辑器快捷键（如 ⌘B 加粗）。
 */
function onKeydown(e) {
  const cmd = getCommand(PALETTE_ID)
  // 打开：比对真源里的 accel（不硬编码 'k'，改键位时面板自动跟随）。
  // 走 emitCommand 而不是直接 show()：与菜单点击、installGlobalShortcuts
  // **同一条路径**，避免「键位开了、菜单点了没反应」的双真源。
  if (!open.value) {
    if (cmd?.accel && accelFromEvent(e) === cmd.accel) {
      e.preventDefault()
      emitCommand(PALETTE_ID)
    }
    return
  }
  // 已打开：接管方向键 / Enter / Esc
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    onMove(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    onMove(-1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    selected.value = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    selected.value = Math.max(0, flat.value.length - 1)
  } else if (e.key === 'Enter') {
    // IME 合成中回车是「确认候选词」，不能当成执行命令
    if (e.isComposing) return
    e.preventDefault()
    onConfirm()
  }
}

// capture 阶段监听：必须早于编辑器的 keymap，否则 ⌘⇧A 会被 CM 先吃掉。
// 该监听只负责「打开」（走 emitCommand 统一总线）与「开着时接管按键」；
// 命令处理器本身注册在 useCommands.js（契约 1 要求集中在那里）。
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

/** 供外部/测试按需打开（也让将来可以从菜单项触发） */
defineExpose({ show, close, isOpen: () => open.value })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-mask" @click.self="close">
      <div class="palette" role="dialog" aria-modal="true" :aria-label="t('palette.title')">
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          :aria-activedescendant="flat[selected] ? `palette-opt-${selected}` : undefined"
          :placeholder="t('palette.placeholder')"
          :aria-label="t('palette.placeholder')"
          autocomplete="off"
          spellcheck="false"
        />
        <div id="palette-list" class="palette-list" role="listbox">
          <template v-for="g in groups" :key="g.id">
            <div class="palette-group">{{ g.label }}</div>
            <button
              v-for="it in g.items"
              :id="`palette-opt-${indexOf(it.id)}`"
              :key="it.id"
              type="button"
              role="option"
              class="palette-item"
              :class="{ 'is-active': indexOf(it.id) === selected }"
              :aria-selected="indexOf(it.id) === selected"
              @click="run(it)"
              @mousemove="selected = indexOf(it.id)"
            >
              <span class="palette-label">{{ it.label }}</span>
              <span v-if="it.kbd" class="palette-kbd">{{ it.kbd }}</span>
            </button>
          </template>
          <div v-if="flat.length === 0" class="palette-empty">{{ t('palette.empty') }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 遮罩：与既有弹层同源（半透明 + 轻微模糊），但压得更浅 —— 命令面板是
   「快速一瞥」型浮层，遮太黑会失去上下文。 */
.palette-mask {
  position: fixed;
  inset: 0;
  /* 模态覆盖层：必须压过 toast(1300) 与 history(1200)，否则保存失败 toast
     会浮在面板之上挡住输入框；与 dialog(1400) 同档略高，确保「在面板里搜到
     '设置'回车打开设置面板」时设置面板盖在面板之上（正确的层叠），而面板自身
     不被任何提示压住。App.vue 150 行铁律下无法用 prop 传层级，故在此固定。 */
  z-index: 1500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: color-mix(in srgb, var(--fg) 24%, transparent);
  backdrop-filter: blur(2px);
}

.palette {
  width: min(560px, calc(100vw - 32px));
  max-height: min(420px, 70vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-raised);
}

.palette-input {
  flex: none;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-bottom: 1px solid var(--border-soft);
  background: transparent;
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--text-md);
  outline: none;
}
.palette-input::placeholder { color: var(--muted); }

.palette-list {
  overflow-y: auto;
  padding: var(--space-1) 0;
}

.palette-group {
  padding: var(--space-2) var(--space-4) var(--space-1);
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-2) var(--space-4);
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  text-align: left;
  cursor: default;
}
.palette-item.is-active { background: var(--accent-soft); }
.palette-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.palette-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-kbd {
  flex: none;
  color: var(--meta);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.palette-empty {
  padding: var(--space-4);
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  text-align: center;
}

/* 打印时必须整体隐藏：遮罩是 fixed 全屏元素，出现在纸上就是一张黑纸
   （Vue scoped 样式打不到子组件内部，故每个带遮罩的组件各写一份 ——
   这是 contracts.test.mjs 契约 3 强制的要求，别删）。 */
@media print {
  .palette-mask { display: none !important; }
}
</style>
