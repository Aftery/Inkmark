// useOutlineSync — 双向滚动联动 + 大纲当前节高亮（从 App.vue 机械搬移，行为零变更）
// ----------------------------------------------------------------------------
// 搬移基线：Phase C 编辑器轨道交付版 App.vue 同名函数与注释，逐行未改逻辑，
// 仅把闭包变量改为依赖注入（editor 用 getter —— 实例在 onMounted 才创建）。
//
// 联动原理（详见各函数体注释）：标题锚点映射 + 互斥锁防循环 + 回声识别；
// 高亮原理：标题 y 序列反查「视口顶部所处标题区间」，缓存按视图态分别有效。

import { ref } from 'vue'

const HEADING_SEL = '.preview-body h1,.preview-body h2,.preview-body h3,.preview-body h4,.preview-body h5,.preview-body h6'

/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor  () => EditorView|null
 * @param {import('vue').Ref<HTMLElement|null>} deps.previewEl 预览滚动容器
 * @param {import('vue').Ref<string>} deps.viewMode 'edit'|'preview'|'split'|'reading'
 * @param {import('vue').Ref<boolean>} deps.sidebarOpen 侧栏可见性
 * @param {import('vue').Ref<Array>}  deps.outline 大纲数据
 * @param {Function} [deps.syncEnabled] 滚动联动开关（菜单 checkbox）；
 *   返回 false 时只保留大纲高亮，不做跨栏联动写入
 */
export function useOutlineSync({ getEditor, previewEl, viewMode, sidebarOpen, outline, syncEnabled }) {
  const outlineActive = ref(-1) // 当前节在大纲里的下标，-1 = 首个标题之前

  let anchorsCache = null
  let anchorsDirty = true
  let outlineYsCache = null // { mode, ys }
  let outlineYsDirty = true
  let outlineSyncQueued = false
  let syncingScroll = false
  let lastSyncWrite = null // { el, value }

  function invalidateAnchors() {
    anchorsDirty = true
    outlineYsDirty = true // 大纲当前节高亮的 y 缓存同点失效
  }

  // 编辑器侧锚点：扫描标题行的行首位置并转成文档坐标 y。
  // 围栏代码块（``` / ~~~）内的 # 不算标题，用简单的开关状态机跳过。
  function collectEditorAnchors() {
    const editor = getEditor()
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
    // 尾锚点必须 >= 最后一个标题 y，否则序列可能非递增（末尾标题贴底时）
    ys.push(Math.max(ys[ys.length - 1], scroll.scrollHeight - scroll.clientHeight))
    return ys
  }

  // 预览侧锚点：querySelectorAll 天然按 DOM 顺序返回，与编辑器侧行序一致
  function collectPreviewAnchors() {
    const pane = previewEl.value
    if (!pane) return null
    const base = pane.getBoundingClientRect().top - pane.scrollTop
    const ys = [0]
    for (const h of pane.querySelectorAll(HEADING_SEL)) {
      ys.push(h.getBoundingClientRect().top - base)
    }
    ys.push(Math.max(ys[ys.length - 1], pane.scrollHeight - pane.clientHeight))
    return ys
  }

  // 惰性重建：首次滚动/锚点失效后的第一次滚动事件才收集（一次性 layout 开销）
  function getAnchors() {
    if (anchorsDirty || !anchorsCache) {
      anchorsDirty = false
      anchorsCache = null
      // 锚点收集依赖两栏可见且度量有效（coordsAtPos / DOM 位置）：
      // 编辑/预览单栏态下另一侧 display:none，度量全是废值，直接拒绝收集
      if (viewMode.value === 'split' && getEditor() && previewEl.value) {
        const ed = collectEditorAnchors()
        const pv = collectPreviewAnchors()
        if (pv && ed.length === pv.length) anchorsCache = { ed, pv }
      }
    }
    return anchorsCache
  }

  // 在 src 锚点序列中定位 srcTop 所处区间，线性插值到 dst 对应区间
  function mapByAnchors(srcTop, src, dst) {
    const last = src.length - 1
    const t = Math.min(Math.max(srcTop, 0), src[last])
    let i = 1
    while (i < last && src[i] < t) i++
    const s0 = src[i - 1], s1 = src[i]
    if (s1 <= s0) return dst[i]
    return dst[i - 1] + ((t - s0) / (s1 - s0)) * (dst[i] - dst[i - 1])
  }

  // 联动写入记录：识别「联动引发的回声滚动」，断掉 编辑→预览→编辑 的放大循环。
  // 为什么 rAF 互斥锁不够：scroll 事件的派发晚于 rAF 回调（锁已释放）。
  // 正常位置锚点映射可逆（来回映射值相同、不触发事件、自然收敛），所以平时没事；
  // 但拖到底部时 CM6 的高度估计随实测逐步修正，锚点序列与真实高度短暂不符，
  // 映射不再可逆，每轮循环把对侧往上拉一点、修正量递减 —— 表现为「页面自己慢慢往上滑」。
  // 解法：联动写入前把目标 clamp 到对侧真实 maxScroll，并记录写入值；
  // 事件到达时 scrollTop ≈ 写入值即为本方写入的回声，直接忽略。
  function isSyncEcho(el) {
    if (!lastSyncWrite || lastSyncWrite.el !== el) return false
    const echo = Math.abs(el.scrollTop - lastSyncWrite.value) <= 1
    lastSyncWrite = null
    return echo
  }

  function onEditorScroll() {
    scheduleOutlineSync() // 滚动驱动大纲当前节高亮（rAF 节流）——联动关闭时仍保留
    // 联动开关（视图菜单 checkbox）：关闭时高亮照常、跨栏写入终止
    if (syncEnabled && !syncEnabled()) return
    // 单栏态守卫（交互 Spec §1.4）：对侧 display:none，联动无意义
    if (viewMode.value !== 'split' || syncingScroll || !getEditor() || !previewEl.value) return
    const cm = getEditor().scrollDOM
    if (isSyncEcho(cm)) return // 本方写入引发的回声，不反向联动
    syncingScroll = true
    const pane = previewEl.value
    const a = getAnchors()
    const pvMax = pane.scrollHeight - pane.clientHeight
    const target = a
      ? mapByAnchors(cm.scrollTop, a.ed, a.pv)
      : (cm.scrollTop / Math.max(1, cm.scrollHeight - cm.clientHeight)) * pvMax
    // clamp 到真实可达值：写入被钳制会让「写入值 ≠ 实际值」，回声识别失效
    lastSyncWrite = { el: pane, value: Math.max(0, Math.min(target, pvMax)) }
    pane.scrollTop = lastSyncWrite.value
    requestAnimationFrame(() => (syncingScroll = false))
  }

  function onPreviewScroll() {
    scheduleOutlineSync() // 预览态下以预览滚动驱动高亮
    if (syncEnabled && !syncEnabled()) return
    if (viewMode.value !== 'split' || syncingScroll || !getEditor() || !previewEl.value) return
    const pane = previewEl.value
    if (isSyncEcho(pane)) return
    syncingScroll = true
    const cm = getEditor().scrollDOM
    const a = getAnchors()
    const edMax = cm.scrollHeight - cm.clientHeight
    const target = a
      ? mapByAnchors(pane.scrollTop, a.pv, a.ed)
      : (pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight)) * edMax
    lastSyncWrite = { el: cm, value: Math.max(0, Math.min(target, edMax)) }
    cm.scrollTop = lastSyncWrite.value
    requestAnimationFrame(() => (syncingScroll = false))
  }

  // ys = [0, y1..yn, tail]：返回视口顶部所处区间的标题下标（0 基），首个标题之前为 -1
  function headingIndexAt(ys, top) {
    let i = ys.length - 1
    while (i > 0 && ys[i] > top) i--
    return i - 1
  }

  // 滚动事件高频触发，反查用 requestAnimationFrame 节流（与互斥锁同量级）
  function scheduleOutlineSync() {
    if (outlineSyncQueued || !sidebarOpen.value) return
    outlineSyncQueued = true
    requestAnimationFrame(() => {
      outlineSyncQueued = false
      updateOutlineHighlight()
    })
  }

  // ---- 当前节高亮（交互 Spec 3.2/3.4）----
  // 数据驱动：编辑/双栏态用编辑器滚动位置、预览/阅读态用预览滚动位置，
  // 在标题 y 序列（collectEditor/PreviewAnchors，首尾带哨兵）里反查
  // 「视口顶部所处标题区间」。标题 y 依赖当前视图态下的实际布局（单栏全宽与
  // 双栏分宽不同），所以缓存按视图态分别有效；失效点与锚点缓存共用
  // invalidateAnchors（不能用 anchorsDirty 本身——它在编辑态无人重置，
  // 会让高亮缓存每帧重算全文档扫描）。
  function getOutlineYs() {
    const mode = viewMode.value
    if (outlineYsDirty || !outlineYsCache || outlineYsCache.mode !== mode) {
      outlineYsCache = null
      if (mode === 'preview' || mode === 'reading') {
        const pv = collectPreviewAnchors() // 预览/阅读态预览区可见，度量有效
        // setext 下划线标题（标题\n===）预览 DOM 会渲染、doc 扫描不到，
        // 数量不符时高亮下标与大纲列表错位——放弃高亮（列表自身不受影响）
        if (pv && pv.length - 2 === outline.value.length) outlineYsCache = { mode, ys: pv }
      } else if (getEditor()) {
        // 编辑/双栏态编辑器可见，coordsAtPos 有效（预览隐藏不影响编辑器侧）
        outlineYsCache = { mode, ys: collectEditorAnchors() }
      }
      outlineYsDirty = false
    }
    return outlineYsCache ? outlineYsCache.ys : null
  }

  function updateOutlineHighlight() {
    if (!sidebarOpen.value || !outline.value.length) return
    const ys = getOutlineYs()
    if (!ys) return // 两侧都不可用的极端态：不高亮
    const top =
      viewMode.value === 'preview' || viewMode.value === 'reading'
        ? (previewEl.value?.scrollTop ?? 0)
        : (getEditor()?.scrollDOM.scrollTop ?? 0)
    const index = headingIndexAt(ys, top)
    if (index !== outlineActive.value) outlineActive.value = index
  }

  // 大纲点击跳转：按视图态分流。
  // 预览/阅读态编辑器隐藏，scrollIntoView 无效，走预览 DOM 按序号跳；
  // 编辑/双栏态用编辑器 dispatch（scrollIntoView 让 CM6 保证目标行进视口）。
  function jumpToHeading(item, index) {
    if (viewMode.value === 'preview' || viewMode.value === 'reading') {
      const headings = previewEl.value?.querySelectorAll(HEADING_SEL)
      // 编辑器与预览的标题数可能不等（setext 下划线标题扫不到），
      // 数量对不上就静默放弃——错误跳转比不跳更糟
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

  return {
    outlineActive,
    invalidateAnchors,
    onEditorScroll,
    onPreviewScroll,
    scheduleOutlineSync,
    jumpToHeading,
  }
}
