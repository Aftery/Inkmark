// useOutline — 大纲当前节高亮 + 标题跳转
// ----------------------------------------------------------------------------
// 【为什么从 useOutlineSync.js 改名重写：单栏重构的连带后果】
// 原模块有两块职责：
//   1) 跨栏滚动联动（编辑区 ⇄ 预览区的锚点映射、互斥锁、回声识别）——
//      随双栏视图一起下线，本文件不含任何一行相关代码；
//   2) 大纲当前节高亮 + 点击跳转 —— 保留，就是现在这个模块。
//
// 【阅读态已于 2026-10-14 移除】原先「编辑态编辑器度量 / 阅读态预览 DOM 度量」
// 的双路径收敛为纯编辑器路径；视图切换导致的度量失效源（watch viewMode +
// requestMeasure）随之消失，缓存失效点只剩窗口 resize 与 invalidateMeasure。
//
// 高亮原理：扫编辑器里所有标题行的文档坐标 y（尾锚点取 max(最后标题, maxScroll)
// 保证序列非递减），用「视口顶部所处标题区间」反查下标。

import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor  () => EditorView|null
 * @param {import('vue').Ref<boolean>} deps.sidebarOpen 侧栏可见性（关闭时不做高亮计算）
 * @param {import('vue').Ref<Array>}  deps.outline 大纲数据
 */
export function useOutline({ getEditor, sidebarOpen, outline }) {
  const outlineActive = ref(-1) // 当前节在大纲里的下标，-1 = 首个标题之前

  let ysCache = null
  let ysDirty = true
  let queued = false

  /** 缓存失效点：窗口尺寸变化、文档替换后调用 */
  function invalidateMeasure() {
    ysDirty = true
  }

  // 编辑器侧 y 序列：遍历文档标题行。围栏代码块（``` / ~~~）内的 # 不算标题，
  // 用一个开关状态机跳过。
  function collectEditorYs() {
    const editor = getEditor()
    if (!editor) return null
    const doc = editor.state.doc
    const scroll = editor.scrollDOM
    const base = scroll.getBoundingClientRect().top - scroll.scrollTop
    const ys = [0]
    let inCode = false
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i)
      const text = line.text.trim()
      if (text.startsWith('```') || text.startsWith('~~~')) inCode = !inCode
      if (!inCode && /^#{1,6}\s/.test(line.text)) {
        const c = editor.coordsAtPos(line.from)
        if (c) ys.push(c.top - base)
      }
    }
    // 哨兵：保证序列非递减，否则 headingIndexAt 的二分式回退会失效
    ys.push(Math.max(ys[ys.length - 1], scroll.scrollHeight - scroll.clientHeight))
    return ys
  }

  function getYs() {
    if (ysDirty || !ysCache) {
      ysCache = null
      const ed = collectEditorYs()
      if (ed) ysCache = { ys: ed }
      ysDirty = false
    }
    return ysCache ? ysCache.ys : null
  }

  // ys = [0, y1..yn, tail]：返回视口顶部所处区间的标题下标（0 基），首个标题之前为 -1
  function headingIndexAt(ys, top) {
    let i = ys.length - 1
    while (i > 0 && ys[i] > top) i--
    return i - 1
  }

  function updateOutlineHighlight() {
    if (!sidebarOpen.value || !outline.value.length) return
    const ys = getYs()
    if (!ys) return // 度量不可用的极端态：不高亮
    const top = getEditor()?.scrollDOM.scrollTop ?? 0
    const index = headingIndexAt(ys, top)
    if (index !== outlineActive.value) outlineActive.value = index
  }

  // 滚动事件高频触发，反查用 requestAnimationFrame 节流
  function scheduleOutlineSync() {
    if (queued || !sidebarOpen.value) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      updateOutlineHighlight()
    })
  }

  /** 大纲点击跳转：光标锚到标题行行首并滚到可视区 */
  function jumpToHeading(item) {
    const editor = getEditor()
    editor?.dispatch({
      selection: { anchor: item.pos },
      scrollIntoView: true,
    })
    editor?.focus()
  }

  // 窗口尺寸变化：视口高度变了，已缓存的 y 序列全部作废。
  onMounted(() => window.addEventListener('resize', invalidateMeasure))
  onBeforeUnmount(() => window.removeEventListener('resize', invalidateMeasure))

  return {
    outlineActive,
    invalidateMeasure,
    scheduleOutlineSync,
    jumpToHeading,
  }
}
