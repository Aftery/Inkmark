// 编辑器封装：CodeMirror 6 · 写作工具形态
// ----------------------------------------------------------------------------
// 1) 无行号、无整行高亮：这是写作器，不是代码编辑器（行号/活动行属代码定位心智）
// 2) 正文使用 var(--font-body-user, var(--font-body)) 15px / 行高 1.7，与预览区完全一致
//    —— 左右两栏文字基线对齐的前提。回退链让用户「正文字体」偏好只作用于文档正文，
//    不污染应用外壳（界面仍走主题级 --font-body；prefs.js 的 R4 裁决见 docs/design/settings-panel-spec.md）
// 3) 语法着色全部引用 CSS 变量，明暗切换无需重建编辑器
// 4) Markdown 结构字号与预览区标题阶梯一致（30/24/20/17/16/15 @ 15px 基准），
//    围栏代码与预览区 highlight.js 共用同一套 --hl-* 变量（单一色板）
//
// 【扩展清单已搬到 editor/extensions.js · 2026-10-28】多标签页要造 N 份
// EditorState，扩展数组不能内联在函数体里（那是 157 行，且只有一份）。
// 现在由 extensions.js 的 buildExtensions() 统一构建，调用方（useEditorSession）
// 构建**一次**后交给 createEditor 与 createEditorState 共用 —— N 份 state 共用
// 同一份扩展实例，撤销栈 / 装饰字段按 state 天然隔离。
// 本文件只留「view 侧」职责：建 state、装 view、挂滚动监听，以及对外的
// 缩放 / 打字机 / 整份替换三个动作。
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { zoomCompartment } from './extensions.js'

// 专注模式开关（StateEffect）与扩展清单同住 extensions.js，这里保留导出路径 ——
// 既有导入方不因搬家而断（多标签页切换时也要用它重放窗口级开关）。
export { setFocusMode } from './extensions.js'

// ---------- 缩放：状态栏 90/100/110/125% 用（App.vue 调 setEditorZoom） ----------
export function setEditorZoom(view, scale) {
  view.dispatch({
    effects: zoomCompartment.reconfigure(
      EditorView.theme({ '&': { fontSize: `calc(var(--text-base) * ${scale})` } }),
    ),
  })
}

// ---------- 打字机模式：把光标所在行滚到视口中部（App.vue 在开关联通时调用） ----------
export function centerCursor(view) {
  if (!view) return
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }),
  })
}

// ---------- 整体替换文档（打开文件 / 切换文件 / 恢复快照） ----------
// 用 setState 而非 dispatch 承载「整份替换」，两个理由：
// 1) 语义正确：CM6 对 setState 的说明正是本场景——「新状态并非派生自旧状态」
//    （打开/切换到另一个文件），此时应当整棵重绘，而非走增量复用。
// 2) 规避 tile 复用路径：@codemirror/view 6.43.x 的 tile 增量更新在「整体替换 +
//    行内/行级装饰」下会损坏并抛
//      TypeError: Cannot destructure property 'tile' of 'parents.pop(...)' as it is undefined
//    （上游 changelog 6.43.3 / 6.43.4 / 6.43.6 连续修 tile 树损坏，该路径风险未收敛）。
//    实测：在 line 装饰写法修正前，dispatch 整份替换必崩，且崩溃后 state 已提交而
//    DOM 不刷新、updateListener 不执行 —— 即「编辑器还停在旧文件、预览已是新文件」。
// state 由 view.state.update 派生 → history / focusField（专注）/ zoomCompartment
//（缩放）等字段状态全部保留；但 setState 不是事务、不触发 updateListener，
// 调用方须自行同步依赖文档内容的外部状态（预览、大纲、状态栏行列）。
export function replaceDocument(view, content) {
  if (!view) return
  const tr = view.state.update({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: { anchor: 0 },
  })
  view.setState(tr.state)
}

// ---------- 图片粘贴 / 拖拽插入 ----------
// 实现已抽到 editor/imageDrop.js（自成职责的输入通道，且长期占着本文件的行数预算）。
// 三条通道共用 onImageFile 一个回调：图片数据（dt.files 里的 File）与 file URL
//（传本地路径字符串）—— useFileAssets 按入参类型分流；
// 通道③（onClipboardImage，WKWebView 上的唯一出路）走独立的可选回调，
// 因为它问的是**系统剪贴板**而非 DataTransfer。
// 普通文本 / 其它文件一律放行（返回 false 交默认处理）。
// 【这两条回调现在由 extensions.js 的 buildExtensions 消费】—— 它们已进扩展清单，
// 本文件不再接收（少两个入参 = 少一个「传了却没用」的误会）。

/**
 * 造一个编辑器视图。
 *
 * @param {HTMLElement} parent 挂载点
 * @param {object} opts
 * @param {string} [opts.doc] 初始文档
 * @param {Array} [opts.extensions] 扩展清单 —— **由调用方构建并共享**
 *        （见 editor/extensions.js 的 buildExtensions：多标签页的 N 份 state 共用一份）
 * @param {(top: number, max: number) => void} [opts.onScroll] 滚动回调
 */
export function createEditor(parent, { doc = '', extensions, onScroll }) {
  // 文档变更 / 选区变化两个 updateListener **在 extensions 里**（不在本文件）：
  // `activateSession` 用 setState 换 state，扩展随 state 走 —— 只装在初始 state
  // 上的监听器切一次标签就没了（打字不标脏、预览不更新，且不报错）。
  // 详见 editor/extensions.js 的 buildExtensions 头注。
  const state = EditorState.create({ doc, extensions })

  const view = new EditorView({ state, parent })

  // 滚动联动（编辑区 → 预览区）：用原生 scroll 事件，与预览侧的 @scroll 对称
  if (onScroll) {
    view.scrollDOM.addEventListener('scroll', () => {
      onScroll(view.scrollDOM.scrollTop,
               view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
    })
  }

  return view
}
