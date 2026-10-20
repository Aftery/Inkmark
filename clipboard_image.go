// clipboard_image.go — 通道③「系统剪贴板里有图片」的**平台无关**判定与类型嗅探
// ----------------------------------------------------------------------------
// 【为什么需要通道③】2026-10-15 真机复验：#8 图片粘贴仍然只粘进一个文件名。
//
// 上一轮（34db4b3）认定根因是「Finder ⌘C 给的是 file URL（text/uri-list）」，
// 并据此新增了 Go 的 SaveImageFromPath。**这个根因是错的**，真机上从没生效过：
//
//	实测剪贴板内容（osascript 'clipboard info'）= public.png / TIFF / JPEG 等**图片数据**，
//	**没有任何 file:// URL**；
//	而 WKWebView（Safari 内核）**不把剪贴板图片暴露给 clipboardData.files /
//	.items**，也不在 text/uri-list 里给 file:// —— 证据就是症状本身：
//	前端两条通道全部落空 → 事件被交回 WebKit 默认处理 → 默认行为是
//	**把文件名当纯文本插入**（截图里粘进来的正是 `1643208705644.jpg`）。
//
// 为什么探针 18/18 全绿却没抓到：scripts/probe 跑在**无头 Chrome**上，
// Chrome 的剪贴板实现与 WKWebView 不同（会给 files / file://）。
// **探针环境与真机剪贴板语义不一致 = 又一次「假绿灯」**（同 HANDOFF §4 ⑱⑲ 类）。
// 本仓的验证工具必须区分「浏览器内核」，不能默认 Chrome ≈ WebKit。
//
// 【为什么放在 Go 而不是前端】
// webview 里没有任何合法途径读系统剪贴板的**二进制图片**（fetch(file://) 被跨源拦死，
// navigator.clipboard.read() 在 WKWebView 无权限、且是异步的无法在 paste 事件里用）。
// 只有进程内的原生剪贴板 API 能拿到字节。
//
// 【本文件只放纯逻辑】IO 交给各平台适配层（clipboard_darwin.go /
// clipboard_linux.go / clipboard_windows.go），它们只负责「把字节取回来」。
// 判定「取回来的东西算不算图片 / 是什么格式」收敛在这里，
// 这样**格式嗅探与判定逻辑能被 Go 单测真覆盖**，而不依赖真机剪贴板状态。
package main

import (
	"bytes"
	"strings"
)

// ImageMagic 是嗅探出的一张图片：字节 + 扩展名。
type ImageMagic struct {
	// Data 是图片原始字节（已按平台适配层给出的格式统一，不做二次编码）。
	Data []byte
	// Ext 是小写扩展名（png / jpg / gif / webp / bmp / tiff…），供落盘命名。
	Ext string
}

// imageSignatures 是「魔数 → 扩展名」的嗅探表。
//
// 为什么必须嗅探而不是信平台给的 MIME/format 名：各平台适配层拿到的格式标识
// 口径完全不同（macOS 是 UTI public.png、Linux xclip 给的是文件扩展名、
// Windows 是 CF_DIBV5 无扩展名），若直接信任它们，一旦某平台报了个
// 不受支持的值，图片就会被静默丢弃 —— 这正是本仓最讨厌的失败形态。
// **以字节为准**，任何一方口径不一致都不会影响落盘。
//
// 偏移量对齐的是各格式**文件头**（magic number），不是容器内的段头。
var imageSignatures = []struct {
	// Ext 是命中后返回的扩展名（决定落盘文件名与后续 <img> 的解码器）。
	Ext string
	// Magic 是该格式的文件头字节序列。
	Magic []byte
	// Offset 是 Magic 出现在字节流中的起始位置（TIFF 的字节序标记不在 0 处）。
	Offset int
}{
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	{Ext: "png", Magic: []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, Offset: 0},
	// JPEG: FF D8 FF
	{Ext: "jpg", Magic: []byte{0xFF, 0xD8, 0xFF}, Offset: 0},
	// GIF: "GIF87a" / "GIF89a"
	{Ext: "gif", Magic: []byte("GIF8"), Offset: 0},
	// BMP: "BM"
	{Ext: "bmp", Magic: []byte("BM"), Offset: 0},
	// WEBP: "RIFF" + size(4) + "WEBP" —— 头尾两段都要校验，只匹配 RIFF 会
	// 把 WAV/AVI 误判成 webp（RIFF 容器家族共用前 4 字节）。
	{Ext: "webp", Magic: []byte("RIFF"), Offset: 0},
	// TIFF: 两种字节序标记 "II*\0" / "MM\0*"
	{Ext: "tiff", Magic: []byte{0x49, 0x49, 0x2A, 0x00}, Offset: 0},
	{Ext: "tiff", Magic: []byte{0x4D, 0x4D, 0x00, 0x2A}, Offset: 0},
	// AVIF / HEIC 都在 ISO-BMFF 容器里，判 ftyp brand
	{Ext: "avif", Magic: []byte("ftypavif"), Offset: 4},
	{Ext: "avif", Magic: []byte("ftypheic"), Offset: 4},
}

// svgSniffLimit 是 SVG 文本嗅探的字节上限：只读文件头判断，
// 避免为一个判断把几百 KB 的 SVG 全读进内存。
const svgSniffLimit = 1024

// webpRiffTypes 是「RIFF 容器里确实是 WEBP」的 4 字节标记（偏移 8）。
var webpRiffTypes = [][]byte{[]byte("WEBP")}

// sniffImageMagic 按魔数嗅探图片格式；不是图片则返回 nil。
//
// 这是本文件的核心，也是通道③唯一真正的「判据」：
// 平台适配层可以五花八门（不同 OS、不同命令、不同 MIME 名），
// 但只要字节不是已知图片格式，一律不落盘 —— 宁可少插一张图，
// 也不能把一段文本当图片写进 assets/ 目录。
func sniffImageMagic(data []byte) *ImageMagic {
	if len(data) == 0 {
		return nil
	}
	// SVG 是**文本**格式，没有二进制魔数，只能嗅探文件头。
	// 放在魔数表之后：若同一段字节既有 PNG 魔数又被判成 SVG 是不可能的，
	// 但顺序上让二进制格式优先，语义更清晰（截图工具给的是二进制）。
	if looksLikeSVG(data) {
		return &ImageMagic{Data: data, Ext: "svg"}
	}
	for _, sig := range imageSignatures {
		if len(data) < sig.Offset+len(sig.Magic) {
			continue
		}
		if !bytes.Equal(data[sig.Offset:sig.Offset+len(sig.Magic)], sig.Magic) {
			continue
		}
		// RIFF 家族必须二次确认容器类型（排除 WAV / AVI）
		if sig.Ext == "webp" {
			if !hasRiffType(data, webpRiffTypes) {
				continue
			}
		}
		return &ImageMagic{Data: data, Ext: sig.Ext}
	}
	return nil
}

// looksLikeSVG 判断字节是否是一份 SVG 文本（允许前导 BOM / 空白 / XML 声明 / 注释）。
func looksLikeSVG(data []byte) bool {
	head := data
	if len(head) > svgSniffLimit {
		head = head[:svgSniffLimit]
	}
	s := strings.TrimLeft(string(head), " \t\r\n")
	// 去掉 UTF-8 BOM（EF BB BF）：部分编辑器导出的 SVG 带 BOM，
	// 不去掉会导致根元素不是以 <svg 开头而被漏判。
	// 这里按字节切片而不是 strings.TrimPrefix("\uFEFF")：
	// 字面 BOM 字符在源码里不可见，容易被编辑器/工具悄悄改坏（本仓已因此踩过一次编译错）。
	if len(s) >= 3 && s[0] == 0xEF && s[1] == 0xBB && s[2] == 0xBF {
		s = s[3:]
	}
	// 跳过 XML 声明 <?xml ... ?> 与注释 <!-- ... -->（只各跳一次，避免病态输入）
	for _, prefix := range []string{"<?xml", "<!--", "<!doctype"} {
		if len(s) >= len(prefix) && strings.EqualFold(s[:len(prefix)], prefix) {
			rest := s[len(prefix):]
			if end := strings.Index(rest, ">"); end >= 0 {
				s = strings.TrimLeft(rest[end+1:], " \t\r\n")
			}
		}
	}
	// SVG 根元素必须以 <svg 开头（大小写不敏感），且不能是别的标签
	return len(s) >= 4 && strings.EqualFold(s[:4], "<svg")
}

// hasRiffType 检查 RIFF 容器偏移8 处的类型标记是否命中给定集合。
func hasRiffType(data []byte, want [][]byte) bool {
	const riffTypeOffset = 8
	if len(data) < riffTypeOffset+4 {
		return false
	}
	got := data[riffTypeOffset : riffTypeOffset+4]
	for _, w := range want {
		if bytes.Equal(got, w) {
			return true
		}
	}
	return false
}
