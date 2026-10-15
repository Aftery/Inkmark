//go:build darwin

// clipboard_darwin.go — 通道③的平台适配层（macOS）：从 NSPasteboard 取图片字节
//
// 为什么用 cgo：WKWebView 里没有任何合法途径读到系统剪贴板的二进制图片
// （fetch(file://) 被跨源策略拦死；navigator.clipboard.read() 无权限且异步，
// 无法在 paste 事件里同步使用）。macOS 上唯一可靠的入口就是 AppKit 的
// NSPasteboard，Go 标准库不封装，必须 cgo。
//
// 【为什么实现放在 .m 文件】cgo 预处理器把 /* */ 内的代码当 **C** 编译，
// ObjC 语法（[NSPasteboard generalPasteboard]）必须由 clang 的 ObjC 模式处理。
// 故 ObjC 实现在 clipboard_darwin.m，本文件只通过 cgo 声明调用它。
// 该写法已由 /tmp/inkmark-cliprobe 探针实测可行（读到 public.png 并解出 604x229）。
//
// 【本文件的职责边界】只做 IO —— 「把剪贴板里的图片字节取出来」。
// 「这堆字节算不算图片、是什么格式」由 clipboard_image.go 的 sniffImageMagic 判定，
// 「落盘」由 app.go 的 writeImageAsset 完成。三层互不越界，
// 因此**判定逻辑是可单测的纯逻辑**，不依赖真机剪贴板状态。
package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
#include "clipboard_darwin.h"
*/
import "C"

import (
	"unsafe"
)

// readClipboardImageRaw 返回剪贴板里的图片字节（PNG 编码）与可能的文件路径。
// 任一为 nil 表示剪贴板里没有对应内容。
//
// macOS 上剪贴板**可以同时**有图片数据和文件引用（复制浏览器图片时两者并存），
// 两个都取回、由上层决定用哪个 —— 顺序上文件路径优先（保留原始格式，不经
// PNG 重编码损失质量），没有文件路径才用图片数据。
func readClipboardImageRaw() (pngBytes []byte, filePath string) {
	if p := C.ink_clipboard_file_path(); p != nil {
		defer C.free(unsafe.Pointer(p))
		filePath = C.GoString(p)
	}

	var length C.ulong
	buf := C.ink_clipboard_image_png(&length)
	if buf == nil || length == 0 {
		return nil, filePath
	}
	defer C.free(unsafe.Pointer(buf))

	// C 缓冲 → Go 切片：**必须拷贝**，不能 unsafe.Slice 直接指向 C 内存 ——
	// free 之后该切片即指向已释放内存（use-after-free）。
	out := make([]byte, int(length))
	copy(out, unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(length)))
	return out, filePath
}

// readClipboardTextRaw 返回剪贴板里的纯文本（无则空串）。
// 只用于「WebKit 把复制的文件塞成纯文件名」时的辅助判定，
// **绝不作为落盘依据** —— 真源永远是 sniffImageMagic 嗅探出的字节。
func readClipboardTextRaw() string {
	p := C.ink_clipboard_text()
	if p == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(p))
	return C.GoString(p)
}