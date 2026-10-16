// docassets.go — 「文档目录资源」的 webview 侧读盘服务（/doc-assets/ 前缀）
// ----------------------------------------------------------------------------
// 【为什么必须有这一层】Markdown 里的图片引用是文档相对路径（assets/x.png），
// 而 webview 的页面 origin 是应用自身的资源服务（wails://…）——相对路径会被
// 解析到**前端构建产物**的同名目录（404）。文档旁边的真实文件 webview 看不见，
// fetch(file://) 又被跨源策略拦死。唯一出路：前端把 src 改写成 /doc-assets/…
//（editor/assetUrl.js，改写口径唯一真源），内嵌资源 404 的请求落到这里的
// Handler（v2.16 assetserver.Options.Handler 语义：Assets miss 的 GET 都到这），
// 由 Go 按当前文档目录读盘返回。
//
// 【为什么 docDir 是「前端真源 → Go 镜像」】当前文档路径只有前端持有（与 dirty
// 同一族镜像，见 App.dirty 的裁决）；由 SetDocDir 写入，资源服务只读。
//
// 【安全边界】webview 是本应用自己的 UI，但资源服务仍按「最小信任」设防：
//   - 只放行 allowedImageExt 白名单内的扩展名（与图片落盘同一套口径）；
//   - 任何含 ".." 段或反斜杠的路径直接 404（目录穿越在 URL 解码后的 Path 上
//     判定，net/http 已把 %2e%2e 解码成 ".."，这里就是最终判定点）；
//   - filepath.Rel 二次校验落点确在文档目录内（防 join 后的形态意外）。
// 目录外的文件、目录内的非图片文件，一律 404 —— 与修复前「内嵌资源 miss」
// 的默认行为（StatusNotFound）完全一致，不新增任何可观测面。
package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// docAssetsPrefix 是文档目录资源的 URL 前缀。改写方在 editor/assetUrl.js，
// 两边必须一字不差（契约测试各占一头）。
const docAssetsPrefix = "/doc-assets/"

// SetDocDir 同步当前文档路径（前端 filePath 的镜像，见文件头）。
// 空串 = 未落盘文档：没有可解析的根，资源服务对一切请求 404。
func (a *App) SetDocDir(docPath string) {
	if docPath == "" {
		a.docDir.Store("")
		return
	}
	a.docDir.Store(filepath.Dir(docPath))
}

// docDirSnapshot 取当前文档目录；未同步过（Load 返回 nil）按空串处理。
func (a *App) docDirSnapshot() string {
	v, _ := a.docDir.Load().(string)
	return v
}

// DocAssetHandler 返回挂在 assetserver.Options.Handler 上的资源服务。
// 职责边界：只管「内嵌资源 miss 之后」的请求 —— 前缀命中则按文档目录读盘，
// 其余（前缀外 / 非 GET）复刻无 Handler 时的默认行为（404 / 405），
// 不改变现有任何路由的可观测行为。
func (a *App) DocAssetHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		if !strings.HasPrefix(r.URL.Path, docAssetsPrefix) {
			http.NotFound(w, r)
			return
		}
		full, ok := a.resolveDocAsset(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(full)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || st.IsDir() {
			http.NotFound(w, r)
			return
		}
		// ServeContent 按 Base 名的扩展名设置 Content-Type（svg → image/svg+xml），
		// 并顺带获得 Range / If-Modified-Since 等标准语义
		http.ServeContent(w, r, filepath.Base(full), st.ModTime(), f)
	})
}

// resolveDocAsset 把请求路径解析成文档目录内的绝对文件路径；
// 任何不在「文档目录内且为图片扩展名」形态的输入都返回 false（调用方 404）。
func (a *App) resolveDocAsset(urlPath string) (string, bool) {
	rel := strings.TrimPrefix(urlPath, docAssetsPrefix)
	if rel == "" || strings.Contains(rel, "\\") {
		return "", false
	}
	// Clean 归一化（去 . // 等）；穿越的**唯一承载性判据**是下面的 Rel 包含校验
	// ——「..」允许留到这一步统一裁定，不在前面散布第二个口径
	//（多口径会让变异自证失真：打掉一层还有别的层接住，红不了）。
	clean := path.Clean(rel)
	if clean == "." || clean == "/" {
		return "", false
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(clean), "."))
	if !allowedImageExt[ext] {
		return "", false
	}
	dir := a.docDirSnapshot()
	if dir == "" {
		return "", false
	}
	full := filepath.Join(dir, filepath.FromSlash(clean))
	// 承载性判据：落点必须在文档目录内。URL 解码（%2e%2e → ..）由 net/http
	// 在进入本函数前完成，这里看到的就是最终形态；Windows 上 Join 会把
	// Clean 漏掉的反斜杠形态归一化，Rel 同样裁定。
	inside, err := filepath.Rel(dir, full)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", false
	}
	return full, true
}
