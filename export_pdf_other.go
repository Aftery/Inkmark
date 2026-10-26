//go:build !darwin && !linux

package main

import "fmt"

// ExportPDF 其他平台的一键直出降级（ADR-003 路线 A′ 依赖 WebKit/PDFKit）：
// 返回明确错误，由前端捕获后退回 window.print()（菜单项保持可用、不置灰）。
//
// linux 不走这里：它已有真正的「打印到文件」实现（export_pdf_linux.go），
// 用户点「导出 PDF」拿到的是文件，不是打印对话框。
func (a *App) ExportPDF(html string, optsJson string) (string, error) {
	return "", fmt.Errorf("当前平台不支持一键导出 PDF，请改用系统打印")
}
