//go:build darwin

package main

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework Foundation -framework PDFKit
#include <stdlib.h>
#include "export_pdf_darwin.h"
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ExportPDF 一键直出 PDF（ADR-003 路线 A′）：
// 弹系统保存对话框（用户取消返回空串、无错误）-> cgo 桥离屏渲染 -> 返回保存路径。
// 页数硬上限 500，超限由桥内显式报错并中止（禁止静默截断）。
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

	cHTML := C.CString(html)
	defer C.free(unsafe.Pointer(cHTML))
	cPath := C.CString(savePath)
	defer C.free(unsafe.Pointer(cPath))
	cTitle := C.CString(opts.DocTitle)
	defer C.free(unsafe.Pointer(cTitle))
	cDate := C.CString(opts.DateText)
	defer C.free(unsafe.Pointer(cDate))
	cLeft := C.CString(opts.Colors.DocName)
	defer C.free(unsafe.Pointer(cLeft))
	cRight := C.CString(opts.Colors.Date)
	defer C.free(unsafe.Pointer(cRight))
	cPageX := C.CString(opts.Colors.PageCur)
	defer C.free(unsafe.Pointer(cPageX))
	cPageN := C.CString(opts.Colors.PageTotal)
	defer C.free(unsafe.Pointer(cPageN))
	cFont := C.CString(opts.FontFamily)
	defer C.free(unsafe.Pointer(cFont))

	errBuf := make([]C.char, 512)
	rc := C.InkmarkRenderPDF(cHTML, cPath, cTitle, cDate, cLeft, cRight,
		cPageX, cPageN, cFont, &errBuf[0], C.int(len(errBuf)))
	if rc != 0 {
		msg := C.GoString(&errBuf[0])
		if msg == "" {
			msg = fmt.Sprintf("PDF 渲染失败（错误码 %d）", int(rc))
		}
		return "", fmt.Errorf("%s", msg)
	}
	return savePath, nil
}
