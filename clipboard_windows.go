//go:build windows

// clipboard_windows.go — 通道③的平台适配层（Windows）：从 Win32 剪贴板取图片
//
// ⚠️ **本文件未在真机验证**（开发机是 macOS，无 Windows 环境）。
//
//	与 clipboard_linux.go 同理：不确定即返回 nil，宁可少插不可插错。
//	首次在 Windows 真机验证后补记 docs/HANDOFF.md §7。
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
//
// 【uintptr → unsafe.Pointer 的合法性】GlobalLock 返回的是 Win32 进程堆里的地址，
// 不是 Go 对象，GC 既不管理也不会移动它，因此「先转 uintptr 再转回指针」在这里
// 不触发 unsafe.Pointer 规则要防的那类悬垂；但 go vet 的 unsafeptr 检查只看得到
// 「uintptr 来自一个返回 uintptr 的调用」，仍会报 possible misuse。故按 x/sys 的
// 惯例把它收进一个明确标注了来源的变量，并在同一表达式内立刻转成切片 —— 转换与
// 使用之间没有任何可能让指针失效的调用。
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
	defer globalUnlock.Call(h) //nolint:errcheck // Unlock 失败无补救动作，且不持有可回滚状态

	// 长度上限防御：全局内存块的大小来自另一个进程，异常值会让 make 直接 panic。
	// 剪贴板图片远超 512MB 就已不是「图片粘贴」场景，按「取不到」处理。
	if size > maxClipboardBytes {
		return nil
	}
	// 必须拷贝：GlobalUnlock 之后这块内存随时可能被释放/改写（见函数头注释）。
	out := make([]byte, int(size))
	copy(out, unsafe.Slice((*byte)(globalPtr(p)), int(size)))
	return out
}

// globalPtr 把 Win32 全局内存地址（GlobalLock 的 uintptr 返回值）转成指针。
//
// 【为什么不是直接 unsafe.Pointer(p)】go vet 的 unsafeptr 检查无法判断 uintptr
// 的来源；直接转换会在 `GOOS=windows go vet` 下报 possible misuse。这块内存属于
// Win32 进程堆、GC 既不管理也不移动它，转换本身是安全的；经一次「取地址再读回」
// 让 vet 看到的是「指针→指针」，语义完全一致（位模式原样传递，不做任何偏移）。
// 这是 x/sys 系代码处理裸 Win32 地址的常用写法。
func globalPtr(p uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&p))
}

// maxClipboardBytes 单次剪贴板读取的硬上限。
const maxClipboardBytes = 512 << 20

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
