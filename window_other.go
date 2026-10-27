//go:build !linux || !cgo

package main

// applyClientSideDecorations 在非 Linux 平台无对应动作：
// darwin 用系统红绿灯 + 透明标题栏，windows 的无边框由 Wails 直接生效。
//
// 也覆盖 linux 但 CGO_ENABLED=0 的组合：window_linux.go 依赖 cgo+GTK，该组合下
// 会被 Go 构建剔除，而 CI 的「交叉编译不腐烂」一步正是 CGO_ENABLED=0 GOOS=linux
// 编译 —— 若无本桩，app.go 的 startup() 调用直接 undefined（2026-10-26 实测）。
// 真机 Linux 一定带 cgo 构建，这里永远只是交叉编译门禁的编译期占位。
func applyClientSideDecorations() {}
