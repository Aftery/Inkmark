// imageDrop.js — 编辑器的图片粘贴 / 拖拽插入
// ----------------------------------------------------------------------------
// 为什么从 createEditor.js 抽出来：这是一块**自成职责**的输入通道
// （DataTransfer 解析 + 落盘回调 + Markdown 片段插入），与编辑器的
// 语法高亮 / WYSIWYG / 键位等关注点无关，却占着 createEditor.js 的行数预算
// （该文件长期贴着 300 有效行红线，见 tests/contracts.test.mjs 的 LINE_EXEMPTIONS）。
// 抽出后 createEditor.js 只保留「注册处理器」一行，扩展点不变。
//
// 边界：只拦截**文件型图片**；普通文本与其它文件一律返回 false 交默认处理
// （浏览器默认粘贴/拖拽不能被吞）。落盘由上层回调完成
// （App.vue 调 Go SaveImage / SaveImageFromPath 写入文档同级 assets/），
// 本模块只负责插入 Markdown。
//
// 【两条输入通道，两种剪贴板形态】（2026-10-14 真机验收 #8 补）
//   ① 从应用里「复制图片」（截图 / 浏览器拷贝）：剪贴板是**图片数据**，
//      DataTransfer.files 里有 type 为 image/* 的 File。
//   ② 在 Finder 里 ⌘C 一个图片文件：剪贴板是 **file URL**
//      （text/uri-list，部分应用只给 text/plain），dt.files 是空的。
//      只认 ① 的实现会把 ② 放给浏览器默认行为 —— 把文件名当文本插进编辑器，
//      现象就是「复制图片后黏贴只是文件名」（无任何报错，静默失败）。
//   两条通道都归一成「拿到可落盘的源」：File 走 onImageFile，本地路径走
//   onImagePath（Go 侧读盘，webview 里 fetch(file://) 被跨源策略拦死）。

/** 图片扩展名白名单。与 Go 侧 app.go 的 allowedImageExt 同一套口径 */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i

/** 从 DataTransfer 里取第一个图片文件；没有则返回 null */
function imageFileFromDataTransfer(dt) {
  if (!dt || !dt.files || dt.files.length === 0) return null
  for (const f of dt.files) {
    if (f.type && f.type.startsWith('image/')) return f
  }
  return null
}

/**
 * 从 DataTransfer 里取「Finder 复制的图片文件」的本地路径；没有则返回 null。
 *
 * 只认 `file://`  scheme 的 URI：text/plain 里放文件名（WebKit 默认粘贴
 * 插入的就是它）或普通正文文本时一律不拦截 —— 把「看起来像路径的文本」
 * 也吞掉会伤及正常粘贴。
 *
 * @param {DataTransfer} dt
 * @returns {string|null} 本地绝对路径（已 decodeURIComponent）
 */
export function imagePathFromDataTransfer(dt) {
  if (!dt || typeof dt.getData !== 'function') return null
  for (const type of ['text/uri-list', 'text/plain']) {
    let raw
    try {
      raw = dt.getData(type)
    } catch {
      continue // 某些形态的 DataTransfer 对未提供的 type 直接抛
    }
    if (!raw) continue
    // uri-list 允许多行（一次复制多个文件）；只取第一个
    const first = raw.trim().split(/\r?\n/)[0].trim()
    const m = /^file:\/\/(.*)$/i.exec(first)
    if (!m) continue
    let path = m[1]
    try {
      path = decodeURIComponent(path)
    } catch {
      /* 保留原样：% 后跟非十六进制时 decodeURIComponent 会抛 */
    }
    if (IMAGE_EXT_RE.test(path)) return path
  }
  return null
}

/** 落盘拿到 URL 后，在指定位置插入图片 Markdown */
function insertImageMarkdown(view, source, pos, onResolved) {
  Promise.resolve(onResolved(source))
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
 * @param {(source: File|string) => Promise<string|null>} onImageFile 落盘回调：
 *   File = 图片数据通道；字符串 = 本地图片路径（Finder 复制通道）。返回可插入的相对路径。
 *   两条通道共用一个入口，是为了不占 App.vue 的行数预算（装配层 ≤150 硬上限）——
 *   类型分流在 useFileAssets.saveImageFile 内部按 typeof 完成。
 * @returns {Record<string, Function>} 可直接展开进 EditorView.domEventHandlers
 */
export function imageDropHandlers(onImageFile) {
  return {
    paste(event, view) {
      const dt = event.clipboardData
      const file = imageFileFromDataTransfer(dt)
      if (file && onImageFile) {
        event.preventDefault()
        insertImageMarkdown(view, file, view.state.selection.main.head, onImageFile)
        return true
      }
      const path = imagePathFromDataTransfer(dt)
      if (path && onImageFile) {
        event.preventDefault()
        insertImageMarkdown(view, path, view.state.selection.main.head, onImageFile)
        return true
      }
      return false
    },
    drop(event, view) {
      const dt = event.dataTransfer
      const file = imageFileFromDataTransfer(dt)
      if (file && onImageFile) {
        event.preventDefault()
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        insertImageMarkdown(view, file, pos ?? view.state.selection.main.head, onImageFile)
        return true
      }
      const path = imagePathFromDataTransfer(dt)
      if (path && onImageFile) {
        event.preventDefault()
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        insertImageMarkdown(view, path, pos ?? view.state.selection.main.head, onImageFile)
        return true
      }
      return false
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
