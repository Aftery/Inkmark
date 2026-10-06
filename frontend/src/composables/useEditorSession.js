// useEditorSession — 编辑器实例 + 派生状态（行列 / 字数 / 预览）+ 文档替换
// ----------------------------------------------------------------------------
// 从 App.vue 抽出（行为零变更）。本模块是「编辑器」这一侧的唯一持有者：
//   - 创建 / 销毁 EditorView，并把实例写进调用方给的 editorRef 槽；
//   - 维护全部由文档内容派生的状态：markdown、previewHtml、caret、wordCount；
//   - 预览渲染防抖（停手 ~120ms 才重渲染，见下）；
//   - syncAfterDocReplace：整份替换文档后的派生状态同步。
//
// 【预览防抖为何在这里而不是调用方】
// markdown 只驱动预览（编辑器内容在 CM6 内）。大文档下每键全量渲染会卡，
// 故把「输入期」的更新防抖 120ms；打开 / 恢复文件走 syncAfterDocReplace
// 直接赋值（不防抖，需即时）。导出 / 打印前由调用方 flushPreview() 补齐。
//
// 【实例槽 editorRef 由调用方持有】
// 本模块 onMounted 才创建实例，而 prefs / documentState / fileOps 等都要在
// setup 期就拿到「取实例的方式」。故约定：调用方声明 shallowRef 槽位并传进来，
// 本模块在 onMounted 填入；装配层与各模块之间只通过 getEditor 闭包互传。
// 这样也顺带保住了「第三类 TDZ」的守卫样本：槽位声明必须早于任何 composable 调用。

import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { createEditor, centerCursor } from '../editor/createEditor'
import { createRenderer, render } from '../preview/markdown'
import { DEFAULT_DOC } from '../editor/sampleDocs'
import { t } from '../i18n/index.js'

const PREVIEW_DEBOUNCE_MS = 120

export function useEditorSession({
  editorRef,
  onDocChange,
  onImageFile,
  typewriterOn,
  onOutlineRefresh,
  onEditorReady,
}) {
  const editorEl = ref(null)   // 模板 ref：CM 挂载点
  const slashRef = ref(null)   // 斜杠命令面板（CM 扩展经 host 协议回调它）
  const markdown = ref('')
  const filePath = ref('')
  const folderPath = ref('')
  const title = computed(() => (filePath.value ? filePath.value.split('/').pop() : t('common.untitled')))
  const caret = ref({ line: 1, col: 1 })

  const renderer = createRenderer()
  const previewHtml = computed(() => render(renderer, markdown.value))

  // 字数：CJK 按字计，西文按词计
  const wordCount = computed(() => {
    const s = markdown.value
    const cjkRe = /[㐀-䶿一-鿿぀-ヿ가-힯]/g
    const cjk = (s.match(cjkRe) || []).length
    const latin = (s.replace(cjkRe, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
    return cjk + latin
  })

  // ---------- 预览渲染防抖 ----------
  let previewTimer = null
  let pendingDoc = null

  function applyPreview(doc) {
    markdown.value = doc
    // 预览 DOM 在 nextTick 才刷新，此时才能重建标题锚点；大纲同机更新
    nextTick(() => onOutlineRefresh?.())
  }

  function queuePreview(doc) {
    pendingDoc = doc
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      previewTimer = null
      const d = pendingDoc
      pendingDoc = null
      if (d !== null) applyPreview(d)
    }, PREVIEW_DEBOUNCE_MS)
  }

  /** 立即应用待渲染内容（导出、打印等任何需要「所见即最新」的场合） */
  function flushPreview() {
    if (previewTimer === null) return
    clearTimeout(previewTimer)
    previewTimer = null
    const doc = pendingDoc
    pendingDoc = null
    if (doc !== null) applyPreview(doc)
  }

  /** 丢弃待渲染内容（切换文件等破坏性边界前，防止旧内容稍后覆盖新文档） */
  function cancelPendingPreview() {
    clearTimeout(previewTimer)
    previewTimer = null
    pendingDoc = null
  }

  // ---------- 编辑器 ----------

  function onEditorUpdate(u) {
    const pos = u.state.selection.main.head
    const line = u.state.doc.lineAt(pos)
    caret.value = { line: line.number, col: pos - line.from + 1 }
    // 打字机模式：输入后把光标行滚到视口中部（rAF 避开 update 事务内再 dispatch）
    if (typewriterOn?.value && u.docChanged) {
      requestAnimationFrame(() => centerCursor(editorRef.value))
    }
  }

  /**
   * 整份替换文档后的派生状态同步。
   * replaceDocument 走 setState 绕开 CM6 tile 增量崩溃（见 createEditor.js），
   * 而 setState 不是事务更新、不会触发 updateListener，故此处手工补齐派生状态。
   * 【注意】这里不标脏：打开文件时内存 == 磁盘，标脏由调用方按场景决定
   * （恢复快照要标，打开文件不标 —— 见 useDocumentState.restoreSnapshot）。
   */
  function syncAfterDocReplace(content) {
    cancelPendingPreview() // 丢弃输入期待渲染内容，防止稍后覆盖刚打开/恢复的文档
    markdown.value = content
    caret.value = { line: 1, col: 1 }
    nextTick(() => onOutlineRefresh?.())
  }

  /** 把一段 Markdown 渲染成 HTML（复制选区为 HTML 用；与预览同一渲染器） */
  function renderMarkdown(md) {
    return render(renderer, md)
  }

  onMounted(() => {
    const view = createEditor(editorEl.value, {
      doc: DEFAULT_DOC,
      // 文档变更的两条分支：预览防抖在本模块内，标脏 / 快照交调用方（onDocChange）
      onDocChange: (doc) => { queuePreview(doc); onDocChange?.() },
      onUpdate: onEditorUpdate,
      onImageFile,
      slashHost: () => slashRef.value,
    })
    editorRef.value = view
    markdown.value = DEFAULT_DOC
    onOutlineRefresh?.()
    // 编辑器此刻才存在：把持久化的缩放档位真正落到 Compartment 上
    onEditorReady?.()

    if (import.meta.env.DEV) {
      window.__inkmark = {
        get editor() { return editorRef.value },
        get markdown() { return markdown.value },
        get previewHtml() { return previewHtml.value },
        get filePath() { return filePath.value },
      }
    }
  })

  onBeforeUnmount(() => {
    cancelPendingPreview()
    editorRef.value?.destroy()
    editorRef.value = null
  })

  return {
    editorEl, slashRef, markdown, filePath, folderPath, title, caret, wordCount, previewHtml,
    queuePreview, flushPreview, cancelPendingPreview, syncAfterDocReplace, renderMarkdown,
  }
}
