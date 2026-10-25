/**
 * image-paste.test.mjs — 图片粘贴 / 拖拽两条输入通道的行为契约（2026-10-14 新增）
 * ---------------------------------------------------------------------------
 * 背景（真机验收 #8，用户原话：「复制图片后，过来黏贴只是文件名」）：
 * macOS 在 Finder 里 ⌘C 一个图片文件，剪贴板里放的是 **file URL**
 * （text/uri-list），图片数据并不在 DataTransfer.files 里。旧实现只认
 * dt.files，于是这类粘贴落给浏览器默认行为 —— 把文件名当文本插进编辑器。
 * 不抛异常、不记日志，编辑器里静静多出一行文件名，是最典型的静默失败。
 *
 * 本文件全部是**真行为测试**（import 真实模块、stub 最小 DOM 形态），
 * 不用源码正则「假装调用」——本仓对假绿灯的判据是「注入缺陷必须变红」。
 *
 * 【形态必须显式入参】（HANDOFF §4 ⑰ 的教训）
 * window.go 的形态（full / 无绑定 / 抛错）由每个用例显式决定，
 * helper 不得无条件重设 globalThis.window —— 否则「缺绑定」路径从未真正
 * 进入，删掉源码里的守卫测试依然全绿（watcher-wiring.test.mjs 踩过）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { imageDropHandlers, imagePathFromDataTransfer } from '../src/editor/imageDrop.js'
import { useFileAssets } from '../src/composables/useFileAssets.js'

// ===========================================================================
// 1. imagePathFromDataTransfer：file URL 提取（纯函数）
// ===========================================================================
describe('imagePathFromDataTransfer · file URL 提取', () => {
  /** 最小 DataTransfer：files + getData 两种取法都走真实代码路径 */
  const dt = (data, files = []) => ({
    files,
    types: Object.keys(data),
    getData: (type) => data[type] ?? '',
  })

  test('text/uri-list 的 file:// 图片 → 本地路径（Finder ⌘C 的真实形态）', () => {
    const got = imagePathFromDataTransfer(dt({ 'text/uri-list': 'file:///Users/me/Pictures/shot.png\n' }))
    assert.equal(got, '/Users/me/Pictures/shot.png')
  })

  test('只有 text/plain 放 file URL 时也认（部分应用只给这一种）', () => {
    const got = imagePathFromDataTransfer(dt({ 'text/plain': 'file:///tmp/a.jpg' }))
    assert.equal(got, '/tmp/a.jpg')
  })

  test('URL 编码（空格 / 中文）→ decodeURIComponent', () => {
    const got = imagePathFromDataTransfer(dt({ 'text/uri-list': 'file:///Users/me/%E5%9B%BE%E7%89%87%20a.png' }))
    assert.equal(got, '/Users/me/图片 a.png')
  })

  test('uri-list 多行（一次复制多个文件）→ 只取第一个', () => {
    const got = imagePathFromDataTransfer(dt({ 'text/uri-list': 'file:///a/1.png\nfile:///a/2.png\n' }))
    assert.equal(got, '/a/1.png')
  })

  test('非图片扩展名 → null（.txt / .pdf 不是本功能的猎物，放行默认行为）', () => {
    assert.equal(imagePathFromDataTransfer(dt({ 'text/uri-list': 'file:///a/readme.txt' })), null)
    assert.equal(imagePathFromDataTransfer(dt({ 'text/uri-list': 'file:///a/doc.pdf' })), null)
  })

  test('普通文本（无 file:// scheme）→ null：绝不能把「像路径的正文」当图片吞掉', () => {
    assert.equal(imagePathFromDataTransfer(dt({ 'text/plain': '见 /usr/local/bin 说明' })), null)
    assert.equal(imagePathFromDataTransfer(dt({ 'text/plain': 'https://example.com/a.png' })), null)
    // WebKit 默认粘贴插入的就是文件名（无 scheme）：同样不拦截
    assert.equal(imagePathFromDataTransfer(dt({ 'text/plain': 'shot.png' })), null)
  })

  test('DataTransfer 形态不完整（无 getData / 空串 / null）→ null 且不抛', () => {
    assert.equal(imagePathFromDataTransfer(null), null)
    assert.equal(imagePathFromDataTransfer({}), null)
    assert.equal(imagePathFromDataTransfer({ getData: () => '' }), null)
    assert.equal(imagePathFromDataTransfer({ getData: () => 'file:///a/x.png' }), '/a/x.png')
  })
})

// ===========================================================================
// 2. imageDropHandlers：粘贴 / 拖拽处理器（真实 handler + stub view/event）
// ===========================================================================

/** 最小 view：处理器只用 selection.head / doc.length / dispatch / posAtCoords */
function stubView(doc = 'hello', head = doc.length) {
  const dispatched = []
  return {
    dispatched,
    state: {
      doc: { length: doc.length },
      selection: { main: { head } },
    },
    dispatch(spec) { dispatched.push(spec) },
    posAtCoords: () => 3,
  }
}

/** 最小 paste/drop 事件：记录 preventDefault 是否被调用 */
function stubEvent(clipboardData) {
  const calls = { preventDefault: 0 }
  return {
    calls,
    clipboardData,
    dataTransfer: clipboardData,
    clientX: 0,
    clientY: 0,
    preventDefault() { calls.preventDefault++ },
  }
}

/** 图片 File（node 22 全局 File；arrayBuffer 真实可用） */
function imageFile(name = 'shot.png', type = 'image/png') {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type })
}

const uriList = (url) => ({ 'text/uri-list': url + '\n' })

/** 等 insertImageMarkdown 里的 Promise.resolve().then 落地 */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('imageDropHandlers · 粘贴（两条通道 + 放行边界）', () => {
  test('通道 ①：clipboardData.files 里的图片 File → 回调收到 File、拦截默认行为', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('assets/a.png') })
    const file = imageFile()
    const event = stubEvent({ files: [file], types: ['Files'], getData: () => '' })
    const view = stubView('hello', 5)

    assert.equal(handlers.paste(event, view), true, '拦截必须返回 true')
    assert.equal(event.calls.preventDefault, 1, '必须阻止默认粘贴（否则文件名/图片被浏览器插入）')
    assert.ok(seen[0] instanceof File, '通道 ① 送进的必须是 File 本体')
    await flush()
    assert.deepEqual(view.dispatched[0].changes, { from: 5, insert: '![](assets/a.png)' })
  })

  test('通道 ②：Finder 复制的 file URL → 回调收到路径字符串、拦截默认行为', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('assets/b.png') })
    const event = stubEvent({ files: [], types: ['text/uri-list'], getData: (t) => uriList('file:///Users/me/Pictures/shot.png')[t] ?? '' })
    const view = stubView('hello', 5)

    assert.equal(handlers.paste(event, view), true, 'file URL 通道必须拦截')
    assert.equal(event.calls.preventDefault, 1)
    assert.equal(seen[0], '/Users/me/Pictures/shot.png', '通道 ② 送进的必须是本地路径字符串')
    await flush()
    assert.deepEqual(view.dispatched[0].changes, { from: 5, insert: '![](assets/b.png)' })
  })

  test('普通文本粘贴 → 不拦截、不调回调（浏览器默认行为必须保留）', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('x') })
    const event = stubEvent({ files: [], types: ['text/plain'], getData: () => '普通正文' })
    const view = stubView()
    assert.equal(handlers.paste(event, view), false)
    assert.equal(event.calls.preventDefault, 0, '不拦截时绝不能 preventDefault')
    await flush()
    assert.equal(seen.length, 0)
    assert.equal(view.dispatched.length, 0)
  })

  test('非图片文件 URL（.txt）→ 不拦截（#8 的修法不能误伤普通文件粘贴）', () => {
    const handlers = imageDropHandlers(() => Promise.resolve('x'))
    const event = stubEvent({ files: [], types: ['text/uri-list'], getData: () => 'file:///a/readme.txt\n' })
    assert.equal(handlers.paste(event, stubView()), false)
  })

  test('没有注册回调 → 即使有图片也不拦截（浏览器预览形态不炸）', () => {
    const handlers = imageDropHandlers(null)
    const event = stubEvent({ files: [imageFile()], types: ['Files'], getData: () => '' })
    assert.equal(handlers.paste(event, stubView()), false)
  })
})

describe('imageDropHandlers · 拖拽', () => {
  test('拖入图片 File → 用落点坐标插入', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('assets/c.png') })
    const event = stubEvent({ files: [imageFile()], types: ['Files'], getData: () => '' })
    const view = stubView('hello world', 0)
    assert.equal(handlers.drop(event, view), true)
    assert.ok(seen[0] instanceof File)
    await flush()
    assert.equal(view.dispatched[0].changes.from, 3, '插入点应取 posAtCoords 的落点（stub 恒为 3）')
  })

  test('dragover：Files 类型才阻止默认（否则浏览器不收 drop）', () => {
    const handlers = imageDropHandlers(() => Promise.resolve('x'))
    const fileEvent = stubEvent({ files: [], types: ['Files'], getData: () => '' })
    handlers.dragover(fileEvent)
    assert.equal(fileEvent.calls.preventDefault, 1)
    const textEvent = stubEvent({ files: [], types: ['text/plain'], getData: () => '' })
    handlers.dragover(textEvent)
    assert.equal(textEvent.calls.preventDefault, 0)
  })

  // 【2026-10-25 真机】WebKitGTK 从文件管理器拖入的 File 常常**没有 MIME**
  // （type === ''）。只认 image/* 会把真实拖拽判成非图片 → drop 被放行 →
  // webview 导航到 file://（整页被图片顶掉）。扩展名必须作为第二判据。
  test('File 没有 MIME（WebKitGTK 形态）但扩展名是图片 → 仍然收下', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('assets/d.png') })
    const noMime = new File([new Uint8Array([0x89, 0x50])], 'shot.png', { type: '' })
    const event = stubEvent({ files: [noMime], types: ['Files'], getData: () => '' })
    assert.equal(handlers.drop(event, stubView('hello', 0)), true)
    assert.ok(seen[0] instanceof File)
    await flush()
  })

  test('File 没有 MIME 且扩展名不是图片（.txt）→ 放行默认行为', () => {
    const handlers = imageDropHandlers(() => Promise.resolve('x'))
    const txt = new File([new Uint8Array([1])], 'notes.txt', { type: '' })
    const event = stubEvent({ files: [txt], types: ['Files'], getData: () => '' })
    assert.equal(handlers.drop(event, stubView()), false)
  })

  test('files 为空但 items 里有 file（部分 WebKit 形态）→ 从 items 取', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('assets/e.png') })
    const file = imageFile('from-items.png')
    const event = stubEvent({ files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], types: ['Files'], getData: () => '' })
    assert.equal(handlers.drop(event, stubView('hello', 0)), true)
    assert.equal(seen[0], file)
    await flush()
  })

  // 【2026-10-25 真机取证】WebKitGTK 从 Dolphin 拖文件进来时：
  //   files = []、items 全是 kind:"string"、getData('text/uri-list') = ""，
  //   唯一的 URI 在 text/html 的 <a> 文本里，且文件名可能没有扩展名。
  test('WebKitGTK 真机形态：URI 只在 text/html 锚点文本里（无扩展名）', async () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('assets/f.png') })
    const html = '<a style="caret-color: rgb(0,0,0)">file:///home/me/Downloads/Wallpaper%20Alchemy%20-%20Arch%20Linux%204K%20%E5%A3%81%E7%BA%B8</a>'
    const event = stubEvent({
      files: [],
      items: [{ kind: 'string', type: 'text/uri-list' }, { kind: 'string', type: 'text/html' }],
      types: ['text/uri-list', 'text/html'],
      getData: (t) => (t === 'text/html' ? html : ''),
    })
    assert.equal(handlers.drop(event, stubView('hello', 0)), true, '必须拦下并落盘（否则 webview 导航到 file://）')
    assert.equal(seen[0], '/home/me/Downloads/Wallpaper Alchemy - Arch Linux 4K 壁纸')
    await flush()
  })

  test('text/html 里的 http(s) 图片地址不得当成本地文件（只认 file://）', () => {
    const seen = []
    const handlers = imageDropHandlers((src) => { seen.push(src); return Promise.resolve('x') })
    const html = '<img src="https://example.com/a.png">'
    const event = stubEvent({
      files: [], items: [], types: ['text/uri-list', 'text/html'],
      getData: (t) => (t === 'text/html' ? html : ''),
    })
    assert.equal(handlers.drop(event, stubView()), false, '远程地址不是本地文件，放行默认行为')
    assert.equal(seen.length, 0)
  })
})

// ===========================================================================
// 3. useFileAssets：落盘回调（真实模块 + window.go stub）
// ===========================================================================

/**
 * 挂载 useFileAssets。goForm 显式决定 window.go 形态：
 *   'full'    → SaveImage / SaveImageFromPath 都在（记调用）
 *   'no-api'  → 无 window.go（vite dev 浏览器预览）
 *   'partial' → 只有 SaveImage（旧绑定形态：SaveImageFromPath 缺失）
 */
function mountAssets({ docPath = '/Users/me/notes/doc.md', goForm = 'full' } = {}) {
  const calls = { saveImage: [], saveImageFromPath: [] }
  const toasts = []
  if (goForm === 'full') {
    globalThis.window = {
      go: {
        main: {
          App: {
            SaveImage: async (...args) => { calls.saveImage.push(args); return 'assets/from-data.png' },
            SaveImageFromPath: async (...args) => { calls.saveImageFromPath.push(args); return 'assets/from-path.png' },
          },
        },
      },
    }
  } else if (goForm === 'no-api') {
    globalThis.window = {}
  } else if (goForm === 'partial') {
    globalThis.window = { go: { main: { App: { SaveImage: async () => 'assets/x.png' } } } }
  } else {
    throw new Error(`未知 goForm: ${goForm}`)
  }
  const assets = useFileAssets({
    getFilePath: () => docPath,
    notify: (msg, isErr) => toasts.push({ msg, isErr }),
  })
  return { assets, calls, toasts }
}

describe('useFileAssets · 两条落盘通道', () => {
  test('通道 ①：File → SaveImage(docPath, base64, ext)，返回 Go 给的相对路径', async () => {
    const { assets, calls } = mountAssets()
    const url = await assets.saveImageFile(imageFile('shot.png'))
    assert.equal(url, 'assets/from-data.png')
    assert.equal(calls.saveImage.length, 1)
    const [docPath, b64, ext] = calls.saveImage[0]
    assert.equal(docPath, '/Users/me/notes/doc.md')
    assert.equal(ext, 'png')
    // base64 必须真的是那 4 字节 PNG 魔数的编码（不是空串、不是乱码）
    assert.equal(Buffer.from(b64, 'base64').toString('hex'), '89504e47')
  })

  test('通道 ②：路径字符串 → SaveImageFromPath(docPath, srcPath)，前端不读盘', async () => {
    const { assets, calls } = mountAssets()
    const url = await assets.saveImageFile('/Users/me/Pictures/shot.png')
    assert.equal(url, 'assets/from-path.png')
    assert.equal(calls.saveImage.length, 0, '路径通道不得再走 base64 通道')
    assert.deepEqual(calls.saveImageFromPath[0], ['/Users/me/notes/doc.md', '/Users/me/Pictures/shot.png'])
  })

  test('saveImagePath 单独调用也可用（同一契约）', async () => {
    const { assets, calls } = mountAssets()
    assert.equal(await assets.saveImagePath('/a/b.jpeg'), 'assets/from-path.png')
    assert.equal(calls.saveImageFromPath[0][1], '/a/b.jpeg')
  })

  test('文档未落盘（filePath 空）→ 两条通道都提示「先保存」并返回 null', async () => {
    const { assets, toasts, calls } = mountAssets({ docPath: '' })
    assert.equal(await assets.saveImageFile(imageFile()), null)
    assert.equal(await assets.saveImageFile('/a/b.png'), null)
    assert.equal(toasts.length, 2, '两条通道各一次提示')
    assert.ok(toasts.every((t) => t.isErr), '必须是错误态提示')
    assert.equal(calls.saveImage.length + calls.saveImageFromPath.length, 0, '不得调用 Go')
  })

  test('window.go 缺失（浏览器预览）→ 提示「当前环境不支持」并返回 null，不抛', async () => {
    const { assets, toasts } = mountAssets({ goForm: 'no-api' })
    assert.equal(await assets.saveImageFile(imageFile()), null)
    assert.equal(await assets.saveImageFile('/a/b.png'), null)
    assert.equal(toasts.length, 2)
  })

  test('旧绑定形态（只有 SaveImage）→ 路径通道同样走「不支持」提示，不抛', async () => {
    // 双通道守卫必须同时校验两个绑定：只查 SaveImage 会让路径通道在旧绑定上
    // 调用一个不存在的方法 → TypeError 静默吞进 insertImageMarkdown 的 catch，
    // 用户看到的是「粘贴没反应」而不是「不支持」。
    const { assets, toasts } = mountAssets({ goForm: 'partial' })
    assert.equal(await assets.saveImageFile('/a/b.png'), null)
    assert.equal(toasts.length, 1)
    // 只判条数会漏掉「文案走错」：少校验一个绑定时，调用不存在的方法抛
    // TypeError 被 catch 成 imageFailed，条数同样是 1。必须钉死是「不支持」。
    assert.match(toasts[0].msg, /不支持/)
  })

  test('Go 侧报错（类型不允许 / 超限 / 读盘失败）→ 转用户可读 toast，返回 null', async () => {
    globalThis.window = {
      go: {
        main: {
          App: {
            SaveImage: async () => { throw new Error('不支持的图片类型: txt') },
            SaveImageFromPath: async () => { throw new Error('读取图片失败: no such file') },
          },
        },
      },
    }
    const toasts = []
    const assets = useFileAssets({ getFilePath: () => '/a/doc.md', notify: (m, e) => toasts.push({ m, e }) })
    assert.equal(await assets.saveImageFile(imageFile('a.txt', 'text/plain')), null)
    assert.equal(await assets.saveImageFile('/a/missing.png'), null)
    assert.equal(toasts.length, 2)
    assert.match(toasts[0].m, /不支持的图片类型/)
    assert.match(toasts[1].m, /读取图片失败/)
  })
})
