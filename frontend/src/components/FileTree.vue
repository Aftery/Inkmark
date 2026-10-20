<script setup>
// 文件树：懒加载（点目录才调用 Go 的ListDir），只显示 md/txt 文件和目录
import { ref, watch } from 'vue'
import { ListDir } from '../../wailsjs/go/main/App'
import TreeNode from './TreeNode.vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  root: { type: String, required: true },
  // 外部变更信号：数值递增即重新拉取根目录列表（Go 侧 fsnotify 触发）
  reloadSignal: { type: Number, default: 0 },
})
const emit = defineEmits(['select'])

const entries = ref([])
const loaded = ref(false)

const MD_EXTS = new Set(['md', 'markdown', 'mdown', 'txt'])

// 序号守卫：快速切换根目录 / 连续收到 fs:changed 时会有多个 ListDir 并发在飞，
// 先发的**后返回**就会把旧目录的内容盖到新目录上（表现为「切了文件夹但树还是旧的」）。
// 每次加载领一个序号，回来时序号已变即丢弃自己的结果。
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  try {
    const all = await ListDir(props.root)
    if (seq !== loadSeq) return // 已被更新的请求取代
    entries.value = all.filter((e) => e.isDir || MD_EXTS.has(e.ext))
  } catch (err) {
    // 与 TreeNode 同族：根目录可能已被删除 / 无权限，不能让 rejection 悬空
    if (seq !== loadSeq) return
    console.warn('[tree] 读取根目录失败', props.root, err)
    entries.value = []
  } finally {
    if (seq === loadSeq) loaded.value = true
  }
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
    <div v-if="loaded && entries.length === 0" class="tree-empty">{{ t('tree.empty') }}</div>
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
