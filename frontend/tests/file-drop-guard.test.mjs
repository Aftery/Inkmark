/**
 * file-drop-guard.test.mjs — 应用级拖拽兜底（imageDrop.js · installFileDropGuard）
 * ============================================================================
 * 守的缺陷（2026-10-25 真机反馈）：「拖进来的图片直接占了整个应用」。
 * 文件落在编辑器 DOM 之外时，CM 的 domEventHandlers 收不到事件，WebKit 走
 * 默认行为 —— 把 webview 导航到 file:// 图片，应用内容被一张图顶掉，文档里
 * 却没有插入任何引用（实测拖拽后的 md 文件确实没有该图片）。
 *
 * 四条不变量：
 *   ① 任何文件型拖拽都不得让 webview 导航（preventDefault）；
 *   ② 编辑器外投放图片 → 插到当前光标处；
 *   ③ CM 已处理过的投放（defaultPrevented）不得再插第二张；
 *   ④ 非文件拖拽（纯文本）一律放行，不能吞掉浏览器的默认行为。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { installFileDropGuard } from '../src/editor/imageDrop.js'

/** 最小 EventTarget：只需要 add/remove/emit，用来观察真实监听器的装卸 */
function fakeTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    emit(type, ev) {
      for (const fn of [...(listeners.get(type) || [])]) fn(ev)
    },
  }
}

/** 最小 view：只用到 selection.head / doc.length / dispatch */
function stubView(head = 5) {
  const dispatched = []
  return {
    dispatched,
    state: { doc: { length: 10 }, selection: { main: { head } } },
    dispatch(spec) { dispatched.push(spec) },
  }
}

/** 最小 drop/dragover 事件：记录 preventDefault 次数 */
function stubEvent(data, { alreadyPrevented = false } = {}) {
  const ev = {
    dataTransfer: {
      files: data.files || [],
      types: Object.keys(data),
      getData: (t) => data[t] ?? '',
    },
    defaultPrevented: alreadyPrevented,
    preventDefaultCalls: 0,
    preventDefault() { ev.preventDefaultCalls++; ev.defaultPrevented = true },
  }
  return ev
}

const uriList = (url) => ({ 'text/uri-list': url + '\n' })
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installFileDropGuard · 文件拖拽不得导航 webview', () => {
  test('编辑器外拖入图片文件（uri-list）→ 拦截默认行为并插到当前光标', async () => {
    const target = fakeTarget()
    const view = stubView(4)
    const seen = []
    const off = installFileDropGuard(() => view, (src) => { seen.push(src); return Promise.resolve('assets/a.png') }, target)

    const ev = stubEvent(uriList('file:///home/me/shot.png'))
    target.emit('drop', ev)
    assert.equal(ev.preventDefaultCalls, 1, '必须阻止默认 —— 否则 webview 导航到 file:// 图片（整页被顶掉）')
    assert.equal(seen[0], '/home/me/shot.png', '图片路径必须送进落盘回调')
    await flush()
    assert.deepEqual(view.dispatched[0].changes, { from: 4, insert: '![](assets/a.png)' }, '必须插到当前光标处')
    off()
  })

  test('CM 已处理过的投放（defaultPrevented）→ 只补一次 preventDefault，不插第二张', () => {
    const target = fakeTarget()
    const view = stubView()
    const seen = []
    installFileDropGuard(() => view, (src) => { seen.push(src); return Promise.resolve('assets/a.png') }, target)

    const ev = stubEvent(uriList('file:///home/me/shot.png'), { alreadyPrevented: true })
    target.emit('drop', ev)
    assert.equal(ev.preventDefaultCalls, 1)
    assert.equal(seen.length, 0, '一次拖拽只能落盘一次（否则插入两张图）')
    assert.equal(view.dispatched.length, 0)
  })

  test('非图片文件（.pdf）→ 拦导航但不落盘', () => {
    const target = fakeTarget()
    const seen = []
    installFileDropGuard(() => stubView(), (src) => { seen.push(src); return Promise.resolve('x') }, target)

    const ev = stubEvent(uriList('file:///home/me/doc.pdf'))
    target.emit('drop', ev)
    assert.equal(ev.preventDefaultCalls, 1, '非图片也必须拦：默认行为一样会导航')
    assert.equal(seen.length, 0)
  })

  test('纯文本拖拽（无 Files / uri-list）→ 完全放行，不吞默认行为', () => {
    const target = fakeTarget()
    installFileDropGuard(() => stubView(), () => Promise.resolve('x'), target)

    const ev = stubEvent({ 'text/plain': '普通正文' })
    target.emit('drop', ev)
    assert.equal(ev.preventDefaultCalls, 0)
  })

  test('dragover：文件拖拽必须标成合法投放区（否则 drop 不派发）', () => {
    const target = fakeTarget()
    installFileDropGuard(() => stubView(), () => Promise.resolve('x'), target)

    const withFiles = stubEvent({ Files: '' })
    target.emit('dragover', withFiles)
    assert.equal(withFiles.preventDefaultCalls, 1, 'Linux/GTK 的文件拖拽 types 里没有 Files，但必须有 uri-list 那条也要拦')

    const plain = stubEvent({ 'text/plain': '正文' })
    target.emit('dragover', plain)
    assert.equal(plain.preventDefaultCalls, 0)
  })

  test('卸载后不再响应（编辑器销毁不留 window 级监听）', () => {
    const target = fakeTarget()
    const off = installFileDropGuard(() => stubView(), () => Promise.resolve('x'), target)
    off()
    assert.equal((target.listeners.get('drop') || []).length, 0)
    assert.equal((target.listeners.get('dragover') || []).length, 0)
  })

  test('没有编辑器实例时也必须拦导航（初始化竞态 / 已销毁）', () => {
    const target = fakeTarget()
    installFileDropGuard(() => null, () => Promise.resolve('x'), target)
    const ev = stubEvent(uriList('file:///home/me/shot.png'))
    target.emit('drop', ev)
    assert.equal(ev.preventDefaultCalls, 1)
  })
})
