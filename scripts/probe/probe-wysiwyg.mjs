/**
 * probe-wysiwyg.mjs — headless 交互探针（CDP + Input.dispatchKeyEvent，真实按键路径）
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
// probe-wysiwyg.mjs — 验证表格 / 分割线 / 图片的 wysiwyg 装饰（一次性）
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
    const req = httpGet(url, (r) => { let b = ''; r.on('data', (c) => { b += c }); r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { rej(e) } }) })
    req.on('error', rej); req.setTimeout(3000, () => req.destroy(new Error('timeout')))
  })
}
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find((p) => existsSync(p))
if (!chrome) { console.log('NO_CHROME'); process.exit(2) }
const cdpPort = await new Promise((res) => { const s = createServer(); s.on('error', () => res(0)); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(); res(p) }) })
const profile = mkdtempSync(join(tmpdir(), 'wp-'))
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
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, b) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', b, { once: true }) })
let id = 0; const pending = new Map(); const logs = []
ws.addEventListener('message', (e) => {
  let m; try { m = JSON.parse(e.data) } catch { return }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || ''))
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
})
const send = (m2, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m2, params })) })
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description }; return r.result?.value }

await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate', { url: URL_BASE })
await sleep(4500)

// 塞入一份含表格 / 分割线 / 图片的文档
console.log('inject:', JSON.stringify(await ev(`(() => {
  const ed = window.__inkmark?.editor
  if (!ed) return { fail: 'no DEV hook' }
  const doc = [
    '# 装饰验证',
    '',
    '| 人物 | 身份 |',
    '| --- | --- |',
    '| 婴宁 | 狐仙 |',
    '',
    '---',
    '',
    '![示例图](https://example.com/a.png)',
    '',
  ].join('\\n')
  ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: doc }, selection: { anchor: 1 } })
  return { ok: true, lines: ed.state.doc.lines }
})()`)))
await sleep(1200)

console.log('decor:', JSON.stringify(await ev(`(() => {
  const cm = document.querySelector('.cm-content')
  if (!cm) return { fail: 'no cm-content' }
  return {
    hr: document.querySelectorAll('.cm-md-hr').length,
    hrBorder: (() => { const h = document.querySelector('.cm-md-hr'); return h ? getComputedStyle(h).borderTopWidth + ' ' + getComputedStyle(h).display : null })(),
    img: document.querySelectorAll('.cm-md-img').length,
    imgSrc: document.querySelector('.cm-md-img img')?.getAttribute('src') ?? null,
    tablePipesLeft: (cm.textContent.match(/\\|/g) || []).length,
    dashLeft: (cm.textContent.match(/^---$/gm) || []).length,
  }
})()`)))

console.log('logs:', JSON.stringify(logs.filter((l) => !l.includes('[vite]')).slice(-6)))
ws.close(); proc.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)