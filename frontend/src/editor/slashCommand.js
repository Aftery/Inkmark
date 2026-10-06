// slashCommand.js — Slash 命令面板的 CodeMirror 侧扩展
// ----------------------------------------------------------------------------
// 分层理由（不要把这两层揉进一个文件）：
//   - 本模块（editor 侧）持有【键位拦截】与【文档变更】。文档变更必须与按键
//     处在同一条事务路径上，才能被撤销栈完整收录、且不产生中间态闪烁。
//   - SlashCommand.vue（组件侧）持有【面板状态与渲染】。面板是 DOM/样式关注点，
//     放进 editor 层会让 CM 扩展反向依赖 Vue。
// 两侧通过一个**延迟求值**的 host 协议连接（见 slashCommandExtension 的注释）。
//
// 键位优先级：全部包在 Prec.high 里，必须压过 defaultKeymap（Enter/ArrowDown/
// ArrowUp/Escape 都在其中）。面板未开启时每个 handler 都返回 false，
// 行为与没有这个扩展时完全一致 —— 零侵入是这个扩展的第一原则。

import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'

/**
 * 命令清单。字段说明：
 *   id       稳定标识（过滤与测试用）
 *   labelKey i18n key（界面文案走 t()，不写死在代码里）
 *   keywords ASCII 过滤词（用户在面板里继续输入的内容按它过滤）
 *   snippet  插入的 Markdown 片段
 *   caret    插入后光标在片段内的偏移（决定落在哪个可编辑位置）
 *   hint     面板右侧的语法提示（等宽字体展示）
 */
export const slashItems = [
  {
    id: 'code',
    labelKey: 'slash.code',
    keywords: ['code', 'js', 'block'],
    snippet: '```javascript\n\n```',
    caret: 14, // 落在围栏内的空行上（'```javascript\n' 之后）
    hint: '```javascript',
  },
  {
    id: 'table',
    labelKey: 'slash.table',
    keywords: ['table', 'grid'],
    snippet: '|  |  |\n| --- | --- |\n|  |  |',
    caret: 2, // 落在第一个单元格里
    hint: '| --- |',
  },
  {
    id: 'todo',
    labelKey: 'slash.todo',
    keywords: ['todo', 'task', 'check'],
    snippet: '- [ ] ',
    caret: 6, // 复选框之后的空格处，直接输入任务文字
    hint: '- [ ]',
  },
  {
    id: 'quote',
    labelKey: 'slash.quote',
    keywords: ['quote', 'cite', 'ref'],
    snippet: '> ',
    caret: 2,
    hint: '>',
  },
]

/**
 * 插入命令片段：把 [anchor, cursor) 整段替换为片段。
 * 这段区间正是「斜杠 + 用户已输入的过滤词」，所以插入时顺带把前一个
 * '/' 删掉，不会留下残留字符（这是面板最容易出的 bug）。
 *
 * @param {import('@codemirror/view').EditorView} view
 * @param {{snippet: string, caret: number}} item
 * @param {number} anchor 斜杠在文档中的位置
 * @returns {boolean} 是否成功插入
 */
export function insertSlashItem(view, item, anchor) {
  // 守卫失败必须**留痕**：这个函数历史上唯一的调用方把 close() 排在它前面，
  // 于是 view/anchor 已被清空，这里 return false 后界面表现是「按了回车
  // 面板关了但什么都没发生」—— 一个没有任何报错的静默失败（由
  // scripts/probe-slash.mjs 实测定位）。守卫命中在正常键盘流里不该发生，
  // 故打 warn 而不是静默返回。
  if (!view || !item || anchor < 0) {
    console.warn('[slash] insertSlashItem 守卫命中（上下文缺失）:', { view: !!view, item: !!item, anchor })
    return false
  }
  const head = view.state.selection.main.head
  const from = Math.min(anchor, head)
  const to = Math.max(anchor, head)
  view.dispatch({
    changes: { from, to, insert: item.snippet },
    selection: { anchor: from + item.caret },
    scrollIntoView: true,
  })
  return true
}

/**
 * 生成扩展。
 *
 * @param {() => (object|null)} getHost 延迟求值的 host 获取函数。
 *   host 是 SlashCommand.vue 经 defineExpose 暴露的实例，需提供：
 *     isOpen(): boolean
 *     openMenu(view, anchorPos): void
 *     move(delta: 1|-1): void
 *     confirm(): void
 *     close(): void
 *     syncFromDoc(view): void
 *   为什么延迟求值：编辑器在 onMounted 创建，面板组件在其之后挂载，
 *   扩展构造期拿不到实例；用闭包推迟到按键发生时再取。
 * @returns {import('@codemirror/state').Extension}
 */
export function slashCommandExtension(getHost) {
  const host = () => (typeof getHost === 'function' ? getHost() : null)

  // 面板开启时接管导航 / 确认 / 退出；未开启一律放行（返回 false）
  const route = (action) => {
    const h = host()
    if (!h || !h.isOpen()) return false
    if (action === 'down') h.move(1)
    else if (action === 'up') h.move(-1)
    else if (action === 'enter') h.confirm()
    else h.close()
    return true
  }

  /**
   * 拦截斜杠键：仅在「行首空白之后」触发（即新行上打第一个字符），
   * 行中间打斜杠是正常正文（路径、日期），一律放行给默认输入。
   * 这里自己插入斜杠再开面板，让锚点与文档变更同事务；
   * 若返回 false 让默认处理，面板就拿不到可靠的锚点位置。
   */
  const onSlash = (view) => {
    const sel = view.state.selection.main
    if (!sel.empty) return false
    const line = view.state.doc.lineAt(sel.head)
    if (!/^\s*$/.test(line.text.slice(0, sel.head - line.from))) return false
    const anchor = sel.head
    view.dispatch({
      changes: { from: anchor, insert: '/' },
      selection: { anchor: anchor + 1 },
    })
    const h = host()
    if (h) h.openMenu(view, anchor)
    return true
  }

  return [
    Prec.high(keymap.of([
      { key: '/', run: onSlash },
      { key: 'ArrowDown', run: () => route('down') },
      { key: 'ArrowUp', run: () => route('up') },
      { key: 'Enter', run: () => route('enter') },
      { key: 'Escape', run: () => route('escape') },
    ])),
    // 面板开启期间：继续输入 → 回调 syncFromDoc 更新过滤词（越界即自闭）；
    // 光标跳走或编辑区失焦 → 直接关闭。
    EditorView.updateListener.of((update) => {
      const h = host()
      if (!h || !h.isOpen()) return
      if (update.docChanged) h.syncFromDoc(update.view)
      else if (update.selectionSet || update.focusChanged) h.close()
    }),
  ]
}
