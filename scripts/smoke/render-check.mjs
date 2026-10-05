// render-check.mjs — 真渲染冒烟（Spec §1.3 / §2.2 / AC-01 / AC-03）
//
// 职责：起零依赖静态服务 -> 无头 Chrome 加载构建产物 dist/ -> 断言真实 DOM 里
//       存在应用根节点（.main / .editor-host）且 setup 期无未捕获异常 / console.error
//       -> 退出码 0（通过）/ 1（失败）/ 2（本机无可用浏览器，如实报「未验证」）。
//
// 【为什么不用「进程存活」冒充】白屏时 WebView 进程照样活着；上一轮就是用
// `pgrep -x inkmark` 当冒烟，所以才把 TDZ 白屏放了过去（Spec §1.3）。
//
// 【三个踩过的坑，写死在这里】
//   1) dev 模式下模板会被 vite 编译进内联 <script>，直接搜 class 名会命中脚本源码
//      而不是真实 DOM —— 所以断言前必须先剥掉 <script>/<style>：
//        html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')
//      本脚本用 CDP 直接读 live DOM（document.querySelector）做权威判定，再对
//      剥壳后的 outerHTML 做字符串复核，两道都过才算渲染成功。
//   2) dev server 冷启动（依赖预优化）会产生假警报 —— 所以冒烟针对构建产物 dist/，
//      并轮询等待根节点出现（超时才算白屏），而不是加载完立刻判定。
//   3) zsh 会把 `--remote-allow-origins=*` 的星号当通配符（报 no matches found，
//      Chrome 起不来）—— 本脚本用 spawn 传参数数组、不经 shell，天然规避；
//      若手工在终端跑 Chrome，记得给星号加引号。
//
// 清理后台进程按端口：lsof -ti:<port> | xargs -r kill，绝不用 pkill -f "..." ——
// 后者会匹配到发起命令的那条 shell 自身，把执行命令的进程一起杀掉（零输出）。
import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { startStaticServer } from './serve-dist.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(HERE, '..', '..')
const DEFAULT_DIST = join(REPO, 'frontend', 'dist')
const APP_VUE = join(REPO, 'frontend', 'src', 'App.vue')

/**
 * 采集有效性的「预期噪声下限」：浏览器预览没有 Wails runtime，每个 safeEventsOn
 * 都会打印一条 `[menu] SKIP (no runtime)` warning。若一条都没有，说明 console
 * 采集通道本身坏了（例如被代理拦成 502），此时渲染结论不可信。
 * 下限从源码里数 safeEventsOn(' 调用数折算（取一半，容忍未来删掉部分诊断），
 * 源码不可读时退回保守常量。
 */
function menuWarnFloor() {
  try {
    const src = readFileSync(APP_VUE, 'utf8')
    const n = (src.match(/safeEventsOn\('/g) || []).length
    if (n > 0) return Math.max(10, Math.floor(n / 2))
  } catch { /* 源码不可读则用常量 */ }
  return 10
}

/** 子进程环境：剥掉代理变量，避免 127.0.0.1 被 HTTP_PROXY 拦成 502（实测踩过）。 */
function chromeEnv() {
  const env = { ...process.env }
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete env[k]
  }
  env.NO_PROXY = '127.0.0.1,localhost'
  env.no_proxy = '127.0.0.1,localhost'
  return env
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) || null
}

function getFreePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}

/** 目标 URL 可达性自检：返回 HTTP 状态码，请求失败返回 0。 */
async function preflight(url) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(timer)
    return res.status
  } catch {
    return 0
  }
}

/** 按端口清理残留进程（不用 pkill -f）。 */
function killByPort(port) {
  return new Promise((res) => {
    execFile('lsof', ['-ti', `:${port}`], (err, stdout) => {
      if (!err && stdout) {
        for (const pid of stdout.trim().split(/\s+/)) {
          try { process.kill(Number(pid), 'SIGKILL') } catch { /* 已退出 */ }
        }
      }
      res()
    })
  })
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = []
    ws.addEventListener('message', (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else ok(msg.result)
        return
      }
      for (const h of this.handlers) h(msg)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(fn) { this.handlers.push(fn) }
}

async function waitForPage(cdpPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* CDP 还没起来 */ }
    await sleep(150)
  }
  throw new Error(`等待 Chrome CDP 就绪超时（${timeoutMs}ms）`)
}

/** 核心：加载 url，等待 .main 出现，收集异常，返回判定结果。 */
async function runCheck({ chromePath, url, timeoutMs }) {
  const cdpPort = await getFreePort()
  const userDataDir = mkdtempSync(join(tmpdir(), 'inkmark-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--no-proxy-server', // 别让本机注入的 HTTP_PROXY 把 127.0.0.1 拦成 502
    `--remote-debugging-port=${cdpPort}`,
    '--remote-allow-origins=*', // 参数数组不经 shell，星号不会被 zsh 展开
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: chromeEnv() })

  let ws = null
  const exceptions = []
  const consoleErrors = []
  const consoleWarns = []
  try {
    const page = await waitForPage(cdpPort, timeoutMs)
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true })
      ws.addEventListener('error', bad, { once: true })
    })
    const cdp = new Cdp(ws)
    cdp.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        exceptions.push(`${d.exception?.description || d.text} @ ${d.url || ''}:${(d.lineNumber || 0) + 1}`)
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const line = msg.params.args.map((a) => a.description ?? a.value).join(' ')
        if (msg.params.type === 'error') consoleErrors.push(line)
        else if (msg.params.type === 'warning') consoleWarns.push(line)
      }
    })
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')
    await cdp.send('Page.navigate', { url })

    const evalValue = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })
      return r.result?.value
    }
    const hasMain = await (async () => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try { if (await evalValue('!!document.querySelector(".main")')) return true } catch { /* ctx 未就绪 */ }
        await sleep(200)
      }
      return false
    })()
    const hasEditor = !!hasMain && (await evalValue('!!document.querySelector(".editor-host")'))
    const html = (await evalValue('document.documentElement.outerHTML')) || ''
    // 坑 1：剥掉内联 <script>/<style> 再搜 class，避免命中脚本源码
    const dom = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
    const strMain = dom.includes('class="main"')
    const strEditor = dom.includes('editor-host')

    const menuWarns = consoleWarns.filter((w) => w.includes('[menu] SKIP')).length
    const floor = menuWarnFloor()
    // 采集有效性自检：根节点在、但预期噪声（[menu] SKIP）一条都没有
    // -> console 采集通道本身坏了（如被代理拦 502），此时不得采信渲染结论。
    const noiseSuspect = hasMain && menuWarns < floor
    const ok = hasMain && hasEditor && strMain && strEditor &&
      exceptions.length === 0 && consoleErrors.length === 0 && !noiseSuspect
    return {
      ok, url, hasMain, hasEditor, strMain, strEditor,
      exceptions, consoleErrors, consoleWarns, menuWarns, floor, noiseSuspect,
    }
  } finally {
    try { ws?.close() } catch { /* noop */ }
    try { chrome.kill('SIGKILL') } catch { /* noop */ }
    await killByPort(cdpPort)
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* noop */ }
  }
}

function report(r) {
  console.log(`[render-check] 加载的 URL：${r.url}`)
  console.log(
    `[render-check] 断言：.main=${r.hasMain} .editor-host=${r.hasEditor}` +
    ` | DOM 串含 class="main"=${r.strMain} 含 editor-host=${r.strEditor}`
  )
  console.log(`[render-check] 捕获到未捕获异常：${r.exceptions.length} 条`)
  r.exceptions.slice(0, 10).forEach((e) => console.log(`  ! ${e}`))
  console.log(`[render-check] 捕获到 console.error：${r.consoleErrors.length} 条`)
  r.consoleErrors.slice(0, 10).forEach((e) => console.log(`  ! ${e}`))
  if (r.consoleWarns.length) {
    console.log(`[render-check] console.warn（不影响判定）：${r.consoleWarns.length} 条`)
    r.consoleWarns.slice(0, 5).forEach((e) => console.log(`  . ${e}`))
  }
  console.log(
    `[render-check] 采集有效性自检：预期 [menu] SKIP 噪声下限 ${r.floor} 条，` +
    `实际 ${r.menuWarns} 条${r.noiseSuspect ? ' -> 可疑：噪声缺失，console 采集通道可能坏了' : ' -> OK'}`
  )
  console.log(r.ok ? '[render-check] PASS：应用根节点已渲染，setup 期无异常' : '[render-check] FAIL：未渲染出根节点 / 存在异常 / 采集可疑')
}

/** 造一个「必然白屏」的页面用于自证检测器真的能报红（不碰仓库里的 App.vue）。 */
function makeMutant() {
  const dir = mkdtempSync(join(tmpdir(), 'inkmark-mutant-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html><head><style>.main{color:red}</style></head>
<body><div id="app"></div>
<script>
  // 模拟 setup 期 TDZ：读取未初始化的 const -> ReferenceError -> 树不渲染
  var early = askInput;
  const askInput = function () {};
  window.__ok = !!document.querySelector('.main');
</script>
</body></html>`)
  return dir
}

async function main() {
  const argv = process.argv.slice(2)
  const argOf = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  const selfTest = argv.includes('--self-test')
  const externalUrl = argOf('--url', null)
  const distDir = argOf('--dir', DEFAULT_DIST)
  const timeoutMs = Number(argOf('--timeout', 8000))

  const chromePath = findChrome()
  if (!chromePath) {
    console.error('[render-check] 未验证：本机找不到可用的无头浏览器（Chrome/Chromium）。')
    console.error('[render-check] 绝不拿「构建通过」或「HTTP 200」冒充渲染验证 —— 请安装浏览器或用 CHROME_PATH 指定。')
    process.exit(2)
  }
  console.log(`[render-check] 浏览器：${chromePath}`)

  if (selfTest) {
    // 坑 2 自证：故意喂一个白屏页面，检测器必须报红，否则它抓不到 TDZ 这类 bug
    const dir = makeMutant()
    const server = await startStaticServer(dir, 0)
    let r
    try {
      r = await runCheck({ chromePath, url: `http://127.0.0.1:${server.port}/`, timeoutMs })
    } finally {
      await server.close()
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* noop */ }
    }
    report(r)
    if (!r.ok) {
      console.log('[render-check] SELF-TEST PASS：白屏反例被成功识别（检测器有效）')
      process.exit(0)
    }
    console.error('[render-check] SELF-TEST FAIL：白屏反例竟然被判通过，检测器不可信')
    process.exit(1)
  }

  let url = externalUrl
  let server = null
  if (!url) {
    if (!existsSync(join(distDir, 'index.html'))) {
      console.error(`[render-check] 未验证：${distDir} 下没有 index.html，请先跑 \`cd frontend && npm run build\`。`)
      process.exit(2)
    }
    server = await startStaticServer(distDir, 0)
    url = `http://127.0.0.1:${server.port}/`
  }
  console.log(`[render-check] 服务目录：${url === externalUrl ? '(外部 URL，未起本地服务)' : distDir}`)

  // 服务自检：目标 URL 必须真的返回 200，否则渲染结论无意义（本机代理坑：502）
  const status = await preflight(url)
  if (status !== 200) {
    console.error(`[render-check] 未验证：目标 URL 自检未返回 200（实际 ${status || '请求失败'}）—— 服务或代理有问题。`)
    await server?.close()
    process.exit(2)
  }
  console.log(`[render-check] 服务自检：HTTP ${status}`)

  let r
  try {
    r = await runCheck({ chromePath, url, timeoutMs })
  } finally {
    await server?.close()
  }
  report(r)
  process.exit(r.ok ? 0 : 1)
}

main().catch((err) => {
  console.error('[render-check] 运行失败：', err?.message || err)
  process.exit(1)
})
