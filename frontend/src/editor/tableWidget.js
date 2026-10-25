// tableWidget.js — 可编辑表格的 DOM widget（单元格编辑 / 键盘导航 / 行列操作触发）
// ----------------------------------------------------------------------------
// 从 tableRender.js 拆出：那个文件负责「什么时候把表格渲染出来」（语法树扫描 +
// StateField block 装饰），本文件负责「渲染出来之后用户怎么编辑它」。
//
// 【为什么单元格用 contenteditable】嵌套 EditorView 会在 block 装饰里与宿主
// 视图争抢焦点/选区，IME 合成事件还会串层。单层 contenteditable + 显式序列化
// 回文档是本仓实测可行的路径（见 HANDOFF 表格轮）。
//
// 【编辑期间的重渲染保护】用户打字会让文档变化 → 装饰重建。eq() 靠 activeWidget
// 识别「还是同一个表格」，让 CM 复用同一份 DOM，焦点与 IME 不被打断；
// 没有这道保护，每敲一个字光标都会跳回行首。
//
// 【结构变更后必须自己重建 DOM —— 这是个真陷阱】eq() 返回 true 时 CM **复用旧
// DOM**，而增删行列/重排/改对齐之后文档已变、旧 DOM 却还是老结构：用户会看到
// 「点了按钮没反应」，一离开再回来才对（因为那时才真正重建）。故结构类操作
// 一律走 rebuild()：按 model 重建 <table> 并把焦点按行列下标还原。

import { WidgetType } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { serializeTable, locateTable } from './tableRender.js'
import { selfSync, currentEditingWidget, setEditingWidget } from './tableSync.js'
import {
  ALIGN_CYCLE, createActionBar, insertColumn, insertRow, moveColumn, moveRow,
  nextAlign, removeColumn, removeRow, setAlignIndicator, setColumnAlign,
} from './tableOps.js'
import { attachTableDrag } from './tableDrag.js'
import { t } from '../i18n/index.js'
import { focusEnd, restoreCellFocus } from './tableFocus.js'
import {
  estimatedTableHeight, measureTableHeight, primeTableHeight,
} from './tableHeight.js'
import { buildTableFromModel } from './tableDom.js'

// ---------------- 【复用链令牌 cid】为什么 eq() 不能用实例身份判定 ----------------
// CM（@codemirror/view ≥6.43 的 Tile 渲染器）在 eq() 命中后走的是
// 「旧 DOM 配新实例」：findWidget 返回 `new WidgetTile(tile.dom, …, widget)`，
// 树上留下的新实例是**没有 DOM 的空壳**（toDOM 从未被调用，见 adoptRange 头注），
// 而真正挂监听、持 DOM 的旧实例从树上退场。于是按实例身份判定会这样断裂：
//   第 1 个字符：树实例 A(有DOM).eq(B1) —— 编辑标记 === A ⇒ 命中，DOM 复用；
//                复用后树上是空壳 B1；
//   第 2 个字符：B1.eq(B2) —— 标记仍指 A，与 B1/B2 都不是同一实例 ⇒ 落空
//                ⇒ 整表重建 ⇒ 单元格焦点随 DOM 移除丢失（WebKit 甚至不给
//                被移除元素发 focusout，用户看到的就是「打 2 个字光标没了」）。
// 2026-10-24 Linux（WebKitGTK 2.54 + 本仓 CM 版本）WebDriver 真机复现确认：
// 机制本身**与平台无关**，差别只在触发密度（该链在 macOS 上同样存在）。
//
// 修法：eq 判定从「实例身份」换成「DOM 出生链身份」—— toDOM 铸造一枚令牌
// （cid），eq 复用时递给树上留下的空壳实例，令牌随复用链一路传下去。
// 编辑标记始终指着 DOM 属主实例（focusin 设置，其 cid 即链首），
// 于是 B1.eq(B2) 也能凭 `this.cid === editing.cid` 认出同一份 DOM 的延续。
let cidSeq = 0

export class TableWidget extends WidgetType {
  constructor(t) {
    super()
    this.model = t.model
    this.key = t.source
    this.from = t.from
    this.to = t.to
    this.source = t.source
    this.dom = null
    this.table = null
    this.viewRef = null
    this.composing = false
    // 操作条的作用目标：最后一次获得焦点的单元格（未点过时默认表头第 0 列）
    this.activeCol = 0
    this.activeRow = -1
    this.ac = new AbortController()
    this.drag = null
    // cid = 「这份 DOM 的出生链」令牌，toDOM 铸造、eq 复用时传给新实例。
    // 为什么不能用实例身份判定「同一张表」——见 cidChain 注释块。
    this.cid = null
  }

  eq(other) {
    const editing = currentEditingWidget()
    // 编辑中必须优先保住焦点/IME：编辑标记所指实例的 DOM 还挂在文档里时，
    // this / other 任一是它的延续就复用。两条判定并存、任一命中即可：
    //   ① 实例身份（旧语义，兜底）：this / other 就是编辑标记所指实例；
    //   ② 出生链令牌 cid：≥6.43 渲染器复用后树上是空壳实例，实例身份会落空，
    //      凭 cid 认出它是同一份 DOM 的延续（机制见 cidChain 注释块）。
    const live = !!(editing && editing.dom?.isConnected)
    const sameIdentity = live && (this === editing || other === editing)
    const sameChain = !!(live && editing.cid != null &&
      (this.cid === editing.cid || other.cid === editing.cid))
    const reuse = sameIdentity || sameChain || other.key === this.key
    if (reuse) {
      // 复用后 CM 树上留下的是 other（空壳：旧 DOM 配新实例，见 adoptRange 头注），
      // 把出生链令牌递给它，链条才不会在第二个字符起断掉。
      if (other.cid == null) other.cid = this.cid ?? editing?.cid ?? null
      // 只在「同一个表格」时接区间：key 不同意味着源码变了、而 model 仍是旧的，
      // 此时把新 source 塞进来会造成「新 source + 旧 model」错配 —— 随后 sync()
      // 会用旧 DOM 序列化出的内容覆盖掉新内容（数据丢失）。故保守跳过。
      if (other.key === this.key) this.adoptRange(other)
    }
    return reuse
  }

  /**
   * 复用 DOM 时把「区间记账」接过来 —— CM 的复用语义有个不对称：
   *
   *   findWidget() 命中 eq() 之后返回的是 `new WidgetTile(tile.dom, …, widget)`
   *   ——**旧 DOM 配新实例**。新实例带的是刚解析出的最新 from/to，却因为 toDOM
   *   从未被调用而没有 dom / table / viewRef，是个空壳；真正挂着 input 监听、
   *   真正在收键盘事件的是**旧实例**。于是旧实例成了唯一活着的编辑者，而它的
   *   from/to 永远停在第一次渲染时的位置（CM 从不回写它）。
   *
   * 只要表格上方/下方被插入过文字（写正文、撤销、外部改动都会），旧实例的区间
   * 就整体偏移。此后再在单元格里打字，dispatchText() 拿过期区间去 sliceString，
   * 对不上 source 就转 locateTable —— 而过期位置常常已经不在任何 Table 节点里
   * （落在上方段落中），locateTable 返回 null，sync() 静默放弃：用户敲的字没进
   * 文档，光标却还在单元格里。这是「输入会跑行」里最容易被当成玄学的那一半。
   *
   * 修法：既然复用是「旧 DOM 继续用」，就把新实例的位置基准交给旧实例。只在
   * key（表格源码）一致时发生，故 model 内容必然一致，不动 model。
   */
  adoptRange(other) {
    if (other === this) return
    this.from = other.from
    this.to = other.to
    this.source = other.source
    this.key = other.key
  }

  /**
   * CM 的高度预估。覆写理由见 tableHeight.js 的文件头。
   *
   * 返回 -1（不知）只在「这张表从来没被量过」时发生，CM 会退回
   * oracle.lineHeight 并在下一帧 measure() 量回真值 —— 是安全的退化路径。
   * 一旦量过（本表或同一 key 的表），就返回缓存值，让 HeightMapBlock
   * 一开始就拿到接近真实的高度，不再每帧先塌回一行高再跳回来。
   *
   * [关键] 本 getter 在 NodeBuilder 里被同步调用，**早于** toDOM()，也早于
   * dispatchText() 返回。所以它只能查模块级缓存，不能依赖 this.dom 之类
   * 实例字段 —— 复用时 CM 给的是「旧 DOM + 新实例」，新实例是个空壳。
   */
  get estimatedHeight() {
    return estimatedTableHeight(this.key)
  }

  // 事件全部由 widget 自己处理（Tab/Enter 导航、Esc 退出、粘贴转纯文本），
  // CM 不参与 —— 否则点击单元格会被当作普通光标点击。
  // 【另见 tableInputGate.js】CM 对单元格内容的默认读回事务由 inputHandler
  // 全局拦截（拆到独立文件的原因与根因链见该文件头注）—— 不在这里注册，
  // 因为 eq() 复用断掉的实例收不到任何 widget 方法，全局通道才可靠。
  ignoreEvent() { return true }

  /**
   * 按 model 构建 <table>（重建与首次渲染共用，保证两条路径绝不会画出两种结构）。
   * 构建逻辑在 tableDom.js —— 拆出去是为守住 300 有效行红线（契约 5）。
   */
  buildTable() { return buildTableFromModel(this.model) }

  toDOM(view) {
    this.cid = ++cidSeq // 铸造出生链令牌（eq 复用时传给树上的空壳实例，见文件头）
    this.viewRef = view
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table'
    this.table = this.buildTable()
    wrap.appendChild(this.table)

    const opt = { signal: this.ac.signal }
    wrap.addEventListener('input', () => this.sync(), opt)
    wrap.addEventListener('compositionstart', () => { this.composing = true }, opt)
    wrap.addEventListener('compositionend', () => { this.composing = false; this.sync() }, opt)
    wrap.addEventListener('keydown', (e) => this.onKeydown(e), opt)
    wrap.addEventListener('paste', (e) => this.onPaste(e), opt)
    wrap.addEventListener('focusin', (e) => this.onFocusIn(e), opt)
    wrap.addEventListener('focusout', (e) => {
      if (e.relatedTarget && wrap.contains(e.relatedTarget)) return // 单元格间移动
      if (currentEditingWidget() === this) setEditingWidget(null)
      this.sync() // 离场前把最后一次未同步的输入落盘
    }, opt)

    // ---- 行列操作条（构建逻辑在 tableOps.js）----
    // 挂在 wrap 内而不是 body：它继承 ignoreEvent()=true，点击不会被 CM 当成
    // 点击文档；且随 widget 一起销毁（AbortSignal 在 destroy 里 abort）。
    this.bar = createActionBar((action) => this.runAction(action), this.ac.signal)
    wrap.appendChild(this.bar)
    // 悬停显形（样式见 editor-wysiwyg.css 的 .cm-md-table.is-hover）
    wrap.addEventListener('mouseenter', () => wrap.classList.add('is-hover'), opt)
    wrap.addEventListener('mouseleave', () => wrap.classList.remove('is-hover'), opt)

    // ---- 行列拖拽重排（tableDrag.js）----
    // getTable 而不是直接传元素：结构变更后 <table> 会被换掉，闭包里必须取最新那个
    this.drag = attachTableDrag({
      wrap,
      getTable: () => this.table,
      signal: this.ac.signal,
      onMove: (kind, from, to) => this.move(kind, from, to),
    })

    this.dom = wrap
    this.refreshIndicators()
    // 此处**不能**量高度：toDOM 的返回值还没被 CM 插进文档，
    // getBoundingClientRect 恒为 0，量了只会写进一个假值。真实量取点在
    // sync() / rebuild() 之后 —— 那时 DOM 已在文档里且完成布局。首帧由 CM 的
    // measure() 兜底（estimatedHeight 报 -1，见 tableHeight.js 文件头）。
    return wrap
  }

  /** 记录当前单元格行列（键盘导航 / 操作条 / 对齐按钮的作用目标都依赖它） */
  onFocusIn(e) {
    setEditingWidget(this)
    const cell = e.target?.closest?.('td,th')
    if (!cell) return
    this.activeCol = cell.cellIndex
    const rowIndex = [...this.table.rows].indexOf(cell.closest('tr'))
    // 表头行记为 -1（在其下方插行即表体第 0 行），表体行按 0 基计
    this.activeRow = rowIndex <= 0 ? -1 : rowIndex - 1
    this.refreshIndicators()
  }

  /** 对齐指示器随活动列更新（操作条上高亮当前列的对齐档） */
  refreshIndicators() {
    const align = this.model.aligns?.[this.activeCol] ?? 'left'
    setAlignIndicator(this.bar, align)
  }

  /**
   * 按 model 重建 DOM，并把焦点还原到同一行列。
   *
   * 只用于**结构变更**（增删行列 / 重排 / 改对齐）：这类操作后文档已变，但
   * CM 因 eq() 命中会复用旧 DOM，不主动重建就是「界面没反应」（见文件头）。
   */
  rebuild({ focusRow = null, focusCol = null } = {}) {
    const wrap = this.dom
    if (!wrap) return
    const old = this.table
    const next = this.buildTable()
    wrap.replaceChild(next, old)
    this.table = next
    this.drag?.refresh?.()
    this.refreshIndicators()
    // 焦点还原：优先调用方指定，否则沿用操作前的活动单元格（越界自动夹取）
    restoreCellFocus(this.table, focusRow ?? (this.activeRow + 1), focusCol ?? this.activeCol)
    // 结构变更（增删行列）后行数变了，高度必然变 —— 立刻重取缓存，否则下一轮
    // NodeBuilder 拿到的还是旧行数的高度，一样会先跳一下再被 measure() 修正。
    // 此处可以直接记到 this.key：结构变更的写入已经完成，不会再有新一轮 dispatch。
    measureTableHeight(this)
  }

  /**
   * 行列增删 / 对齐 / 重排的唯一入口。
   *
   * 【为什么改 model 再整体写回】列数散布在表头/每一行/对齐/分隔行四处，
   * 直接改 DOM 再同步时只要有一处跟不上，产出的就是**非法 Markdown**
   * （GFM 列数不一致时整表退化为段落）。在 model 上改到自洽再统一序列化。
   *
   * 【为什么先 sync()】用户可能刚打完字还没离开单元格，先做一次幂等同步，
   * 保证操作基于屏幕上的最新内容。
   */
  runAction(action) {
    this.sync()
    const model = this.model
    const col = this.activeCol ?? 0
    const row = this.activeRow ?? -1
    const colCount = model.header.length

    // 对齐：点同一个档位再循环到下一档（左 → 中 → 右 → 左）
    if (action.startsWith?.('align:')) {
      const want = action.slice(6)
      const target = want === 'cycle' ? nextAlign(model.aligns[col]) : want
      setColumnAlign(model, col, ALIGN_CYCLE.includes(target) ? target : nextAlign(model.aligns[col]))
      this.writeModel()
      this.rebuild({ focusCol: col })
      return
    }

    let focusRow = null
    switch (action) {
      case 'add-row':
        focusRow = row + 2 // 表体新行插在 row+1（0 基），DOM 行号 = +1（表头占一位）+1（新行）
        insertRow(model, row + 1)
        break
      case 'add-col':
        insertColumn(model, Math.min(col + 1, colCount))
        break
      case 'del-row':
        // 表体最少保留 1 行：删空后只剩表头，GFM 仍合法，但用户几乎总是手滑
        if (model.rows.length <= 1) return this.refuse('lastRow')
        removeRow(model, row)
        break
      case 'del-col':
        // 最少保留 1 列（同理）
        if (colCount <= 1) return this.refuse('lastColumn')
        removeColumn(model, col)
        break
      default:
        return
    }
    this.writeModel()
    this.rebuild({ focusRow, focusCol: Math.min(col, model.header.length - 1) })
  }

  /** 拖拽重排落点（tableDrag 松手时调一次，只产生一条撤销记录） */
  move(kind, from, to) {
    this.sync()
    if (kind === 'col') moveColumn(this.model, from, to)
    else moveRow(this.model, from, to)
    this.activeCol = kind === 'col' ? to : this.activeCol
    this.activeRow = kind === 'row' ? to : this.activeRow
    this.writeModel()
    this.rebuild({ focusRow: kind === 'row' ? to + 1 : this.activeRow + 1, focusCol: this.activeCol })
  }

  /** 拒绝操作时给一次短暂提示（不改文档），避免用户以为按钮坏了 */
  refuse(kind) {
    const el = this.dom
    if (!el) return
    el.classList.remove('is-refused')
    void el.offsetWidth // 强制重排，让动画在连续点击时可重播
    el.classList.add('is-refused')
    // 文案走 i18n；用 title 而非气泡：单元格是 contenteditable，覆盖层会打断输入
    el.title = t(kind === 'lastRow' ? 'table.keepLastRow' : 'table.keepLastColumn')
    setTimeout(() => {
      if (el.isConnected) el.classList.remove('is-refused')
    }, 600)
  }

  /** 把当前 model 写回文档（与 sync 同一套区间重定位保护） */
  writeModel() {
    const view = this.viewRef
    if (!view) return
    // 用文档主换行符序列化：文档是 CRLF 时若硬编码 '\n'，回写会让表格行变 LF
    // 而相邻行仍是 CRLF，重渲染错位（用户侧「输着输着跑行」）。见 tableRender.js。
    const text = serializeTable(this.model, view.state.lineBreak)
    return this.dispatchText(text)
  }

  /**
   * 区间保护 + 去重后写回。
   *
   * 返回值 = **文档此刻是否已等于 `text`**（不是「有没有产生事务」）：
   * true 表示已一致（刚写进去或本就一致），false 表示区间定位失败、什么都没做
   * （宁可不同步，也绝不猜区间）。
   *
   * 【为什么是这个语义】`sync()` 拿它决定要不要把 model 升级成刚从 DOM 读出的
   * 那份。若把「文本本就一致」报成 false，model 会停在旧值而 DOM 已是新值 ——
   * model / source / key 脱节，下次 eq() 的比较基准就错了（表现为内容滞后、
   * 错位）。故成功路径**一律**同步更新 from / to / source / key，维持不变量：
   * `state.sliceDoc(from, to) === source === key === serializeTable(model)`
   *
   * [注意] 读回必须用 `state.sliceDoc` 而不是 `state.doc.sliceString`：后者恒按
   * '\n' 拼接，前者按 `state.lineBreak`。两者在默认配置下相等（生产即是如此，
   * 全仓未配置 lineSeparator facet），但一旦文档配了 CRLF，混用会让「刚写进去的
   * 文本」与「读回来的文本」永远不等 —— 去重失效，每敲一个字都多一笔事务。
   */
  dispatchText(text) {
    const view = this.viewRef
    const state = view.state
    let { from, to } = this
    if (state.sliceDoc(from, to) !== this.source) {
      const found = locateTable(state, from)
      if (!found) return false
      ;({ from, to } = found)
    }
    // 文本已一致：不产生多余事务，但记账仍要对齐（见上）
    if (text !== state.sliceDoc(from, to)) {
      // 【必须在 dispatch 之前】这是「跑行」修复的真正落点，时序理由见
      // tableHeight.js 文件头：state.update 会立刻 new 出带新 source 的
      // TableWidget，view.dispatch 同步触发 NodeBuilder 读 estimatedHeight ——
      // 读发生在 dispatch 返回之前。若在 dispatch 之后才写缓存，新实例这一轮
      // 仍报 -1；而下一轮 source 又变了，上一轮存的键永远匹配不上，逐字输入时
      // 命中率恒为 0，等于没修。此处 this.dom 仍是文档里正在显示的表格，高度可信。
      primeTableHeight(text, this.dom)
      const tr = state.update({
        changes: { from, to, insert: text },
        annotations: selfSync.of(true),
        // 【选区守卫】主选区此刻多半停在表外旧位置（单元格收点击，CM 主选区
        // 从未跟进）。这笔事务若不带 selection，flush/selectionchange 读到单元格
        // DOM 选区后会把 CM 主选区「搬进」表格 range（applyDOMChange 的 newSel
        // 派发 / applyDefaultInsert 的 mainSel 搬运）⇒ selectionInside 翻真 ⇒
        // 下一帧 widget 从装饰里消失 = 表格瞬间源码化 + 焦点丢。这里把主选区
        // 钉在表格**边界**（this.to，界外判定包含边界）：渲染态保持，flush 的
        // newSel 与主选区同位 ⇒ sameSelPos 命中不再搬运。
        selection: { anchor: Math.min(from, state.doc.length) },
      })
      view.dispatch(tr)
      // 【为什么不能写 from + text.length】CM 按 lineSeparator facet 切行，换行符
      // 被归一化（\r\n → 单个位置）：文档是 CRLF 时 text.length 比真实增量多出
      // 「换行个数」个字符。用 text.length 记账会让 this.to 越过表格末尾，下一次
      // sliceString(from, to) 会把表格后的一行正文一起圈进来 —— 用户侧就是
      // 「输着输着跑行 / 旁边的段落被吃掉」。以真实新文档长度为准。
      to = from + (tr.newDoc.length - (state.doc.length - (to - from)))
    }
    this.from = from
    this.to = to
    this.source = text
    this.key = text
    // 【选区守卫的另一半】sync 可能因「文本已一致」而不发事务（上面 if 未进），
    // 但 CM 主选区仍可能已被搬进表内（例如 flush 在 sync 之前先跑了一轮 newSel
    // 派发）。只要发现主选区落在表格 range 内，立刻移到表格起始边界：既保持
    // 渲染态（边界算界外），又给 flush 的 sameSelPos 一个可命中的同位锚点。
    // dispatchText 成功 ⇒ 表格 range 就是 [from, to]，直接用。
    const sel = view.state.selection.main
    if (sel.to > from && sel.from < to) {
      view.dispatch({ selection: { anchor: Math.min(from, view.state.doc.length) } })
    }
    return true
  }

  destroy() {
    this.ac.abort()
    if (currentEditingWidget() === this) setEditingWidget(null)
  }

  /**
   * 单元格 DOM → serializeTable → 文档。定位失败宁可不同步，绝不猜区间。
   *
   * 【不变量】成功时 model / source / key / from / to **必须一起更新**（source/key/
   * from/to 在 dispatchText 里，model 在这里）。任何一半落单，下一次 eq() 或
   * dispatchText() 的比较基准就错了，DOM 与文档开始各说各话 —— 用户侧表现为
   * 内容滞后、错位。tests/table-sync-invariant.test.mjs 钉死这条不变量。
   */
  sync() {
    const view = this.viewRef
    if (!view || !this.dom || view.composing || this.composing) return
    const table = this.table
    if (!table) return
    const grid = [...table.rows].map((tr) => [...tr.cells].map((td) => td.textContent))
    const model = { header: grid[0], aligns: this.model.aligns, delimRaw: this.model.delimRaw, rows: grid.slice(1) }
    const text = serializeTable(model, view.state.lineBreak)
    if (this.dispatchText(text)) this.model = model
  }

  onKeydown(e) {
    const view = this.viewRef
    const cell = e.target.closest?.('td,th')
    if (!view || !cell) return
    // 撤销重做必须路由给 CM：contenteditable 的原生 undo 只改 DOM 不改文档，
    // 放任不管会造成「界面撤销了、文档没变」的分叉
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo(view)
      else undo(view)
      return
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const table = this.table
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!this.stepCell(cell, e.shiftKey ? -1 : 1)) {
        // 正向越界才补行；反向越界（首格 Shift+Tab）什么都不做 ——
        // 曾经在这里无条件 appendRow，导致「想退出去」反而多出一行
        if (!e.shiftKey) this.appendRow(table, 0)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault() // Enter 不得在单元格里造 <div>；语义 = 下一行同列（末行则加行）
      const rowsArr = [...table.rows]
      const col = cell.cellIndex
      const next = rowsArr[rowsArr.indexOf(cell.closest('tr')) + 1]
      if (next && next.cells[col]) focusEnd(next.cells[col])
      else this.appendRow(table, col)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      this.sync()
      view.dispatch({ selection: { anchor: Math.min(this.to, view.state.doc.length) }, scrollIntoView: true })
      view.focus()
    }
  }

  stepCell(cell, delta) {
    const cells = [...this.table.querySelectorAll('th,td')]
    const j = cells.indexOf(cell) + delta
    if (j < 0 || j >= cells.length) return false
    focusEnd(cells[j])
    return true
  }

  appendRow(table, focusCol = 0) {
    const n = this.model.header.length
    const { aligns } = this.model
    const tr = document.createElement('tr')
    const tds = []
    for (let i = 0; i < n; i++) {
      const td = document.createElement('td')
      td.contentEditable = 'true'
      td.style.textAlign = aligns[i] ?? 'left'
      tr.appendChild(td)
      tds.push(td)
    }
    table.tBodies[0].appendChild(tr)
    focusEnd(tds[Math.min(Math.max(focusCol, 0), n - 1)])
    this.activeRow = table.rows.length - 2
    this.drag?.refresh?.()
    this.sync()
  }

  onPaste(e) {
    if (!e.target.closest?.('td,th')) return
    const text = e.clipboardData?.getData('text/plain')
    if (text == null) return
    e.preventDefault()
    // 单元格是单行语义：换行折叠为空格，防止破坏表格结构。
    // execCommand 虽被标记过时，但在 contenteditable 插入纯文本仍是最可靠手段。
    document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '))
  }
}
