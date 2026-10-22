<!-- Sidebar.vue — 侧栏：文件 / 大纲 双 tab（单栏布局下唯一的辅助面板） -->
<!--
  纯展示 + 事件上抛：文件树点选、大纲跳转、tab 切换、开文件夹、关闭侧栏都 emit 给 App.vue。
  组件不碰数据源（folderPath / outline / activeIndex 全由父级注入）——
  这样「打开文件夹后自动切到文件 tab」这类联动只有 useFileOps 一处判断。

  【Typora 化 · 默认收起】
  可见性真源在 composables/useWorkspace.js 的 sidebarOpen（初值 false）——
  首屏就是纯写作面，与 Typora 的默认状态一致。App.vue 用 v-show 控制，
  故本组件只在「已展开」时被看见，不需要自己判断可见性。
  展开入口有两个（都在 App.vue 之外的既有链路里，本组件不新增接线）：
    ① 标题栏的侧栏图标按钮 / ⌘B（复用 view.outline 命令，见 TitleBar.vue）；
    ② 文件 ▸ 打开文件夹（useFileOps.openFolder 会把 sidebarOpen 置 true）。
  本组件补的是**收起入口**：早先侧栏一旦展开，除了再按一次 ⌘B 没有任何可视出口
  （⌘B 属于「看不见的能力」）。故 tab 条末尾加一个收起按钮，默认极淡、
  hover 才点亮，不增加常驻视觉重量。

  【为什么收起按钮走命令总线而不是 emit】App.vue 用 v-show 控制本组件可见性，
  但其模板没有（也不会再有）`@close` 监听 —— ≤150 行铁律下不为一个按钮加一行接线。
  故按钮直接 `emitCommand('view.outline')`：那是**已注册的同一个命令处理器**
  （useCommands 的 toggleOutline），与 ⌘B、标题栏图标走的是同一条路径，
  不存在第二份「打开/关闭」判断。这也避免了「emit 一个没人听的事件」那种
  点了没反应且不报错的静默死接线。
-->
<script setup>
import FileTree from './FileTree.vue'
import Outline from './Outline.vue'
import AppIcon from './icons/AppIcon.vue'
import { t } from '../i18n/index.js'
import { emitCommand } from '../composables/useShortcuts.js'

const props = defineProps({
  folderPath: { type: String, default: '' },
  reloadSignal: { type: Number, default: 0 },
  outline: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: -1 },
  tab: { type: String, default: 'files' }, // 'files' | 'outline'
})

const emit = defineEmits(['select', 'open-folder', 'jump', 'tab'])

/** 收起侧栏 = 触发既有的「显示/隐藏大纲」命令（它就是侧栏的总开关，见上） */
function collapse() {
  emitCommand('view.outline')
}

// 侧栏标题 = 文件夹名。两种分隔符都要认：Windows 的 folderPath 是 C:\dir\sub，
// 只按 "/" 切会把整条路径显示成标题（与 useEditorSession 的 baseName 同口径）。
function folderName(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : (p || '/')
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-tabs" role="tablist" :aria-label="t('sidebar.label')">
        <button
          class="sidebar-tab"
          :class="{ active: props.tab === 'files' }"
          type="button"
          role="tab"
          :aria-selected="props.tab === 'files'"
          @click="emit('tab', 'files')"
        >{{ t('sidebar.tab.files') }}</button>
        <button
          class="sidebar-tab"
          :class="{ active: props.tab === 'outline' }"
          type="button"
          role="tab"
          :aria-selected="props.tab === 'outline'"
          @click="emit('tab', 'outline')"
        >{{ t('sidebar.tab.outline') }}</button>
      </div>
      <!-- 收起入口：侧栏展开后唯一的可视出口（⌘B 仍是键盘路径，二者等价） -->
      <button
        class="sidebar-close"
        type="button"
        :title="t('sidebar.collapse')"
        :aria-label="t('sidebar.collapse')"
        @click="collapse"
      >
        <AppIcon name="sidebar-collapse" size="inline" />
      </button>
    </div>

    <div v-show="props.tab === 'files'" class="sidebar-body">
      <template v-if="props.folderPath">
        <div class="sidebar-title" :title="props.folderPath">
          {{ folderName(props.folderPath) }}
        </div>
        <FileTree
          :root="props.folderPath"
          :reload-signal="props.reloadSignal"
          @select="(p) => emit('select', p)"
        />
      </template>
      <div v-else class="sidebar-empty">
        <p>{{ t('sidebar.empty.hint') }}</p>
        <button class="sidebar-cta" type="button" @click="emit('open-folder')">
          {{ t('sidebar.empty.cta') }}
        </button>
      </div>
    </div>

    <div v-show="props.tab === 'outline'" class="sidebar-body">
      <Outline
        :items="props.outline"
        :active-index="props.activeIndex"
        @jump="(item, i) => emit('jump', item, i)"
      />
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
}
.sidebar-title {
  padding: var(--space-3) var(--space-4) var(--space-2);
  font-weight: var(--weight-emphasize);
  font-size: var(--text-sm);
  color: var(--fg-2);
  border-bottom: 1px solid var(--border-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 顶部：双 tab + 收起按钮 ---- */
.sidebar-head {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-soft);
}
.sidebar-tabs { display: flex; flex: 1; min-width: 0; }
.sidebar-tab {
  flex: 1;
  min-height: 44px; /* 触控目标约束 */
  background: none;
  border: none;
  font: inherit;
  font-size: var(--text-sm);
  letter-spacing: var(--tracking-small);
  color: var(--muted);
  cursor: pointer;
}
/* 激活态只用字重与颜色区分，不占 --accent 预算（每屏 accent ≤ 2 处） */
.sidebar-tab.active {
  color: var(--fg);
  font-weight: var(--weight-emphasize);
}
.sidebar-tab:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring);
}

/* 收起按钮：与 tab 同高（44px 触控目标），宽度只占图标位；
   默认极淡（--meta），hover/聚焦才到 --fg —— 不给展开态再添一处常驻重色 */
.sidebar-close {
  display: grid;
  place-items: center;
  width: 36px;
  border: none;
  background: none;
  color: var(--meta);
  cursor: pointer;
  transition: color var(--motion-fast) var(--ease-standard);
}
.sidebar-close:hover { color: var(--fg); background: var(--surface-2); }
.sidebar-close:focus-visible { outline: none; box-shadow: inset var(--focus-ring); }

.sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ---- 文件 tab 空态：引导文案 + CTA ---- */
.sidebar-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4);
  text-align: center;
  color: var(--meta);
  font-size: var(--text-sm);
}
.sidebar-empty p { margin: 0; }
.sidebar-cta {
  min-height: 44px;
  padding: 0 var(--space-4);
  background: var(--surface-2);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.sidebar-cta:hover { background: var(--accent-soft); border-color: var(--border-strong); }
.sidebar-cta:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
