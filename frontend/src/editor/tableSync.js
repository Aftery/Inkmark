// tableSync.js — 表格「自家同步」事务标记（唯一的循环依赖断点）
// ----------------------------------------------------------------------------
// tableRender.js（装饰层）与 tableWidget.js（DOM 层）互相需要：
//   - 装饰层要 new TableWidget 去渲染；
//   - widget 要读 selfSync 标记自己发出的变更，避免「同步 → 重渲染 → 再同步」回环。
// 若把 Annotation 定义在任意一侧都成环（模块初始化顺序不确定，先被求值的一侧
// 会拿到 undefined）。故单独放进这个无依赖的小文件，两侧都从它 import。

import { Annotation } from '@codemirror/state'

/**
 * 标记「这笔文档变更由表格 widget 自己发出」。
 *
 * 装饰层见到它就保留 activeWidget（编辑中），否则视为外部改动
 * （撤销 / 文件监听 / 命令插入）→ 强制重渲染，避免单元格 DOM 与文档脱节。
 */
export const selfSync = Annotation.define()

/**
 * 正在被编辑（单元格持有焦点）的表格 widget 实例。
 *
 * 【为什么要放在这里而不是各自模块内】装饰层（tableRender）需要「外部改动时」
 * 把它清掉，DOM 层（tableWidget）需要「获得/失去焦点时」设置它 —— 这是
 * 一份跨模块共享的可变状态。ESM 不允许给 import 的绑定重新赋值，
 * 故用一个极小的 setter 收敛写入口（读仍需知道当前值，用 getter）。
 */
let editingWidget = null

/** 当前正在编辑的表格 widget（无则 null） */
export function currentEditingWidget() {
  return editingWidget
}

/** 设置/清空「正在编辑的 widget」 */
export function setEditingWidget(widget) {
  editingWidget = widget
}
