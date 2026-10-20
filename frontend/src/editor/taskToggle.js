// taskToggle.js — 任务列表勾选框的点击交互
// ----------------------------------------------------------------------------
// 【职责边界】本文件**只做一件事**：把「点击勾选框」翻译成一笔文档变更
// （`[ ]` ⇄ `[x]`）。渲染仍归 wysiwyg.js（它产 `.cm-md-task-box` widget），
// 本文件不产任何装饰。
//
// 【为什么不写在 wysiwyg.js 里】那个文件的第 5 条架构约束是「内容零篡改：
// 本模块只产装饰，永不 dispatch 文档变更」（docs/spec/phaseC-architecture.md §3）。
// 勾选必须改文档，故它不能住在那里 —— 违反那条约束会让「装饰层是否有副作用」
// 这个前提失效，WYSIWYG 的可靠性论证整段作废。
//
// 【为什么不用 WidgetType 的 domEventHandlers / 在 widget 里 dispatch】
// widget 实例随装饰重建而更换，且它的 toDOM 拿不到稳定的 dispatch 上下文；
// 统一在 EditorView 层用 domEventHandlers 捕获冒泡上来的点击，职责更单一：
// 「哪个元素被点了」由 DOM 判定，「改成什么」由语法树判定。
//
// 【为什么不直接 toggle 整个 checked 类】文档才是真源：只改 DOM 会在下一次
// 装饰重算时被文档内容覆盖回去（表现为「点了没反应」或「闪一下又弹回」）。

import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

/** 勾选框 widget 的类名（与 wysiwyg.js 的 TaskCheckboxWidget 必须一致） */
const TASK_BOX_CLASS = 'cm-md-task-box'

/**
 * 定位一次点击对应的 TaskMarker 节点。
 *
 * 点在 widget 上时拿不到「字符位置」（widget 是替换装饰，DOM 里没有对应文本），
 * 故用 posAtDOM 取该 widget 所覆盖区间的起点，再在语法树里向上找 TaskMarker。
 * 找不到（点的是非任务列表的空白 / 树未就绪）就返回 null，调用方放行默认行为。
 */
function taskMarkerAt(view, event) {
  const box = event.target?.closest?.(`.${TASK_BOX_CLASS}`)
  if (!box) return null
  if (!view.dom.contains(box)) return null

  let pos
  try {
    // posAtDOM 对替换装饰返回其**起点**；取到后仍需靠语法树确认它确实是
    // TaskMarker 的起点，否则可能落在相邻节点的边界上。
    pos = view.posAtDOM(box, 0)
  } catch {
    return null
  }

  const tree = syntaxTree(view.state)
  for (const at of [pos, pos + 1, pos - 1]) {
    if (at < 0 || at > view.state.doc.length) continue
    let node = tree.resolveInner(at, 1)
    while (node) {
      if (node.name === 'TaskMarker') return node
      node = node.parent
    }
  }
  return null
}

/** `[ ]` → `[x]`；`[x]` / `[X]` → `[ ]`。保留原括号内的字符宽度，避免行内位移 */
export function toggledMarker(text) {
  const inner = text.slice(1, -1).trim().toLowerCase()
  return inner === 'x' ? '[ ]' : '[x]'
}

/**
 * 生成任务列表勾选的 DOM 事件处理器（注册进 EditorView.domEventHandlers）。
 *
 * 返回 `true` 表示已处理并阻止默认行为。之所以用 mousedown 而非 click：
 * click 之前编辑器可能已经移动了光标（把替换装饰换成源码），导致 widget 消失、
 * 找不到目标节点；mousedown 阶段 widget 一定还在。
 */
export function taskToggleHandlers() {
  return {
    mousedown(event, view) {
      if (event.button !== 0) return false
      const node = taskMarkerAt(view, event)
      if (!node) return false
      event.preventDefault()

      const current = view.state.doc.sliceString(node.from, node.to)
      const next = toggledMarker(current)
      if (next === current) return true // 已是目标形态：吞掉点击，避免光标跳到奇怪位置

      // 用 changes 而非 dispatch 整段重写：只改这一个标记，撤销栈里也是最小粒度
      view.dispatch({
        changes: { from: node.from, to: node.to, insert: next },
        // 勾选不应抢走焦点/移动光标：保持当前 selection 不变，用户可连点多个
        scrollIntoView: false,
      })
      return true
    },
  }
}
