<!-- TitleBar.vue — 前端自绘标题栏（菜单 + 文件名 + 窗口控制，取代原生菜单栏与系统标题栏） -->
<!--
  职责边界：本组件【不含任何业务逻辑】。菜单项一律 emit 给 App.vue 接线，
  与原先「Go 菜单 → EventsEmit → App.vue」的链路终点一致，只是省掉了 Go 那一跳。

  跨平台（数据源 composables/usePlatform.js：Environment() 权威 + navigator 同步初判）：
  - darwin：main.go 用 Frameless:false + mac.TitleBarHidden()，原生红绿灯仍在左上角。
    故【隐藏右侧自绘窗口按钮】（与红绿灯重复），且左侧菜单整体右移 70px 给红绿灯留白。
    拖动由系统处理：TitleBarHidden 的 FullSizeContent 让内容铺满窗口，
    而标题栏区域仍是系统拖动区（--wails-draggable 只在无边框窗口下生效，
    在这里被 Wails 忽略，属预期）。
  - linux/windows：main.go 用 Frameless:true，自绘窗口按钮（最小化/最大化/关闭），
    整条是 --wails-draggable: drag 的拖拽区。

  **所有可点击子元素必须显式声明 no-drag**（无边框平台下），否则点击会被拖拽区吞掉。
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../i18n/index.js'
import { isDarwin } from '../composables/usePlatform.js'
import { WindowMinimise, WindowToggleMaximise } from '../../wailsjs/runtime/runtime'

const props = defineProps({
  filename: { type: String, default: '' },
  isDirty: { type: Boolean, default: false },
  // 菜单结构由 App.vue 从命令表（useShortcuts.js 的 COMMANDS）派生后传入。
  // 【为什么不在本组件里 import COMMANDS 自己算】菜单与快捷键必须是同一份
  // 事实：若组件自己过滤分组，就多了一份「哪些命令该进菜单」的判断，
  // 改命令表时可能只改到一半（键位生效了、菜单里没有，或反之）。
  // 传 props 让「分组与顺序」这一决定留在唯一的真源侧。
  // 每项：{ id, label, kbd }；分组：{ id, items }
  groups: { type: Array, default: () => [] },
})

const emit = defineEmits(['command'])

const title = computed(() => props.filename || t('titlebar.untitled'))

// ---- 菜单开合 ----
// pointerdown 用 capture 阶段监听：必须早于子元素的 click 语义，
// 否则「点菜单按钮」会先被 click 里的 toggle 关掉再被外部判定重开。
const rootRef = ref(null)
const openMenu = ref(null)

function toggleMenu(id) {
  openMenu.value = openMenu.value === id ? null : id
}

// 已有菜单展开时，悬停另一项直接切换（桌面菜单栏的常规手感）
function hoverMenu(id) {
  if (openMenu.value && openMenu.value !== id) openMenu.value = id
}

function onDocPointerdown(e) {
  if (rootRef.value && !rootRef.value.contains(e.target)) openMenu.value = null
}
function onKeydown(e) {
  if (e.key === 'Escape') openMenu.value = null
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerdown, true)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerdown, true)
  document.removeEventListener('keydown', onKeydown)
})

function onItem(item) {
  openMenu.value = null
  emit('command', item.id)
}

// ---- 窗口控制 ----
// Wails runtime 只在桌面端注入；浏览器预览（npm run dev）下调用会抛，
// 故统一包一层 try（与项目既有的 window.go?. 兜底同一取向）。
function runWin(fn) {
  try {
    fn()
  } catch {
    // 浏览器预览无 window.runtime：静默跳过，不影响 UI
  }
}
const minimise = () => runWin(WindowMinimise)
const toggleMaximise = () => runWin(WindowToggleMaximise)

// 关闭走 App.CloseWindow 而不是 Wails 的 Quit：Quit 是强制退出、不经过
// OnBeforeClose，会绕过「未保存更改」确认框；CloseWindow 走正常关闭流程。
// 浏览器预览下 window.go 不存在，兜底静默跳过。
const close = () => runWin(() => window.go?.main?.App?.CloseWindow?.())
</script>

<template>
  <div ref="rootRef" class="titlebar" style="--wails-draggable: drag">
    <!-- 左：自绘菜单栏。darwin 下右移 70px 给原生红绿灯留白 -->
    <div class="tb-left" :class="{ 'tb-left-mac': isDarwin }" style="--wails-draggable: no-drag">
      <div v-for="g in groups" :key="g.id" class="tb-menu">
        <button
          class="tb-menu-btn"
          :class="{ active: openMenu === g.id }"
          type="button"
          @click="toggleMenu(g.id)"
          @mouseenter="hoverMenu(g.id)"
        >{{ t(`titlebar.${g.id}`) }}</button>
        <div v-if="openMenu === g.id" class="tb-dropdown" role="menu">
          <button
            v-for="item in g.items"
            :key="item.id"
            class="tb-item"
            type="button"
            role="menuitem"
            @click="onItem(item)"
          >
            <span>{{ item.label }}</span>
            <span v-if="item.kbd" class="tb-kbd">{{ item.kbd }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 中：文件名 + 脏状态圆点；双击标题区切换最大化（桌面惯例） -->
    <div class="tb-center" @dblclick="toggleMaximise">
      <span v-if="isDirty" class="tb-dirty" :title="t('doc.unsaved')" />
      <span class="tb-title" :title="title">{{ title }}</span>
    </div>

    <!-- 右：窗口控制。darwin 隐藏（原生红绿灯已承担这三件事） -->
    <div v-if="!isDarwin" class="tb-right" style="--wails-draggable: no-drag">
      <button class="tb-win" type="button" :aria-label="t('titlebar.minimize')" @click="minimise">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <line x1="2.5" y1="6" x2="9.5" y2="6" />
        </svg>
      </button>
      <button class="tb-win" type="button" :aria-label="t('titlebar.zoom')" @click="toggleMaximise">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button class="tb-win tb-win-close" type="button" :aria-label="t('titlebar.close')" @click="close">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: var(--titlebar-height);
  flex-shrink: 0;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--fg-2);
  user-select: none;
}

.tb-left { display: flex; gap: var(--space-1); }
/* macOS 红绿灯留白：三颗按钮约 70px 宽，压在菜单上会点不中 */
.tb-left-mac { padding-left: 70px; }
.tb-menu { position: relative; }
.tb-menu-btn {
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: default;
}
.tb-menu-btn:hover,
.tb-menu-btn.active { background: var(--surface-2); color: var(--fg); }
.tb-menu-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.tb-dropdown {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  min-width: 200px;
  padding: var(--space-1);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  z-index: 100;
}
.tb-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  width: 100%;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: default;
}
.tb-item:hover { background: var(--accent-soft); }
.tb-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.tb-kbd { color: var(--meta); font-size: var(--text-xs); }
.tb-sep { height: 1px; margin: var(--space-1) var(--space-2); background: var(--border-soft); }

.tb-center {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 50%;
  overflow: hidden;
  white-space: nowrap;
}
.tb-title { overflow: hidden; text-overflow: ellipsis; }
/* 未保存标记：纯 CSS 圆点，不使用任何符号字形（P0 零 emoji / 零字符图标） */
.tb-dirty {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
}

.tb-right { display: flex; justify-content: flex-end; gap: var(--space-1); }
.tb-win {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-2);
  cursor: default;
}
.tb-win svg { stroke: currentColor; stroke-width: 1.25; fill: none; }
.tb-win:hover { background: var(--surface-2); color: var(--fg); }
.tb-win:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.tb-win-close:hover { background: var(--danger-soft); color: var(--danger); }
</style>
