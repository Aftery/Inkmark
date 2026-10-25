//go:build !linux

// clipboard_text_other.go — 文本剪贴板的非 Linux 实现：直接用 Wails 运行时。
//
// Linux 需要自实现的原因（GTK 剪贴板在 KDE Wayland 上读 XWayland 应用的选区
// 会得到空串）见 clipboard_linux.go 文件头；macOS / Windows 的运行时实现
// （NSPasteboard / Win32 clipboard）没有这个问题，保持原样。
package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func platformClipboardGetText(ctx context.Context) (string, error) {
	return runtime.ClipboardGetText(ctx)
}

func platformClipboardSetText(ctx context.Context, text string) error {
	return runtime.ClipboardSetText(ctx, text)
}
