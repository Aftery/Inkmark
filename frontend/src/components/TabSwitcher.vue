<script setup>
/**
 * TabSwitcher — 切换标签时闪一下的「最近使用」浮层（P4）
 * ----------------------------------------------------------------------------
 * 【从 TabBar.vue 拆出来的理由】同 TabContextMenu：父组件撞了 300 有效行门禁，
 * 而本组件是**纯展示**（无 emit、无 DOM 交互），拆走零耦合。
 *
 * 【排序 = 按下瞬间的 MRU 快照（MD-10）】数据由命令层（`useCommands.cycleTab`）
 * 在浮层从关到开的那一次交给 `useShortcuts.tabSwitcher.ids`。本组件**不重排、不
 * 重算**：一旦这里改成「按活的 MRU 实时排序」，连按两下时列表顺序会跟着变，
 * 用户看到列表在跳，而「下一个」的参照系也自相矛盾。
 *
 * 【aria-hidden 的理由】切换结果已由 `role="tab"` + `aria-selected` 播报一次；
 * 浮层是纯视觉便利件，再播一遍会让读屏把同一件事说两次。
 *
 * 【pointer-events: none】它只存在 200ms，绝不能吃掉下一次点击。
 */
import { t } from '../i18n/index.js'

defineProps({
  open: { type: Boolean, default: false },
  /** DocSession[]（已按快照序排好，父组件负责把 id 解析成对象并滤掉已关的） */
  rows: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="tab-switcher" aria-hidden="true" :data-active-id="activeId">
      <div
        v-for="s in rows"
        :key="s.id"
        class="switcher-row"
        :class="{ 'is-active': s.id === activeId }"
      >
        <span class="switcher-title">{{ s.title }}</span>
        <span v-if="s.dirty" class="switcher-dot"></span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tab-switcher {
  position: fixed;
  /* 紧贴标签栏下沿：标题栏 38px（--titlebar-height）+ 标签栏 34px + 一档间距。
     这里的 34px 就是 TabBar.vue 里 `.tab-bar` 的 height，两处必须一起改。 */
  top: calc(var(--titlebar-height) + 34px + var(--space-2));
  left: var(--space-4);
  z-index: 400; /* 与右键菜单同层（同为标签栏的下拉件） */
  min-width: 200px;
  max-width: 320px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--elev-raised);
  pointer-events: none; /* 200ms 的浮层绝不能吃掉下一次点击 */
  --wails-draggable: no-drag;
}

.switcher-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--fg-2);
  font-size: var(--text-sm);
}

.switcher-row.is-active { background: var(--surface-2); color: var(--fg); }

.switcher-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switcher-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--meta);
}

/* 瞬时 chrome，不上纸面。父组件的 scoped 规则打不到子组件内部，故自持一份 */
@media print {
  .tab-switcher { display: none !important; }
}
</style>
