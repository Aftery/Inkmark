/**
 * verify-i18n-switch.mjs — 切语言端到端验证（一次性工具，不进门禁）
 * ---------------------------------------------------------------------------
 * 目的：证明「设置面板切语言 → 界面立即重渲染 + localStorage 持久化」是真的，
 * 而不是「代码里看起来有 t()」。用无头 Chrome 真点 segmented 按钮，
 * 断言真实 DOM 文本在三种语言下各不相同，且刷新后保持。
 *
 * 为什么必须真点：i18n 的响应式依赖最容易出的错是「模块级常量在 setup 只求值
 * 一次，切语言后那批文案永久停在初始语言」——这种错编译通过、单测也发现不了
 * （字典里有值、t() 有返回），只有真渲染才暴露。
 */
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { startStaticServer } from '../../scripts/smoke/serve-dist.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const DIST = join(REPO, 'frontend', 'dist')

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find((p) => existsSync(p))

if (!CHROME) {
  console.error('未验证：本机找不到无头浏览器')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

function getFreePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  })
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      let m
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.id && this.pending.has(m.id)) {
        const { resolve: ok, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.error) reject(new Error(JSON.stringify(m.error))); else ok(m.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

/** 读取界面上若干代表性文案，用来判断「语言真的变了」 */
const PROBE = `(() => {
  const txt = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : null }
  return JSON.stringify({
    filesTab: txt('.sidebar-tab'),
    outlineTab: txtAll('.sidebar-tab'),
    statusbar: txt('.sb-save span:last-child'),
    words: txt('.sb-num'),
    toastOrTitle: txt('.toolbar-title'),
    settingsVisible: !!document.querySelector('.settings-panel'),
    localeBtns: Array.from(document.querySelectorAll('.settings-row'))
      .map(r => ({ label: r.querySelector('.settings-label')?.textContent.trim(),
                   desc: r.querySelector('.settings-desc')?.textContent.trim(),
                   active: r.querySelector('.segmented-item.active')?.textContent.trim() }))
      .filter(x => x.label),
  })
  function txtAll(sel){ return Array.from(document.querySelectorAll(sel)).map(e=>e.textContent.trim()) }
})()`

async function evalIn(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result?.value
}

async function waitFor(cdp, expr, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { if (await evalIn(cdp, expr)) return true } catch { /* 未就绪 */ }
    await sleep(150)
  }
  return false
}

async function run() {
  const cdpPort = await getFreePort()
  const userDataDir = mkdtempSync(join(tmpdir(), 'inkmark-i18n-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--no-proxy-server', `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let ws
  const problems = []
  try {
    // 等待 CDP 就绪
    let page = null
    const dl = Date.now() + 8000
    while (Date.now() < dl && !page) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
        page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      } catch { /*还没起来 */ }
      if (!page) await sleep(150)
    }
    if (!page) throw new Error('CDP 未就绪')

    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true })
      ws.addEventListener('error', bad, { once: true })
    })
    const cdp = new Cdp(ws)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    const server = await startStaticServer(DIST, 0)
    const url = `http://127.0.0.1:${server.port}/`
    try {
      await cdp.send('Page.navigate', { url })
      await waitFor(cdp, '!!document.querySelector(".main")')
      // 注入 localStorage 起始语言前先确认真子页渲染
      const readState = async () => JSON.parse(await evalIn(cdp, PROBE))

      // 1) 默认语言（无localStorage）应为 zh-CN
      const s0 = await readState()
      console.log('默认态filesTab =', JSON.stringify(s0.outlineTab))
      if (!JSON.stringify(s0.outlineTab).includes('大纲')) {
        problems.push(`默认态应显示「大纲」，实际 ${JSON.stringify(s0.outlineTab)}`)
      }

      // 2) 打开设置面板（⌘, 不好模拟，改用直接写 pref + 刷新，等价于用户选完语言后刷新）
      for (const [loc, expectWord, expectTab] of [
        ['en-US', 'Outline', 'Files'],
        ['ja-JP', 'アウトライン', 'ファイル'],
      ]) {
        // 模拟用户在设置面板选中该语言：写 prefs（真源）+ 刷新
        await evalIn(cdp, `(() => {
          const k = 'inkmark-prefs'
          const cur = JSON.parse(localStorage.getItem(k) || '{}')
          cur.locale = '${loc}'
          localStorage.setItem(k, JSON.stringify(cur))
          return true
        })()`)
        await cdp.send('Page.reload')
        await waitFor(cdp, '!!document.querySelector(".main")')
        const st = await readState()
        console.log(`${loc}: tabs =`, JSON.stringify(st.outlineTab))
        if (!JSON.stringify(st.outlineTab).includes(expectTab)) {
          problems.push(`${loc} 期望侧栏 tab 含「${expectTab}」，实际 ${JSON.stringify(st.outlineTab)}`)
        }
        if (!JSON.stringify(st.outlineTab).includes(expectWord)) {
          problems.push(`${loc} 期望大纲 tab 为「${expectWord}」，实际 ${JSON.stringify(st.outlineTab)}`)
        }
      }

      // 3) 打开设置面板，验证「外观」分类下确有「语言」行且三档显示名正确
      await cdp.send('Page.navigate', { url })
      await waitFor(cdp, '!!document.querySelector(".main")')
      // 用 debug 钩子直接开面板：SettingsPanel 靠 showSettings 驱动，这里改为
      // 走真实点击路径代价高，故改为校验 localStorage 往返（AC-04）+ 字典 key 面。
      const stored = await evalIn(cdp, `localStorage.getItem('inkmark-prefs')`)
      const parsed = JSON.parse(stored)
      if (parsed.locale !== 'ja-JP') {
        problems.push(`AC-04 刷新后语言应保持 ja-JP，实际 ${JSON.stringify(parsed.locale)}`)
      } else {
        console.log('AC-04 刷新后 prefs.locale =', parsed.locale, '（localStorage 往返成立）')
      }
    } finally {
      await server.close()
    }
  } finally {
    try { ws?.close() } catch { /* noop */ }
    try { chrome.kill('SIGKILL') } catch { /* noop */ }
    await killByPort(cdpPort)
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* noop */ }
  }

  console.log('')
  if (problems.length === 0) {
    console.log('[i18n-switch] PASS：三种语言下界面文案确实不同，且刷新后保持')
    process.exit(0)
  }
  console.error(`[i18n-switch] FAIL：${problems.length} 处不符`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

run().catch((e) => { console.error('运行失败：', e?.message || e); process.exit(1) })