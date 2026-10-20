// codeBlock.js — 围栏代码块的交互与显示增强（行号 + 一键复制）
// ----------------------------------------------------------------------------
// 【三项能力的分工】
//   1. 语法高亮 —— 编辑器侧靠 CodeMirror 的 markdown 语言解析 + mdHighlight 配色
//      （见 editor/markdownHighlight.js 与 createEditor.js 的 mdHighlight），
//      预览/导出侧靠 highlight.js（preview/markdown.js）。两边共用 --hl-* 色板。
//      本文件不负责高亮，只负责下面两项。
//   2. 行号 —— 代码块内左侧显示 1..N 的连续编号。
//   3. 一键复制 —— 悬停代码块时右上角出现复制按钮，复制**纯代码内容**（不含围栏）。
//
// 【为什么行号只给代码块、不给全文档】本应用是写作工具，正文行号是编辑器调试
// 特性的味道，会干扰阅读。代码块才是「需要按行定位」的地方（报错栈、示例代码）。
//
// 【为什么用 StateField 行内装饰，而不是 gutter】CM6 的 gutters 是**整篇文档**
// 一条侧栏，无法只对某几行生效；而代码块需要「行号贴着每行左缘」的效果。
// 故用 line 装饰（加类名 + 伪元素塞编号）——只改视觉、零文档改动。
//
// 【为什么编号用 CSS counter 而不是把数字塞进 DOM】行号是纯视觉信息，塞进
// contenteditable 的文档流会被复制/编辑带出去。CSS counter 天然只存在于渲染层，
// 也不会被 onDocChange 看到。

import { Decoration, WidgetType, ViewPlugin } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { t } from '../i18n/index.js'

/** 代码块行的类名（行号由 CSS counter 渲染，见 editor-wysiwyg.css） */
export const CODE_LINE_CLASS = 'cm-md-codeline'

/**
 * 计算代码块的行号装饰。
 *
 * 对每个 FencedCode 节点：跳过开围栏行（```lang）与闭围栏行（```），
 * 中间的内容行依次标记为 code-line，用 CSS counter 递增编号。
 * 空代码块（``` 紧跟 ```）没有内容行，自然不产生任何装饰。
 *
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} from 可见区间起点
 * @param {number} to 可见区间终点
 * @returns {{decorations: DecorationSet, lineCount: Map<number, number>}}
 */
export function codeLineDecorations(state, from, to) {
  const { doc } = state
  const ranges = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      // 正文由 CodeText 子节点给出（见 codeBlockContent 的结构说明）。
      // 没有 CodeText = 空代码块（``` 紧跟 ```），不产生行号。
      let bodyStart = -1
      let bodyEnd = -1
      node.node.cursor().iterate((child) => {
        if (child.name === 'CodeText' && bodyStart < 0) {
          bodyStart = child.from
          bodyEnd = child.to
        }
        return true
      })
      if (bodyStart < 0) return

      const firstLine = doc.lineAt(bodyStart).number
      const lastLine = doc.lineAt(Math.min(bodyEnd, doc.length)).number
      // 行号从 1 开始（代码块内相对序号），写进 data-line 供 CSS attr() 取用。
      // 为什么不在 CSS 用 counter：counter 无法在「每个代码块」处重置（CM 的行
      // 装饰不提供块级容器），跨块的编号会一路累加。写进属性是唯一可靠做法，
      // 而属性在 ::before 的 content 中被渲染，仍是不进入文档文本的视觉信息。
      let no = 1
      for (let n = firstLine; n <= lastLine; n++) {
        const line = doc.line(n)
        if (line.from > bodyEnd) break
        ranges.push({ pos: line.from, no })
        no++
      }
    },
  })
  // 行装饰必须按位置升序添加（RangeSetBuilder 亦要求有序）；不同代码块的
  // 区间可能交错（同一视口内多个块），故统一排序后再构建。
  ranges.sort((a, b) => a.pos - b.pos)
  return Decoration.set(
    ranges.map((r) =>
      Decoration.line({
        class: CODE_LINE_CLASS,
        attributes: { 'data-line': String(r.no) },
      }).range(r.pos),
    ),
    true,
  )
}

/**
 * 行号装饰层。
 *
 * 【为什么是 ViewPlugin 而不是 StateField】行号只依赖文档结构与可见区间，
 * 不参与「表格/checkbox」那类需要跨模块读取的状态；ViewPlugin 提供 decoration
 * 对**行装饰**是合法的（只有 block 装饰被禁止）。这样它也不会进入事务 update
 * 的热路径。
 *
 * 【为什么只在 visibleRanges 内算】AC-05：大文档下全量扫描会卡。代码块行号
 * 完全没必要管视口外的内容 —— 滚动进来时会因 viewportChanged 重算。
 */
export const codeLinePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view)
    }
    update(u) {
      // IME 合成期间冻结重算（同 wysiwyg.js 的 AC-04）：中文输入时行号跳动会干扰
      if (u.view.composing) return
      if (u.docChanged || u.viewportChanged) {
        this.decorations = this.build(u.view)
      }
    }
    build(view) {
      const ranges = view.visibleRanges
      if (!ranges.length) return Decoration.none
      // visibleRanges 通常只有 1~2 段；合并成一个区间再扫，避免重复 iterate
      return codeLineDecorations(view.state, ranges[0].from, ranges[ranges.length - 1].to)
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------------- 一键复制 ----------------

/**
 * 复制按钮 widget。
 *
 * 【为什么挂在代码块首行的行尾、而不是用绝对定位浮层】widget 随文档结构走：
 * 代码块被删除/移动时按钮自动跟着走，省掉「浮层位置与实际代码块脱节」的
 * 一类缺陷。样式上用 position:absolute 相对所在行定位到右上角。
 *
 * 【为什么 copy 失败要有反馈】navigator.clipboard 在非安全上下文 / 权限被拒时
 * 会 reject。静默吞掉就是「点了没反应」（本仓最恨的形态），故把按钮文案
 * 临时切到失败态。
 */
class CopyButtonWidget extends WidgetType {
  constructor(code) {
    super()
    this.code = code
  }

  // 内容变了才算不同（否则每次重算都重建 DOM，闪烁）
  eq(other) {
    return other.code === this.code
  }

  // 必须由 widget 自己处理点击：返回 true = 不让 CM 把它当普通编辑器点击
  ignoreEvent() { return true }

  toDOM() {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-md-copy'
    btn.setAttribute('aria-label', t('code.copy'))
    btn.title = t('code.copy')
    // 不用 emoji / 图标字体：本仓 P0 规则要求图标一律走 SVG（AppIcon）
    btn.textContent = t('code.copyLabel')
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      const ok = await copyText(this.code)
      btn.textContent = ok ? t('code.copied') : t('code.copyFailed')
      btn.classList.toggle('is-done', ok)
      btn.classList.toggle('is-failed', !ok)
      // 复位：按钮是常驻的，成功提示停留 1.2s 足够被看到
      setTimeout(() => {
        if (!btn.isConnected) return
        btn.textContent = t('code.copyLabel')
        btn.classList.remove('is-done', 'is-failed')
      }, 1200)
    })
    return btn
  }
}

/**
 * 写入系统剪贴板。
 *
 * 优先 navigator.clipboard（异步 API，需要安全上下文）；WKWebView 的
 * wails:// 页面通常满足条件。失败时退回 execCommand('copy') —— 它在
 * contenteditable 场景仍被 WebKit 支持，是唯一可用的兜底。
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 落到 execCommand 兜底 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // 必须留在文档里且不被看到：display:none 的元素无法被选中复制
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * 复制按钮的装饰层：每个代码块首行行尾挂一个按钮。
 *
 * 【为什么是 ViewPlugin 而不是 StateField】StateField 的 update 拿不到
 * `visibleRanges`，只能全文档遍历 —— 大文档下每敲一个字都遍历整棵树，
 * 正是 AC-05 明确要避免的。按钮只在视口内可见才有意义，故用 ViewPlugin +
 * 只在 `visibleRanges` 内扫描；viewportChanged 时重算。
 *
 * 【按钮内容会不会过期】会：用户编辑代码后按钮的 code 快照需要更新。
 * 故 docChanged 时也重建 —— 但重建范围仍限定在可见区间，成本与视口成正比。
 */
export const codeCopyPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view)
    }
    update(u) {
      if (u.view.composing) return // IME 合成期间冻结（同 wysiwyg.js 的 AC-04）
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = this.build(u.view)
      }
    }
    build(view) {
      const ranges = view.visibleRanges
      if (!ranges.length) return Decoration.none
      return buildCopyDeco(view.state, ranges[0].from, ranges[ranges.length - 1].to)
    }
  },
  { decorations: (v) => v.decorations },
)

function buildCopyDeco(state, from, to) {
  const ranges = []
  // 光标当前所在的代码块（可能为 null）。
  // 【规则】光标在某个代码块内 → **只**给那一块显示按钮（就近操作，避免整篇
  // 文档到处是按钮）；光标不在任何块内 → 给所有可见块显示（保持可发现性：
  // 用户可能只是扫读全文想复制某一段，光标位置不该成为障碍）。
  // 【为什么不只靠 hover】hover 才显示的按钮在触屏 / 无鼠标环境下永远不可达。
  const focused = fencedCodeAt(state, state.selection.main.head)
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      // 光标在别的块里 → 这一块不显示按钮
      if (!focused || focused.from === node.from) {
        const code = codeBlockContent(state.doc, node.node)
        // 挂在开围栏行的行尾（不可分割位置）：行装饰与图片 widget 都靠这个位置
        const openLine = state.doc.lineAt(node.from)
        ranges.push(Decoration.widget({
          widget: new CopyButtonWidget(code),
          side: 1,
        }).range(openLine.to))
      }
    },
  })
  return Decoration.set(ranges, true)
}

/**
 * 从文档里取出某代码块的**纯内容**（不含开闭围栏），供复制使用。
 *
 * 【为什么取 CodeText 而不是「两个 CodeMark 之间」】Lezer 的 FencedCode 结构是
 *   FencedCode > CodeMark(```) + CodeInfo(lang) + CodeText(正文) + CodeMark(```)
 * CodeText 的区间**恰好**就是正文（不含前后换行），直接切片即可；用
 * 「首个 CodeMark 之后到第二个 CodeMark 之前」再手工 trim 换行，会在
 * 空块 / 未闭合块 / CRLF 等形态上出错（实测过：多切或少切一个换行）。
 *
 * 【未闭合围栏】此时没有第二个 CodeMark，CodeText 仍到文档末尾，直接可用。
 * 【空块】没有 CodeText 子节点 → 返回空串。
 */
export function codeBlockContent(doc, node) {
  let text = null
  node.cursor().iterate((child) => {
    if (child.name === 'CodeText') {
      // 理论上只有一个 CodeText；取第一个即可
      if (text === null) text = doc.sliceString(child.from, child.to)
    }
    return true
  })
  return text ?? ''
}

/**
 * 定位光标所在的 FencedCode 节点（用于复制按钮判断「当前在哪一块里」）。
 * 找不到返回 null。
 */
export function fencedCodeAt(state, pos) {
  let node = syntaxTree(state).resolveInner(Math.max(0, Math.min(pos, state.doc.length)), 1)
  while (node) {
    if (node.name === 'FencedCode') return node
    node = node.parent
  }
  return null
}
