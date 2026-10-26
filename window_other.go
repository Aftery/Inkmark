//go:build !linux

package main

// applyClientSideDecorations 在非 Linux 平台无对应动作：
// darwin 用系统红绿灯 + 透明标题栏，windows 的无边框由 Wails 直接生效。
func applyClientSideDecorations() {}
