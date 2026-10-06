// imageDrop.js — 编辑器的图片粘贴 / 拖拽插入
// ----------------------------------------------------------------------------
// 为什么从 createEditor.js 抽出来：这是一块**自成职责**的输入通道
// （DataTransfer 解析 + 落盘回调 + Markdown 片段插入），与编辑器的
// 语法高亮 / WYSIWYG / 键位等关注点无关，却占着 createEditor.js 的行数预算
// （该文件长期贴着 300 有效行红线，见 tests/contracts.test.mjs 的 LINE_EXEMPTIONS）。
// 抽出后 createEditor.js 只保留「注册处理器」一行，扩展点不变。
//
// 边界：只拦截**文件型图片**；普通文本与其它文件一律返回 false 交默认处理
// （浏览器默认粘贴/拖拽不能被吞）。落盘由上层 onImageFile 回调完成
// （App.vue 调 Go SaveImage 写入文档同级 assets/），本模块只负责插入 Markdown。

/** 从 DataTransfer 里取第一个图片文件；没有则返回 null */
function imageFileFromDataTransfer(dt) {
  if (!dt || !dt.files || dt.files.length === 0) return null
  for (const f of dt.files) {
    if (f.type && f.type.startsWith('image/')) return f
  }
  return null
}

/** 落盘拿到 URL 后，在指定位置插入图片 Markdown */
function insertImageMarkdown(view, file, pos, onImageFile) {
  Promise.resolve(onImageFile(file))
    .then((url) => {
      if (!url) return
      const at = Math.max(0, Math.min(pos, view.state.doc.length))
      const snippet = `![](${url})`
      view.dispatch({
        changes: { from: at, insert: snippet },
        selection: { anchor: at + snippet.length },
      })
    })
    .catch(() => { /* 插入失败静默：上层已给 toast */ })
}

/**
 * 生成图片粘贴 / 拖拽的 DOM 事件处理器。
 * @param {(file: File) => Promise<string|null>} onImageFile 落盘回调，返回可插入的相对路径
 * @returns {Record<string, Function>} 可直接展开进 EditorView.domEventHandlers
 */
export function imageDropHandlers(onImageFile) {
  return {
    paste(event, view) {
      const file = imageFileFromDataTransfer(event.clipboardData)
      if (!file || !onImageFile) return false
      event.preventDefault()
      insertImageMarkdown(view, file, view.state.selection.main.head, onImageFile)
      return true
    },
    drop(event, view) {
      const file = imageFileFromDataTransfer(event.dataTransfer)
      if (!file || !onImageFile) return false
      event.preventDefault()
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      insertImageMarkdown(view, file, pos ?? view.state.selection.main.head, onImageFile)
      return true
    },
    dragover(event) {
      // 文件拖拽需阻止默认，否则浏览器不会派发 drop
      if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) {
        event.preventDefault()
      }
      return false
    },
  }
}
