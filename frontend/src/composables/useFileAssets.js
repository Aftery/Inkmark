// useFileAssets — 多媒体资产落盘（图片粘贴 / 拖拽的唯一入口）
// ----------------------------------------------------------------------------
// 【为什么独立成模块，为未来留什么位置】
// 图片与附件的「拿到可插入的 URL」这件事，横跨三层、每层都可能换实现：
//   输入层（editor/imageDrop.js）  DataTransfer 解析 + dispatch 插入
//   落盘层（本模块）               File → Base64 → Go → 相对路径
//   存储层（app.go 的 SaveImage）  文档同级 assets/ 目录
// 云端图床时代只需替换本模块的 saveImageFile 内部实现（换 API 调用），
// 输入层与命令表一行不动 —— 这就是把它单独立模块的收益。
//
// 【契约】
//   - 未落盘文档（filePath 为空）拦截并提示先保存：没有目录就没有 assets/，
//     静默失败只会让用户以为粘贴坏了。
//   - 返回值 = 可写进 Markdown 的相对路径（assets/xxx.png）；失败一律返回
//     null 并已给过 toast，调用方**不得**再弹错误（避免双重提示）。
//   - 标脏不在这里做：insertMarkdown 走 CM dispatch → updateListener →
//     onDocChange → markDirty，与手工输入同一条路径（不新增第二条标脏通道）。

import { t } from '../i18n/index.js'

/**
 * @param {Object}   deps
 * @param {Function} deps.getFilePath () => string 当前文档路径（空 = 未落盘）
 * @param {Function} deps.notify      (msg, isErr?) => void 轻提示
 */
export function useFileAssets({ getFilePath, notify }) {
  /**
   * 图片落盘：File → Base64 → Go 侧 SaveImage → 相对路径。
   * Go 侧负责在文档同级建 assets/ 目录、生成 img-<毫秒>-<随机>.<ext> 文件名
   * （app.go 的 SaveImage），并做类型白名单与 20MB 上限校验。
   * @param {File} file 浏览器给出的图片文件
   * @returns {Promise<string|null>} 可插入的相对路径；失败 null
   */
  async function saveImageFile(file) {
    const api = window.go?.main?.App
    if (!api?.SaveImage) {
      notify?.(t('toast.imageUnsupported'), true)
      return null
    }
    const docPath = getFilePath()
    if (!docPath) {
      notify?.(t('toast.saveBeforeImage'), true)
      return null
    }
    try {
      // 逐字节转二进制串再 btoa：FileReader / arrayBuffer → base64 的桥。
      // 不用 String.fromCharCode(...bytes) —— 大图会因参数过多爆栈。
      const bytes = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      return await api.SaveImage(docPath, btoa(bin), ext)
    } catch (err) {
      notify?.(t('toast.imageFailed', { error: err?.message || err }), true)
      return null
    }
  }

  return { saveImageFile }
}
