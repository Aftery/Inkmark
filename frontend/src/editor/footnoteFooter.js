// 脚注汇总块：源文档里的定义行由 wysiwyg.js 隐藏，这里在**文末**统一渲染一份
// 列表，阅读顺序与 GitHub / markdown-it 预览一致（定义不再打断正文）。
//
// 【为什么是 StateField 而不是 ViewPlugin】CodeMirror 不允许插件提供块级装饰
// （实测直接抛 "Block decorations may not be specified via plugins"），而汇总
// 列表必须是块级才能独占文末。StateField 的代价是每次文档变更都扫一遍全文，
// 换来正确的布局；定义行本身无法搬移（装饰只能挂在原文位置），故原文处留空行
// 是可接受的代价。
import { StateField } from '@codemirror/state'
import { EditorView, Decoration, WidgetType } from '@codemirror/view'
import { isFootnoteDefStart, parseFootnoteDefText } from './inlineExtras.js'

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * 收集全文脚注定义（含缩进续行）。
 *
 * 与 wysiwyg.js 的行级口径一致：续行必须缩进 ≥1 空格，空行 / 顶格行 / 下一条
 * 定义终止。围栏代码块里的 `[^x]:` 是代码，必须跳过（按行跟踪围栏，不依赖语法树
 * —— 本函数在滚到文末时对全文跑一次，语法树只保证视口内有）。
 *
 * @param {import('@codemirror/state').Text} doc
 * @returns {{label:string, content:string, pos:number}[]}
 */
export function collectFootnoteDefs(doc) {
  const out = []
  let fence = ''
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const f = FENCE.exec(line.text)
    if (f) {
      if (!fence) fence = f[1]
      else if (fence[0] === f[1][0]) fence = ''
      continue
    }
    if (fence || !isFootnoteDefStart(line.text)) continue
    const parts = parseFootnoteDefText(line.text)
    if (!parts) continue
    const rest = []
    let last = n
    for (let k = n + 1; k <= doc.lines; k++) {
      const next = doc.line(k)
      if (!next.text.trim() || !/^\s+\S/.test(next.text) || isFootnoteDefStart(next.text)) break
      rest.push(next.text.trim())
      last = k
    }
    out.push({ label: parts.label, content: [parts.rest, ...rest].join(' ').trim(), pos: line.from })
    n = last
  }
  return out
}

/** 文末汇总列表：编号 + 内容；点击条目跳到原文定义行（该行会因活跃而显形）。 */
export class FootnoteFooterWidget extends WidgetType {
  constructor(entries) {
    super()
    this.entries = entries
  }
  eq(other) {
    return this.entries.length === other.entries.length &&
      // pos 也要比：定义行上方的正文被编辑后位置会整体平移，只比文字会让旧
      // DOM 的点击处理器跳到过期的位置。
      this.entries.every((e, i) => e.label === other.entries[i].label &&
        e.content === other.entries[i].content && e.pos === other.entries[i].pos)
  }
  toDOM(view) {
    const box = document.createElement('div')
    box.className = 'cm-md-footnote-footer'
    const list = document.createElement('ol')
    for (const e of this.entries) {
      const li = document.createElement('li')
      const sup = document.createElement('sup')
      sup.className = 'cm-md-footnote-ref'
      sup.textContent = e.label
      const body = document.createElement('span')
      body.textContent = ' ' + e.content
      li.append(sup, body)
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault()
        view.dispatch({ selection: { anchor: e.pos }, scrollIntoView: true })
        view.focus()
      })
      list.appendChild(li)
    }
    box.appendChild(list)
    return box
  }
  // 点击由上面的 mousedown 自行处理（跳回定义），不让 CM 再按坐标落光标
  ignoreEvent() { return true }
}

/** 构建文末汇总装饰（纯函数，便于在 node 里直接打靶）。 */
export function buildFootnoteFooter(doc) {
  // 绝大多数文档没有脚注：一次子串查找就返回，不逐行扫。
  if (!doc.toString().includes('[^')) return Decoration.none
  const entries = collectFootnoteDefs(doc)
  if (!entries.length) return Decoration.none
  return Decoration.set([
    Decoration.widget({
      widget: new FootnoteFooterWidget(entries),
      block: true,
      side: 1,
    }).range(doc.length),
  ])
}

export const footnoteFooterField = StateField.define({
  create(state) { return buildFootnoteFooter(state.doc) },
  update(deco, tr) { return tr.docChanged ? buildFootnoteFooter(tr.state.doc) : deco },
  provide: (f) => EditorView.decorations.from(f),
})
