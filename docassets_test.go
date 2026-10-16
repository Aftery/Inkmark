package main

// /doc-assets/ 资源服务的回归测试（docassets.go）。
//
// 为什么必须机检：这条链路的所有失败形态都是「404 但页面不报错」—— 编辑器与
// 预览各自把加载失败降级成碎图占位，静默得连 console.error 都没有（实测）。
// 判据在这里钉住的是**安全边界与解析语义**：目录穿越 / 白名单外扩展名 /
// 未同步文档目录，都必须落在 404；目录内白名单内的文件必须按正确
// Content-Type 读出来。改写口径的前端一头在 tests/asset-url.test.mjs。

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// serveDocAsset 起一个挂好 Handler 的测试服务，docDir 注入独立临时目录。
func serveDocAsset(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	app := &App{}
	dir := t.TempDir()
	app.SetDocDir(filepath.Join(dir, "笔记.md"))
	srv := httptest.NewServer(app.DocAssetHandler())
	t.Cleanup(srv.Close)
	return srv, dir
}

func get(t *testing.T, url string) *http.Response {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestDocAssetServesImageInsideDocDir(t *testing.T) {
	srv, dir := serveDocAsset(t)
	assets := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01}
	if err := os.WriteFile(filepath.Join(assets, "img-1.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	resp := get(t, srv.URL+"/doc-assets/assets/img-1.png")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("目录内图片应 200，得 %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "image/png" {
		t.Fatalf("Content-Type 应为 image/png，得 %q", ct)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("读响应体失败: %v", err)
	}
	if string(body) != string(png) {
		t.Fatal("响应体与磁盘字节不一致")
	}
}

func TestDocAssetBlocksTraversal(t *testing.T) {
	srv, dir := serveDocAsset(t)
	// 目录外的图片：无论怎么拼都不许读出来
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "outside.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		"/doc-assets/../outside.png",
		"/doc-assets/../../outside.png",
		"/doc-assets/%2e%2e/outside.png",
		"/doc-assets/assets/../../outside.png",
		`/doc-assets/assets\..\..\outside.png`,
	} {
		resp := get(t, srv.URL+p)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("穿越路径 %s 应 404，得 %d", p, resp.StatusCode)
		}
	}
}

func TestDocAssetRejectsNonImageExt(t *testing.T) {
	srv, dir := serveDocAsset(t)
	if err := os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if resp := get(t, srv.URL+"/doc-assets/secret.txt"); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("白名单外扩展名应 404，得 %d", resp.StatusCode)
	}
}

func TestDocAsset404WithoutDocDir(t *testing.T) {
	app := &App{} // 从未 SetDocDir（未落盘文档 / 启动初期）
	srv := httptest.NewServer(app.DocAssetHandler())
	defer srv.Close()
	if resp := get(t, srv.URL+"/doc-assets/assets/x.png"); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("未同步文档目录应 404，得 %d", resp.StatusCode)
	}
}

func TestDocAssetKeepsDefaultBehaviorOutsidePrefix(t *testing.T) {
	srv, _ := serveDocAsset(t)
	if resp := get(t, srv.URL+"/some/missing.html"); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("前缀外路径应保持默认 404，得 %d", resp.StatusCode)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/doc-assets/assets/x.png", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("非 GET 应 405（复刻无 Handler 时的默认行为），得 %d", resp.StatusCode)
	}
}

func TestSetDocDirMirrorsDocDirectory(t *testing.T) {
	app := &App{}
	if got := app.docDirSnapshot(); got != "" {
		t.Fatalf("未同步时应为空串，得 %q", got)
	}
	app.SetDocDir("/Users/aftery/Desktop/笔记.md")
	if got := app.docDirSnapshot(); got != "/Users/aftery/Desktop" {
		t.Fatalf("应镜像文档所在目录，得 %q", got)
	}
	app.SetDocDir("")
	if got := app.docDirSnapshot(); got != "" {
		t.Fatalf("空串应清空镜像（未落盘文档），得 %q", got)
	}
}

func TestDocAssetSvgContentType(t *testing.T) {
	srv, dir := serveDocAsset(t)
	svg := []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")
	if err := os.WriteFile(filepath.Join(dir, "logo.svg"), svg, 0o644); err != nil {
		t.Fatal(err)
	}
	resp := get(t, srv.URL+"/doc-assets/logo.svg")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("svg 应 200，得 %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "image/svg+xml") {
		t.Fatalf("svg 的 Content-Type 应为 image/svg+xml，得 %q", ct)
	}
}
