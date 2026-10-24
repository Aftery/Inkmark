// assetUrl.js — 文档相对图片路径 → webview 可加载 URL 的唯一改写口
// ----------------------------------------------------------------------------
// 【为什么必须有这一步】webview 的页面 origin 是应用自身的资源服务，Markdown
// 里的相对路径 `assets/x.png` 会被解析到**前端构建产物**的同名目录（404）；
// 文档旁边的真实文件 webview 看不见，fetch(file://) 又被跨源策略拦死。
// 改写成 /doc-assets/… 后，由 Go 侧 DocAssetHandler（docassets.go）按当前
// 文档目录读盘返回。前缀常量两边必须一字不差（Go 测试 docassets_test.go
// 与前端 tests/asset-url.test.mjs 各守一头）。
//
// 【导出为什么不改写】落盘的 HTML 与文档同级，浏览器按磁盘相对路径加载
// assets/ 反而是对的 —— 所以 render() 默认不改写，只有预览面开 resolveAssets
// （useEditorSession 的 previewHtml；导出 HTML/PDF 用 exportHtml）。
//
// 【为什么模块级状态而不是传参】消费方是 wysiwyg 的 ImageWidget.toDOM 与
// markdown-it 的 image 规则，两者都不持有会话态，传参要凿穿装饰/渲染两层。
// 同步点在 useEditorSession：watch(filePath, …, { flush: 'sync' }) 在赋值的
// 同一行完成同步，不存在「渲染早于状态」的竞态（打开文件的 setState 排在
// 赋值之后，装饰构建时状态已就位）。

let hasDocDir = false
// 上一次同步进来的路径：只用来判断「是否真的变了」。改写口径本身只取决于
// hasDocDir（有目录 / 没目录），但「变了」这个事实是图片装饰的刷新依据 ——
// 见 assetContext.js（路径变化不产生事务，装饰不会自己重算）。
let docPath = ''

/**
 * 文档路径变化时由 assetContext.applyDocPath 调用（**唯一同步点**）；
 * 空串 = 未落盘。
 * @param {string} p
 * @returns {boolean} 路径是否真的变了 —— 变了才需要重建图片装饰
 */
export function setDocPath(p) {
  const next = typeof p === 'string' ? p : ''
  if (next === docPath) return false
  docPath = next
  hasDocDir = Boolean(next)
  return true
}

/**
 * 把 Markdown 图片的 src 改写成 webview 可加载的 URL。
 * data:/blob:/http(s):/wails: 与 origin 绝对路径一律原样；未落盘文档没有
 * 可解析的根，原样返回（编辑器照常渲染为碎图占位，与改写前一致）。
 */
export function resolveAssetSrc(src) {
  if (!src || !hasDocDir) return src
  if (/^(data:|blob:|https?:|wails:)/i.test(src)) return src
  if (src.startsWith('/')) return src
  const rel = src.replace(/^\.\//, '')
  // 逐段编码：文件名可能含空格 / 中文；已编码的 % 会变 %25（双重编码），
  // 本应用生成的图片名不含 %，手写带 % 的路径属边缘场景，宁可 404 也不
  // 在渲染层猜测用户意图
  return '/doc-assets/' + rel.split('/').map(encodeURIComponent).join('/')
}
