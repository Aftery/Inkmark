// tests/image-clipboard.test.mjs — 通道③（系统剪贴板兜底）的前端行为
// ----------------------------------------------------------------------------
// 【这条通道为什么必须存在】2026-10-15 真机复验：#8 图片粘贴**仍然**只粘进一个文件名。
// 上一轮认定根因是「Finder给的是 file URL（text/uri-list）」并据此加了通道②，
// 但那个根因是错的 —— 真机上从没有生效过：
//   WKWebView（Safari 内核）**不把剪贴板图片暴露给 clipboardData**：
//   没有 files、没有 items、text/uri-list 里也没有 file://，
//   只有 text/plain 里的**文件名**。于是通道①② 全部落空 → 事件交回 WebKit
//   默认处理 → 默认行为是**把文件名当纯文本插入**，全程无任何报错。
//   剪贴板的二进制内容 webview 读不到，只能由 Go 走原生 API 取 → 通道③。
//
// 【为什么上一轮的探针没抓到】scripts/probe 跑在**无头 Chrome** 上，
// Chrome 的剪贴板实现与 WKWebView 不同（会给 files / file://）。
// **探针环境与真机剪贴板语义不一致 = 又一次假绿灯。**
//
// 【本文件的断言纪律】每条都打在「这条路径特有的可观测差异」上：
//   拦截了没有？preventDefault 了没有？送进回调的是什么？插入的文本是哪一个？
// 凡是「不报错就算过」的写法一律不写 —— 本仓已两次栽在这类恒真断言上
// （见 HANDOFF §4⑱⑲）。

// 【本文件曾有2 条恒真断言，已修正 —— 变异自证2026-10-15】
//   方向1 删掉 looksLikeImageFilename 的「含空白则拒绝」
//        → 精确报红（「foo.png bar.png」被误吞）。这正是第一版实现的真 bug。
//   方向2 误判时不还回文本 → 精确报红（用户文本被吞）。
//   方向3 删掉门槛里「通道①② 已拿到图片」的短路检查
//        → **第一次跑没报红**。查出原因：paste() 里通道①② 成功时早已 return true，
//          压根走不到门槛的短路检查 —— 两道防线互相掩护，
//          绕道 paste 的测试区分不出是哪一道在起作用。
//          处置：新增 shouldTryClipboardFallback 的**直测**，
//          重跑该变异后精确报红（19 条用例，2 条命中）。
//   教训重申：**「改坏了测试会红」必须真跑一遍**，不能凭「我写了断言」就认为有效。
//
//【断言纪律】每条都打在「这条路径特有的可观测差异」上：
//   拦截了没有？preventDefault 了没有？送进回调的是什么？插入的文本是哪一个？
//   凡是「不报错就算过」的写法一律不写 —— 本仓已多次栽在这类恒真断言上。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { imageDropHandlers, looksLikeImageFilename, shouldTryClipboardFallback } from '../src/editor/imageDrop.js'

/** 事件 stub：与 image-paste.test.mjs 同口径 */
function stubEvent({ files = [], types = [], getData = () => '' } = {}) {
  const calls = { preventDefault: 0 }
  return {
    clipboardData: { files, types, getData, items: [] },
    clientX: 0,
    clientY: 0,
    preventDefault() { calls.preventDefault++ },
    calls,
  }
}

/** view stub：记录所有 dispatch */
function stubView(doc = '', head = 0) {
  return {
    state: { doc: { length: doc.length }, selection: { main: { head } } },
    posAtCoords: () => head,
    dispatched: [],
    dispatch(spec) { this.dispatched.push(spec) },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

// ---------------------------------------------------------------------------
// 门槛判定：只有「①② 都拿不到 + 文本像图片文件名」才走通道③
// ---------------------------------------------------------------------------
describe('通道③ 门槛 · shouldTryClipboardFallback 的判定', () => {
  test('WebKit 的真实形态：files 空、无 uri-list、text/plain 是文件名 → 走兜底', async () => {
    // 这就是 2026-10-15 真机复现的那次粘贴形态
    const event = stubEvent({
      files: [],
      types: ['text/plain'],
      getData: (t) => (t === 'text/plain' ? '1643208705644.jpg' : ''),
    })
    let asked = 0
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => { asked++; return Promise.resolve('assets/x.png') })
    const handled = handlers.paste(event, stubView())

    assert.equal(handled, true, '这次粘贴必须被拦截，否则又变成插入文件名')
    assert.equal(event.calls.preventDefault, 1, '必须同步 preventDefault（异步前就要决定）')
    // onClipboardImage 经 .then() 调用（见 imageDrop.js 的注释：
    // Promise.resolve(fn()) 会先同步执行 fn，抛错会逃出 paste），
    // 故必须等一个微任务才能断言它真的被调过。
    await flush()
    assert.equal(asked, 1, '必须真的去问系统剪贴板')
  })

  test('普通中文正文 → 不问剪贴板、不拦截（误吞文本是比插不进图更严重的回归）', () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: () => '这是一段普通正文，粘贴进来应当原样保留' })
    let asked = 0
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => { asked++; return Promise.resolve(null) })

    assert.equal(handlers.paste(event, stubView()), false, '不该拦截')
    assert.equal(asked, 0, '不该白跑一次 Go IPC')
    assert.equal(event.calls.preventDefault, 0, '拦截前绝不能 preventDefault')
  })

  test('代码/带空格的句子 → 不拦截', () => {
    for (const text of ['const a = 1', 'foo.png bar.png', 'a\nb.png']) {
      const event = stubEvent({ files: [], types: ['text/plain'], getData: () => text })
      const handlers = imageDropHandlers(() => Promise.resolve(null), () => Promise.resolve(null))
      assert.equal(handlers.paste(event, stubView()), false, `不该拦截: ${JSON.stringify(text)}`)
    }
  })

  test('已有图片数据（通道①）时绝不问剪贴板（否则多插一张图）', async () => {
    const file = new File([new Uint8Array([0x89, 0x50])], 'shot.png', { type: 'image/png' })
    // text/plain 必须**也是**一个像图片文件名的字符串！否则门槛会因
    // 「文本不像文件名」而返回 false，短路检查根本没被执行到，
    // 断言就成了恒真（第一版就是这么写错的，变异自证当场抓出）。
    // 这样才真正验证「拿到图片 File 后不再多问一次剪贴板」。
    const event = stubEvent({
      files: [file],
      types: ['Files', 'text/plain'],
      getData: (t) => (t === 'text/plain' ? 'shot.png' : ''),
    })
    let asked = 0
    const handlers = imageDropHandlers(() => Promise.resolve('assets/a.png'), () => { asked++; return Promise.resolve(null) })

    handlers.paste(event, stubView())
    await flush()
    assert.equal(asked, 0, '通道① 已成功时不该再问系统剪贴板（否则重复插图）')
  })

  test('已有 file:// URI（通道②）时绝不问剪贴板', async () => {
    // 同上：text/plain 也要给一个像图片文件名的值，才能真正走到 ② 的短路
    const event = stubEvent({
      files: [], types: ['text/uri-list', 'text/plain'],
      getData: (t) => ({
        'text/uri-list': 'file:///Users/me/a.png\n',
        'text/plain': 'a.png',
      })[t] ?? '',
    })
    let asked = 0
    const handlers = imageDropHandlers(() => Promise.resolve('assets/b.png'), () => { asked++; return Promise.resolve(null) })

    handlers.paste(event, stubView())
    await flush()
    assert.equal(asked, 0, '通道② 已成功时不该再问系统剪贴板（否则重复插图）')
  })

  test('未注册 onClipboardImage（旧接线）→ 行为与加通道③之前完全一致', () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: () => '1643208705644.jpg' })
    const handlers = imageDropHandlers(() => Promise.resolve(null))
    assert.equal(handlers.paste(event, stubView()), false, '没注册回调就不能拦截')
    assert.equal(event.calls.preventDefault, 0)
  })
})

describe('shouldTryClipboardFallback · 门槛函数直测', () => {
  // 【为什么必须直测门槛函数】绕道 paste() 的测试**无法**区分两道防线：
  // paste() 里通道①② 成功时早就 return true，压根走不到门槛函数的短路检查，
  // 于是「删掉门槛里的短路检查」这种破坏也照样全绿（变异自证实测）。
  // 直测才能让每道防线被独立证伪 —— 否则它们互相掩护，
  // 哪天有人重构掉paste 的早返回，死代码就静默失效 → 重复插图。
  const dtWith = ({ files = [], data = {} }) => ({
    files,
    getData: (t) => data[t] ?? '',
  })

  test('拿到图片 File → 门槛为 false（哪怕文本也像图片文件名）', () => {
    const file = new File([new Uint8Array([0x89, 0x50])], 'shot.png', { type: 'image/png' })
    const dt = dtWith({ files: [file], data: { 'text/plain': 'shot.png' } })
    assert.equal(shouldTryClipboardFallback(dt), false, '已拿到图片就不该再兜底（会重复插图）')
  })

  test('拿到 file:// URI → 门槛为 false', () => {
    const dt = dtWith({
      files: [],
      data: { 'text/uri-list': 'file:///Users/me/a.png\n', 'text/plain': 'a.png' },
    })
    assert.equal(shouldTryClipboardFallback(dt), false, '已拿到 file:// 就不该再兜底')
  })

  test('什么都没有、文本像图片文件名 → 门槛为 true（唯一该兜底的情形）', () => {
    const dt = dtWith({ files: [], data: { 'text/plain': '1643208705644.jpg' } })
    assert.equal(shouldTryClipboardFallback(dt), true)
  })

  test('文本不像图片 → 门槛为 false', () => {
    const dt = dtWith({ files: [], data: { 'text/plain': '普通正文' } })
    assert.equal(shouldTryClipboardFallback(dt), false)
  })

  test('dt 为 null / getData 抛异常 → 门槛为 false 且不抛', () => {
    assert.equal(shouldTryClipboardFallback(null), false)
    const bad = { files: [], getData() { throw new Error('boom') } }
    assert.equal(shouldTryClipboardFallback(bad), false, 'getData 抛异常不该让粘贴崩掉')
  })
})

// ---------------------------------------------------------------------------
// 拿到 URL 后的插入行为
// ---------------------------------------------------------------------------
describe('通道③ 拿到剪贴板图片 → 插入 Markdown', () => {
  test('返回 assets 路径 → 插入 ![](assets/...) 且不插入文件名', async () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: (t) => (t === 'text/plain' ? '1643208705644.jpg' : '') })
    const view = stubView('hello world', 5)
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => Promise.resolve('assets/clip.png'))

    handlers.paste(event, view)
    await flush()

    assert.equal(view.dispatched.length, 1, '只应 dispatch 一次')
    assert.deepEqual(view.dispatched[0].changes, { from: 5, insert: '![](assets/clip.png)' })
    assert.ok(!String(view.dispatched[0].changes.insert).includes('1643208705644'),
      '绝不能把文件名也插进去 —— 那正是本缺陷的症状')
  })

  test('插入位置是插入符处（不是文末）', async () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: (t) => (t === 'text/plain' ? 'a.png' : '') })
    const view = stubView('hello', 2)
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => Promise.resolve('assets/c.png'))
    handlers.paste(event, view)
    await flush()
    assert.equal(view.dispatched[0].changes.from, 2, '应插在光标处')
  })
})

// ---------------------------------------------------------------------------
// 误判兜底：门槛是弱启发式，误判时必须把文本还给用户，不能凭空吞掉
// ---------------------------------------------------------------------------
describe('通道③ 误判兜底 · 文本必须原样还回', () => {
  test('剪贴板其实没有图片（返回 null）→ 原文本被还原，文档不丢内容', async () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: (t) => (t === 'text/plain' ? 'logo.png' : '') })
    const view = stubView('hello', 5)
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => Promise.resolve(null))

    handlers.paste(event, view)
    await flush()

    // 关键：preventDefault 已经吞掉了默认粘贴，所以必须手工还回去
    assert.equal(view.dispatched.length, 1, '应有一次「还回文本」的 dispatch')
    assert.deepEqual(view.dispatched[0].changes, { from: 5, insert: 'logo.png' },
      '误判时用户的文本不能被吞掉')
  })

  test('返回 undefined（Go 绑定缺失时的降级）→ 同样还回文本', async () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: (t) => (t === 'text/plain' ? 'x.png' : '') })
    const view = stubView('hello', 0)
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => Promise.resolve(undefined))
    handlers.paste(event, view)
    await flush()
    assert.deepEqual(view.dispatched[0].changes, { from: 0, insert: 'x.png' })
  })

  test('回调抛错 → 不 dispatch 任何内容，也不把未捕获异常抛给测试', async () => {
    const event = stubEvent({ files: [], types: ['text/plain'], getData: (t) => (t === 'text/plain' ? 'a.png' : '') })
    const view = stubView('hello', 0)
    const handlers = imageDropHandlers(() => Promise.resolve(null), () => { throw new Error('Go 侧已给 toast') })
    handlers.paste(event, view)
    await flush()
    assert.equal(view.dispatched.length, 0, '出错时不该插入半截内容（Go 侧已toast）')
  })
})

// ---------------------------------------------------------------------------
// 门槛谓词本身（被上面反复调用，单独钉住边界）
// ---------------------------------------------------------------------------
describe('looksLikeImageFilename · 门槛谓词边界', () => {
  test('像图片文件名 → true', () => {
    for (const t of ['a.png', '1643208705644.jpg', 'shot.JPEG', 'x.gif', '图.webp', 'a.b.svg']) {
      assert.equal(looksLikeImageFilename(t), true, `应判true: ${t}`)
    }
  })
  test('不像 → false（含空串/多行/带路径/非图片扩展名/纯句子）', () => {
    for (const t of ['', '   ', 'readme', 'a.txt', 'a.md', 'hello world', 'a\nb.png',
      '/Users/me/a.png', 'C:\\Users\\a.png', 'https://x.com/a.png', '看这张图.png 的说明']) {
      assert.equal(looksLikeImageFilename(t), false, `应判 false: ${JSON.stringify(t)}`)
    }
  })
  test('null / undefined / 非字符串 → false（不得抛）', () => {
    for (const t of [null, undefined, 123, {}, []]) {
      assert.equal(looksLikeImageFilename(t), false)
    }
  })
})