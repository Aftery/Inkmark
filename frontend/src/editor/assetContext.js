// assetContext.js — 文档路径 → 图片呈现的**唯一同步点**
// ----------------------------------------------------------------------------
// 【为什么单独成模块】这条同步原先是 useEditorSession 里 watch 的三行，只做两件
// 事：翻 assetUrl 的模块级开关、镜像给 Go（SetDocDir）。2026-10-23 真机回归
// 「图片位置只有一个虚线占位框，里面写着 assets/…」补上第三件：**通知编辑器
// 重建图片装饰**。三件事必须原子地一起做，少任何一件都是「图片不显示但全绿」：
//   少开关 → src 不加 /doc-assets/ 前缀 ⇒ webview 按页面 origin 解析 ⇒ 404；
//   少镜像 → Go 侧仍按**上一个**文档目录读盘 ⇒ 404；
//   少通知 → 开关翻了但没有任何事务、装饰不重算，旧 widget（含其破图 DOM）被
//            eq 判定「没变」而一直复用 ⇒ 破损态定格（缺陷本体）。
// 故收敛成一个函数：将来任何新增的「路径 → 表现层」依赖都从这里分叉，不另开
// 第二条同步通道（两条通道必然有一条先漏）。
//
// 【为什么必须显式通知】文档路径变化**不产生 CodeMirror 事务**：
//   - 打开 / 新建文件走 createEditor.replaceDocument → view.setState，整棵
//     docView 重建，装饰天然按新口径重算 —— 这条路本来就不需要通知；
//   - 「首次保存 / 另存为 / 重命名 / 同内容换目录」只是给 filePath.value 赋值，
//     一行事务都没有，wysiwyg 插件的 update() 永远不会被调用。
// 于是补一笔**纯 effects 事务**把它叫醒（手法同 tableRender.js 的 rescanTables：
// 装饰依赖了 CM 看不见的外部状态，就必须有一个显式信号）。
//
// 【为什么判据是版本号而不是那笔 effect 本身】插件的 update() 在 IME 合成期会
// 整笔跳过（AC-04 硬约束，合成中改 DOM 会清掉候选窗）。若把「过期」语义挂在
// 事务上，那笔事务一被跳过，过期信息就永久丢失；挂在版本号上则下一笔事务自然
// 补上（版本号还在，diff 仍在）。effect 的作用只剩「让一笔事务发生」。

import { StateEffect } from '@codemirror/state'
import { setDocPath } from './assetUrl.js'
// 显式带 .js：本模块要被 node:test 直接 import（image-asset-context.test.mjs），
// 无扩展名的写法在 Vite 里能解析、在 node ESM 里 ERR_MODULE_NOT_FOUND —— 那样
// 整条图片链路的测试只能退化成源码正则（本仓已明确不接受）。
import { SetDocDir } from '../../wailsjs/go/main/App.js'

/** 改写口径（文档路径）的版本号：只有路径**真的变了**才自增，插件据此判过期 */
let version = 0
export const assetVersion = () => version

/**
 * 叫醒编辑器的空事务载体（无载荷）。存在的唯一理由是「让一笔事务发生」——
 * 重建判据是 assetVersion()，理由见文件头最后一段。
 */
export const docAssetsChanged = StateEffect.define()

/**
 * 把当前文档路径同步到全部消费方（见文件头）。**唯一**调用方是
 * useEditorSession 的 flush:'sync' watch —— 不要在别处再调 setDocPath/SetDocDir。
 *
 * @param {string} path 文档绝对路径（空串 = 未落盘）
 * @param {{dispatch: Function}|null} view 编辑器实例；setup 期 / 已销毁时传 null
 * @returns {boolean} 路径是否真的变了（调用方据此决定派生状态要不要重算）
 */
export function applyDocPath(path, view) {
  const changed = setDocPath(path)
  // Go 侧镜像（docassets.go 按它读盘）。浏览器预览 / node 测试里没有绑定，
  // 抛 ReferenceError 属正常降级 —— 与 TitleBar 同款 try/catch。
  try {
    SetDocDir(path)
  } catch { /* 无 Wails 绑定：预览环境照常渲染，仅资源不走 /doc-assets/ */ }
  if (!changed) return false
  version++
  // 未挂载时不派发：插件构造时记下的就是当前版本号，装饰一出生即按新口径构建
  if (view && typeof view.dispatch === 'function') {
    view.dispatch({ effects: docAssetsChanged.of(null) })
  }
  return true
}
