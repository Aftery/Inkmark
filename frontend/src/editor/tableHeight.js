// tableHeight.js — 表格 widget 的实测高度缓存（跨实例）
// ----------------------------------------------------------------------------
// 从 tableWidget.js 拆出：那文件管「渲染出来之后用户怎么编辑」，本文件只负责
// 「CM 认为这张表有多高」。拆出的直接原因是契约 5 行数门禁，也因为这条高度
// 记账链本身值得独立成文件说明。
//
// 【为什么需要它】WidgetType.estimatedHeight 默认返回 -1
// （@codemirror/view/dist/index.js:148），于是 NodeBuilder.point
// （index.js:6036-6044）把整张表格当成**一行**高：
//     let height = deco.widget ? deco.widget.estimatedHeight : 0;
//     if (height < 0) height = this.oracle.lineHeight;
//     if (deco.block) this.addBlock(new HeightMapBlock(len, height, deco));
// 3~4 行的表格 DOM 实际高 100~170px，而 CM 记账只有一行（约 27px @ 16px/1.7）。
//
// 落差本身不致命：measure() 会在下一帧用 HeightMapBlock.setMeasuredHeight
// （index.js:5689-5699）量回真实高度。致命的是**每敲一个字都重演一次**：
//   ① 每敲一个字 source 就变 → 装饰层 new 一个新 TableWidget（key = 新 source）；
//   ② PointDecoration.heightRelevant 对 block 装饰**恒为 true**
//      （index.js:352-354），故新旧装饰永不 equal；
//   ③ DecorationComparator.comparePoint（index.js:6139-6142）必然报一个
//      height change range；
//   ④ ViewState.update（index.js:6318-6322）把它并入 heightChanges →
//      heightMap.applyChanges → HeightMapBlock 被 NodeBuilder 重建，高度回落到
//      oracle.lineHeight；
//   ⑤ 之后要等下一帧 measure() 才量回真实高度。
// 于是表格后续内容每帧先上跳约 120px 再回落 —— 用户在表格里连续打字时，这个
// 跳动每敲一个字发生一次。这正是「表格输入打 2 个字符就跑行」的物理来源，
// 也解释了它为什么像玄学：取决于表格是否在视口内、measure() 是否及时。
//
// 【修法的关键：必须在 dispatch **之前**写缓存】这一点极易写错，本文件曾
// 因此写出过一版「永远不命中」的实现，故把时序钉在这里：
//
//   dispatchText() 内部第一件事就是 state.update()，而 StateField.update 会
//   立刻调 decoOf() new 出带**新 source** 的 TableWidget；紧接着
//   view.dispatch() 同步跑 docView.update → NodeBuilder 读 estimatedHeight。
//   也就是说：**新实例读缓存发生在 dispatch 还没返回的时候**。
//
//   若在 dispatch 之后才 rememberTableHeight(this.key, h)（this.key 此时已是
//   新 source），存进去的确实是对的键，但读早就发生了 —— 这一轮仍报 -1。
//   更要命的是下一轮 source 又变了，上一轮存的键永远匹配不上：逐字输入时
//   缓存命中率恒为 0，等于没修。
//
//   正确做法是**提前写入**：sync() 已经用 serializeTable 算出了即将写入文档的
//   文本，那就是新实例的 key；在 dispatch 之前把「当前 DOM 的实测高度」记到
//   这个未来键上，新实例一构造好查表就能命中。
//
// 【为什么允许用旧 DOM 的高度当前瞻值】一次按键对表格高度的影响至多是某个
// 单元格多折一行（约一行高），而错误估计的代价是「整表塌成一行」再跳回来
// （约 120px）。前者小一个数量级，且下一次按键会用新的实测值覆盖。CM 对
// estimatedHeight 的契约本就是「预估值，真实值由 measure() 修正」
// （index.js:148 "May return -1 to indicate you don't know"）。
//
// 【为什么按 key 而不是「最近一次任意高度」】缓存键是表格源码：源码变意味着
// 行数/每格文字可能都变了，别的表的高度不再适用。若改成全局「最近一次量到的
// 高度」，同文档两张高度不同的表会互相污染，且删行后高度偏大永不自愈。

/** 表格源码 key → 上次实测高度（px） */
const measuredHeights = new Map()

/** 缓存上限：长会话里不无限增长（键是整段表格源码，可能很长） */
const MAX_ENTRIES = 64

/** 记一次实测高度。键为空 / 高度非正数时忽略（-1 与 0 都不是高度） */
export function rememberTableHeight(key, height) {
  if (!key || !(height > 0)) return false
  measuredHeights.set(key, height)
  if (measuredHeights.size > MAX_ENTRIES) {
    // Map 保序：删最老的一条（FIFO），实现简单且无需额外时间戳
    const oldest = measuredHeights.keys().next().value
    measuredHeights.delete(oldest)
  }
  return true
}

/** 查某张表上次量到的高度；没量过返回 -1（CM 会退回 oracle.lineHeight） */
export function estimatedTableHeight(key) {
  return measuredHeights.get(key) ?? -1
}

/**
 * 从一个 DOM 节点读高度。读不到（未连接 / 无 API / 高度非正）返回 0。
 *
 * [注意] 这里**不**碰缓存：调用方决定这个值该记到哪个键上 —— 记到「当前源码」
 * 还是「即将写入的源码」，语义完全不同（见文件头时序说明）。
 */
export function readTableDomHeight(dom) {
  if (!dom?.isConnected || typeof dom.getBoundingClientRect !== 'function') return 0
  const h = dom.getBoundingClientRect().height
  return h > 0 ? h : 0
}

/**
 * 量当前 widget 的 DOM 高度并记到它**当前**的 key 上。
 *
 * 用于结构变更（rebuild）之后：此时 key 已经是序列化好的最新源码，且不会再有
 * 新一轮 dispatch，直接记即可。
 *
 * [注意] DOM 未连接或高度为 0 时**不清缓存**：同 key 保留上一次的有效值，比
 * 退回 -1 好（-1 会让 CM 又把表格当一行高，抖动复现）。
 *
 * @param {{dom?: object, key?: string}} widget
 * @returns {boolean} 是否量到有效高度
 */
export function measureTableHeight(widget) {
  const h = readTableDomHeight(widget?.dom)
  if (!h) return false
  return rememberTableHeight(widget.key, h)
}

/**
 * 提前把「当前 DOM 的实测高度」登记到**即将写入文档的源码**上。
 *
 * 这是本修复的真正落点，时序理由见文件头。必须在 dispatch 之前调用。
 *
 * @param {string} nextKey 即将写入文档的表格源码
 * @param {object} dom 当前（旧）表格 DOM，此刻仍在文档里且已完成布局
 * @returns {boolean} 是否登记成功
 */
export function primeTableHeight(nextKey, dom) {
  const h = readTableDomHeight(dom)
  if (!h) return false
  return rememberTableHeight(nextKey, h)
}

/** 仅供测试：清空缓存（模块级 Map 会跨用例串味） */
export function resetTableHeightCache() {
  measuredHeights.clear()
}
