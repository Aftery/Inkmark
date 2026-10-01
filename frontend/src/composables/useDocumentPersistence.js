// useDocumentPersistence — 自动保存 / 历史快照 / 导出（HTML + PDF）的唯一落点
// ----------------------------------------------------------------------------
// 从 App.vue 机械搬移（行为零变更，搬移基线：Phase C 编辑器轨道交付版）。
//
// 职责边界：
//   - 自动保存：800ms 防抖覆盖原文件（AC-13）
//   - 历史快照：与自动保存**解耦**（AC-14）——触发源只有 ①有效编辑会话节流
//     （距上次 ≥3 分钟且在编辑）②显式保存 ③文件切换等破坏性边界前 ④手动。
//     轮转/去重由 Go 侧 SnapshotWrite 负责（AC-15）。
//   - 导出：HTML（46rem 屏幕行宽）与 PDF 一键直出（AC-16~AC-19c，含 dark→light
//     主题映射与 467px 版心）；window.go 不可用时退回 window.print()（AC-19b）。
//
// editor 以 getter 注入：编辑器实例在 App.vue 的 onMounted 才创建，
// composable 需在 setup 同步实例化（状态栏初始态先于编辑器存在）。

import { ref } from 'vue'
import { SaveFileDialog, WriteFile } from '../../wailsjs/go/main/App'
import { buildHtmlDocument } from '../export/exporters'

// ---------- 快照元数据展示格式化（历史面板 / 恢复提示共用） ----------

export function formatSnapTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatSnapSize(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

function errText(err) {
  const s = typeof err === 'string' ? err : err?.message || ''
  return s.slice(0, 120) || '未知错误'
}

/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor   () => EditorView|null（onMounted 后才有值）
 * @param {import('vue').Ref<string>} deps.filePath  文档绝对路径（空 = 未落盘）
 * @param {import('vue').Ref<string>} deps.title     文件名（保存对话框默认名）
 * @param {import('vue').Ref<string>} deps.previewHtml 渲染好的预览 HTML（导出用）
 * @param {import('vue').Ref<string>} deps.theme     当前已解析主题（theme.js 真源）
 * @param {Function} deps.notify      (msg, isErr?) => void 轻提示（UI 归 App.vue）
 */
export function useDocumentPersistence({ getEditor, filePath, title, previewHtml, theme, notify }) {
  // 状态机：unsaved（有改动未落盘）→ saving（写入中）→ saved；写入失败 → error。
  // 四态在状态栏用「图标形状 + 文案 + 颜色」三重表达（AC-20）。
  const saveState = ref('unsaved')
  const dirty = ref(false)
  const showHistory = ref(false)
  const snapshots = ref([])
  const historyLoading = ref(false)

  let saveTimer = null
  const SNAPSHOT_INTERVAL = 3 * 60 * 1000
  let lastSnapshotAt = Date.now()

  // Go 绑定直调（wailsjs 生成文件未再生成，且浏览器预览下不存在）
  function getAppApi() {
    return window.runtime && window.go ? window.go.main.App : null
  }

  const docText = () => getEditor()?.state.doc.toString() ?? ''

  // ---------- 自动保存（800ms 防抖，AC-13）----------

  function markDirty() {
    dirty.value = true
    saveState.value = 'unsaved'
    clearTimeout(saveTimer)
    if (filePath.value) saveTimer = setTimeout(autoSave, 800)
  }

  async function autoSave() {
    if (!filePath.value || !getEditor()) return
    saveState.value = 'saving'
    try {
      await WriteFile(filePath.value, docText())
      dirty.value = false
      saveState.value = 'saved'
    } catch (err) {
      saveState.value = 'error' // 只读目录等失败：状态栏明示，不静默
      notify?.(`自动保存失败：${errText(err)}`, true)
    }
  }

  // ---------- 历史快照（AC-14：与自动保存解耦）----------

  function maybeSnapshot() {
    if (Date.now() - lastSnapshotAt >= SNAPSHOT_INTERVAL) writeSnapshot(true)
  }

  async function writeSnapshot(force = false) {
    const api = getAppApi()
    if (!api?.SnapshotWrite || !filePath.value || !getEditor()) return
    if (!force && Date.now() - lastSnapshotAt < SNAPSHOT_INTERVAL) return
    try {
      await api.SnapshotWrite(filePath.value, docText())
      lastSnapshotAt = Date.now()
    } catch { /* 快照失败不打扰写作，保存主链路不受影响 */ }
  }

  // 打开/切换文件等破坏性边界前先留一份快照
  async function snapshotBoundary() {
    if (filePath.value) await writeSnapshot(true)
  }

  // 文件会话切换：清防抖计时器、保存态复位、快照时钟重新起算
  function resetSession() {
    saveState.value = 'saved'
    dirty.value = false
    clearTimeout(saveTimer)
    lastSnapshotAt = Date.now()
  }

  // ---------- 保存 ----------

  async function saveFile() {
    clearTimeout(saveTimer)
    const path = filePath.value
    if (!path) return saveFileAs()
    saveState.value = 'saving'
    try {
      await WriteFile(path, docText())
      dirty.value = false
      saveState.value = 'saved'
      writeSnapshot(true) // 显式保存 → 立即快照（Go 侧按内容哈希去重）
    } catch (err) {
      saveState.value = 'error'
      notify?.(`保存失败：${errText(err)}`, true)
    }
  }

  async function saveFileAs() {
    let path = await SaveFileDialog(title.value.endsWith('.md') ? title.value : '未命名.md')
    if (!path) return
    if (!path.endsWith('.md')) path += '.md'
    saveState.value = 'saving'
    try {
      await WriteFile(path, docText())
      filePath.value = path
      dirty.value = false
      saveState.value = 'saved'
      lastSnapshotAt = Date.now()
      writeSnapshot(true)
    } catch (err) {
      saveState.value = 'error'
      notify?.(`保存失败：${errText(err)}`, true)
    }
  }

  // ---------- 导出 ----------

  async function exportHtml() {
    const path = await SaveFileDialog(`${title.value.replace(/\.md$/, '')}.html`)
    if (!path) return
    const html = buildHtmlDocument(title.value, previewHtml.value, theme.value)
    await WriteFile(path.endsWith('.html') ? path : path + '.html', html)
  }

  // PDF 页眉页脚参数（视觉规格 §8）：临时切到目标主题读 token 解析值再切回，
  // 四角色字色（文档名 --muted / 日期 --meta / 当前页 --fg-2 / 总页 --muted）+ 字体 --font-body。
  function buildPdfOpts(t) {
    const root = document.documentElement
    const prev = root.getAttribute('data-theme')
    root.setAttribute('data-theme', t)
    const cs = getComputedStyle(root)
    const opts = {
      docTitle: title.value.replace(/\.md$/, ''),
      dateText: new Date().toISOString().slice(0, 10),
      colors: {
        docName: cs.getPropertyValue('--muted').trim(),
        date: cs.getPropertyValue('--meta').trim(),
        pageCur: cs.getPropertyValue('--fg-2').trim(),
        pageTotal: cs.getPropertyValue('--muted').trim(),
      },
      fontFamily: cs.getPropertyValue('--font-body').trim(),
    }
    if (prev) root.setAttribute('data-theme', prev)
    else root.removeAttribute('data-theme')
    return opts
  }

  // 非 darwin 判定：桌面端绑定存在但平台不支持一键导出（后端返回「不支持」错误）时，
  // 退回 window.print() 保住 ⌘P 出 PDF 的能力（AC-19b 降级链，不弹错误 toast 就结束）。
  function isNonDarwin() {
    if (typeof navigator === 'undefined') return false
    const ua = `${navigator.platform || ''} ${navigator.userAgent || ''}`
    return !/Mac|iPhone|iPad|iPod/i.test(ua)
  }

  // PDF 一键直出（AC-16~AC-19c）：Go 侧离屏 WKWebView 分页渲染；
  // 浏览器预览 / 非 darwin（window.go 不可用）降级 window.print()，不炸 setup（AC-19b）。
  async function exportPdf() {
    const api = getAppApi()
    if (!api || typeof api.ExportPDF !== 'function') return window.print()
    // AC-19c 主题映射：dark → 强制 light（PDF 是纸面产物，不出深底浅字）；light/paper 原样
    const pdfTheme = theme.value === 'dark' ? 'light' : theme.value
    // 版式宽 467px（架构坑 19 / 视觉规格 §8.8）：1 CSS px = 1 pt 分页假设的前提
    let html = buildHtmlDocument(title.value, previewHtml.value, pdfTheme, '467px')
    // 兜底：若未来模板回退为固定 46rem，这里保证 PDF 版心仍为 467px
    if (/max-width:\s*46rem/.test(html)) html = html.replace(/max-width:\s*46rem/g, 'max-width:467px')
    try {
      const savedPath = await api.ExportPDF(html, JSON.stringify(buildPdfOpts(pdfTheme)))
      // 用户在保存对话框点「取消」：后端返回 ("", nil)（空路径无错误）——
      // 按用户取消处理：静默返回，不弹 toast、不改状态栏错误态
      if (!savedPath) return
      notify?.(`已导出 PDF：${savedPath}`)
    } catch (err) {
      // 非 darwin 桌面平台：绑定存在但后端返回「当前平台不支持一键导出 PDF」——
      // 退回 window.print()，⌘P 仍能出 PDF，而不是弹一个错误 toast 就结束
      if (isNonDarwin()) return window.print()
      // 含 Go 侧 500 页超限等错误：明示并中止，不静默
      notify?.(`导出失败：${errText(err)}`, true)
    }
  }

  // ---------- 历史快照面板 ----------

  function toggleHistory() {
    showHistory.value = !showHistory.value
    if (showHistory.value) loadSnapshots()
  }

  async function loadSnapshots() {
    const api = getAppApi()
    if (!api?.SnapshotList || !filePath.value) { snapshots.value = []; return }
    historyLoading.value = true
    try {
      snapshots.value = (await api.SnapshotList(filePath.value)) || []
    } catch {
      snapshots.value = []
    }
    historyLoading.value = false
  }

  async function snapshotNow() {
    await writeSnapshot(true)
    notify?.('已生成快照')
    loadSnapshots()
  }

  async function restoreSnapshot(s) {
    const api = getAppApi()
    if (!api?.SnapshotRead || !filePath.value) return
    try {
      const content = await api.SnapshotRead(filePath.value, s.name)
      getEditor()?.dispatch({ changes: { from: 0, to: getEditor().state.doc.length, insert: content } })
      getEditor()?.focus()
      showHistory.value = false
      notify?.(`已恢复到 ${formatSnapTime(s.createdAt)}，可 ⌘Z 撤销`)
    } catch (err) {
      notify?.(`恢复失败：${errText(err)}`, true)
    }
  }

  return {
    // 状态
    saveState, dirty, showHistory, snapshots, historyLoading,
    // 自动保存 / 快照
    markDirty, maybeSnapshot, snapshotBoundary, resetSession,
    // 保存 / 导出
    saveFile, saveFileAs, exportHtml, exportPdf,
    // 历史面板
    toggleHistory, snapshotNow, restoreSnapshot,
  }
}
