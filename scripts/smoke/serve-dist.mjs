// serve-dist.mjs — 零依赖静态服务器：把构建产物 dist/ 按真实 URL 结构对外提供。
//
// 用途：真渲染冒烟的宿主（render-check.mjs 里 import startStaticServer）。
// 也可独立运行：node scripts/smoke/serve-dist.mjs <distDir> <port>
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/**
 * 在 127.0.0.1 上启动静态服务器。
 * @param {string} dir 要对外提供的目录（构建产物 dist）
 * @param {number} [port] 端口；0 表示由系统分配
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export function startStaticServer(dir, port = 0) {
  const server = createServer(async (req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    } catch {
      res.writeHead(400); res.end('400'); return
    }
    // 目录穿越防护：normalize 后必须仍落在 dir 内
    const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '')
    const file = join(dir, rel)
    if (!file.startsWith(dir)) { res.writeHead(403); res.end('403'); return }
    try {
      const buf = await readFile(file)
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
      res.end(buf)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404')
    }
  })
  return new Promise((resolvePromise, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolvePromise({
        port: server.address().port,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

// 作为 CLI 直接运行
if (process.argv[1] && process.argv[1].endsWith('serve-dist.mjs')) {
  const dir = process.argv[2]
  const port = Number(process.argv[3] || 4321)
  if (!dir) {
    console.error('用法：node scripts/smoke/serve-dist.mjs <distDir> <port>')
    process.exit(2)
  }
  const { port: actual } = await startStaticServer(dir, port)
  console.log(`serving ${dir} on http://127.0.0.1:${actual}`)
}
