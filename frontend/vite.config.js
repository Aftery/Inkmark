import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * /doc-assets/ 在 dev 模式下必须「装死」（404），让 Wails 把请求交给 Go。
 *
 * 【缺陷本体 · 2026-10-25 真机反馈「粘贴图片只显示 assets/… 占位框」】
 * 生产环境 origin 是 wails://，/doc-assets/ 不在内嵌产物里 ⇒ assets miss ⇒
 * docassets.go 的 Handler 按文档目录读盘，一切正常。dev 模式不同：Wails 的
 * assetserver 把 miss 的请求代理给 vite，而 vite 的 SPA fallback 对任意未知
 * 路径回 200 index.html（浏览器的 <img> 请求 Accept 里带 * / *，正好命中这条
 * 兜底）⇒ Wails 认为「资源命中」⇒ Handler 永远不被调用 ⇒ <img> 收到一段 HTML
 * ⇒ 解码失败 ⇒ 碎图占位。实测同一 URL：
 *   Accept: image/*        → 404（Go handler 接住，正确）
 *   Accept: image/*,* / *  → 200 text/html（浏览器真实请求，错误）
 *
 * 这里显式 404 制造「miss」：Wails 收到 404 后照旧走 assetserver 的 miss 分支，
 * 请求落到 DocAssetHandler（该分支在 2.16 已验证）。生产构建不受影响（apply: serve）。
 */
const docAssetsPassthrough = {
  name: 'inkmark:doc-assets-passthrough',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!/^\/doc-assets(?:\/|$)/.test(req.url || '')) return next()
      res.statusCode = 404
      res.end()
    })
  },
}

export default defineConfig({
  plugins: [vue(), docAssetsPassthrough],
  // wails dev 模式下把 /wails 的 IPC websocket 代理到 vite（可选，骨架先不配）
})
