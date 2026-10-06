/**
 * probe-slash.mjs — headless 交互探针（CDP + Input.dispatchKeyEvent，真实按键路径）
 * ---------------------------------------------------------------------------
 * 用途：复现 render-check 覆盖不到的**交互**缺陷（按键、面板、装饰、主题计算色）。
 * 为什么必须真浏览器：这几个缺陷全是「静默失败」——面板正常弹出但插入无效、
 * 装饰类一个不产出、prop 收到 Ref 对象，全都不抛异常，只有量真实 DOM 才知道。
 *
 * 前置：先起 dev server（DEV 钩子只在 dev 下存在）：
 *   cd frontend && npx vite --port 5599 --strictPort
 * 再跑（另一终端）：
 *   node scripts/probe/<name>.mjs
 *
 * 两个必须同时监听的 CDP 事件：Runtime.consoleAPICalled（Vue prop warning、
 * 守卫 warn）与 Runtime.exceptionThrown（插件崩溃）—— 漏掉任一个都会让
 * 缺陷静默通过。
 *
 * 注意：本机注入 HTTP_PROXY 会把 127.0.0.1 拦成 502，故用 node:http 而非 fetch
 * （Node 的 fetch 读进程启动时的 env 快照，改 process.env 无效）。
 */
// probe-slash.mjs — 一次性诊断探针（用完可删）
// 实测：在真实 CM6 里输入 '/' 后按 Enter，看面板是否开、confirm 是否生效。
// 打 dev server（DEV 钩子只在 dev 下存在），Node 22 内置 WebSocket 直连 CDP。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const URL_BASE = process.env.PROBE_URL || 'http://127.0.0.1:5599/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = { ...process.env }
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[k]

// 本机注入的 HTTP_PROXY 会把 127.0.0.1 拦成 502（本仓在 render-check 里踩过）。
// Node 的 fetch 读的是进程启动时的 env 快照，改 process.env 无效；
// 故这里用 node:http 直接取 JSON —— 它完全不看代理变量。
import { get as httpGet } from 'node:http'
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

const chrome = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find((p) => existsSync(p))
if (!chrome) { console.log('NO_CHROME'); process.exit(2) }

const freePort = () => new Promise((res) => {
  const s = createServer(); s.on('error', () => res(0))
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(); res(p) })
})

const cdpPort = await freePort()
const profile = mkdtempSync(join(tmpdir(), 'slashprobe-'))
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
  `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*',
  `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], env })

let page = null
const deadline = Date.now() + 20000
while (Date.now() < deadline && !page) {
  try {
    const list = await getJSON(`http://127.0.0.1:${cdpPort}/json/list`)
    page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  } catch { /* not up yet */ }
  if (!page) await sleep(150)
}
if (!page) { console.log('NO_PAGE'); proc.kill(); process.exit(3) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, bad) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', bad, { once: true }) })
let id = 0
const pending = new Map()
const logs = []
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data) } catch { return }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  }
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
})
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }))
})
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return r.result?.value
}

await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate', { url: URL_BASE })
await sleep(4500)

// 收集 console/异常，供诊断

console.log('setup:', JSON.stringify(await ev(`(() => {
  const ed = window.__inkmark?.editor
  if (!ed) return { fail: 'no DEV hook' }
  const n = ed.state.doc.length
  ed.dispatch({ changes: { from: n, insert: '\\n' }, selection: { anchor: n + 1 } })
  ed.focus()
  return { ok: true, focused: ed.hasFocus }
})()`)))

async function key(k, code, keyCode, text) {
  const b = { key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text } : {}), ...b })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...b })
}

await key('/', 'Slash', 191, '/')
await sleep(700)
console.log('afterSlash:', JSON.stringify(await ev(`(() => {
  const ed = window.__inkmark?.editor, p = document.querySelector('.slash-panel')
  return { tail: ed && JSON.stringify(ed.state.doc.toString().slice(-14)),
           open: !!p, items: p ? p.querySelectorAll('.slash-item').length : 0,
           active: p ? p.querySelector('.slash-item.active')?.textContent?.trim() : null,
           rect: p ? (r => ({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(p.getBoundingClientRect()) : null }
})()`)))

await key('Enter', 'Enter', 13, '\r')
await sleep(700)
console.log('afterEnter:', JSON.stringify(await ev(`(() => {
  const ed = window.__inkmark?.editor
  return { tail: ed && JSON.stringify(ed.state.doc.toString().slice(-30)),
           open: !!document.querySelector('.slash-panel') }
})()`)))

console.log('logs:', JSON.stringify(logs.slice(-10)))
ws.close(); proc.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)