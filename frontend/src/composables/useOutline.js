// useOutline — 大纲当前节高亮 + 标题跳转
// ----------------------------------------------------------------------------
// 【为什么从 useOutlineSync.js 改名重写：单栏重构的连带后果】
// 原模块有两块职责：
//   1) 跨栏滚动联动（编辑区 ⇄ 预览区的锚点映射、互斥锁、回声识别）——
//      随双栏视图一起下线，本文件不含任何一行相关代码；
//   2) 大纲当前节高亮 + 点击跳转 —— 保留，就是现在这个模块。
//
// 高亮原理：扫编辑器里所有标题行的文档坐标 y（尾锚点取 max(最后标题, maxScroll)
// 保证序列非递减），用「视口顶部所处标题区间」反查下标。
// 缓存按视图态分别有效（编辑态用编辑器度量，阅读态用预览 DOM 度量），
// 失效点为 invalidateMeasure（窗口 resize / 视图切换 / 文档替换）。

import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const HEADING_SEL = '.preview-body h1,.preview-body h2,.preview-body h3,.preview-body h4,.preview-body h5,.preview-body h6'

/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor  () => EditorView|null
 * @param {import('vue').Ref<string>} deps.viewMode 'edit'|'reading'
 * @param {import('vue').Ref<boolean>} deps.sidebarOpen 侧栏可见性（关闭时不做高亮计算）
 * @param {import('vue').Ref<Array>}  deps.outline 大纲数据
 */
export function useOutline({ getEditor, viewMode, sidebarOpen, outline }) {
  const outlineActive = ref(-1) // 当前节在大纲里的下标，-1 = 首个标题之前

  let ysCache = null // { mode, ys }
  let ysDirty = true
  let queued = false

  /** 缓存失效点：窗口尺寸变化、视图切换、文档替换后调用 */
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

  // 预览侧 y 序列：querySelectorAll 天然按 DOM 顺序返回
  function collectPreviewYs(pane) {
    if (!pane) return null
    const base = pane.getBoundingClientRect().top - pane.scrollTop
    const ys = [0]
    for (const h of pane.querySelectorAll(HEADING_SEL)) {
      ys.push(h.getBoundingClientRect().top - base)
    }
    ys.push(Math.max(ys[ys.length - 1], pane.scrollHeight - pane.clientHeight))
    return ys
  }

  function getYs() {
    const mode = viewMode.value
    if (ysDirty || !ysCache || ysCache.mode !== mode) {
      ysCache = null
      if (mode === 'reading') {
        // setext 下划线标题（标题\n===）预览 DOM 会渲染、doc 扫描不到，
        // 数量与大纲对不上时放弃高亮（列表自身不受影响）
        const pv = collectPreviewYs(paneOf())
        if (pv && pv.length - 2 === outline.value.length) ysCache = { mode, ys: pv }
      } else {
        const ed = collectEditorYs()
        if (ed) ysCache = { mode, ys: ed }
      }
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
    const top = viewMode.value === 'reading'
      ? (paneOf()?.scrollTop ?? 0)
      : (getEditor()?.scrollDOM.scrollTop ?? 0)
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

  // 阅读态的滚动容器由 App.vue 的 ref 注入（避免本模块反向依赖组件树）
  let readingPaneGetter = () => null
  function setReadingPane(getter) {
    readingPaneGetter = getter
  }
  function paneOf() {
    return readingPaneGetter()
  }

  /** 大纲点击跳转：编辑态用编辑器 dispatch，阅读态走预览 DOM */
  function jumpToHeading(item, index) {
    if (viewMode.value === 'reading') {
      const pane = paneOf()
      const headings = pane?.querySelectorAll(HEADING_SEL)
      // 编辑器与预览的标题数可能不等（setext 标题 doc 扫不到），
      // 数量对不上就静默放弃 —— 错误跳转比不跳更糟
      if (headings && headings.length === outline.value.length) {
        headings[index].scrollIntoView({ block: 'start' })
      }
      return
    }
    const editor = getEditor()
    editor?.dispatch({
      selection: { anchor: item.pos },
      scrollIntoView: true,
    })
    editor?.focus()
  }

  // ---------- 度量失效的两个自持来源（从 App.vue 搬来） ----------
  // 1) 切回编辑态：display:none 期间 CM6 的高度度量全部失真，重测一遍。
  //    放在本模块而不是 useWorkspace，是为了不反向依赖调用方（useWorkspace
  //    需要 viewMode，本模块再需要它就会成环）。
  watch(viewMode, (mode) => {
    if (mode !== 'edit') return
    nextTick(() => {
      getEditor()?.requestMeasure()
      invalidateMeasure()
    })
  })
  // 2) 窗口尺寸变化：视口高度变了，已缓存的 y 序列全部作废。
  onMounted(() => window.addEventListener('resize', invalidateMeasure))
  onBeforeUnmount(() => window.removeEventListener('resize', invalidateMeasure))

  return {
    outlineActive,
    invalidateMeasure,
    scheduleOutlineSync,
    jumpToHeading,
    setReadingPane,
  }
}