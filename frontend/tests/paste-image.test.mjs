/**
 * paste-image.test.mjs — ⌘V 粘贴命令的图片通道（第十四轮修复）
 * ---------------------------------------------------------------------------
 * 被测对象：
 *   - editor/pasteCommand.js 的 pasteIntoView（图片优先 / 文本兜底 / 顺序契约）
 *   - useCommands 的 edit.paste → pasteIntoView 接线（经真实命令总线驱动，
 *     不走源码正则 —— 正则连「注释掉的绑定」都抓不到，见 HANDOFF §4 ⑲）
 *   - useFileAssets.saveImageFromClipboard 的 quiet 契约（⌘V 高频文本粘贴
 *     不得每次弹「请先保存」）
 *
 * 【为什么这条接线必须机检】⌘V 被 installGlobalShortcuts 全局分发接管并
 * preventDefault 后，DOM paste 事件**从不触发**——imageDrop 的三条图片通道
 * 到不了键盘这条路。若 edit.paste 忘了图片通道，症状是「拖拽能插图、⌘V 只出
 * 文件名文本」，全程无报错（本仓最恨的静默失败形态）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { pasteIntoView } from '../src/editor/pasteCommand.js'
import { emitCommand } from '../src/composables/useShortcuts.js'
import { useCommands } from '../src/composables/useCommands.js'
import { useFileAssets } from '../src/composables/useFileAssets.js'

/** 同形 EditorView stub：记录 dispatch / focus，供断言（image-paste.test.mjs 同款） */
function stubView(from = 5, to = 5, docLen = 40) {
  const calls = { dispatch: [], focus: 0 }
  return {
    calls,
    state: { selection: { main: { from, to } }, doc: { length: docLen } },
    dispatch(tr) { calls.dispatch.push(tr) },
    focus() { calls.focus++ },
  }
}

/** 装一个最小 window.go（App.js 绑定在调用时直取 window['go']['main']['App']） */
function installGoApi(methods) {
  const orig = globalThis.window
  globalThis.window = { go: { main: { App: methods } } }
  return () => { globalThis.window = orig }
}

describe('pasteIntoView · 图片优先 / 文本兜底', () => {
  test('剪贴板有图片 → 插 ![](url)，不读文本，焦点回编辑器', async () => {
    const view = stubView(5, 5)
    let textRead = 0
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => 'assets/img-1.png',
      getText: async () => { textRead++; return '不该被读' },
      notify: () => assert.fail('正常路径不得 toast'),
    })
    assert.equal(ok, true)
    assert.equal(textRead, 0, '图片命中后不应再读文本')
    assert.equal(view.calls.dispatch.length, 1)
    assert.equal(view.calls.dispatch[0].changes.insert, '![](assets/img-1.png)')
    assert.equal(view.calls.dispatch[0].selection.anchor, 5 + '![](assets/img-1.png)'.length)
    assert.equal(view.calls.focus, 1)
  })

  test('插入落在快照选区上：替换 from..to 区间', async () => {
    const view = stubView(2, 6)
    await pasteIntoView(view, {
      getClipboardImage: async () => 'assets/a.jpg',
      getText: async () => 't',
    })
    const ch = view.calls.dispatch[0].changes
    assert.equal(ch.from, 2)
    assert.equal(ch.to, 6)
  })

  test('无图片（null）→ 落回文本路径', async () => {
    const view = stubView()
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => null,
      getText: async () => '普通文本',
      notify: () => assert.fail('有文本不该 toast'),
    })
    assert.equal(ok, true)
    assert.equal(view.calls.dispatch[0].changes.insert, '普通文本')
    assert.equal(view.calls.dispatch[0].selection.anchor, 5 + '普通文本'.length)
  })

  test('图片通道抛错不得阻塞文本粘贴（宁可插图失败，不可吞文本）', async () => {
    const view = stubView()
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => { throw new Error('boom') },
      getText: async () => '文本',
    })
    assert.equal(ok, true)
    assert.equal(view.calls.dispatch[0].changes.insert, '文本')
  })

  test('读文本失败 → toast 读取失败、零 dispatch', async () => {
    const view = stubView()
    const toasts = []
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => null,
      getText: async () => { throw new Error('denied') },
      notify: (m) => toasts.push(m),
    })
    assert.equal(ok, false)
    assert.equal(toasts.length, 1)
    assert.equal(view.calls.dispatch.length, 0)
  })

  test('剪贴板为空 → toast 空、零 dispatch', async () => {
    const view = stubView()
    const toasts = []
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => null,
      getText: async () => '',
      notify: (m) => toasts.push(m),
    })
    assert.equal(ok, false)
    assert.equal(toasts.length, 1)
    assert.equal(view.calls.dispatch.length, 0)
  })

  // 【2026-10-25 真机反馈】文档未保存时图片通道静默跳过，文本又是空串 →
  // 旧实现报「剪贴板为空」，与事实相反（剪贴板里明明有图）。必须改说「请先保存」。
  test('有图但文档未保存 → 说「请先保存文档」，不说「剪贴板为空」', async () => {
    const view = stubView()
    const toasts = []
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => null,   // quiet 探测：未落盘 → 静默 null
      getText: async () => '',
      hasClipboardImage: async () => true,   // 事实：剪贴板里有图
      canSaveImage: () => false,             // 事实：文档未落盘
      notify: (m, isErr) => toasts.push({ m, isErr }),
    })
    assert.equal(ok, false)
    assert.equal(toasts.length, 1, '只能有一条提示（不能先「剪贴板为空」再「请先保存」）')
    assert.match(toasts[0].m, /保存/)
    assert.equal(toasts[0].isErr, true)
    assert.equal(view.calls.dispatch.length, 0)
  })

  test('有图且文档已落盘（落盘失败已 toast）→ 不再叠加第二条提示', async () => {
    const view = stubView()
    const toasts = []
    const ok = await pasteIntoView(view, {
      getClipboardImage: async () => null,
      getText: async () => '',
      hasClipboardImage: async () => true,
      canSaveImage: () => true,
      notify: (m) => toasts.push(m),
    })
    assert.equal(ok, false)
    assert.equal(toasts.length, 0, '真错误已由图片通道 toast，这里重复提示只会噪音')
  })

  test('剪贴板无图且无文本 → 仍然说「剪贴板为空」', async () => {
    const view = stubView()
    const toasts = []
    await pasteIntoView(view, {
      getClipboardImage: async () => null,
      getText: async () => '',
      hasClipboardImage: async () => false,
      canSaveImage: () => false,
      notify: (m) => toasts.push(m),
    })
    assert.equal(toasts.length, 1)
    assert.match(toasts[0], /剪贴板/)
  })
})

describe('edit.paste 命令接线（真实命令总线驱动）', () => {
  // useCommands 在组件外实例化：onMounted/onBeforeUnmount 会告警（无害），
  // 显式压掉以保持测试输出干净 —— registerCommands 由我们手工调用补偿。
  function mountCmds({ getClipboardImage, clipboardGet }) {
    const view = stubView()
    const toasts = []
    const origWarn = console.warn
    console.warn = () => {}
    let cmds
    try {
      cmds = useCommands({
        getEditor: () => view,
        session: {}, docState: {}, fileOps: {}, workspace: {}, prefs: {},
        outlineSync: {}, help: { showShortcuts: ref(false), rows: [] },
        dialog: ref({ show: false }), closeDialog: () => {}, askInput: async () => {},
        notify: (m) => toasts.push(m), slashRef: ref(null),
        getClipboardImage,
      })
      cmds.registerCommands()
    } finally {
      console.warn = origWarn
    }
    return { view, toasts, clipboardGet }
  }

  test('⌘V 命令经图片通道插图（ClipboardGet 不被调用）', async () => {
    let textCalls = 0
    const clipboardGet = async () => { textCalls++; return '文本' }
    const restore = installGoApi({ ClipboardGet: clipboardGet })
    try {
      const { view } = mountCmds({ getClipboardImage: async () => 'assets/cmd.png' })
      assert.equal(emitCommand('edit.paste'), true)
      await new Promise((r) => setTimeout(r, 0))
      assert.equal(textCalls, 0, '图片命中后命令不得再读文本')
      assert.equal(view.calls.dispatch[0].changes.insert, '![](assets/cmd.png)')
    } finally {
      restore()
    }
  })

  test('无图片时命令落回 ClipboardGet 文本（回归：普通文本粘贴不坏）', async () => {
    const restore = installGoApi({ ClipboardGet: async () => '命令路径文本' })
    try {
      const { view } = mountCmds({ getClipboardImage: async () => null })
      emitCommand('edit.paste')
      await new Promise((r) => setTimeout(r, 0))
      assert.equal(view.calls.dispatch[0].changes.insert, '命令路径文本')
    } finally {
      restore()
    }
  })
})

describe('saveImageFromClipboard · quiet 契约', () => {
  test('quiet=true：未落盘文档静默返回 null（⌘V 文本粘贴高频，不得弹「请先保存」）', async () => {
    const restore = installGoApi({
      SaveImage: async () => '', SaveImageFromPath: async () => '',
      SaveImageFromClipboard: async () => '',
    })
    try {
      const toasts = []
      const assets = useFileAssets({ getFilePath: () => '', notify: (m) => toasts.push(m) })
      const rel = await assets.saveImageFromClipboard({ quiet: true })
      assert.equal(rel, null)
      assert.deepEqual(toasts, [], 'quiet 模式下环境性跳过不得 toast')
      // 对照：非 quiet（imageDrop 路径）保持响亮提示
      const rel2 = await assets.saveImageFromClipboard()
      assert.equal(rel2, null)
      assert.equal(toasts.length, 1, '非 quiet 模式应提示先保存文档')
    } finally {
      restore()
    }
  })
})
