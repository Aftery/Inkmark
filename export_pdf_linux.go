//go:build linux

package main

// export_pdf_linux.go — Linux 一键导出 PDF（GTK 打印到文件，无系统对话框）
//
// 与 darwin 的实现（export_pdf_darwin.go）保持同一份对外契约：
//   ExportPDF(html, optsJson) → (保存路径, error)
// 用户取消保存对话框返回 ("", nil)；渲染/打印失败返回 error（前端据此提示，
// 不再退化成打印对话框 —— Linux 已经有真正的导出了）。
//
// 实现细节与「为什么不是 window.print()」见 export_pdf_linux.c 文件头。

/*
#cgo pkg-config: gtk+-3.0 webkit2gtk-4.1
#include <stdlib.h>
void inkmarkStartExportPDF(const char *html, const char *path, const char *base_uri);
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// fileURIForDir 把文档目录转成 WebKit 的 base URI（相对路径图片据此解析）。
// 末尾斜杠不能省：没有它，最后一段会被当成文件名而不是目录。
func fileURIForDir(dir string) string {
	if strings.TrimSpace(dir) == "" {
		return ""
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(dir) + "/"}
	return u.String()
}

// pdfExportState 串行化导出：GTK 的打印流程是单实例的，并发调用会互相踩。
// done 只承载一次结果（缓冲 1，回调不会阻塞主线程）。
var pdfExportState struct {
	mu   sync.Mutex
	busy bool
	done chan error
}

//export inkmarkExportPDFDone
func inkmarkExportPDFDone(_ *C.char, errMsg *C.char) {
	var err error
	if errMsg != nil {
		err = fmt.Errorf("%s", C.GoString(errMsg))
	}
	pdfExportState.mu.Lock()
	ch := pdfExportState.done
	pdfExportState.mu.Unlock()
	if ch != nil {
		select {
		case ch <- err:
		default:
		}
	}
}

// ExportPDF 一键直出 PDF（Linux 实现）：
// 弹系统保存对话框（取消返回空串、无错误）→ 离屏 WebView 加载导出 HTML →
// GTK 虚拟打印机「打印到文件」写成 PDF → 返回保存路径。
func (a *App) ExportPDF(html string, optsJson string) (string, error) {
	if html == "" {
		return "", fmt.Errorf("导出内容为空，已中止")
	}
	var opts PDFExportOpts
	if optsJson != "" {
		if err := json.Unmarshal([]byte(optsJson), &opts); err != nil {
			return "", fmt.Errorf("导出参数解析失败: %w", err)
		}
	}

	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出 PDF",
		DefaultFilename: pdfExportDefaultName(opts.DocTitle),
	})
	if err != nil {
		return "", fmt.Errorf("保存对话框打开失败: %w", err)
	}
	if savePath == "" {
		// 用户在保存对话框点了取消，视为正常中断而非错误
		return "", nil
	}
	if err := a.exportPDFToFile(savePath, html); err != nil {
		return "", err
	}
	return savePath, nil
}

// exportPDFToFile 是「路径已确定」之后的纯渲染部分（保存对话框之外）：
// 离屏 WebView 加载导出 HTML，GTK 虚拟打印机写成 PDF，等到 finished/failed。
// 单独拆出来是为了能在不弹对话框的前提下测试（见 export_pdf_linux_test.go）。
func (a *App) exportPDFToFile(savePath, html string) error {
	pdfExportState.mu.Lock()
	if pdfExportState.busy {
		pdfExportState.mu.Unlock()
		return fmt.Errorf("已有导出任务正在进行中")
	}
	pdfExportState.busy = true
	done := make(chan error, 1)
	pdfExportState.done = done
	pdfExportState.mu.Unlock()
	defer func() {
		pdfExportState.mu.Lock()
		pdfExportState.busy = false
		pdfExportState.done = nil
		pdfExportState.mu.Unlock()
	}()

	cHTML := C.CString(html)
	defer C.free(unsafe.Pointer(cHTML))
	cPath := C.CString(savePath)
	defer C.free(unsafe.Pointer(cPath))
	// 相对路径图片的基准：当前文档目录（未落盘的文档没有目录，传空串）
	cBase := C.CString(fileURIForDir(a.docDirSnapshot()))
	defer C.free(unsafe.Pointer(cBase))

	C.inkmarkStartExportPDF(cHTML, cPath, cBase)
	return <-done
}
