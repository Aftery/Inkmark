<script setup>
// 文件树：懒加载（点目录才调用 Go 的 ListDir），只显示 md/txt 文件和目录
import { ref, watch } from 'vue'
import { ListDir } from '../../wailsjs/go/main/App'
import TreeNode from './TreeNode.vue'

const props = defineProps({
  root: { type: String, required: true },
  // 外部变更信号：数值递增即重新拉取根目录列表（Go 侧 fsnotify 触发）
  reloadSignal: { type: Number, default: 0 },
})
const emit = defineEmits(['select'])

const entries = ref([])
const loaded = ref(false)

const MD_EXTS = new Set(['md', 'markdown', 'mdown', 'txt'])

async function load() {
  const all = await ListDir(props.root)
  entries.value = all.filter((e) => e.isDir || MD_EXTS.has(e.ext))
  loaded.value = true
}
load()

// 根目录切换或外部变更信号变化时重新拉取。
// TreeNode 以 path 为 key，列表更新不会重建已展开的子节点，展开态得以保留。
watch(() => [props.root, props.reloadSignal], load)
</script>

<template>
  <div class="file-tree">
    <TreeNode
      v-for="entry in entries"
      :key="entry.path"
      :entry="entry"
      @select="emit('select', $event)"
    />
    <div v-if="loaded && entries.length === 0" class="tree-empty">没有 Markdown 文件</div>
  </div>
</template>

<style scoped>
.file-tree { overflow-y: auto; padding: var(--space-2) var(--space-1); }
.tree-empty {
  padding: var(--space-1) var(--space-3);
  color: var(--muted);
  font-size: var(--text-xs);
}
</style>
