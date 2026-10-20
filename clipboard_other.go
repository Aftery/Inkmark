//go:build !darwin && !linux && !windows

// clipboard_other.go — 通道③的平台兜底：无剪贴板读取能力的平台
//
// 存在的意义：让 readClipboardImageRaw 在**任何** GOOS 下
// 都有定义，避免「只有三个平台能编译」这种不必要的构建限制。
// 本实现恒返回空 —— 通道③自动退化为「不生效」，前端仍走原有两条通道，
// 行为与加通道③之前完全一致（**优雅降级，绝不报错**）。

package main

func readClipboardImageRaw() (pngBytes []byte, filePath string) { return nil, "" }
