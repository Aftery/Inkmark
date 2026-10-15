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
// 【三条输入通道，三种剪贴板形态】
//   ① 从应用里「复制图片」（截图 / 浏览器拷贝）：剪贴板是**图片数据**，
//      DataTransfer.files 里有 type 为 image/* 的 File。
//   ② DataTransfer 里能拿到 file:// URI：某些内核/来源会给 text/uri-list，
//      只认 ① 的实现会把 ② 放给浏览器默认行为。
//   ③ **系统剪贴板兜底**（2026-10-15 真机复验新增，也是 WKWebView 上的唯一出路）：
//      WKWebView（Safari 内核）**不把剪贴板图片暴露给 clipboardData** ——
//      没有 files、没有 items、text/uri-list 里也没有 file://，只有 text/plain
//      里的**文件名**。于是 ①② 全部落空 → 事件交回 WebKit 默认处理 → 默认行为
//      是**把文件名当纯文本插入**。这就是「复制图片后黏贴只是文件名」，
//      全程无任何报错（静默失败）。
//      剪贴板的二进制内容 webview 里读不到（fetch(file://) 被跨源拦死、
//      navigator.clipboard.read() 无权限且异步），只能由 Go 走原生 API 取 →
//      onClipboardImage()。
//
// 【paste 事件是同步的，Go 调用是异步的 —— 这是本模块最棘手的地方】
// 若先让默认行为跑完（不 preventDefault），文件名文本已经被插进文档，
// 异步拿到图片后就只能「再插一张图」，留下垃圾。
// 故这里的顺序是：**先用同步可得的信息做门槛判断 → 决定是否 preventDefault
// → 再发起异步的 Go 调用**。门槛的作用是「宁可漏插一张图，也不误吞一次文本粘贴」：
// 只有当剪贴板里既有图片、DataTransfer 又拿不到时，才认为这是一次图片粘贴。
function shouldTryClipboardFallback(dt) {
  if (!dt) return false
  // 已经有图片数据（通道①）或 file:// URI（通道②）→ 不需要兜底。
  // 这两行在 paste() 里其实是**冗余的**（通道①② 成功时早已 return true，
  // 走不到这里），属防御性防线：若将来重构调整了早返回顺序，
  // 这里能保证「已经拿到图片就不再问剪贴板」不会失效（否则重复插图）。
  if (imageFileFromDataTransfer(dt)) return false
  if (imagePathFromDataTransfer(dt)) return false
  // WebKit 对「复制的文件」给的是 text/plain 里的文件名。
  // 只在文本「看起来像图片引用」时才兜底：正常粘贴一段中文/代码/带空格的句子
  // 都不该被吞掉。这是**弱启发式**，真正的判据在 Go 侧（按字节嗅探魔数）。
  const text = safeGetData(dt, 'text/plain')
  return looksLikeImageFilename(text)
}

/** 导出供测试直测门槛函数本身（变异自证需要：绕道 paste 的测试
 * 无法区分「paste 的早返回」与「门槛的短路检查」哪一道在起作用）。 */
export { shouldTryClipboardFallback }

/** 图片扩展名白名单。与 Go 侧 app.go 的 allowedImageExt 同一套口径 */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i

/**
 * 安全地读 DataTransfer 的某个类型；某些形态对未提供的 type 直接抛。
 * 与 clipboard_text 相关的失败一律当作「没有」，绝不因一次读取失败中断粘贴。
 */
function safeGetData(dt, type) {
  if (!dt || typeof dt.getData !== 'function') return ''
  try {
    return dt.getData(type) || ''
  } catch {
    return ''
  }
}

/**
 * 判断剪贴板文本是否「看起来像一个图片文件名」——WebKit 对「复制的文件」
 * 给的就是这个形态（只有文件名、没有路径）。
 *
 * 门槛条件刻意保守：单行、无路径分隔符、**无空白**、带已知图片扩展名。
 * 「无空白」这一条是必须的：只判结尾扩展名的话，「见foo.png bar.png」
 * 这种正常句子会被误判 → 文本被吞 → 比插不进图更严重的回归。
 * （第一版漏了这条，被本文件的自测当场抓到。）
 *
 * 两处判据不同层、不可互替：本函数决定「要不要去问剪贴板」（弱启发式门槛，
 * 宁可漏判也不吞文本）；真正「算不算图片」由 Go 侧按字节嗅探魔数裁定
 * （clipboard_image.go 的 sniffImageMagic），文本形态在这边只够资格触发询问。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeImageFilename(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (/[\r\n]/.test(t)) return false
  if (/\s/.test(t)) return false // 含空格/制表符 → 是句子，不是文件名
  if (t.includes('/') || t.includes('\\')) return false
  return IMAGE_EXT_RE.test(t)
}

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
 *   File = 图片数据通道；字符串 = 本地图片路径。返回可插入的相对路径。
 *   两条通道共用一个入口，是为了不占 App.vue 的行数预算（装配层 ≤150 硬上限）——
 *   类型分流在 useFileAssets.saveImageFile 内部按 typeof 完成。
 * @param {() => Promise<string|null>} [onClipboardImage] 通道③：问系统剪贴板要图片。
 *   可选 —— 没注册时行为与加通道③之前完全一致。
 * @returns {Record<string, Function>} 可直接展开进 EditorView.domEventHandlers
 */
export function imageDropHandlers(onImageFile, onClipboardImage) {
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
      // 通道③：①② 都拿不到，且文本像图片文件名 → 去问系统剪贴板。
      // 必须在这里（同步）就 preventDefault：默认行为一旦跑完，
      // 文件名文本已经被插进文档，异步取到图片就只剩「多插一张 + 留垃圾」。
      // 门槛不通过时不 preventDefault，正常文本粘贴一律放行。
      if (onClipboardImage && shouldTryClipboardFallback(dt)) {
        event.preventDefault()
        const at = view.state.selection.main.head
        // 记下被拦下的文本：preventDefault 后它不会进文档。
        // 若剪贴板里其实没有图片（启发式误判），要原样还给用户。
        const fallbackText = safeGetData(dt, 'text/plain')
        // 注意：必须用 then(onFulfilled) 形式而不是 Promise.resolve(fn()) ——
        // 后者会**先同步执行** fn()，fn 抛错就直接逃出 paste()，
        // 变成编辑器里的未捕获异常。async 包装把同步抛错也变成 reject。
        Promise.resolve()
          .then(onClipboardImage)
          .then((url) => {
            const pos = Math.max(0, Math.min(at, view.state.doc.length))
            if (url) {
              // URL 已由 Go 落盘，直接插 Markdown（不再回调一次）
              const snippet = `![](${url})`
              view.dispatch({
                changes: { from: pos, insert: snippet },
                selection: { anchor: pos + snippet.length },
              })
              return
            }
            // 误判：把文本还回去（剪贴板里其实没有图片）
            if (fallbackText) {
              view.dispatch({
                changes: { from: pos, insert: fallbackText },
                selection: { anchor: pos + fallbackText.length },
              })
            }
          })
          .catch(() => { /* Go 侧已给 toast */ })
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
