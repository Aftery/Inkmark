/**
 * probe-table-hint.mjs — 「表格没渲染」提示的交互探针（真实按键路径）
 * ---------------------------------------------------------------------------
 * 用途：验 render-check 与单元测试都覆盖不到的那一段 ——
 * **用户真的敲键盘打出缺分隔行的表格后，状态栏会不会真的冒出提示**。
 *
 * 为什么必须真浏览器：这整条链路的每一环都可能「静默失效」——
 *   1. checkTableHint 没被 onEditorUpdate 调到（少写一行，不报错）
 *   2. 语法树在真实编辑器里与无头构造的 state 表现不同
 *   3. 模块级 ref 没接上组件 → 状态栏永远不更新
 *   4. i18n key 拼错 → 界面显示 "statusbar.tableHint" 原文
 * 四种都不抛异常，141 条测试也照样全绿（本仓吃过两次假绿灯的亏）。
 *
 * 前置：先起 dev server（DEV 钩子只在 dev 下存在）：
 *   cd frontend && npx vite --port 5599 --strictPort
 * 再跑（另一终端）：
 *   node scripts/probe/probe-table-hint.mjs
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
const profile = mkdtempSync(join(tmpdir(), 'th-'))
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
    exceptions.push(m.params?.exceptionDetails?.exception?.description ?? 'unknown')
  }
})
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id
  pending.set(i, { res, rej })
  ws.send(JSON.stringify({ id: i, method, params }))
})
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description }
  return r.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_BASE })
await sleep(4500)

/** 读状态栏提示的可见文本（空串 = 没有提示） */
const readHint = () => ev(
  `(() => { const el = document.querySelector('.sb-hint'); return el ? el.textContent.trim() : '' })()`
)
/** 真实按键：逐字符 dispatchKeyEvent，走完整输入管线 */
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

const results = []
const step = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  →  ' + detail : ''}`)
}

// 0) 前置：提示初始应为缺席（示例文档的表格都是合法的）
step('初始无提示（示例文档表格合法）', (await readHint()) === '', `hint="${await readHint()}"`)

// 1) 点进编辑器，全选清空，然后真实敲入「缺分隔行」的表格
await ev(`(() => {
  const ed = document.querySelector('.cm-content')
  ed.focus()
  const view = window.__inkmark && window.__inkmark.editor
  if (!view) return 'no-editor'
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
  return 'ok'
})()`)
await sleep(200)
// Backspace 删除全部内容（走真实按键，不用 execCommand）
for (let i = 0; i < 260; i++) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })
  if (i % 40 === 39) await sleep(30)
}
await sleep(400)
step('清空后仍无提示', (await readHint()) === '', `doc="${await ev(`window.__inkmark.editor.state.doc.sliceString(0, 40)`)}"`)

// 2) 敲入用户截图里的那一段：两行管道、无分隔行
await typeText('|| ||\n|| ||')
await sleep(600)
const hintAfterBad = await readHint()
step('缺分隔行 → 状态栏冒出提示', hintAfterBad.length > 0, `hint="${hintAfterBad}"`)
step('提示不是 i18n key 原文（key 没拼错 / 字典缺 key）',
  hintAfterBad.length > 0 && !hintAfterBad.includes('statusbar.'),
  `hint="${hintAfterBad}"`)
step('提示带行号', /1/.test(hintAfterBad), `hint="${hintAfterBad}"`)

// 3) 改成合法表格 → 提示必须消失（提示不能变成常驻噪音）
//    【两处探针自身的坑，写在这里防止后人重犯】
//    a) 分隔行必须敲在**第 2 行**（表头正下方）。GFM 不认第 3 行 —— 早先本探针
//       写成「先敲两行、再补分隔行」，分隔行落到第 3 行，那仍不是合法表格，
//       提示继续显示才是正确行为，探针却报 FAIL。是探针写错，不是产品缺陷。
//    b) 不能在第 2 行行尾直接追加（光标在那儿），会得到 `|| ||| --- | --- |`
//       这种照样不合法的文本。故改成「清空 → 重敲一个完整合法表格」。
async function clearDoc() {
  await ev(`(() => {
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

await clearDoc()
await typeText('| a | b |\n| --- | --- |\n| c | d |')
await sleep(700)
const hintAfterFix = await readHint()
step('改成合法表格 → 提示消失', hintAfterFix === '', `hint="${hintAfterFix}"`)

// 4) 真实表格应当渲染：管道符被隐藏，证明解析器确实在工作。
//    【注意】光标所在行**及上下各 1 行**按设计显示源码（WYSIWYG 的「显形
//    判定」：编辑那一行时藏起管道符反而挡路）。整张表只有 3 行，光标无论放
//    哪一行都落在 ±1 的活跃范围内 —— 必须先在表格**之外**另起一段正文、
//    把光标挪进去，才能数到「非活跃行」。
await ev(`(() => {
  const view = window.__inkmark && window.__inkmark.editor
  if (!view) return 'no-editor'
  const len = view.state.doc.length
  view.dispatch({ changes: { from: len, insert: '\\n\\n这段正文在表格之外。' },
                  selection: { anchor: len + 12 } })
  return 'ok'
})()`)
await sleep(600)
const pipeVisible = await ev(`(() => {
  const text = document.querySelector('.cm-content').innerText
  return (text.match(/\\|/g) || []).length
})()`)
step('合法表格的非活跃行管道符已被 WYSIWYG 隐藏', pipeVisible <= 1, `可见管道符数=${pipeVisible}`)

// 5) 控制组：console.error 与未捕获异常都必须为 0
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