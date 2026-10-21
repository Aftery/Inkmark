// tableDrag.js — 表格行列拖拽重排（鼠标按住行/列手柄拖到目标位置）
// ----------------------------------------------------------------------------
// 【交互模型】与 Typora / Notion 一致：
//   - 表头单元格上方出现「列手柄」（鼠标悬停在表头行上时显形），按住左右拖 →
//     整列跟着走，落点高亮一条竖线；
//   - 每个表体行左侧出现「行手柄」，按住上下拖 → 整行重排，落点高亮一条横线；
//   - 松手才真正改文档（拖拽全程不写文档）—— 中途按 Esc 即取消。
//
// 【为什么用手柄而不是直接拖单元格】单元格是 contenteditable：按住它拖选文字
// 是用户最常用的动作，把它改成拖拽会让「选一段字」彻底失灵。手柄是独立的
// 非可编辑元素，两者互不抢占。
//
// 【为什么松手才写文档】拖拽会产出几十次 pointermove，每次写文档都会触发
// 装饰重建（tableRender 的 StateField 全文档重扫）+ 撤销栈爆炸（一次拖拽上百条
// 撤销记录，⌘Z 要按到手酸）。松手一次 dispatch = 一条撤销记录。
//
// 【为什么 getTable 是函数】结构变更（增删行列 / 重排）后 widget 会把 <table>
// 整个换掉（见 tableWidget.js 文件头），闭包里若捕获旧元素，拖拽就作用在
// 已经脱离文档的节点上 —— 表现为「拖了没反应，也不报错」。
//
// 纯计算部分（dropIndexAt / toMoveIndex / isNoopMove）单独导出，供单测直接驱动。

import { t } from '../i18n/index.js'

/**
 * 根据指针坐标算落点下标。
 *
 * @param {Array<{start:number,end:number}>} spans 各元素的 [开始, 结束) 坐标（已排序）
 * @param {number} pos 指针坐标（与 spans 同一坐标系）
 * @returns {number} 插入位（0..spans.length）；等于 spans.length 表示落在末尾
 *
 * 判定口径：指针落在某元素的前半段 → 插到它之前，后半段 → 插到它之后。
 * 与文件拖拽的通行直觉一致（拖到目标左半边 = 放到它前面）。
 */
export function dropIndexAt(spans, pos) {
  if (!spans.length) return 0
  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i]
    if (pos < (start + end) / 2) return i
  }
  return spans.length
}

/**
 * 把「插入位」换算成「移动后的目标下标」。
 *
 * 移动语义（moveColumn/moveRow 都是「抽出再插入」）下两者差一位：
 * 元素从 from 抽走后，原本位于它之后的元素整体前移一位。
 * 例：4 列 [a,b,c,d]，把 a 拖到「c 与 d 之间」（插入位 3）→ 目标下标 2 → [b,c,a,d]。
 *
 * @param {number} from 被拖元素当前下标
 * @param {number} insertAt 插入位（0..n，来自 dropIndexAt）
 */
export function toMoveIndex(from, insertAt) {
  return insertAt > from ? insertAt - 1 : insertAt
}

/** 该落点是否真的会改变顺序（落在自身位置视为不变，省掉一次无意义写回） */
export function isNoopMove(from, to) {
  return from === to
}

/**
 * 给表格装拖拽手柄。
 *
 * @param {Object} cfg
 * @param {HTMLElement} cfg.wrap 外层 .cm-md-table（手柄与落点线的定位基准）
 * @param {() => HTMLTableElement|null} cfg.getTable 取**当前**表格本体
 * @param {AbortSignal} cfg.signal 随 widget 销毁解绑
 * @param {(kind:'row'|'col', from:number, to:number) => void} cfg.onMove 松手回调
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function attachTableDrag({ wrap, getTable, signal, onMove }) {
  const state = { kind: null, from: -1, insertAt: null }

  const ghost = document.createElement('div')
  ghost.className = 'cm-md-table-drop'
  ghost.setAttribute('aria-hidden', 'true')
  wrap.appendChild(ghost)

  const colHandles = document.createElement('div')
  colHandles.className = 'cm-md-table-handles cm-md-table-handles--col'
  wrap.appendChild(colHandles)

  const rowHandles = document.createElement('div')
  rowHandles.className = 'cm-md-table-handles cm-md-table-handles--row'
  wrap.appendChild(rowHandles)

  /** 重建手柄：位置按目标元素的实际几何排（列宽由内容决定，没法用百分比算） */
  function layout() {
    const table = getTable()
    if (!table) return
    colHandles.textContent = ''
    rowHandles.textContent = ''
    const wrapRect = wrap.getBoundingClientRect()

    const headRow = table.tHead?.rows?.[0]
    if (headRow) {
      ;[...headRow.cells].forEach((cell, i) => {
        const r = cell.getBoundingClientRect()
        const h = document.createElement('span')
        h.className = 'cm-md-table-handle'
        h.dataset.kind = 'col'
        h.dataset.index = String(i)
        h.title = t('table.dragColumn')
        h.setAttribute('aria-label', t('table.dragColumn'))
        h.style.left = `${r.left - wrapRect.left}px`
        h.style.width = `${r.width}px`
        h.style.top = '0px'
        colHandles.appendChild(h)
      })
    }
    ;[...(table.tBodies[0]?.rows ?? [])].forEach((tr, i) => {
      const r = tr.getBoundingClientRect()
      const h = document.createElement('span')
      h.className = 'cm-md-table-handle'
      h.dataset.kind = 'row'
      h.dataset.index = String(i)
      h.title = t('table.dragRow')
      h.setAttribute('aria-label', t('table.dragRow'))
      h.style.top = `${r.top - wrapRect.top}px`
      h.style.left = '0px'
      h.style.height = `${r.height}px`
      rowHandles.appendChild(h)
    })
  }

  /** 拖拽中：算落点并画指示线（不写文档） */
  function onPointerMove(e) {
    if (!state.kind) return
    const table = getTable()
    if (!table) return
    const isCol = state.kind === 'col'
    const spans = isCol
      ? [...(table.tHead?.rows?.[0]?.cells ?? [])].map((c) => {
          const r = c.getBoundingClientRect()
          return { start: r.left, end: r.right }
        })
      : [...(table.tBodies[0]?.rows ?? [])].map((tr) => {
          const r = tr.getBoundingClientRect()
          return { start: r.top, end: r.bottom }
        })
    if (!spans.length) return

    const insertAt = dropIndexAt(spans, isCol ? e.clientX : e.clientY)
    state.insertAt = insertAt
    const wrapRect = wrap.getBoundingClientRect()
    const edge = insertAt >= spans.length ? spans[spans.length - 1].end : spans[insertAt].start

    if (isCol) {
      const headRect = table.tHead.getBoundingClientRect()
      const bodyRect = table.getBoundingClientRect()
      ghost.className = 'cm-md-table-drop is-col'
      ghost.style.left = `${edge - wrapRect.left}px`
      ghost.style.top = `${headRect.top - wrapRect.top}px`
      ghost.style.height = `${bodyRect.bottom - headRect.top}px`
      ghost.style.width = '2px'
    } else {
      const bodyRect = table.getBoundingClientRect()
      ghost.className = 'cm-md-table-drop is-row'
      ghost.style.top = `${edge - wrapRect.top}px`
      ghost.style.left = `${bodyRect.left - wrapRect.left}px`
      ghost.style.width = `${bodyRect.width}px`
      ghost.style.height = '2px'
    }
  }

  /** 松手：算目标下标并提交一次移动 */
  function onPointerUp() {
    if (!state.kind) return
    const { kind, from, insertAt } = state
    cleanup()
    if (insertAt == null) return
    const to = toMoveIndex(from, insertAt)
    if (isNoopMove(from, to)) return
    onMove(kind, from, to)
    layout()
  }

  /** Esc 取消拖拽（拖到一半发现拖错了） */
  function onKeydown(e) {
    if (e.key !== 'Escape' || !state.kind) return
    e.preventDefault()
    e.stopPropagation()
    cleanup()
  }

  function cleanup() {
    state.kind = null
    state.from = -1
    state.insertAt = null
    wrap.classList.remove('is-dragging', 'is-dragging--col', 'is-dragging--row')
    ghost.className = 'cm-md-table-drop'
  }

  /** 拖拽起点：按下手柄 */
  function onPointerDown(e) {
    const handle = e.target.closest?.('.cm-md-table-handle')
    if (!handle) return
    e.preventDefault()
    e.stopPropagation()
    state.kind = handle.dataset.kind
    state.from = Number(handle.dataset.index)
    state.insertAt = null
    wrap.classList.add('is-dragging', `is-dragging--${state.kind}`)
    window.addEventListener('pointermove', onPointerMove, { signal })
    window.addEventListener('pointerup', onPointerUp, { signal })
    window.addEventListener('pointercancel', cleanup, { signal })
    window.addEventListener('keydown', onKeydown, { signal })
  }

  wrap.addEventListener('pointerdown', onPointerDown, { signal })
  // 拖拽期间禁止选中文字（否则整屏文字被高亮）
  wrap.addEventListener('selectstart', (e) => { if (state.kind) e.preventDefault() }, { signal })

  // 几何变化（内容换行 / 增删行列）后手柄要跟着重排。
  //
  // 【为什么要 unobserve 旧表】结构变更后 widget 会把 <table> 整个换掉
  // （见 tableWidget.js 文件头）。只 observe 新表而不放掉旧表，旧表虽然已脱离
  // 文档却仍被 RO 持有 → 每次 refresh 都多一个观察者，长编辑会话下是稳定的泄漏。
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => layout())
  let observed = null
  const observe = () => {
    const tbl = getTable()
    if (!ro || !tbl || tbl === observed) return
    if (observed) ro.unobserve(observed)
    ro.observe(tbl)
    observed = tbl
  }
  observe()
  signal.addEventListener('abort', () => ro?.disconnect(), { once: true })

  layout()
  return {
    refresh: () => { observe(); layout() },
    destroy: () => { ro?.disconnect(); observed = null },
  }
}
