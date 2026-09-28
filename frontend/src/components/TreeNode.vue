<script setup>
// 递归树节点：目录点击时懒加载子项（调 Go 的 ListDir）
import { ref } from 'vue'
import { ListDir } from '../../wailsjs/go/main/App'

const props = defineProps({
  entry: { type: Object, required: true },
  depth: { type: Number, default: 0 },
})
const emit = defineEmits(['select'])

const MD_EXTS = new Set(['md', 'markdown', 'mdown', 'txt'])

const open = ref(false)
const children = ref(null) // null = 未加载
const loading = ref(false)

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
    <div class="tree-row" :style="{ paddingLeft: 10 + depth * 16 + 'px' }" @click="toggle">
      <span class="tree-icon">
        {{ entry.isDir ? (open ? '📂' : '📁') : '📄' }}
      </span>
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
  display: flex; align-items: center; gap: 6px;
  padding-top: 4px; padding-bottom: 4px; padding-right: 10px;
  border-radius: 6px; cursor: pointer;
  color: var(--text-primary); white-space: nowrap;
}
.tree-row:hover { background: var(--bg-tertiary); }
.tree-icon { font-size: 13px; flex-shrink: 0; }
.tree-name { overflow: hidden; text-overflow: ellipsis; }
.tree-hint { padding: 4px 10px; color: var(--text-secondary); font-size: 12px; }
</style>
