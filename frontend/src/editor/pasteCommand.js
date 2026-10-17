// pasteCommand.js — ⌘V / 菜单「编辑 ▸ 粘贴」的唯一执行体（图片优先，文本兜底）
// ----------------------------------------------------------------------------
// 【为什么粘贴命令必须自带图片通道 —— 2026-10-16 真机复验的第十四轮根因】
// ⌘V 被 installGlobalShortcuts 的全局分发接管并 preventDefault —— webview 的
// 原生粘贴与 DOM paste 事件**从此不再触发**，imageDrop.js 里基于 paste 事件的
// 三条图片通道（①数据 ②file URL ③系统剪贴板）到不了键盘这条路（拖拽不受
// 影响，走 drop 事件）。菜单「粘贴」同样汇到本命令。修复前的症状即：拖拽能
// 插图、⌘V 只出文件名文本 —— 因为命令处理器只做了 ClipboardGet 文本插入。
//
// 【判据为什么不需要弱启发式门槛】这里是异步上下文（命令已是 async），
// 直接问 Go「剪贴板里有没有图片」，由 Go 侧字节嗅探（sniffImageMagic）精确
// 裁定；imageDrop 那套「文本像不像文件名」的门槛是为同步 preventDefault 服务的，
// 这里用不上。
//
// 【顺序契约（沿用旧 doPaste 的裁决）】先快照选区再 await：异步读取期间焦点 /
// 选区可能变化，插入必须落在按下 ⌘V 那一刻的选区上。
import { t } from '../i18n/index.js'

/**
 * 把系统剪贴板的内容插入 view：有图片插 `![](assets/…)`，否则插文本。
 *
 * @param {object} view CodeMirror EditorView（测试可注入同形 stub）
 * @param {Object} io
 * @param {() => Promise<string|null>} io.getClipboardImage 问 Go 要图片
 *   （useFileAssets.saveImageFromClipboard：无图片 / 未落盘 / 旧构建降级都返回
 *   null —— 都不是错误，静默落回文本路径）
 * @param {() => Promise<string>} io.getText 读剪贴板文本（ClipboardGet 绑定）
 * @param {(msg: string, isErr?: boolean) => void} [io.notify] 轻提示
 * @returns {Promise<boolean>} 是否插入了内容
 */
export async function pasteIntoView(view, { getClipboardImage, getText, notify }) {
  const { from, to } = view.state.selection.main // 快照：异步期间选区可能变
  try {
    const url = await getClipboardImage()
    if (url) {
      const snippet = `![](${url})`
      view.dispatch({
        changes: { from, to, insert: snippet },
        selection: { anchor: from + snippet.length },
      })
      view.focus()
      return true
    }
  } catch {
    /* 图片通道异常不阻塞文本粘贴（useFileAssets 对真错误已 toast） */
  }
  let text = ''
  try {
    text = await getText()
  } catch (e) {
    console.error('[clipboard] read failed:', e)
    notify?.(t('toast.clipboardReadFailed'))
    return false
  }
  if (!text) {
    notify?.(t('toast.clipboardEmpty'))
    return false
  }
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  })
  view.focus()
  return true
}
