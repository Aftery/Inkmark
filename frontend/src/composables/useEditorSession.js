// useEditorSession — 编辑器实例 + 会话注册表（多标签页）+ 派生状态
// ----------------------------------------------------------------------------
// 从 App.vue 抽出（行为零变更）。本模块是「编辑器」这一侧的唯一持有者：
//   - 创建 / 销毁 EditorView，并把实例写进调用方给的 editorRef 槽；
//   - 维护会话注册表（每个标签一份 EditorState）与激活会话（activeId）；
//   - 维护全部由**激活会话**派生的状态：markdown、previewHtml、caret、wordCount；
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
//
// 【多标签页的形态（P1）】单 `EditorView` + 按标签切换 `EditorState`
// （架构方案 §0.1 的选型）。理由：`EditorState` 里已经装着一份撤销栈 / 选区 /
// 装饰字段的值，**切换标签 = 换一份 state**，不需要 N 份 view ⟹ 不需要 N 套
// 插件与装饰缓存。全部扩展实例仍只有一份（`extensions`，见 editor/extensions.js）。
//   - **不变式 · activeSession 永不为 null**：初始就建一个未落盘会话（MD-08）。
//     关掉最后一个标签 = 回到这份空文档，不新增空状态组件、不占 App.vue 行数。
//   - **不变式 · filePath 只读**：它是 `activeSession.path` 的派生值，唯一写入
//     入口是 `setActivePath()`。多标签下路径有 5 个触发场景（打开 / 另存为 /
//     重命名 / 切标签 / 关标签），各处直接赋值会让「装饰已按新标签重算、路径
//     还没翻」—— 图片地址指向错目录（QA 文档 R-9/R-10 的同一根因）。
//
// 【图片两条通道的注记（2026-10-28 从 App.vue 搬来）】装配层腾行数（≤150 硬上限）
// 时把下面两条注记从调用点移到了本模块头注 —— 它们解释的是**本模块的参数**，
// 挂在装配层只会让那两行越看越像「这里有玄机」：
//   - onImageFile 是**惰性**的：粘贴 / 拖拽真实发生在 mount 之后，届时 assets
//     已初始化；
//   - onClipboardImage 是通道③：WKWebView 不暴露剪贴板图片，只能问系统剪贴板
//     （见 imageDrop.js）。

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { createEditor, centerCursor, setEditorZoom } from '../editor/createEditor.js'
import { buildExtensions, createEditorState, setFocusMode } from '../editor/extensions.js'
import { createRenderer, render } from '../preview/markdown.js'
import { DEFAULT_DOC } from '../editor/sampleDocs.js'
import { t } from '../i18n/index.js'
import { checkTableHint, clearTableHint } from './useTableHint.js'
import { applyDocPath } from '../editor/assetContext.js'
import { installFileDropGuard } from '../editor/imageDrop.js'

const PREVIEW_DEBOUNCE_MS = 120

// CJK 判定（汉字 / 假名 / 韩文）；西文按 [A-Za-z0-9_'-]+ 计词
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/
const LATIN_WORD_RE = /[A-Za-z0-9_'-]/

/**
 * 统计字数：CJK 逐字计，西文连续字母数字算一个词。
 * 纯函数、无中间字符串分配（旧实现 replace 全文再 match，成本随文档长度线性放大）。
 */
export function countWords(s) {
  let cjk = 0
  let latin = 0
  let inWord = false
  for (const ch of s) {
    if (CJK_RE.test(ch)) {
      cjk++
      inWord = false
    } else if (LATIN_WORD_RE.test(ch)) {
      if (!inWord) {
        latin++
        inWord = true
      }
    } else {
      inWord = false
    }
  }
  return cjk + latin
}

/** 取路径最后一段（同时支持 / 与 Windows 反斜杠；末尾分隔符忽略）。 */
function baseName(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function useEditorSession({
  editorRef,
  onDocChange,
  onImageFile,
  onClipboardImage,
  typewriterOn,
  onOutlineRefresh,
  onEditorReady,
  // 窗口级开关：切标签时要重放到新 state（架构 §5.2 步骤 7）
  zoom,
  focusOn,
  // 大纲度量缓存失效（架构 §5.2 步骤 12；ysCache 是单文档缓存）
  invalidateOutline,
}) {
  const editorEl = ref(null)   // 模板 ref：CM 挂载点
  const slashRef = ref(null)   // 斜杠命令面板（CM 扩展经 host 协议回调它）
  let removeDropGuard = null
  // 扩展清单**只构建一次**：多标签页要造 N 份 EditorState，它们共用这一份实例
  // （撤销栈 / 装饰字段按 state 隔离，见 editor/extensions.js 头注的「不变式」段）。
  // 绝不能每个标签各建一份 —— 那正是 extensions.js 被抽出来的原因。
  // 两个 updateListener 也在这里：setState 换 state 时扩展随 state 走，装在
  // 「初始 state」上的监听器切一次标签就消失（打字不标脏、预览不更新且不报错）。
  const extensions = buildExtensions({
    slashHost: () => slashRef.value,
    onImageFile,
    onClipboardImage,
    onDocChange: (doc) => {
      const s = getActiveSession()
      if (s) s.state = editorRef.value?.state ?? s.state
      queuePreview(doc)
      onDocChange?.()
    },
    onUpdate: onEditorUpdate,
  })

  // ---------- 会话注册表 ----------
  /** @type {import('vue').Ref<Array>} 有序数组 = 标签栏显示顺序 */
  const sessions = ref([])
  /** @type {import('vue').Ref<string>} */
  const activeId = ref('')
  /** @type {import('vue').Ref<Array<string>>} MRU：最近访问的 id 在最前 */
  const mru = ref([])
  // 单调递增、**不复用**："t1" / "t2" …（复用 id 会让已关标签的旧引用复活）
  let idSeq = 0
  const nextSessionId = () => `t${++idSeq}`

  const activeSession = computed(
    () => sessions.value.find((s) => s.id === activeId.value) || null,
  )
  /** 供下游按需取当前会话（不注入 reactive 对象本身，避免它们误写） */
  const getActiveSession = () => activeSession.value

  /** 按路径找会话；找不到返回 null（同路径幂等的判据，见 useFileOps 的 openTab） */
  function findByPath(path) {
    if (!path) return null
    return sessions.value.find((s) => s.path === path) || null
  }

  /**
   * 新建一个会话（不激活）。
   * 内容用 createEditorState 造 —— `extensions` 必须是上面那一份共享实例。
   */
  function createSession({ path = '', content = '' }) {
    const s = {
      id: nextSessionId(),
      path,
      title: path ? baseName(path) : t('common.untitled'),
      state: createEditorState({ doc: content, extensions }),
      scrollTop: 0,
      markdown: content,
      dirty: false,
      saveState: 'saved',
      lastSnapshotAt: Date.now(),
    }
    sessions.value = [...sessions.value, s]
    mru.value = [s.id, ...mru.value]
    // 返回**注册表里的那一个**（ref 的深层响应式代理），不是刚建的字面量：
    // 拿字面量去改字段会绕过 proxy 的 setter，watcher 不触发（filePath / title
    // 不更新，且不报错）。调用方与 findByPath 拿到同一身份才好比较。
    return sessions.value[sessions.value.length - 1]
  }

  /** 移除一个会话（关闭标签用；调用方负责先做 dirty 确认） */
  function removeSession(id) {
    if (!sessions.value.some((s) => s.id === id)) return false
    sessions.value = sessions.value.filter((s) => s.id !== id)
    mru.value = mru.value.filter((x) => x !== id)
    if (activeId.value === id) {
      // 不变式：activeSession 永不为 null（MD-08）。落点取 MRU 的下一个
      // （activate_on_close = history）；一个都不剩时补一份**空文档** ——
      // 与 newFile 同口径（内容是 '' 而不是示例文档），应用保持运行。
      const next = mru.value.length
        ? sessions.value.find((s) => s.id === mru.value[0])
        : null
      activeId.value = next ? next.id : createSession({ path: '', content: '' }).id
    }
    return true
  }

  /**
   * 改激活会话的路径（另存为 / 重命名 / 打开）。**filePath 的唯一写入入口**。
   * 标题同步在这里做：`title` 是 `session.title` 的派生值，路径变了标题必须跟着变。
   */
  function setActivePath(nextPath) {
    const s = getActiveSession()
    if (!s) return
    s.path = nextPath
    s.title = nextPath ? baseName(nextPath) : t('common.untitled')
  }

  // 文档状态机晚绑定：useDocumentState 在装配序里**晚于**本模块创建（它依赖本模块
  // 的 filePath / title）。若把它当惰性 getter 注入，App.vue 就会出现「顶层 const
  // 声明晚于注入」的第三类 TDZ（tdz-order.test.mjs 报红），故用显式绑定。
  let docState = null
  /** 由装配层在 docState 建好后调用一次 */
  function bindDocState(ds) { docState = ds }

  // ---------- 派生状态：全部由「激活会话」算出 ----------
  const filePath = computed(() => activeSession.value?.path ?? '')
  const folderPath = ref('')
  // 标题取自会话（单一真源）。**两种分隔符都要认**：Go 侧返回各平台原生路径，
  // Windows 上是 C:\dir\a.md —— 只按 "/" 切会把整条路径当成文件名显示，
  // 故取尾段统一在 createSession / setActivePath 两处做，这里只读结果。
  const title = computed(() => activeSession.value?.title ?? t('common.untitled'))
  // 正文：激活会话的预览源（由防抖任务或整份替换写入）
  const markdown = computed(() => activeSession.value?.markdown ?? '')
  const caret = ref({ line: 1, col: 1 })

  const renderer = createRenderer()
  // 预览面开 src 改写（/doc-assets/，见 assetUrl.js）；导出面保持磁盘相对路径
  // ——落盘 HTML 与文档同级，浏览器按相对路径加载 assets/ 才是对的
  const previewHtml = computed(() => render(renderer, markdown.value, { resolveAssets: true }))
  // 导出面公式走 MathML 形态：导出产物里没有 KaTeX 的 Web 字体，用 html 形态会
  // 变成「字体缺失、符号错位」的公式（不报错、只是难看）。见 markdown/math.js 头注。
  const exportHtml = computed(() => render(renderer, markdown.value, { mathOutput: 'mathml' }))

  // 文档路径 → 三处消费：前端改写开关（assetUrl）+ Go 侧镜像（/doc-assets/ 读盘根，
  // docassets.go）+ 图片装饰刷新信号（assetContext.js）。三件事必须一起做，
  // 故统一走 applyDocPath 这个唯一同步点 —— 路径变化不产生事务，少一次通知就会
  // 让已渲染的图片一直复用旧 DOM（破损态定格，见 assetContext.js 文件头）。
  // flush:'sync' 在赋值同一行生效，不与随后的 setState / 装饰构建竞速。
  // 【切标签的顺序依赖】activateSession 必须**先 setState 再切 activeId**：
  // 本 watcher 会 dispatch 一笔事务去重建图片装饰，那笔事务得作用在**新** state 上。
  watch(
    filePath,
    (p) => {
      applyDocPath(p, editorRef.value)
    },
    { flush: 'sync' }
  )

  // 字数：CJK 按字计，西文按词计。
  // 两个正则提到模块级：computed 每次重算都新建正则 + replace 重建整份字符串，
  // 大文档下每键一次全量拷贝。改为单次遍历计数，零中间字符串。
  const wordCount = computed(() => countWords(markdown.value))

  // ---------- 预览渲染防抖 ----------
  let previewTimer = null
  let pendingDoc = null

  function applyPreview(doc) {
    // 写到**当时激活的会话**上：切标签时 cancelPendingPreview 已丢弃本笔，
    // 故不会出现「旧标签的内容落到新标签的 markdown」（架构 §5.2 步骤 3）。
    const s = getActiveSession()
    if (s) s.markdown = doc
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

  /** 丢弃待渲染内容（切换文件 / 切换标签等破坏性边界前，防止旧内容稍后覆盖新文档） */
  function cancelPendingPreview() {
    clearTimeout(previewTimer)
    previewTimer = null
    pendingDoc = null
  }

  // ---------- 编辑器 ----------

  // IME 合成守卫的挂起槽（架构 §5.2 步骤 0）。上限 1：后来的覆盖先来的，
  // 否则一串快速点击会产生一串延迟切换、顺序错乱。
  let pendingSwitch = null

  function onEditorUpdate(u) {
    // 事务回写（不可省）：EditorState 不可变，view.state 每次事务都是新对象。
    // 注册表若留着旧引用，切回标签时 setState(旧 state) 会让用户看到**旧内容**
    // （静默回退）。selectionSet 不触发 onDocChange，故必须在这里回写。
    const cur = getActiveSession()
    if (cur) cur.state = u.state

    const pos = u.state.selection.main.head
    const line = u.state.doc.lineAt(pos)
    caret.value = { line: line.number, col: pos - line.from + 1 }
    // 「表格没渲染」提示：每次更新都查一遍（纯读语法树，开销可忽略），
    // 命中与否由 useTableHint 内部逐字段比较后决定是否触发重渲染。
    checkTableHint(u.state)
    // 打字机模式：输入后把光标行滚到视口中部（rAF 避开 update 事务内再 dispatch）。
    // 回调里必须重新读 editorRef：rAF 排到下一帧，期间可能已经销毁 / 换文档，
    // 捕获的旧 view 会被 centerCursor 访问到已释放的 DOM。
    if (typewriterOn?.value && u.docChanged) {
      requestAnimationFrame(() => centerCursor(editorRef.value))
    }
    // IME 合成刚结束（composing 由 true 变 false）且有待切换的标签 → 现在执行。
    // 必须延到当前 update 之后：事务进行中 setState 会触发嵌套 update（CM6 会抛）。
    // 这一条同时是本守卫的兜底 —— 「合成迟迟不结束」时，下一次任何事务都会走这里。
    if (pendingSwitch && !u.view.composing) {
      const target = pendingSwitch
      pendingSwitch = null
      setTimeout(() => { void runActivation(u.view, target) }, 0)
    }
  }

  /**
   * 整份替换文档后的派生状态同步。
   * replaceDocument 走 setState 绕开 CM6 tile 增量崩溃（见 createEditor.js），
   * 而 setState 不是事务更新、不会触发 updateListener，故此处手工补齐派生状态。
   * 【注意】这里不标脏：打开文件时内存 == 磁盘，标脏由调用方按场景决定
   * （恢复快照要标，打开文件不标 —— 见 useDocumentState.restoreSnapshot）。
   * 【必须回写 session.state】整份替换后 view.state 是新对象；不回写的话切走再
   * 切回会把**替换前**的旧内容装回编辑器 —— 打开文件后切个标签就静默丢内容。
   */
  function syncAfterDocReplace(content) {
    cancelPendingPreview() // 丢弃输入期待渲染内容，防止稍后覆盖刚打开/恢复的文档
    const s = getActiveSession()
    if (s) {
      s.markdown = content
      if (editorRef.value) s.state = editorRef.value.state
    }
    caret.value = { line: 1, col: 1 }
    // 整份替换不触发 updateListener（见上），故手工重算表格提示，
    // 否则上一份文档的提示会残留到新文档
    if (editorRef.value) checkTableHint(editorRef.value.state)
    nextTick(() => onOutlineRefresh?.())
  }

  // ---------- 切换标签（架构 §5.2 的 15 步，顺序即契约）----------

  /**
   * 激活某个会话。步骤编号与架构方案 §5.2 一一对应，**不得调换**。
   *
   * 这里只做「要不要守卫 / 挂起」的前置判定，真正的时序在 runActivation ——
   * 拆开是因为 IME 挂起的请求要在合成结束后走同一条时序，不该复制一份。
   */
  async function activateSession(target) {
    const view = editorRef.value
    if (!view || !target) return
    // 步骤 0 · IME 合成守卫（P0）：合成中的预编辑文本只在 DOM 里，setState 重建
    // docView 会让「未上屏的那几个字」直接消失。zh-CN / ja-JP 是已发布的两个
    // locale，IME 是它们的主输入路径 ⟹ 这是主路径上的数据丢失类缺陷。
    // 判定用公开的 view.composing，不用 DOM 事件（WKWebView 上时序不可靠）。
    if (view.composing) {
      pendingSwitch = target
      return
    }
    // 步骤 1 · 重复激活直接返回（会白重建整棵 docView）
    if (target.id === activeId.value) return
    await runActivation(view, target)
  }

  async function runActivation(view, target) {
    // 步骤 2 · 捕获当前标签：state / 滚动位置 / 脏标记，脏则留底快照
    const cur = getActiveSession()
    if (cur) {
      cur.state = view.state
      cur.scrollTop = view.scrollDOM.scrollTop
      // P1：dirty 仍是全局单值 —— 切走时捕获进会话，切入时交回（P2 改 per-session）
      if (docState) cur.dirty = docState.dirty.value
      // switchFile = 「脏则强行写一份快照留底」+「复位会话（清自动保存防抖、
      // 保存态归零）」。与打开另一个文件的边界同口径：旧稿此刻还在内存里，
      // 错过这一刻就永远写不回去了。同时清掉定时器 —— 否则 800ms 后那笔自动
      // 保存会拿**新标签**的内容去写（跨标签串写，P2 才彻底解决）。
      await docState?.switchFile?.()
    }
    // 步骤 3 · 丢弃待渲染预览（旧文档的防抖预览会覆盖新标签的 markdown）
    cancelPendingPreview()
    // 步骤 4 · 清表格提示（tableHint 是模块级单例，不清会残留上一个文档的提示）
    clearTableHint()
    // 步骤 5 · 装入新 state —— **必须先于步骤 6**
    view.setState(target.state)
    // 步骤 6 · 切 activeId → 触发 watch(filePath) → applyDocPath（三件事同步完成）
    activeId.value = target.id
    // 步骤 7 · 重放窗口级开关：zoomCompartment / focusField 的值随 state 走，
    // 不重放就会「复活」上一个标签的档位
    setEditorZoom(view, (zoom?.value ?? 100) / 100)
    view.dispatch({ effects: setFocusMode.of(Boolean(focusOn?.value)) })
    // 步骤 8 · 回写 state（步骤 7 的 dispatch 产生了新 state）
    target.state = view.state
    // 步骤 9 · 恢复滚动：setState 重建 docView 后几何要下一帧才准
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = target.scrollTop
    })
    // 步骤 10 · 同步预览源（切标签是一次性边界，不走防抖）
    target.markdown = target.state.doc.toString()
    // 步骤 11 · 重算表格提示（setState 不触发 updateListener，必须手工补算）
    checkTableHint(view.state)
    // 步骤 12 · 重算大纲 + 失效度量缓存（ysCache 是单文档缓存）
    onOutlineRefresh?.()
    invalidateOutline?.()
    // 步骤 13 · 重算行列（行列是显示值，不是 state）
    const pos = target.state.selection.main.head
    const line = target.state.doc.lineAt(pos)
    caret.value = { line: line.number, col: pos - line.from + 1 }
    // 步骤 14 · 推 MRU（Tab Switcher 与「关闭后落点」都用它）
    mru.value = [target.id, ...mru.value.filter((id) => id !== target.id)]
    // 步骤 15 · 聚焦（切完标签应能直接打字）
    view.focus()
    // dirty 交回：进入的会话自己记着脏不脏，状态栏据此显示（P2 改 per-session）
    if (docState) {
      docState.dirty.value = target.dirty
      docState.saveState.value = target.dirty ? 'unsaved' : 'saved'
    }
  }

  /**
   * 把一段 Markdown 渲染成 HTML（「复制选区为 HTML」用；与预览同一渲染器）。
   *
   * 【为什么走 mathml 形态】复制出去的内容会粘到别的应用（邮件 / 笔记 / 文档），
   * 那里既没有 KaTeX 的 CSS 也没有它的 Web 字体 —— html 形态的公式会变成一堆
   * 错位的 span。MathML 由接收方系统字体渲染，粘过去至少是「能读的公式」。
   * 这与导出 HTML/PDF 的取舍同源（见 markdown/math.js 头注）。
   */
  function renderMarkdown(md) {
    return render(renderer, md, { mathOutput: 'mathml' })
  }

  // MD-08：activeSession 永不为 null —— 初始就建一个未落盘会话。
  // 【与架构方案的偏差，如实登记】内容用 DEFAULT_DOC 而非空串：现状启动即
  // 示例文档（首屏不是白板），改成 '' 是**行为变化**，不在 P1「骨架」范围内。
  const initialSession = createSession({ path: '', content: DEFAULT_DOC })
  activeId.value = initialSession.id

  onMounted(() => {
    const view = createEditor(editorEl.value, {
      // 直接装上初始会话的内容：视图与注册表从第一帧起就指向同一份文档，
      // 不需要「先装默认 doc、再切一次」的多余事务。
      doc: initialSession.state.doc.toString(),
      // 共享的那一份扩展清单（见上方 extensions 的构建点）
      extensions,
    })
    editorRef.value = view
    // 注册表与视图必须是**同一个 state 对象**（EditorState 不可变，两份就等于
    // 两份撤销栈）。createEditor 内部另建了一份 state，故这里对齐一次。
    initialSession.state = view.state
    // 应用级拖拽兜底：文件落在编辑器外时不让 webview 导航到 file://（见 imageDrop.js）
    removeDropGuard = installFileDropGuard(() => editorRef.value, onImageFile)
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
    clearTableHint()
    removeDropGuard?.()
    removeDropGuard = null
    editorRef.value?.destroy()
    editorRef.value = null
  })

  return {
    // 编辑器与派生状态
    editorEl, slashRef, markdown, filePath, folderPath, title, caret, wordCount, previewHtml, exportHtml,
    // 会话注册表
    sessions, activeId, mru, activeSession, getActiveSession, findByPath,
    createSession, activateSession, removeSession, setActivePath, bindDocState,
    // 预览 / 文档替换
    queuePreview, flushPreview, cancelPendingPreview, syncAfterDocReplace, renderMarkdown,
  }
}
