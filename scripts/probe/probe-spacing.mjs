/**
 * probe-spacing.mjs — 量「分割线上下间距」与「表格单元格拥挤」的真实几何
 * ---------------------------------------------------------------------------
 * 用途：用户反馈「分割线和下面内容太远」「表格里面内容太挤」这两条都是**观感**
 * 问题，靠读 CSS 只能猜。本探针把真实浏览器里的盒子几何（rect / computed padding /
 * 单元格列宽与折行数 / 行与行之间的空隙）全部量出来，作为「改前 / 改后」的对照
 * 证据，避免又靠「我觉得好看了」结案。
 *
 * 前置：先起 dev server（DEV 钩子只在 dev 下存在）：
 *   cd frontend && npx vite --port 5599 --strictPort
 * 再跑（另一终端）：
 *   node scripts/probe/probe-spacing.mjs
 *
 * env：
 *   PROBE_URL   默认 http://127.0.0.1:5599/
 *   PROBE_SHOT  截图输出路径（可选）
 *
 * 输出：JSON（stdout），含每个 .cm-line / block widget 的盒子与关键间距。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { get as httpGet } from 'node:http'

const URL_BASE = process.env.PROBE_URL || 'http://127.0.0.1:5599/'
const SHOT = process.env.PROBE_SHOT || ''
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
const profile = mkdtempSync(join(tmpdir(), 'sp-'))
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', '--no-proxy-server', `--remote-debugging-port=${cdpPort}`,
  '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--window-size=1440,1100', 'about:blank'],
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

// 复刻用户截图里的文档形态：H2 + 紧贴的 --- + 空行 + 两列表格（长描述）
const DOC = [
  '## 已实现能力',
  '---',
  '',
  '| 功能 | 实现 |',
  '|---|---|',
  '| Markdown 编辑 + 语法高亮 | CodeMirror 6（`src/editor/`），写作工具形态：无行号、无整行高亮；围栏代码块高亮与预览区共用同一套 `--hl-*` 色板 |',
  '| WYSIWYG 即时渲染（默认） | `src/editor/wysiwyg.js`：光标所在行及上下相邻 1 行显示 Markdown 源码，其余行呈现渲染效果 |',
  '| 任务列表勾选 | 点勾选框直接翻转 `[ ]` ⇄ `[x]`；渲染仍在 wysiwyg.js |',
  '',
  '分割线下面的正文。',
].join('\n')

const injected = await ev(`(() => {
  const ed = window.__inkmark?.editor
  if (!ed) return { fail: 'no DEV hook' }
  // 光标放到最后一行的行尾：让表格与分割线都不在「活跃行 ±1」范围内（否则显形源码）
  ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: ${JSON.stringify(DOC)} }, selection: { anchor: ${DOC.length} } })
  return { ok: true, lines: ed.state.doc.lines }
})()`)
await sleep(1500)

const measure = await ev(`(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }
  const cs = (el, ...props) => { if (!el) return null; const s = getComputedStyle(el); const o = {}; for (const p of props) o[p] = s[p]; return o }
  const hr = document.querySelector('.cm-md-hr')
  const hrLine = hr?.closest('.cm-line')
  const tableEl = document.querySelector('.cm-md-table')
  const table = tableEl?.querySelector('table')
  const firstBodyRow = table?.querySelector('tbody tr')
  const cells = firstBodyRow ? [...firstBodyRow.children] : []
  const head = table?.querySelector('thead tr')
  const content = document.querySelector('.cm-content')
  // 内容区直接子节点序列（CM 的 line + block widget 宿主都在这一层或再深一层）
  const walk = (root, depth = 0, out = []) => {
    for (const el of root.children) {
      out.push({ depth, tag: el.tagName, cls: el.className, text: (el.textContent || '').slice(0, 24), rect: r(el) })
      if (depth < 2) walk(el, depth + 1, out)
    }
    return out
  }
  const lineRects = [...content.querySelectorAll('.cm-line')].map((ln) => ({ text: (ln.textContent || '').slice(0, 20), rect: r(ln), cls: ln.className }))
  // hr 之后的第一个非空内容块（表格 widget 或正文行）
  const afterHr = hrLine ? [...content.querySelectorAll('.cm-line')].filter((ln) => ln.getBoundingClientRect().top >= hrLine.getBoundingClientRect().bottom - 0.5) : []
  const nextBlock = afterHr.find((ln) => ln.querySelector('.cm-md-table') || (ln.textContent || '').trim().length > 0) || null
  const hrRect = r(hr), hrLineRect = r(hrLine), nextRect = r(nextBlock)
  const tableRect = r(tableEl)
  return {
    viewport: { w: innerWidth, h: innerHeight },
    content: { rect: r(content), scroll: content.scrollHeight },
    hr: {
      found: !!hr,
      rect: hrRect,
      style: cs(hr, 'marginTop', 'marginBottom', 'height', 'borderTopWidth', 'display'),
      line: { rect: hrLineRect, style: cs(hrLine, 'lineHeight', 'paddingTop', 'paddingBottom', 'height') },
      gapToNextBlock: hrLineRect && nextRect ? +(nextRect.top - hrLineRect.bottom).toFixed(1) : null,
      gapBorderToNext: hrRect && nextRect ? +(nextRect.top - (hrRect.top + parseFloat(getComputedStyle(hr).borderTopWidth))).toFixed(1) : null,
      prevLine: hrLine ? r(hrLine.previousElementSibling) : null,
      nextLine: hrLine ? r(hrLine.nextElementSibling) : null,
      // 分割线行上下的空白总和（从上一行底到下一行顶）
      totalGapFromPrev: hrLine ? +((r(hrLine).top) - r(hrLine.previousElementSibling).bottom).toFixed(1) : null,
    },
    table: {
      rect: tableRect,
      style: cs(tableEl, 'marginTop', 'marginBottom'),
      innerTable: r(table),
      tableStyle: cs(table, 'tableLayout', 'borderCollapse', 'width'),
      cols: table ? [...table.querySelectorAll('thead th')].map((th) => r(th).w) : null,
      headCell: head ? { rect: r(head.children[0]), style: cs(head.children[0], 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'lineHeight', 'fontSize', 'minWidth', 'wordBreak', 'overflowWrap', 'whiteSpace') } : null,
      bodyCell: cells[0] ? { rect: r(cells[0]), style: cs(cells[0], 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'lineHeight', 'fontSize', 'wordBreak', 'overflowWrap', 'whiteSpace'), text: cells[0].textContent, lineCount: Math.round((r(cells[0]).h - 16) / parseFloat(getComputedStyle(cells[0]).lineHeight)) } : null,
      bodyCell2: cells[1] ? { rect: r(cells[1]), text: cells[1].textContent.slice(0, 40), lineCount: Math.round((r(cells[1]).h - 16) / parseFloat(getComputedStyle(cells[1]).lineHeight)) } : null,
      rowHeights: [...table.querySelectorAll('tr')].map((tr) => r(tr).h),
    },
    lineRects,
    dom: walk(content),
  }
})()`)
console.log(JSON.stringify({ injected, measure, logs: logs.filter((l) => !l.includes('[vite]')).slice(-8) }, null, 2))

if (SHOT) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  if (r?.data) writeFileSync(SHOT, Buffer.from(r.data, 'base64'))
}

ws.close(); proc.kill()
try { rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(0)
