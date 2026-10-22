<!-- TitleBar.vue — 前端自绘标题栏（菜单 + 文件名 + 窗口控制，取代原生菜单栏与系统标题栏） -->
<!--
  职责边界：本组件【不含任何业务逻辑】。菜单项一律 emit 给 App.vue 接线，
  与原先「Go 菜单 → EventsEmit → App.vue」的链路终点一致，只是省掉了 Go 那一跳。

  【Typora 化 · chrome 降噪（本轮）】目标：一条很细的标题栏，**文件名是主角**。
  全部落在视觉层，不动结构：
    - 高度按 --titlebar-height 派生一个更薄的 --tb-h（见 <style> 里的注释）；
    - 菜单字号降到 --text-xs、颜色降到 --muted，hover 才回到 --fg（菜单退成背景）；
    - 文件名字号 --text-sm + 强调字重 + --fg（全条唯一的视觉焦点）；
    - 底边从 --border 降到 --border-soft（发丝线，不再是一条明显的分界）。

  【两个 chrome 开关的入口（默认隐藏的能力必须可找回）】
    1) 侧栏：默认收起（useWorkspace 的 sidebarOpen 初值 false）。入口 = ⌘B
       + 本条的侧栏图标按钮（复用既有命令 view.outline，见 SIDEBAR_COMMAND 注释）。
    2) 状态栏：默认隐藏（composables/useChrome.js）。入口 = 「视图」下拉里的
       一行 chrome 开关（下方 chromeItem 计算）+ 状态栏可见时它自己的档位按钮。
       为什么放进既有下拉而不是再加一个标题栏图标：标题栏是 1fr auto 1fr 网格，
       左侧每加一个控件都从文件名那里偷宽度（最小窗口 800px 时尤其紧）。
       放进「视图」也正好是用户的直觉位置（与「专注模式 / 显示大綱」同一组）。

  跨平台（数据源 composables/usePlatform.js：Environment() 权威 + navigator 同步初判）：
  - darwin：main.go 用 Frameless:false + mac.TitleBarHidden()，原生红绿灯仍在左上角。
    故【隐藏右侧自绘窗口按钮】（与红绿灯重复），且左侧菜单整体右移 70px 给红绿灯留白。
    拖动由系统处理：TitleBarHidden 的 FullSizeContent 让内容铺满窗口，
    而标题栏区域仍是系统拖动区（--wails-draggable 只在无边框窗口下生效，
    在这里被 Wails 忽略，属预期）。
  - linux/windows：main.go 用 Frameless:true，自绘窗口按钮（最小化/最大化/关闭）。
    标题栏整条是 --wails-draggable: drag 的拖拽区。

  **所有可点击子元素必须显式声明 no-drag**（无边框平台下），否则点击会被拖拽区吞掉。
  no-drag 只能加在具体可点元素上，不能加在布局容器上：Wails dragTest 只读
  e.target 的计算值，而自定义属性会向下继承——容器级 no-drag 会把该容器占据的
  整片空白区也变成非拖动区（真机反馈「窗口不能拖动」的根因所在）。
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { t, getLocale } from '../i18n/index.js'
import { isDarwin } from '../composables/usePlatform.js'
import { statusbarPinned, toggleStatusbarPinned } from '../composables/useChrome.js'
import AppIcon from './icons/AppIcon.vue'
import { WindowMinimise, WindowToggleMaximise } from '../../wailsjs/runtime/runtime'
import { CloseWindow } from '../../wailsjs/go/main/App'

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

/**
 * chrome（界面元素）开关项 —— 本组件自有的、**非命令**的一行菜单。
 *
 * 【为什么它可以由本组件补，而不违反「菜单结构只有命令表一个真源」】
 * 上面那条纪律约束的是**命令**（可 emit 给 App.vue、有快捷键、要在速查表里
 * 出现的东西）。状态栏显隐是一个**纯视图开关**：不进命令表、没有快捷键、
 * 不派发到命令总线，改它也不会让「菜单与快捷键两份事实」分裂。
 * 因此它走 `local: true` 分支，由本组件直接消费。
 *
 * 【为什么不给它一条真命令（view.statusbar）】那要同时改 useShortcuts.js 的
 * COMMANDS 与 useCommands.js 的处理器注册 —— 两者都不在本任务的写入范围
 * （且契约 1 会强制两边同步，改一半必红）。留作后续归并：把它升格为真命令后，
 * 这一行删掉、走通用 emit 即可，行为不变。
 *
 * 【状态怎么表达】菜单项没有图标位（tb-item 只有 label + kbd），而本仓
 * P0-1 禁止字符符号（不写对勾符）。故把档位写进 label（「状态栏」），
 * 右端用 kbd 位放当前档位（「自动」/「常显」），读屏与肉眼都读得出来。
 */
const chromeItem = computed(() => ({
  id: 'chrome.statusbar',
  local: true,
  label: t('statusbar.menu'),
  kbd: t(statusbarPinned.value ? 'statusbar.always' : 'statusbar.auto'),
}))

/** 把 chrome 开关附到「视图」分组末尾；该分组不存在时（防御）不附，不新建分组 */
const menuGroups = computed(() =>
  props.groups.map((g) =>
    g.id === 'view' ? { ...g, items: [...g.items, chromeItem.value] } : g
  )
)

/**
 * 侧栏开关复用既有命令 view.outline。
 * 【为什么不新增 view.sidebar】侧栏本来就是「一个面板、两个 tab」，命令表里的
 * view.outline 就是它的开关（⌘B）。新增一条语义重叠的命令，会连带要求同步
 * README 键位节 + 应用内速查表（verify-shortcuts.mjs 三方比对），换来零行为
 * 差异 —— 不划算。故本按钮只负责「把这条既有命令点出来」。
 */
const SIDEBAR_COMMAND = 'view.outline'

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
  if (e.key !== 'Escape' || !openMenu.value) return
  // 关闭前先记下是哪个菜单：Esc 之后焦点必须回到该按钮，否则键盘用户
  // 的焦点落到 document.body，后续 Tab 从页首重新开始（无障碍回归）。
  const id = openMenu.value
  openMenu.value = null
  rootRef.value?.querySelector(`[data-menu="${id}"]`)?.focus()
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
  // chrome 开关是**就地生效**的：不关菜单反而让用户看不清档位变化，
  // 故先执行再收起（两个动作都极轻，无闪烁）。
  if (item.local) toggleStatusbarPinned()
  openMenu.value = null
  if (!item.local) emit('command', item.id)
}

function toggleSidebar() {
  openMenu.value = null
  emit('command', SIDEBAR_COMMAND)
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
// 浏览器预览下 CloseWindow 不存在，兜底静默跳过。
//
// dirty 必须随关闭请求走**同一条 IPC**（CloseWindow(isDirty)）：watch(dirty)
// → SetDirty 是异步镜像，用户快速输入后立即点 × 时 Go 侧镜像可能还是旧值。
// 此前「先 await SetDirty 再关 + 50ms sleep」依赖 IPC 时序假设，改为入参
// 携带后不存在竞态。
// locale 随请求传入：Go 侧的原生确认框文案要跟着界面语言走（dialogs.go）。
const close = async () => {
  try {
    await CloseWindow(props.isDirty, getLocale())
  } catch {
    /* 浏览器预览或绑定未就绪 */
  }
}
</script>

<template>
  <div ref="rootRef" class="titlebar" style="--wails-draggable: drag">
    <!-- 左：自绘菜单栏 + 侧栏开关。darwin 下整体右移 70px 给原生红绿灯留白 -->
    <div class="tb-left" :class="{ 'tb-left-mac': isDarwin }">
      <div v-for="g in menuGroups" :key="g.id" class="tb-menu">
        <button
          class="tb-menu-btn"
          :class="{ active: openMenu === g.id }"
          type="button"
          :data-menu="g.id"
          aria-haspopup="menu"
          :aria-expanded="openMenu === g.id"
          @click="toggleMenu(g.id)"
          @mouseenter="hoverMenu(g.id)"
        >{{ t(`titlebar.${g.id}`) }}</button>
        <div v-if="openMenu === g.id" class="tb-dropdown" role="menu">
          <button
            v-for="item in g.items"
            :key="item.id"
            class="tb-item"
            :class="{ 'tb-item-chrome': item.local }"
            type="button"
            role="menuitem"
            @click="onItem(item)"
          >
            <span>{{ item.label }}</span>
            <span v-if="item.kbd" class="tb-kbd">{{ item.kbd }}</span>
          </button>
        </div>
      </div>

      <!-- 侧栏开关：侧栏默认收起，这是标题栏上唯一的常驻入口（与 ⌘B 同一命令） -->
      <button
        class="tb-icon-btn"
        type="button"
        :title="t('menu.outline')"
        :aria-label="t('menu.outline')"
        @click="toggleSidebar"
      >
        <AppIcon name="sidebar-expand" size="inline" />
      </button>
    </div>

    <!-- 中：文件名（视觉主角）+ 脏状态圆点；双击标题区切换最大化（桌面惯例） -->
    <div class="tb-center" @dblclick="toggleMaximise">
      <span v-if="isDirty" class="tb-dirty" :title="t('doc.unsaved')" />
      <span class="tb-title" :title="title">{{ title }}</span>
    </div>

    <!-- 右：窗口控制。darwin 隐藏（原生红绿灯已承担这三件事） -->
    <div v-if="!isDarwin" class="tb-right">
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
  /* 【更细的标题栏】从 token 派生而不是另写死一个数：--titlebar-height 仍是
     唯一真源（design-tokens.css，非本任务写入范围），这里只做「-4px」的收薄。
     34px 的边界：非 darwin 的自绘窗口按钮是 28px 见方，34px 仍能容下且留 3px
     呼吸；darwin 的原生红绿灯约在 14~16px 处垂直居中，34px 的高比 38px
     更贴近系统标题栏的视觉重心（不再比红绿灯低一截）。 */
  --tb-h: calc(var(--titlebar-height) - 4px);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: var(--tb-h);
  flex-shrink: 0;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border-soft);
  font-family: var(--font-ui);
  /* 菜单退成背景：字号降一档 + --muted（--fg 只留给文件名） */
  font-size: var(--text-xs);
  color: var(--muted);
  user-select: none;
}

.tb-left { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
/* macOS 红绿灯留白：三颗按钮约 70px 宽，压在菜单上会点不中 */
.tb-left-mac { padding-left: 70px; }
.tb-menu { position: relative; }
.tb-menu-btn {
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: default;
  white-space: nowrap;
}
.tb-menu-btn:hover,
.tb-menu-btn.active { background: var(--surface-2); color: var(--fg); }
.tb-menu-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* 侧栏开关：24px 见方，不把标题栏撑回原高度（与 .tb-win 的 28px 同理） */
.tb-icon-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-left: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: default;
}
.tb-icon-btn:hover { background: var(--surface-2); color: var(--fg); }
.tb-icon-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

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
  font-size: var(--text-sm);
  text-align: left;
  cursor: default;
}
.tb-item:hover { background: var(--accent-soft); }
.tb-item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.tb-kbd { color: var(--meta); font-size: var(--text-xs); }
/* chrome 开关：与命令项之间用一条发丝线隔开，暗示「这是界面设置，不是命令」 */
.tb-item-chrome { margin-top: var(--space-1); border-top: 1px solid var(--border-soft); }

.tb-center {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 60%;
  overflow: hidden;
  white-space: nowrap;
}
/* 文件名是主角：唯一的 --fg + 强调字重，菜单与窗口按钮都退到它之后 */
.tb-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}
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

/* --wails-draggable 白名单：root 的 drag 经继承覆盖整条标题栏，
   仅可点元素逐个覆盖回 no-drag。绝不下放到 .tb-left/.tb-right 容器
   （容器有自己的 1fr 空白区，下放即整片拖不动）。 */
.tb-menu-btn,
.tb-icon-btn,
.tb-dropdown,
.tb-item,
.tb-win { --wails-draggable: no-drag; }
</style>
