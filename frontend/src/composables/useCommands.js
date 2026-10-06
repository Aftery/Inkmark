// useCommands — 命令处理器注册面 + 菜单结构 + 全局 Esc 路由
// ----------------------------------------------------------------------------
// 【为什么命令注册从 App.vue 搬到这里】
// 原生菜单下线后，COMMANDS 表（useShortcuts.js）成了键位唯一真源，
// 菜单点击与全局快捷键经同一个命令总线分发，处理器只有这一处。
// 它天然是一整块「命令 → 行为」的映射：留在 App.vue 会让装配层持续膨胀
// （旧 App.vue 1300+ 行的主因之一），故整体下沉。
//
// 【与命令表的双向闭合由门禁保证，不要手改】
// contracts.test.mjs 契约 1 核对「COMMANDS 的每条 id 都在本文件的 map 里注册」，
// 缺一个就是「菜单里点了没反应 / 快捷键按了没反应」且不报错。
//
// 【时序契约】registerCommands 在 onMounted 里跑：命令处理器依赖编辑器实例，
// onMounted 之前它还不存在。装全局键位与 Esc 路由也在同一时机。

import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import {
  undo, redo, selectAll, moveLineUp, moveLineDown, copyLineDown, deleteLine,
} from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import {
  toggleBold, toggleItalic, toggleStrike, toggleInlineCode,
  toggleLink, insertImage, toggleHeading,
  toggleBulletList, toggleOrderedList, toggleTaskList, toggleBlockquote,
  toggleCodeBlock, insertTable, insertHr, insertToc, clearFormatting,
} from '../editor/commands'
import { SYNTAX_DOC } from '../editor/sampleDocs'
import {
  commandsByGroup, fmtAccel, onCommand, installGlobalShortcuts,
} from './useShortcuts.js'
import { WindowMinimise, WindowToggleMaximise } from '../../wailsjs/runtime/runtime'
import { ClipboardGet, ClipboardSet, Version } from '../../wailsjs/go/main/App'
import { t } from '../i18n/index.js'

/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor   () => EditorView|null
 * @param {Object}   deps.session    useEditorSession 实例（flushPreview / renderMarkdown）
 * @param {Object}   deps.docState   useDocumentState 实例（保存 / 导出 / 历史）
 * @param {Object}   deps.fileOps    useFileOps 实例（文件级命令）
 * @param {Object}   deps.workspace  useWorkspace 实例（界面开关）
 * @param {Object}   deps.prefs      usePrefs 单例（缩放 / 主题）
 * @param {Object}   deps.outlineSync useOutline 实例（大纲切换时同步高亮）
 * @param {Object}   deps.help       useShortcutsHelp 实例（速查表可见性与行数据）
 * @param {import('vue').Ref} deps.dialog useDialog 的 dialog（Esc 路由需要读可见性）
 * @param {Function} deps.closeDialog 关闭输入对话框
 * @param {Function} deps.askInput    打开输入对话框
 * @param {Function} deps.notify      (msg, isErr?) => void 轻提示
 * @param {import('vue').Ref} deps.slashRef 斜杠面板（它自己处理 Esc）
 */
export function useCommands(deps) {
  const {
    getEditor, session, docState, fileOps, workspace, prefs, outlineSync, help,
    dialog, closeDialog, askInput, notify, slashRef,
  } = deps

  // 设置面板（⌘, 打开；Esc / 关闭按钮收起）与关于面板（帮助菜单）
  const showSettings = ref(false)
  const showAbout = ref(false)
  const aboutVersion = ref('')

  function closeSettings() {
    showSettings.value = false
    getEditor()?.focus()
  }

  function closeAbout() {
    showAbout.value = false
    getEditor()?.focus()
  }

  // ---------- 编辑基础 ----------

  /** 统一执行编辑器命令：吞掉异常（命令失败不该打断输入流），执行后还焦 */
  function execCmd(cmd) {
    const editor = getEditor()
    if (!editor) return
    try {
      cmd(editor)
    } catch (e) {
      console.error('[execCmd] command failed:', e)
    }
    editor.focus()
  }

  // ---------- 剪贴板（剪切 / 拷贝 / 粘贴）----------
  // 走系统剪贴板 + CM6 事务：原生 EditMenu Role 的 copy:/paste: selector 在
  // 菜单下线后彻底不可用，而 document.execCommand('paste') 被浏览器安全策略
  // 禁用（无用户手势 / 非可编辑上下文），故只能自己读写。
  // 注意·顺序契约：粘贴必须【先 ClipboardGet 拿文本、再插入】，异步读取期间
  // 焦点/选区可能变化，故先捕获选区快照，读取成功后再用该快照插入。
  async function doCopy({ cut = false } = {}) {
    const view = getEditor()
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = view.state.sliceDoc(from, to)
    if (!text) {
      notify?.(t('toast.noSelection'))
      return
    }
    try {
      await ClipboardSet(text)
    } catch (e) {
      console.error('[clipboard] write failed:', e)
      notify?.(t('toast.clipboardWriteFailed'))
      return
    }
    if (cut) {
      view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } })
      view.focus()
    }
  }

  async function doPaste() {
    const view = getEditor()
    if (!view) return
    const { from, to } = view.state.selection.main // 快照：异步期间选区可能变
    let text = ''
    try {
      text = await ClipboardGet()
    } catch (e) {
      console.error('[clipboard] read failed:', e)
      notify?.(t('toast.clipboardReadFailed'))
      return
    }
    if (!text) {
      notify?.(t('toast.clipboardEmpty'))
      return
    }
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    view.focus()
  }

  // ---------- 查找 / 跳转 / 复制为 HTML ----------

  function openFind() {
    const editor = getEditor()
    if (!editor) return
    nextTick(() => {
      editor.focus()
      openSearchPanel(editor)
    })
  }

  async function jumpToLine() {
    const editor = getEditor()
    if (!editor) return
    const v = await askInput({
      title: t('dialog.jumpToLine'),
      placeholder: t('dialog.linePlaceholder', { total: editor.state.doc.lines }),
    })
    if (v === null) return
    const n = Number.parseInt(v, 10)
    if (!Number.isFinite(n) || n < 1 || n > editor.state.doc.lines) {
      notify?.(t('toast.lineOutOfRange', { total: editor.state.doc.lines }), true)
      return
    }
    const line = editor.state.doc.line(n)
    editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    editor.focus()
  }

  function copySelectionAsHtml() {
    const editor = getEditor()
    if (!editor) return
    const r = editor.state.selection.main
    const md = r.empty ? editor.state.doc.toString() : editor.state.sliceDoc(r.from, r.to)
    navigator.clipboard?.writeText(session.renderMarkdown(md)).then(
      () => notify?.(t('toast.copiedHtml')),
      () => notify?.(t('toast.copyFailed'), true),
    )
  }

  // ---------- 大纲开关 ----------

  function toggleOutline() {
    workspace.sidebarOpen.value = !workspace.sidebarOpen.value
    if (workspace.sidebarOpen.value) {
      workspace.sidebarTab.value = 'outline'
      outlineSync.scheduleOutlineSync()
    }
  }

  // ---------- 关于 / 语法示例 ----------

  // 版本号【只从 Go 单一真源读】（App.Version() ← version.go 的 var version）
  async function openAbout() {
    try {
      aboutVersion.value = await Version()
    } catch {
      aboutVersion.value = ''
    }
    showAbout.value = true
  }

  /** 帮助 → Markdown 语法示例：按破坏性边界处理（先给当前稿留快照） */
  async function loadSyntaxSample() {
    await docState.switchFile()
    fileOps.loadDocument(SYNTAX_DOC, '')
    notify?.(t('toast.syntaxLoaded'))
  }

  // ---------- 命令注册（菜单点击与快捷键共用这一张表）----------

  function registerCommands() {
    const map = {
      // 文件
      'file.new': fileOps.newFile,
      'file.open': fileOps.openFile,
      'file.openFolder': fileOps.openFolder,
      'file.save': () => docState.saveFile(),
      'file.saveAs': () => docState.saveFileAs(),
      'file.rename': fileOps.renameFile,
      'file.print': () => { session.flushPreview(); window.print() },
      'file.exportHtml': () => { session.flushPreview(); docState.exportHtml() },
      'file.exportPdf': () => { session.flushPreview(); docState.exportPdf() },
      // 编辑
      'edit.undo': () => execCmd(undo),
      'edit.redo': () => execCmd(redo),
      'edit.cut': () => doCopy({ cut: true }),
      'edit.copy': () => doCopy(),
      'edit.paste': () => doPaste(),
      'edit.selectAll': () => execCmd(selectAll),
      'edit.find': openFind,
      'edit.findReplace': openFind, // CM 面板自带替换行，同一入口
      'edit.jumpLine': jumpToLine,
      'edit.moveLineUp': () => execCmd(moveLineUp),
      'edit.moveLineDown': () => execCmd(moveLineDown),
      'edit.dupLine': () => execCmd(copyLineDown),
      'edit.deleteLine': () => execCmd(deleteLine),
      'edit.copyAsHtml': copySelectionAsHtml,
      // 格式（工具条已下线，由斜杠面板与快捷键驱动）
      'format.bold': () => execCmd(toggleBold),
      'format.italic': () => execCmd(toggleItalic),
      'format.strike': () => execCmd(toggleStrike),
      'format.inlineCode': () => execCmd(toggleInlineCode),
      'format.link': () => execCmd(toggleLink),
      'format.h1': () => execCmd(toggleHeading(1)),
      'format.h2': () => execCmd(toggleHeading(2)),
      'format.h3': () => execCmd(toggleHeading(3)),
      'format.bulletList': () => execCmd(toggleBulletList),
      'format.orderedList': () => execCmd(toggleOrderedList),
      'format.todoList': () => execCmd(toggleTaskList),
      'format.quote': () => execCmd(toggleBlockquote),
      'format.codeBlock': () => execCmd(toggleCodeBlock),
      'format.insertImage': () => execCmd(insertImage),
      'format.insertTable': () => execCmd(insertTable),
      'format.insertHr': () => execCmd(insertHr),
      'format.insertToc': () => execCmd(insertToc),
      'format.clear': () => execCmd(clearFormatting),
      // 视图
      'view.focus': workspace.toggleFocus,
      'view.outline': toggleOutline,
      'view.zoomIn': () => prefs.changeZoom(10),
      'view.zoomOut': () => prefs.changeZoom(-10),
      'view.zoomReset': () => prefs.resetZoom(),
      'view.theme': () => prefs.cycleTheme(),
      'view.typewriter': workspace.toggleTypewriter,
      'view.alwaysOnTop': workspace.toggleAlwaysOnTop,
      // 窗口
      'window.minimize': () => { try { WindowMinimise() } catch { /* 浏览器预览 */ } },
      'window.zoom': () => { try { WindowToggleMaximise() } catch { /* 浏览器预览 */ } },
      // 帮助
      'help.shortcuts': () => { help.showShortcuts.value = true },
      'help.about': openAbout,
      'help.syntax': loadSyntaxSample,
    }
    for (const id of Object.keys(map)) onCommand(id, map[id])
  }

  /** 供 TitleBar 渲染菜单：按分组取命令并附上已翻译的显示名与键位 */
  const menuGroups = computed(() => {
    const order = ['file', 'edit', 'format', 'view', 'window', 'help']
    return order
      .map((g) => ({
        id: g,
        items: commandsByGroup(g).map((c) => ({
          id: c.id,
          label: t(c.labelKey),
          kbd: fmtAccel(c.accel),
        })),
      }))
      .filter((g) => g.items.length > 0)
  })

  // ---------- 全局 Esc：逐层收起最上面那层 ----------
  // 顺序即层级（输入框 > 设置 > 速查 > 关于 > 专注 > 阅读 > 历史）；
  // 输入框等原生控件自己的 Esc 交由其元素处理，故这里只处理「弹层类」。
  function onEscKeydown(e) {
    if (e.isComposing) return
    if (e.key !== 'Escape') return
    if (slashRef.value?.isOpen?.()) return // 斜杠面板自己处理 Esc（CM keymap）
    if (dialog.value.show) closeDialog(null)
    else if (showSettings.value) closeSettings()
    else if (help.showShortcuts.value) help.showShortcuts.value = false
    else if (showAbout.value) closeAbout()
    else if (workspace.focusOn.value) workspace.toggleFocus()
    else if (workspace.viewMode.value === 'reading') workspace.toggleReading()
    else if (docState.showHistory.value) docState.showHistory.value = false
  }

  let removeShortcuts = null
  onMounted(() => {
    registerCommands()
    removeShortcuts = installGlobalShortcuts()
    window.addEventListener('keydown', onEscKeydown)
  })
  onBeforeUnmount(() => {
    removeShortcuts?.()
    window.removeEventListener('keydown', onEscKeydown)
  })

  return {
    menuGroups,
    showSettings, closeSettings,
    showAbout, aboutVersion, closeAbout,
    showShortcuts: help.showShortcuts,
    shortcutRows: help.rows,
  }
}
