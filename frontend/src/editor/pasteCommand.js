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
 * 粘贴内容是否「像单个 URL」：是则可以把已有选区变成链接。
 *
 * 口径与 @codemirror/lang-markdown 的 pasteURLAsLink 一致（协议白名单 + 无空白），
 * 但**不能复用它**：那条实现挂在 DOM 的 paste 事件上，而 ⌘V 已被全局分发
 * preventDefault（第十四轮根因，见文件头）—— 它在本仓永远不会触发。
 */
const URL_RE = /^(?:https?:\/\/|mailto:|xmpp:|www\.)\S+$/i

/** 纯文本是否是单个 URL（导出供测试） */
export function looksLikeUrl(text) {
  if (typeof text !== 'string') return false
  const s = text.trim()
  return s.length > 0 && !s.includes('\n') && URL_RE.test(s)
}

/**
 * 把「选中文字 + 粘贴 URL」变成 `[选中文字](url)`。
 *
 * @returns {{snippet: string}|null} 需要转换时返回插入片段，否则 null
 */
export function linkifySelection(url, selected) {
  if (!looksLikeUrl(url) || !selected) return null
  // 选区本身已经是链接/图片时不叠加（否则粘出 `[[](u)](u)` 这种产物）
  if (/^\s*!?\[[^\]]*\]\([^)]*\)\s*$/.test(selected)) return null
  // 跨行选区不转链接：`[...]` 里含换行不会被渲染成链接，产物只会是源码噪音
  if (selected.includes('\n')) return null
  const target = /^www\./i.test(url.trim()) ? `https://${url.trim()}` : url.trim()
  return { snippet: `[${selected}](${target})` }
}

/**
 * 读取一段文档文本（同步快照用）。
 *
 * 【为什么两条路都留着】真实 EditorState 有 sliceDoc()，而测试/外部注入的同形
 * stub 往往只给 doc.sliceString()（本仓 paste-image.test.mjs 即如此）。这里按
 * 「能力探测」读，而不是强制调用方补方法 —— 少一个「测试桩与真实现接口不一致」
 * 的隐式契约，同时保住「await 之前取快照」这条真正重要的顺序约定。
 */
function readSlice(state, from, to) {
  if (typeof state.sliceDoc === 'function') return state.sliceDoc(from, to)
  const doc = state.doc
  if (doc && typeof doc.sliceString === 'function') return doc.sliceString(from, to)
  return ''
}

/**
 * 把系统剪贴板的内容插入 view：有图片插 `![](assets/…)`，否则插文本。
 * 文本路径上若「有选区 + 内容是 URL」则转成 Markdown 链接（见 linkifySelection）。
 *
 * @param {object} view CodeMirror EditorView（测试可注入同形 stub）
 * @param {Object} io
 * @param {() => Promise<string|null>} io.getClipboardImage 问 Go 要图片
 *   （useFileAssets.saveImageFromClipboard：无图片 / 未落盘 / 旧构建降级都返回
 *   null —— 都不是错误，静默落回文本路径）
 * @param {() => Promise<string>} io.getText 读剪贴板文本（ClipboardGet 绑定）
 * @param {() => Promise<boolean>} [io.hasClipboardImage] 剪贴板里是否有图片（不落盘探测）
 * @param {() => boolean} [io.canSaveImage] 当前文档是否已落盘（决定图片能否写入）
 * @param {(msg: string, isErr?: boolean) => void} [io.notify] 轻提示
 * @returns {Promise<boolean>} 是否插入了内容
 */
export async function pasteIntoView(view, { getClipboardImage, getText, hasClipboardImage, canSaveImage, notify }) {
  const { from, to } = view.state.selection.main // 快照：异步期间选区可能变
  // 选区文字也在 await 前取（同一快照语义）：链接化要用它当链接文本
  const selected = from === to ? '' : readSlice(view.state, from, to)
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
    // 「剪贴板里明明有图」与「剪贴板真没有内容」必须分开说：
    // 前者在文档未落盘时被图片通道静默跳过（quiet 探测），旧实现一律报
    // 「剪贴板为空」——与事实相反（2026-10-25 真机反馈）。
    let hasImage = false
    try { hasImage = Boolean(await hasClipboardImage?.()) } catch { hasImage = false }
    if (hasImage) {
      // 已落盘却仍走到这里 = 落盘失败，真错误已由 useFileAssets toast，不再叠加
      if (!canSaveImage?.()) notify?.(t('toast.saveBeforeImage'), true)
    } else {
      notify?.(t('toast.clipboardEmpty'))
    }
    return false
  }
  // 选中文字 + 粘贴 URL → [选中文字](url)；选区为空时保持原样直接插入文本
  const link = linkifySelection(text, selected)
  const insert = link ? link.snippet : text
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  view.focus()
  return true
}
