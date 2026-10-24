/**
 * image-asset-context.test.mjs — 图片装饰必须随文档路径重建（2026-10-23 真机回归）
 * ===========================================================================
 * 【缺陷本体：全程不报错，只有「图片位置一个虚线框，里面写着 assets/…」】
 *
 * 文档里的 `![说明](assets/x.png)` 在编辑器里渲染成 <img>，其 src 必须经
 * assetUrl.resolveAssetSrc 改写成 /doc-assets/…（webview 的页面 origin 是应用
 * 自身的资源服务，未改写的相对路径会落到构建产物目录 → 404 → 碎图）。
 * 而这条改写依赖一个**模块级开关**（assetUrl 的 hasDocDir，随文档路径翻转），
 * widget 又是**构造期快照**。于是有两条独立的坑：
 *
 *   ① 判定坑 —— eq() 只比 src/alt 时，文档落盘（开关打开）后 widget 判「没变」
 *      ⇒ CM 复用旧 DOM ⇒ 上一次解析出的未改写地址（404）被永久定格。
 *   ② 触发坑 —— 就算 eq() 参与比较，**路径变化本身不产生任何 CodeMirror
 *      事务**（首次保存 / 另存为 / 重命名只是给 filePath 赋值），插件 update()
 *      不被调用 ⇒ 装饰不重算 ⇒ 旧 widget 一直在场，①②叠加才是真机现象。
 *
 * 故本文件的断言分三段：判定（eq）、触发（版本号判据）、产物（装饰集真的换了
 * widget，且新地址真的进了 DOM）。第三段用 RangeSet.compare 判「CM 会不会重建
 * DOM」—— 那是 CM 自己的比较器，不是我们复述的实现。
 *
 * 【为什么不用「目视」代替】整个链路没有一处会抛错、会打日志、会让测试变红：
 * 编辑器照常打开、Markdown 照常写、只有图片是碎的。本仓已记录过 8 次
 * 「匹配注释里的代码」与多次「静默失败」，故一律打真实模块而不是源码正则。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, RangeSet, ChangeSet } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  buildDecorations, buildImageDOM, shouldRebuildDecorations, wysiwygField,
} from '../src/editor/wysiwyg.js'
import { setDocPath } from '../src/editor/assetUrl.js'
import { applyDocPath, assetVersion, docAssetsChanged } from '../src/editor/assetContext.js'

const DOC = 'intro\n\n![说明](assets/x.png)\n'
const SAVED = '/Users/aftery/Desktop/笔记.md'

/** 造一个只有本组关心的扩展的 EditorState（不装插件，直接驱动纯函数） */
function mkState() {
  return EditorState.create({
    doc: DOC,
    selection: { anchor: 0 }, // 光标停在首行：图片所在行非活跃 ⇒ 会被替换
    extensions: [markdown({ base: markdownLanguage }), wysiwygField],
  })
}

/** 取出装饰集里所有图片 widget（按出现顺序）；len 默认本文档长度 */
function imageWidgets(deco, len = DOC.length) {
  const out = []
  deco.between(0, len, (from, to, val) => {
    if (val.widget && val.widget.constructor.name === 'ImageWidget') out.push(val.widget)
  })
  return out
}

/** CM 的 DOM 复用判据：RangeSet.compare 报出的变更区间为空 ⇒ 不重建 DOM */
function decoDiff(prev, next) {
  const changes = []
  RangeSet.compare([prev], [next], ChangeSet.empty(DOC.length), {
    compareRange: (from, to) => changes.push(['range', from, to]),
    comparePoint: (from, to) => changes.push(['point', from, to]),
    boundChange: (pos) => changes.push(['bound', pos]),
  })
  return changes
}

/** 可记录调用的 EditorView 桩（只要 dispatch 就够 —— 本模块只用这一个方法） */
function fakeView() {
  const dispatched = []
  return {
    dispatched,
    dispatch(tr) { dispatched.push(tr) },
  }
}

// ===========================================================================
// 0) 判据自检：先证明本组的「DOM 复用」探测器能分出好坏了，否则后面全是假绿
// ===========================================================================
describe('探测手段自检 · widget 变了 CM 必须报 diff', () => {
  test('同一份装饰集：diff 为空（说明比较器判「可复用」）', () => {
    setDocPath(SAVED)
    const state = mkState()
    const deco = buildDecorations(state, [{ from: 0, to: DOC.length }]).deco
    assert.deepEqual(decoDiff(deco, deco), [], '同一装饰集被判成有差异，探测器口径不对')
  })

  test('两个内容不同的 widget：diff 非空（说明比较器看得见 widget 的差异）', () => {
    // 手工造两份只差 src 的装饰集 —— 若这一步为空，eq() 里加多少键都不会重建
    const one = buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco
    setDocPath('')
    const noDir = buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco
    setDocPath(SAVED)
    assert.notDeepEqual(
      decoDiff(one, noDir), [],
      '改写口径不同但 diff 为空 —— eq() 没参与比较，CM 会一直复用旧 DOM',
    )
  })
})

// ===========================================================================
// 1) 判定坑：eq() 必须让「改写口径」参与比较
// ===========================================================================
describe('ImageWidget.eq · 改写口径参与复用判定', () => {
  test('同一 src/alt，不同的解析地址 → eq 失配（否则破损态永久定格）', () => {
    setDocPath('') // 未落盘：resolveAssetSrc 原样返回
    const before = imageWidgets(buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco)[0]
    setDocPath(SAVED) // 落盘后：/doc-assets/ 改写生效
    const after = imageWidgets(buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco)[0]

    assert.ok(before && after, '没取到图片 widget（判据失效）')
    assert.equal(before.src, after.src, '两边的原始 src 应相同（同一个 Markdown 节点）')
    assert.equal(before.resolvedSrc, 'assets/x.png', '未落盘时不应改写')
    assert.equal(after.resolvedSrc, '/doc-assets/assets/x.png', '落盘后必须改写')
    assert.equal(before.eq(after), false, 'eq 未把 resolvedSrc 纳入比较 —— 旧 DOM 会被复用')
    assert.equal(after.eq(before), false, 'eq 必须双向对称')
  })

  test('同一口径下 src/alt/resolved 全同 → eq 命中（不许无脑重建，视口滚动会卡）', () => {
    setDocPath(SAVED)
    const a = imageWidgets(buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco)[0]
    const b = imageWidgets(buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco)[0]
    assert.equal(a.eq(b), true, '口径没变却判失配 —— 每次重算都要整块重建 DOM')
  })

  test('alt 变化仍然参与比较（原有契约不能丢）', () => {
    setDocPath(SAVED)
    // 首行放光标：图片所在行非活跃才会被替换成 widget（活跃行显形，§3.2）
    const mk = (alt) => EditorState.create({
      doc: `引言\n\n![${alt}](assets/x.png)\n`,
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), wysiwygField],
    })
    const sa = mk('说明')
    const sb = mk('别的')
    const a = imageWidgets(buildDecorations(sa, [{ from: 0, to: sa.doc.length }]).deco, sa.doc.length)[0]
    const b = imageWidgets(buildDecorations(sb, [{ from: 0, to: sb.doc.length }]).deco, sb.doc.length)[0]
    assert.ok(a && b, '没取到图片 widget（判据失效）')
    assert.equal(a.src, b.src, 'src 应相同')
    assert.equal(a.eq(b), false, 'alt 不同却判相等')
  })
})

// ===========================================================================
// 2) 触发坑：路径变化必须能叫醒插件（版本号 + 空事务）
// ===========================================================================
describe('applyDocPath · 唯一同步点的三件事', () => {
  test('路径真的变了才自增版本，且派发一笔纯 effects 事务', () => {
    setDocPath('')
    const view = fakeView()
    const v0 = assetVersion()

    assert.equal(applyDocPath(SAVED, view), true, '路径变化应返回 true')
    assert.equal(assetVersion(), v0 + 1, '版本号没自增 —— 插件无从判断装饰过期')
    assert.equal(view.dispatched.length, 1, '没有派发事务 —— 插件 update() 永远不会被调用')
    // 桩收到的是 dispatch 的 spec：只有 effects，没有 changes ——
    // 本模块**只产信号，永不改文档**（wysiwyg.js 头注约束 5）
    const spec = view.dispatched[0]
    assert.equal(spec.changes, undefined, '不许通过这笔事务改动文档')
    assert.ok(spec.effects, '事务必须带 effects，否则 CM 不会重算装饰依赖')
  })

  test('重复同步同一路径：不自增、不派发（避免每次赋值都重建全部图片）', () => {
    applyDocPath(SAVED, fakeView())
    const v = assetVersion()
    const view = fakeView()
    assert.equal(applyDocPath(SAVED, view), false, '同一路径应返回 false')
    assert.equal(assetVersion(), v, '同一路径却自增了版本号')
    assert.equal(view.dispatched.length, 0, '同一路径却派发了事务')
  })

  test('未挂载（view 为 null）时不派发，但版本号照常自增', () => {
    setDocPath('')
    const v = assetVersion()
    assert.equal(applyDocPath('', null), false, '空路径且原本为空：没变化')
    assert.equal(assetVersion(), v)
    assert.equal(applyDocPath(SAVED, null), true)
    assert.equal(assetVersion(), v + 1)
  })

  test('派发的效果就是 docAssetsChanged（不是随手一个空 spec）', () => {
    setDocPath('')
    const view = fakeView()
    applyDocPath('/tmp/a.md', view)
    const spec = view.dispatched[0]
    const effects = spec.effects ? [spec.effects] : []
    assert.ok(
      effects.some((e) => e.is?.(docAssetsChanged)),
      '派发的事务里没有 docAssetsChanged —— 将来加过滤/调试钩子会认不出这笔事务',
    )
  })
})

describe('shouldRebuildDecorations · 判据必须覆盖「没有任何 CM 信号」的那一类更新', () => {
  const state = mkState()
  const noop = (extra = {}) => ({
    docChanged: false, selectionSet: false, viewportChanged: false,
    startState: state, state, ...extra,
  })

  test('口径版本变了 → 即使其余判据全 false 也必须重建（本缺陷的正解）', () => {
    setDocPath('')
    const prev = assetVersion()
    applyDocPath(SAVED, null) // 无 view：只翻版本，模拟「路径已变但事务尚未到」
    assert.equal(
      shouldRebuildDecorations(noop(), prev), true,
      '版本号变了却不重建 —— 图片会停在旧地址（缺陷本体）',
    )
  })

  test('口径没变且无任何更新信号 → 不重建（滚动 / 每次 update 都重建会卡）', () => {
    const prev = assetVersion()
    assert.equal(shouldRebuildDecorations(noop(), prev), false)
  })

  test('原有三条判据不得被这次改动挤掉（回归）', () => {
    const prev = assetVersion()
    assert.equal(shouldRebuildDecorations(noop({ docChanged: true }), prev), true, 'docChanged 失效')
    assert.equal(shouldRebuildDecorations(noop({ selectionSet: true }), prev), true, 'selectionSet 失效')
    assert.equal(shouldRebuildDecorations(noop({ viewportChanged: true }), prev), true, 'viewportChanged 失效')
  })
})

// ===========================================================================
// 3) 产物：装饰集换成新 widget，新地址真的进了 DOM
// ===========================================================================
describe('端到端语义 · 落盘前后同一份文档产出不同的图片地址', () => {
  /** 记录型 DOM 桩：只实现 buildImageDOM 用到的那几项 */
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase()
      this.children = []
      this.className = ''
      this.attrs = {}
      this.listeners = {}
      this.src = ''
      this.alt = ''
      this.loading = ''
      this.parent = null
      this.classList = {
        add: (c) => { this.className = `${this.className} ${c}`.trim() },
        contains: (c) => this.className.split(/\s+/).includes(c),
      }
    }
    setAttribute(k, v) { this.attrs[k] = v }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn) }
    appendChild(c) { this.children.push(c); c.parent = this; return c }
    remove() {
      if (!this.parent) return
      const i = this.parent.children.indexOf(this)
      if (i >= 0) this.parent.children.splice(i, 1)
      this.parent = null
    }
    /** 触发某个已注册事件的回调（模拟 <img> 加载失败） */
    fire(type) { for (const fn of this.listeners[type] ?? []) fn() }
  }

  function withDocumentStub(fn) {
    const prev = globalThis.document
    globalThis.document = { createElement: (tag) => new El(tag) }
    try { return fn() } finally { globalThis.document = prev }
  }

  test('落盘前：img.src 是未改写的相对路径；落盘后：是 /doc-assets/ 地址', () => {
    withDocumentStub(() => {
      setDocPath('')
      const [before] = imageWidgets(buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco)
      const beforeDom = before.toDOM()
      assert.equal(beforeDom.children[0].src, 'assets/x.png')

      setDocPath(SAVED)
      const [after] = imageWidgets(buildDecorations(mkState(), [{ from: 0, to: DOC.length }]).deco)
      const afterDom = after.toDOM()
      assert.equal(afterDom.children[0].src, '/doc-assets/assets/x.png')
    })
  })

  test('加载失败：摘掉 <img>，占位文案用**原始** src（不是 /doc-assets/ 改写值）', () => {
    withDocumentStub(() => {
      setDocPath(SAVED)
      const wrap = buildImageDOM('assets/x.png', '/doc-assets/assets/x.png', '')
      const img = wrap.children[0]
      img.fire('error')
      assert.ok(wrap.classList.contains('is-broken'), '加载失败必须打上 is-broken（CSS 虚线框的钩子）')
      assert.equal(wrap.children.length, 1, '碎图 <img> 必须被摘掉')
      const tip = wrap.children[0]
      assert.equal(tip.className, 'cm-md-img-tip')
      assert.equal(
        tip.textContent, 'assets/x.png',
        '占位文案必须是 Markdown 里的原始路径（给读 Markdown 的人看），不能是内部 URL',
      )
    })
  })

  test('有 alt 时占位文案优先用 alt（与旧行为一致）', () => {
    withDocumentStub(() => {
      const wrap = buildImageDOM('assets/x.png', '/doc-assets/assets/x.png', '说明')
      wrap.children[0].fire('error')
      assert.equal(wrap.children[0].textContent, '说明')
    })
  })

  test('行内式图片的 alt 必须真的取到（lezer 不产出 LinkLabel，旧实现恒为空）', () => {
    // [2026-10-24 实测] lezer 对 ![alt](url) 的 Image 子节点里没有 LinkLabel，
    // 只有引用式 ![alt][ref] 才有。旧 altOf 只查 LinkLabel ⇒ 行内式 alt 恒为 ''，
    // 占位框会丢用户写的说明、退化成裸路径。这条钉住新的取值口径。
    setDocPath(SAVED)
    const inline = EditorState.create({
      doc: '引言\n\n![说明文字](assets/x.png)\n',
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), wysiwygField],
    })
    const [w] = imageWidgets(
      buildDecorations(inline, [{ from: 0, to: inline.doc.length }]).deco, inline.doc.length,
    )
    assert.ok(w, '没取到图片 widget（判据失效）')
    assert.equal(w.alt, '说明文字', '行内式图片的 alt 取不到 —— 占位框会退化成裸路径')

    // 空的 alt 仍是空（不能把 `![](...)` 误读成别的文本）
    const empty = EditorState.create({
      doc: '引言\n\n![](assets/x.png)\n',
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), wysiwygField],
    })
    const [e] = imageWidgets(
      buildDecorations(empty, [{ from: 0, to: empty.doc.length }]).deco, empty.doc.length,
    )
    assert.equal(e.alt, '', '空 alt 被读成了非空文本')
  })
})
