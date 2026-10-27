package main

// export_pdf_opts.go — PDF 导出的跨平台公共部分（参数形状 + 默认文件名）
//
// 从 export_pdf_darwin.go 抽出：Linux 现在也走真正的「一键导出」（GTK 打印到
// 文件），两条实现必须用**同一份**契约形状与默认文件名规则，否则同一个文档
// 在两个平台导出的文件名不一样。

import (
	"net/url"
	"path/filepath"
	"strings"
)

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

// fileURIForDir 把文档目录转成 WebKit 的 base URI（相对路径图片据此解析）。
// 末尾斜杠不能省：没有它，最后一段会被当成文件名而不是目录。
//
// 从 export_pdf_linux.go 移来：它本身是纯 Go（不碰 C），住在 cgo 文件里会让
// 交叉编译门禁（CGO_ENABLED=0 GOOS=linux）下 linux 测试文件引用不到它 ——
// cgo 文件被整份剔除、测试文件却还在，vet 直接 undefined。纯逻辑住纯文件。
func fileURIForDir(dir string) string {
	if strings.TrimSpace(dir) == "" {
		return ""
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(dir) + "/"}
	return u.String()
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
