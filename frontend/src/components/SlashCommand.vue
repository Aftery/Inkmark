<!-- SlashCommand.vue — 斜杠命令面板（纯展示 + 键位路由） -->
<!--
  职责边界：本组件只管面板的状态、定位、过滤与高亮；【不碰文档】。
  文档变更（删掉斜杠与过滤词、插入片段）由 editor/slashCommand.js 执行，
  这样变更能与按键同事务、可撤销、且不会出现中间态闪烁。
  键盘流（上下键 / 回车 / Esc）由 CM 的 keymap 拦截后回调本组件暴露的方法。
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { t } from '../i18n/index.js'
import { slashItems, insertSlashItem } from '../editor/slashCommand.js'

const PANEL_WIDTH = 248
const ITEM_HEIGHT = 32
const VIEWPORT_MARGIN = 8

const open = ref(false)
const x = ref(0)
const y = ref(0)
const query = ref('')
const selected = ref(0)

// view/anchor 是非响应式的命令上下文：它们只在 open→close 这个短窗口内
// 有意义，不该进响应式系统（每次按键都触发依赖重算没有意义）。
let view = null
let anchor = -1

const items = computed(() => slashItems.map((it) => ({ ...it, label: t(it.labelKey) })))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(
    (it) => it.keywords.some((k) => k.startsWith(q)) || it.id.startsWith(q),
  )
})

// 过滤后列表变短时把选中项夹回合法范围（否则 Enter 会插错命令）
watch(filtered, (list) => {
  if (selected.value >= list.length) selected.value = 0
})

/** 在光标下方弹出；贴边时翻转方向并收进视口 */
function openMenu(v, anchorPos) {
  const coords = v.coordsAtPos(v.state.selection.main.head)
  if (!coords) return
  view = v
  anchor = anchorPos
  const estHeight = Math.min(items.value.length, 6) * ITEM_HEIGHT + 12
  let left = coords.left
  let top = coords.bottom + 6
  if (left + PANEL_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
  }
  if (top + estHeight > window.innerHeight - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, coords.top - estHeight - 6)
  }
  x.value = left
  y.value = top
  query.value = ''
  selected.value = 0
  open.value = true
}

function isOpen() { return open.value }

function move(delta) {
  const n = filtered.value.length
  if (n === 0) return
  selected.value = (selected.value + delta + n) % n
}

function confirm() {
  const item = filtered.value[selected.value]
  // 先关面板再改文档：扩展的 updateListener 看到 isOpen()===false，
  // 不会把这次插入误当成「用户继续输入过滤词」。
  close()
  insertSlashItem(view, item, anchor)
}

function close() {
  open.value = false
  view = null
  anchor = -1
}

/**
 * 文档变化时同步过滤词（用户在面板打开后继续打字）。
 * 光标退到斜杠之前、跨行、或选区非空 → 关闭面板。
 */
function syncFromDoc(v) {
  const head = v.state.selection.main.head
  if (head <= anchor || v.state.doc.lineAt(head).from !== v.state.doc.lineAt(anchor).from) {
    close()
    return
  }
  query.value = v.state.doc.sliceString(anchor + 1, head)
}

defineExpose({ openMenu, isOpen, move, confirm, close, syncFromDoc })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="slash-panel"
      :style="{ left: x + 'px', top: y + 'px' }"
      role="listbox"
    >
      <button
        v-for="(it, i) in filtered"
        :key="it.id"
        class="slash-item"
        :class="{ active: i === selected }"
        type="button"
        role="option"
        :aria-selected="i === selected"
        @mouseenter="selected = i"
        @click="confirm()"
      >
        <span class="slash-label">{{ it.label }}</span>
        <span class="slash-hint">{{ it.hint }}</span>
      </button>
      <div v-if="filtered.length === 0" class="slash-empty">{{ t('slash.empty') }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.slash-panel {
  position: fixed;
  min-width: 248px;
  max-height: 240px;
  overflow: auto;
  padding: var(--space-1);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--fg);
  z-index: 200; /* 高于弹层（1400）之下、toast（1300）之上：面板是编辑器附属物 */
}
.slash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: default;
}
.slash-item.active { background: var(--accent-soft); }
.slash-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.slash-hint { color: var(--meta); font-family: var(--font-mono); font-size: var(--text-xs); }
.slash-empty { padding: var(--space-2) var(--space-3); color: var(--muted); }
</style>
