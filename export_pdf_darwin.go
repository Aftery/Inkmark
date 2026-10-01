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
	"strings"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// PDFExportOpts 由前端序列化为 JSON 经 optsJson 传入（契约冻结形状）。
//
// 颜色 / 字体由前端按当前主题解析后传入，Go 与 ObjC 侧一律不硬编码任何 UI 颜色；
// 主题映射（dark -> 强制 light，AC-19c）已由前端完成，Go 侧不感知主题。
type PDFExportOpts struct {
	DocTitle   string `json:"docTitle"`
	DateText   string `json:"dateText"`
	FontFamily string `json:"fontFamily"` // 页眉页脚字体族（随主题，纸感走衬线）
	Colors     struct {
		DocName   string `json:"docName"`   // 页眉左（文档名）字色
		Date      string `json:"date"`      // 页眉右（日期）字色
		PageCur   string `json:"pageCur"`   // 页脚当前页码字色
		PageTotal string `json:"pageTotal"` // 页脚 "/ N 页" 字色
	} `json:"colors"`
}

// pdfExportDefaultName 由 docTitle 派生默认文件名（契约：defaultName 不再由前端传）：
// 替换文件系统非法字符、去首尾空白与点、超长截断；派生结果为空时用 export。
func pdfExportDefaultName(docTitle string) string {
	name := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_", "?", "_",
		"\"", "_", "<", "_", ">", "_", "|", "_",
		"\n", " ", "\r", " ", "\t", " ",
	).Replace(docTitle)
	name = strings.Trim(strings.TrimSpace(name), ".")
	runes := []rune(name)
	if len(runes) > 60 {
		name = string(runes[:60])
	}
	if name == "" {
		name = "export"
	}
	return name + ".pdf"
}

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
