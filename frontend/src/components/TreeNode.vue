<script setup>
// 递归树节点：目录点击时懒加载子项（调 Go 的 ListDir）
// 图标统一走 AppIcon（全项目唯一渲染入口），16px 行内尺寸
import { ref, computed } from 'vue'
import { ListDir } from '../../wailsjs/go/main/App'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps({
  entry: { type: Object, required: true },
  depth: { type: Number, default: 0 },
})
const emit = defineEmits(['select'])

const MD_EXTS = new Set(['md', 'markdown', 'mdown', 'txt'])

const open = ref(false)
const children = ref(null) // null = 未加载
const loading = ref(false)

const iconName = computed(() =>
  props.entry.isDir ? (open.value ? 'folder-open' : 'folder') : 'file'
)

async function toggle() {
  if (!props.entry.isDir) {
    emit('select', props.entry.path)
    return
  }
  open.value = !open.value
  if (open.value && children.value === null) {
    loading.value = true
    const all = await ListDir(props.entry.path)
    children.value = all.filter((e) => e.isDir || MD_EXTS.has(e.ext))
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div class="tree-row" :style="{ paddingLeft: 8 + depth * 16 + 'px' }" @click="toggle">
      <AppIcon class="tree-icon" :name="iconName" size="inline" />
      <span class="tree-name">{{ entry.name }}</span>
    </div>
    <div v-if="entry.isDir && open">
      <div v-if="loading" class="tree-hint">加载中…</div>
      <template v-else>
        <TreeNode
          v-for="child in children || []"
          :key="child.path"
          :entry="child"
          :depth="depth + 1"
          @select="emit('select', $event)"
        />
        <div v-if="children && children.length === 0" class="tree-hint">（空目录）</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex; align-items: center; gap: var(--space-2);
  padding-top: 5px; padding-bottom: 5px; padding-right: var(--space-2);
  border-radius: var(--radius-sm); cursor: pointer;
  color: var(--fg-2); white-space: nowrap;
  font-size: var(--text-sm);
  transition: background-color var(--motion-fast) var(--ease-standard),
              color var(--motion-fast) var(--ease-standard);
}
.tree-row:hover { background: var(--surface-2); color: var(--fg); }
.tree-icon { color: var(--muted); flex-shrink: 0; }
.tree-row:hover .tree-icon { color: var(--fg-2); }
.tree-name { overflow: hidden; text-overflow: ellipsis; }
.tree-hint {
  padding: var(--space-1) var(--space-3);
  color: var(--muted);
  font-size: var(--text-xs);
}
</style>
