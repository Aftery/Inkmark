//go:build windows

// clipboard_windows.go — 通道③的平台适配层（Windows）：从 Win32 剪贴板取图片
//
// ⚠️ **本文件未在真机验证**（开发机是 macOS，无 Windows 环境）。
//    与 clipboard_linux.go 同理：不确定即返回 nil，宁可少插不可插错。
//    首次在 Windows 真机验证后补记 docs/HANDOFF.md §7。
//
// 【为什么用 syscall 而不是 cgo】Windows 上剪贴板 API 本身就是 syscall 可达的
// （user32.dll 的 OpenClipboard/GetClipboardData），无需 cgo 桥接，
// 保持 CGO_ENABLED=0 也能构建（交叉编译友好）。
//
// 【剪贴板格式的坑】
//   - CF_DIB / CF_DIBV5：裸的 DIB，**不带文件头**。要还原成 PNG 必须自己拼一个
//     BITMAPFILEHEADER 放到 DIB 前面，否则任何解码器都认不出（表现为「图片损毁」）。
//   - 剪贴板里的 DIB 常常带 alpha 通道，若按 32bpp BI_RGB 硬解会得到黑底；
//     故这里统一按 BITMAPFILEHEADER + BI_BITFIELDS 处理并让上层走 PNG 落盘。
//   - CF_HDROP：复制的**文件**列表，与本项目 SaveImageFromPath 是同一条路，
//     优先于图片数据（保留原始文件、不经重编码）。
package main

import (
	"encoding/binary"
	"syscall"
	"unsafe"
)

// Win32 剪贴板常量。
const (
	cfUnicodeText = 13
	cfDIBV5       = 17
	cfDIB         = 8
	cfHDrop       = 15
)

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	shell32         = syscall.NewLazyDLL("shell32.dll")
	openClipboard   = user32.NewProc("OpenClipboard")
	closeClipboard  = user32.NewProc("CloseClipboard")
	getClipboardDat = user32.NewProc("GetClipboardData")
	globalLock      = kernel32.NewProc("GlobalLock")
	globalUnlock    = kernel32.NewProc("GlobalUnlock")
	globalSize      = kernel32.NewProc("GlobalSize")
	dragQueryFile   = shell32.NewProc("DragQueryFileW")
)

// clipboardLocked 表示已成功打开剪贴板；调用方必须保证配对 CloseClipboard。
func openClipboardForRead() bool {
	r, _, _ := openClipboard.Call(0)
	return r != 0
}

// getClipboardBytes 按格式号取剪贴板原始字节；不存在则返回 nil。
//
// 内存必须 GlobalLock → 拷进 Go 切片 → GlobalUnlock。
// **不能**把 Go 切片指针直接指向剪贴板内存：另一个进程随时可能改写它。
func getClipboardBytes(format uintptr) []byte {
	h, _, _ := getClipboardDat.Call(format)
	if h == 0 {
		return nil
	}
	size, _, _ := globalSize.Call(h)
	if size == 0 {
		return nil
	}
	p, _, _ := globalLock.Call(h)
	if p == 0 {
		return nil
	}
	defer globalUnlock.Call(h)

	out := make([]byte, int(size))
	copy(out, unsafe.Slice((*byte)(unsafe.Pointer(p)), int(size)))
	return out
}

// dibToPNGWithHeader 给裸 DIB 补上 BITMAPFILEHEADER，使字节成为合法的 BMP。
//
// 函数名保留历史措辞但实际产出是 **BMP**（补头后的裸 DIB 就是 BMP 文件去掉文件头的形态）：
// 目的是让 sniffImageMagic 能认出它（"BM" 魔数）并落盘为 .bmp，
// 像素格式交由浏览器 <img> 解码 —— 由解码器处理 alpha/色彩空间，比我们硬转 PNG 可靠。
func dibToPNGWithHeader(dib []byte) []byte {
	// BITMAPFILEHEADER：bfType(2) + bfSize(4) + reserved(4) + bfOffBits(4)
	const fileHeaderLen = 14
	if len(dib) < 12 {
		return nil
	}
	out := make([]byte, 0, fileHeaderLen+len(dib))
	hdr := make([]byte, fileHeaderLen)
	binary.LittleEndian.PutUint16(hdr[0:], 0x4D42) // "BM"
	binary.LittleEndian.PutUint32(hdr[2:], uint32(fileHeaderLen+len(dib)))
	// biSize 决定 bfOffBits：BITMAPINFOHEADER(40) 时为 14+40=54
	biSize := binary.LittleEndian.Uint32(dib[0:4])
	offBits := uint32(fileHeaderLen + biSize)
	binary.LittleEndian.PutUint32(hdr[10:], offBits)
	out = append(out, hdr...)
	out = append(out, dib...)
	return out
}

// readClipboardImageRaw 返回剪贴板里的图片字节与可能的文件路径。
func readClipboardImageRaw() (pngBytes []byte, filePath string) {
	if !openClipboardForRead() {
		return nil, ""
	}
	defer closeClipboard.Call()

	// ① 复制的文件（CF_HDROP）→ 路径，与 SaveImageFromPath 汇流
	if h, _, _ := getClipboardDat.Call(cfHDrop); h != 0 {
		if n, _, _ := dragQueryFile.Call(h, 0, 0, 0); n > 0 {
			buf := make([]uint16, n+1)
			if r, _, _ := dragQueryFile.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), n+1); r > 0 {
				filePath = syscall.UTF16ToString(buf[:])
			}
		}
	}

	// ② 图片数据：优先 DIBV5，退回 DIB
	for _, f := range []uintptr{cfDIBV5, cfDIB} {
		if raw := getClipboardBytes(f); len(raw) > 0 {
			if withHdr := dibToPNGWithHeader(raw); withHdr != nil {
				return withHdr, filePath
			}
		}
	}
	return nil, filePath
}

// readClipboardTextRaw 返回剪贴板纯文本（无则空串）。
// Windows 的 CF_UNICODETEXT 是 UTF-16LE，需成对解码。
func readClipboardTextRaw() string {
	if !openClipboardForRead() {
		return ""
	}
	defer closeClipboard.Call()

	raw := getClipboardBytes(cfUnicodeText)
	if len(raw) < 2 {
		return ""
	}
	u16 := make([]uint16, len(raw)/2)
	for i := range u16 {
		u16[i] = binary.LittleEndian.Uint16(raw[i*2:])
	}
	return syscall.UTF16ToString(u16)
}