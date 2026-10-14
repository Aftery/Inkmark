// useFileAssets — 多媒体资产落盘（图片粘贴 / 拖拽的唯一入口）
// ----------------------------------------------------------------------------
// 【为什么独立成模块，为未来留什么位置】
// 图片与附件的「拿到可插入的 URL」这件事，横跨三层、每层都可能换实现：
//   输入层（editor/imageDrop.js）  DataTransfer 解析 + dispatch 插入
//   落盘层（本模块）               File/路径 → Go → 相对路径
//   存储层（app.go 的 SaveImage / SaveImageFromPath）  文档同级 assets/ 目录
// 云端图床时代只需替换本模块的内部实现（换 API 调用），输入层与命令表
// 一行不动 —— 这就是把它单独立模块的收益。
//
// 【两条输入通道，一个回调】（2026-10-14 真机验收 #8 补第二条）
//   ① 图片数据：复制截图 / 浏览器拷贝图 → DataTransfer.files 里的 File
//      → Go SaveImage(docPath, base64, ext)。
//   ② 本地文件：Finder 里 ⌘C 一个图片文件 → 剪贴板只有 file URL
//      （text/uri-list），webview 里 fetch(file://) 被跨源策略拦死，
//      读盘只能走 Go → SaveImageFromPath(docPath, srcPath)。
//   两条通道在 imageDrop.js 里分辨（files vs file URL），到本模块按
//   **入参类型**分流（File vs string）—— 共用一个 onImageFile 回调是为了
//   不占 App.vue 的行数预算（装配层 ≤150 硬上限，见 contracts 契约 5）。
//   两条通道共用同一套「未落盘拦截 → 类型/大小校验 → assets/ 落盘 → 相对路径」
//   契约（校验在 Go 侧，前端不重复实现）。
//
// 【契约】
//   - 未落盘文档（filePath 为空）拦截并提示先保存：没有目录就没有 assets/，
//     静默失败只会让用户以为粘贴坏了。
//   - 返回值 = 可写进 Markdown 的相对路径（assets/xxx.png）；失败一律返回
//     null 并已给过 toast，调用方**不得**再弹错误（避免双重提示）。
//   - 标脏不在这里做：insertMarkdown 走 CM dispatch → updateListener →
//     onDocChange → markDirty，与手工输入同一条路径（不新增第二条标脏通道）。

import { t } from '../i18n/index.js'

/** 通道 ①② 共用的守卫：先有 Go 绑定、先有落盘文档，否则给 toast 并返回 null */
function requireImageSink(getFilePath, notify) {
  const api = window.go?.main?.App
  if (!api?.SaveImage || !api?.SaveImageFromPath) {
    notify?.(t('toast.imageUnsupported'), true)
    return null
  }
  const docPath = getFilePath()
  if (!docPath) {
    notify?.(t('toast.saveBeforeImage'), true)
    return null
  }
  return { api, docPath }
}

/**
 * @param {Object}   deps
 * @param {Function} deps.getFilePath () => string 当前文档路径（空 = 未落盘）
 * @param {Function} deps.notify      (msg, isErr?) => void 轻提示
 */
export function useFileAssets({ getFilePath, notify }) {
  /**
   * 通道 ②：Finder 复制的本地图片文件 → Go 侧 SaveImageFromPath 读盘落库。
   * 扩展名从路径取（Go 侧再校验白名单）；读取与大小校验全在 Go 侧，
   * 前端只搬路径 —— webview 里没有读 file:// 的合法途径（跨源策略）。
   * @param {string} srcPath 本地图片绝对路径
   * @returns {Promise<string|null>} 可插入的相对路径；失败 null
   */
  async function saveImagePath(srcPath) {
    const sink = requireImageSink(getFilePath, notify)
    if (!sink) return null
    try {
      return await sink.api.SaveImageFromPath(sink.docPath, srcPath)
    } catch (err) {
      notify?.(t('toast.imageFailed', { error: err?.message || err }), true)
      return null
    }
  }

  /**
   * 图片落盘总入口（粘贴 / 拖拽两条通道共用，见文件头）。
   * @param {File|string} source File = 图片数据通道；字符串 = 本地图片路径（Finder 复制通道）
   * @returns {Promise<string|null>} 可插入的相对路径；失败 null
   */
  async function saveImageFile(source) {
    if (typeof source === 'string') return saveImagePath(source)
    const sink = requireImageSink(getFilePath, notify)
    if (!sink) return null
    const { api, docPath } = sink
    try {
      // 逐字节转二进制串再 btoa：FileReader / arrayBuffer → base64 的桥。
      // 不用 String.fromCharCode(...bytes) —— 大图会因参数过多爆栈。
      const bytes = new Uint8Array(await source.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      const ext = (source.name.split('.').pop() || 'png').toLowerCase()
      return await api.SaveImage(docPath, btoa(bin), ext)
    } catch (err) {
      notify?.(t('toast.imageFailed', { error: err?.message || err }), true)
      return null
    }
  }

  return { saveImageFile, saveImagePath }
}
