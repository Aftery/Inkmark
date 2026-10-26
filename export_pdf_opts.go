package main

// export_pdf_opts.go — PDF 导出的跨平台公共部分（参数形状 + 默认文件名）
//
// 从 export_pdf_darwin.go 抽出：Linux 现在也走真正的「一键导出」（GTK 打印到
// 文件），两条实现必须用**同一份**契约形状与默认文件名规则，否则同一个文档
// 在两个平台导出的文件名不一样。

import "strings"

// PDFExportOpts 由前端序列化为 JSON 经 optsJson 传入（契约冻结形状）。
//
// 颜色 / 字体由前端按当前主题解析后传入，Go 与平台实现侧一律不硬编码任何 UI
// 颜色；主题映射（dark -> 强制 light，AC-19c）已由前端完成，Go 侧不感知主题。
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
