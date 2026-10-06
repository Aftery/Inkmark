<!-- Sidebar.vue — 侧栏：文件 / 大纲 双 tab（单栏布局下唯一的辅助面板） -->
<!--
  纯展示 + 事件上抛：文件树点选、大纲跳转、tab 切换、开文件夹都 emit 给 App.vue。
  组件不碰数据源（folderPath / outline / activeIndex 全由父级注入）——
  这样「打开文件夹后自动切到文件 tab」这类联动只有 useFileOps 一处判断。
-->
<script setup>
import FileTree from './FileTree.vue'
import Outline from './Outline.vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  folderPath: { type: String, default: '' },
  reloadSignal: { type: Number, default: 0 },
  outline: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: -1 },
  tab: { type: String, default: 'files' }, // 'files' | 'outline'
})

const emit = defineEmits(['select', 'open-folder', 'jump', 'tab'])
</script>

<template>
  <aside class="sidebar">
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

    <div v-show="props.tab === 'files'" class="sidebar-body">
      <template v-if="props.folderPath">
        <div class="sidebar-title" :title="props.folderPath">
          {{ props.folderPath.split('/').pop() }}
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
  border-right: 1px solid var(--border);
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

/* ---- 双 tab：文字标签，零新增图标 ---- */
.sidebar-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-soft);
}
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
