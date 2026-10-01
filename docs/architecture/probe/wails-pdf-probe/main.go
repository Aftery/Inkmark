package main

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework Foundation -framework PDFKit
#include <stdlib.h>
#include "pdfbridge.h"
*/
import "C"

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"unsafe"
)

func buildHTML(paragraphs int) string {
	var b strings.Builder
	b.WriteString(`<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; }
  h1 { color: #4F46E5; }
  h2 { page-break-before: always; }
  .box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
</style></head>
<body>
  <h1>Inkmark PDF 探针</h1>
  <div class="box"><p>验证 WKWebView 能否在进程内直接产出 PDF。</p>
  <p>Chinese: 中文排版 / 标点，测试字形嵌入。</p></div>
`)
	for i := 0; i < paragraphs; i++ {
		fmt.Fprintf(&b, "<h2>章节 %d</h2><p>这是用于测试分页的第 %d 段。%s</p>\n",
			i+1, i+1, strings.Repeat("内容填充测试。", 40))
	}
	b.WriteString("</body></html>")
	return b.String()
}

func main() {
	runtime.LockOSThread()

	mode := "A"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	paras := 0
	if len(os.Args) > 2 {
		fmt.Sscanf(os.Args[2], "%d", &paras)
	}
	html := buildHTML(paras)
	out := fmt.Sprintf("/tmp/pdfprobe/%s_p%d.pdf", mode, paras)

	htmlC := C.CString(html)
	outC := C.CString(out)
	defer C.free(unsafe.Pointer(htmlC))
	defer C.free(unsafe.Pointer(outC))
	_ = os.Remove(out)

	var rc int
	switch mode {
	case "A":
		rc = int(C.RenderHTMLToPDF(htmlC, outC))
	case "B0":
		rc = int(C.RenderHTMLToPDFPrint(htmlC, outC, 0))
	case "B1":
		rc = int(C.RenderHTMLToPDFPrint(htmlC, outC, 1))
	case "B2":
		rc = int(C.RenderHTMLToPDFPrint(htmlC, outC, 2))
	case "B3":
		rc = int(C.RenderHTMLToPDFPrintB3(htmlC, outC))
	case "AR1": // A4 第 1 页区域
		rc = int(C.RenderHTMLToPDFRect(htmlC, outC, 0, 0, 595, 842))
	case "AR2": // A4 第 2 页区域
		rc = int(C.RenderHTMLToPDFRect(htmlC, outC, 0, 842, 595, 842))
	case "PAG": // 逐页渲染 + PDFKit 合并
		rc = int(C.RenderHTMLToPDFPaginated(htmlC, outC, 595, 842))
	default:
		fmt.Println("mode must be A|B0|B1|B2|B3|AR1|AR2|PAG")
		os.Exit(2)
	}
	fi, err := os.Stat(out)
	size := int64(-1)
	if err == nil {
		size = fi.Size()
	}
	fmt.Printf("[%s p=%d] rc=%d size=%d file=%s\n", mode, paras, rc, size, out)
}
