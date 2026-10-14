/**
 * probe-r11-fixes.mjs — 第十一轮五处真机缺陷的修复验证探针（2026-10-14）
 * ---------------------------------------------------------------------------
 * 背景：2026-10-13 真机目视验收 18/22，5 项不通过。根因全部钉死后修复，
 * 本探针在无头 Chrome 里对**真实按键 / 真实粘贴事件 / 真实命令总线**复现
 * 五条路径，确认修复生效（而不是「构建通过就算修好了」）：
 *
 *   #7  斜杠面板「没反应」：keymap 增绑全角 '／' + 输入法 insertText 兜底
 *   #8  粘贴「只是文件名」：Finder file URL（text/uri-list）走 Go 读盘落库
 *   #13 打印「没反应」：⌘P 从 window.print()（WKWebView 空操作）改走导出 PDF
 *   #19 / #20（2026-10-14 终局）：阅读态已整体移除 —— 产品定位改为编辑器内
 *       所见即所得（表格真渲染见 editor/tableRender.js，契约由
 *       tests/table-render.test.mjs 与 probe-wysiwyg.mjs 覆盖），
 *       本探针原 ⌘E 进出阅读态的 5 项断言随之退役。
 *
 * 为什么必须真浏览器：五条的旧形态全是静默失败（不抛异常、构建通过、
 * 旧测试全绿）。旧探针用 dispatchKeyEvent 送半角 '/' 模拟，绕开了输入法，
 * 所以探针绿而真机红 —— 本轮补上全角键与 insertText 两条真实路径。
 *
 * 【探针自身装配的两个坑，踩过就知道】（2026-10-14 实测）
 *   1) getAppApi() 的判据是 `window.runtime && window.go` —— stub 只装
 *      window.go 会让导出 PDF 静默走 window.print() 分支，探针假红。
 *      必须连 window.runtime 一起装。
 *   2) 图片落盘有「先保存」守卫：不先经 ⌘O 打开一份文档，filePath 为空，
 *      SaveImageFromPath 根本不会被调用（这是正确行为，见 #8 第一步的断言）。
 *
 * 前置：先起 dev server（DEV 钩子只在 dev 下存在）：
 *   cd frontend && npx vite --port 5599 --strictPort
 * 再跑（另一终端）：
 *   node scripts/probe/probe-r11-fixes.mjs
 *
 * 两个必须同时监听的 CDP 事件：Runtime.consoleAPICalled 与 Runtime.exceptionThrown。
 * 注意：本机注入的 HTTP_PROXY 会把 127.0.0.1 拦成 502，故用 node:http 而非 fetch。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { get as httpGet } from 'node:http'

const URL_BASE = process.env.PROBE_URL || 'http://127.0.0.1:5599/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = { ...process.env }
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[k]

function getJSON(url) {
  return new Promise((res, rej) => {
    const req = httpGet(url, (r) => {
      let b = ''
      r.on('data', (c) => { b += c })
      r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { rej(e) } })
    })
    req.on('error', rej)
    req.setTimeout(3000, () => req.destroy(new Error('timeout')))
  })
}

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find((p) => existsSync(p))
if (!chrome) { console.log('NO_CHROME'); process.exit(2) }

const cdpPort = await new Promise((res) => {
  const s = createServer()
  s.on('error', () => res(0))
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(); res(p) })
})
const profile = mkdtempSync(join(tmpdir(), 'r11-'))
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', '--no-proxy-server', `--remote-debugging-port=${cdpPort}`,
  '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], env })

let page = null
const dl = Date.now() + 20000
while (Date.now() < dl && !page) {
  try { page = (await getJSON(`http://127.0.0.1:${cdpPort}/json/list`)).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) } catch {}
  if (!page) await sleep(150)
}
if (!page) { console.log('NO_PAGE'); proc.kill(); process.exit(2) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, b) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', b, { once: true }) })

let id = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []
ws.addEventListener('message', (e) => {
  let m
  try { m = JSON.parse(e.data) } catch { return }
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
    return
  }
  // 两个必须同时监听的事件 —— 漏掉任一个都会让缺陷静默通过
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description).join(' ') ?? '')
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails?.exception?.description ?? 'unknown')
  }
})
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id
  pending.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method, params }))
})
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  // 防呆：表达式求值成了函数（忘了尾调用 ()）时 returnByValue 会静默给 {}，
  // 曾让 #8 的守卫断言假红。这里直接炸成可见错误。
  if (r.result?.type === 'function') return { __err: 'probe bug: expression is a function (missing invocation?)' }
  return r.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_BASE })
await sleep(4500)

const results = []
const step = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  →  ' + detail : ''}`)
}

/** 真实按键：逐字符 dispatchKeyEvent（半角直接给字符，全角给 U+FF0F） */
async function typeText(text) {
  for (const ch of text) {
    if (ch === '\n') {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    } else {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    }
    await sleep(12)
  }
}

/** 带 ⌘ 的按键（modifiers bitmask：Meta=4） */
async function keyWithMeta(key, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 4 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 4 })
  await sleep(400)
}

async function tapEscape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(200)
}

/** 清空文档（真实 Backspace 流）并聚焦编辑器 */
async function clearDoc() {
  await ev(`(() => {
    const ed = document.querySelector('.cm-content')
    ed.focus()
    const view = window.__inkmark && window.__inkmark.editor
    if (!view) return 'no-editor'
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    return 'ok'
  })()`)
  await sleep(150)
  for (let i = 0; i < 300; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })
    if (i % 40 === 39) await sleep(25)
  }
  await sleep(300)
}

const panelOpen = () => ev(`!!document.querySelector('.slash-panel')`)
const docText = () => ev(`window.__inkmark.editor.state.doc.toString()`)

/** 在编辑器上派发一个合成 paste 事件（DataTransfer 由页面侧构造，形态与 Finder ⌘C 一致） */
async function pasteWith(types) {
  return ev(`(() => {
    const dt = new DataTransfer()
    ${types.map(([t, v]) => `dt.setData(${JSON.stringify(t)}, ${JSON.stringify(v)})`).join('\n    ')}
    const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    document.querySelector('.cm-content').dispatchEvent(event)
    return 'ok'
  })()`)
}

// ---------------------------------------------------------------------------
// 0) 前置：注入 window.runtime + window.go stub（dev server 没有 Wails 绑定）。
//    getAppApi() 的判据是 `window.runtime && window.go`，两个都必须装。
// ---------------------------------------------------------------------------
await ev(`(() => {
  window.__calls = { exportPdf: [], saveImageFromPath: [], saveImage: [], openFile: [], readFile: [] }
  window.runtime = {}
  window.go = { main: { App: {
    ExportPDF: async (html, opts) => { window.__calls.exportPdf.push({ len: html.length, opts }); return '/tmp/probe-out.pdf' },
    SaveImageFromPath: async (docPath, srcPath) => { window.__calls.saveImageFromPath.push({ docPath, srcPath }); return 'assets/probe-shot.png' },
    SaveImage: async (docPath, b64, ext) => { window.__calls.saveImage.push({ docPath, ext }); return 'assets/probe-data.png' },
    OpenFileDialog: async () => { window.__calls.openFile.push(1); return '/tmp/probe-doc.md' },
    ReadFile: async (p) => { window.__calls.readFile.push(p); return '# 探针文档\\n' },
    SaveFileDialog: async () => '/tmp/probe-doc.md',
    WriteFile: async () => {},
    ListDir: async () => [],
    RenameFile: async () => '',
    SetDirty: async () => {},
    SnapshotList: async () => [],
    SnapshotRead: async () => '',
    SnapshotWrite: async () => '',
    WatchDir: async () => {},
    UnwatchDir: async () => {},
    Version: async () => '0.0.0',
  } } }
  return 'ok'
})()`)

// ---------------------------------------------------------------------------
// #7 斜杠面板：全角 ／（中文输入法形态）
// ---------------------------------------------------------------------------
await clearDoc()
await typeText('／') // 全角斜线 U+FF0F：旧代码在这里「没反应」
await sleep(300)
step('#7 全角 ／ 在新行行首弹出面板（中文输入法真实键位）', (await panelOpen()) === true, `panel=${await panelOpen()}`)

// 继续输入过滤词 + Enter：斜杠不残留、片段正确插入
await typeText('t')
await sleep(150)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await sleep(300)
const afterConfirm = await docText()
step('#7 Enter 插入表格片段且全角斜杠不残留', afterConfirm.includes('|') && !afterConfirm.includes('／'), `doc=${JSON.stringify(afterConfirm.slice(0, 40))}`)
step('#7 确认后面板关闭', (await panelOpen()) === false)

// 输入法兜底路径：不产生可匹配 keydown 时（composition/insertText），
// 全角字符直接落进文档 —— updateListener 反推开面板。
await clearDoc()
await ev(`document.querySelector('.cm-content').focus()`)
await send('Input.insertText', { text: '／' })
await sleep(300)
step('#7 输入法 insertText 落进文档的 ／ 也能弹出面板（兜底路径）', (await panelOpen()) === true, `panel=${await panelOpen()}`)
await tapEscape()

// 回归：半角 / 照旧弹出（修全角不能弄坏半角）
await clearDoc()
await typeText('/')
await sleep(250)
step('#7 回归：半角 / 仍弹出面板', (await panelOpen()) === true)
await tapEscape()

// ---------------------------------------------------------------------------
// #8 图片粘贴：Finder ⌘C 的 file URL（text/uri-list）
// ---------------------------------------------------------------------------
// 8a 文档未落盘：必须提示「先保存」而不是静默失败（验收单原文），
//    且不得调 Go、不得往文档里插任何东西。
await clearDoc()
await pasteWith([['text/uri-list', 'file:///Users/me/Pictures/%E6%88%AA%E5%9B%BE.png\n']])
await sleep(400)
const unsavedState = await ev(`(() => ({
  calls: window.__calls.saveImageFromPath.length,
  doc: window.__inkmark.editor.state.doc.toString(),
  // .focus-toast 有两个（专注模式 / 通用），querySelector 会命中常隐的第一个；
  // 必须按「当前可见」过滤才是真正弹给用户的那条。
  toast: [...document.querySelectorAll('.focus-toast')]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.textContent.trim())[0] || '',
}))()`)
step('#8 未落盘文档粘贴 → 提示「先保存」、不调 Go、文档不被插入',
  unsavedState.calls === 0 && unsavedState.doc === '' && unsavedState.toast.length > 0 && !/^toast\./.test(unsavedState.toast),
  JSON.stringify(unsavedState))

// 8b 经 ⌘O 打开一份文档（stub 对话框），filePath 落地
await keyWithMeta('o', 79)
const opened = await ev(`window.__inkmark.filePath`)
step('#8 前置：⌘O 打开文档后 filePath 非空', typeof opened === 'string' && opened.length > 0, `filePath=${opened}`)

// 8c file URL 粘贴 → Go 读盘落库 + 插入 ![](assets/…)
await pasteWith([['text/uri-list', 'file:///Users/me/Pictures/%E6%88%AA%E5%9B%BE.png\n']])
await sleep(500)
const pasteCalls = await ev(`window.__calls.saveImageFromPath`)
const docAfterPaste = await docText()
step('#8 file URL 粘贴 → Go SaveImageFromPath 收到解码后的本地路径',
  Array.isArray(pasteCalls) && pasteCalls.length === 1 && pasteCalls[0].srcPath === '/Users/me/Pictures/截图.png' && pasteCalls[0].docPath === '/tmp/probe-doc.md',
  JSON.stringify(pasteCalls))
step('#8 落盘后插入 ![](assets/…) 而不是文件名/URL 文本',
  docAfterPaste.includes('![](assets/probe-shot.png)') && !docAfterPaste.includes('file:///'),
  `doc=${JSON.stringify(docAfterPaste.slice(0, 60))}`)

// 8d 控制组：普通文本粘贴不被拦截（浏览器默认行为保留）
await ev(`window.__calls.saveImageFromPath.length = 0`)
await clearDoc()
await pasteWith([['text/plain', '普通正文粘贴']])
await sleep(300)
const docAfterText = await docText()
const callsAfterText = await ev(`window.__calls.saveImageFromPath.length`)
step('#8 回归：普通文本粘贴不拦截、不调 Go', docAfterText.includes('普通正文粘贴') && callsAfterText === 0,
  `doc=${JSON.stringify(docAfterText.slice(0, 30))} calls=${callsAfterText}`)

// ---------------------------------------------------------------------------
// #13 打印：⌘P 改走导出 PDF（window.print 在 WKWebView 是空操作）
// ---------------------------------------------------------------------------
await ev(`window.__calls.exportPdf.length = 0`)
await keyWithMeta('p', 80)
const pdfCalls = await ev(`window.__calls.exportPdf`)
step('#13 ⌘P 触发 Go ExportPDF（不再调 window.print 空操作）',
  Array.isArray(pdfCalls) && pdfCalls.length === 1 && pdfCalls[0].len > 100,
  JSON.stringify(pdfCalls?.map((c) => c.len)))

// ---------------------------------------------------------------------------
// （2026-10-14）原 #19/#20 阅读态 5 项断言已随阅读态移除整体退役，
// 渲染正确性由 tests/table-render.test.mjs + probe-wysiwyg.mjs 承接。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 控制组：console.error 与未捕获异常都必须为 0
// ---------------------------------------------------------------------------
step('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
step('无未捕获异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))

ws.close()
proc.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch {}

const failed = results.filter((r) => !r.pass)
console.log('')
console.log(`— 探针结果：${results.length - failed.length}/${results.length} 通过 —`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - ${f.name}  ${f.detail || ''}`)
  process.exit(1)
}
process.exit(0)
