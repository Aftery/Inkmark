//go:build linux

// clipboard_linux.go — 通道③的平台适配层（Linux）：从 X11/Wayland 剪贴板取图片
//
// ⚠️ **本文件未在真机验证**（开发机是 macOS，无 Linux 环境）。
//
//	这是本仓「静默失败」高发区，故实现刻意保守：
//	**任何不确定的情形一律返回 nil**，让调用方走原有通道（而不是报错或写坏文件）。
//	首次在 Linux 真机上验证后，应把结论补进 docs/HANDOFF.md §7 未决项。
//
// 【为什么需要它】见 clipboard_image.go 文件头：WKWebView/GTK WebKit 同样不把
// 剪贴板图片暴露给前端 clipboardData，Linux 上没有 AppKit 可用，只能靠外部命令。
//
// 【工具选择】X11 用 xclip，Wayland 用 wl-paste —— 二者是各自生态的标准工具。
// 用 exec 而非 cgo：GLib 的 clipboard API 需要事件循环上下文，
// 在 Go 里初始化代价与风险都远高于调一个现成命令。
package main

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

// clipboardToolTimeout 是外部命令的超时上限。
// 剪贴板读取是**同步阻塞在 paste 事件里**的：一个卡住的 xclip 会让编辑器
// 看起来「粘贴没反应」——正是本仓最厌恶的失败形态。故必须有硬超时。
const clipboardToolTimeout = 2 * time.Second

// runClipboardTool 跑一条取字节的命令，带硬超时。
// 只返回 stdout；任何错误、超时、空输出都返回 nil。
func runClipboardTool(name string, args ...string) []byte {
	ctx, cancel := context.WithTimeout(context.Background(), clipboardToolTimeout)
	defer cancel()

	path, err := exec.LookPath(name)
	if err != nil {
		return nil // 工具不存在 → 返回空，走原有通道
	}
	out, err := exec.CommandContext(ctx, path, args...).Output()
	if err != nil {
		return nil // 超时 / 非零退出 → 一律当作「取不到」
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// displayServerFromEnv 粗判当前是 X11 还是 Wayland。
// 两者都存在时优先 Wayland（wl-paste），XWayland 下 xclip 通常也能工作。
func displayServerFromEnv() string {
	if strings.TrimSpace(os.Getenv("WAYLAND_DISPLAY")) != "" {
		return "wayland"
	}
	if strings.TrimSpace(os.Getenv("DISPLAY")) != "" {
		return "x11"
	}
	return ""
}

// readClipboardImageRaw 返回剪贴板里的图片字节与可能的文件路径。
// 顺序：先试文件路径（保留原始格式），再试图片字节。
func readClipboardImageRaw() (pngBytes []byte, filePath string) {
	switch displayServerFromEnv() {
	case "wayland":
		// wl-paste：-l text 列出 MIME 类型；--list-types 只列类型不取内容
		if types := runClipboardTool("wl-paste", "--list-types"); types != nil {
			s := strings.ToLower(string(types))
			// 有文件 URI MIME → 取路径；退而求其次取 image/png 字节
			if strings.Contains(s, "x-special/gnome-copied-files") ||
				strings.Contains(s, "text/uri-list") {
				if out := runClipboardTool("wl-paste", "--no-newline"); out != nil {
					filePath = firstFilePath(string(out))
				}
			}
			if filePath == "" && strings.Contains(s, "image/png") {
				pngBytes = runClipboardTool("wl-paste", "--type", "image/png")
			}
		}
	case "x11":
		// xclip -selection clipboard：图片以 image/png 之类 MIME 暴露。
		// 取不到就是取不到 —— 不去猜 TARGETS，猜错会把非图片写进 assets/。
		if out := runClipboardTool("xclip", "-selection", "clipboard", "-t", "image/png", "-o"); out != nil {
			pngBytes = out
		}
	}
	return pngBytes, filePath
}

// firstFilePath 从 uri-list 文本里取出第一个 file:// 路径。
func firstFilePath(s string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "file://") {
			p := strings.TrimPrefix(line, "file://")
			// 本项目不引入全局 URL 解码依赖；仅去掉常见的 %20 空格编码
			p = strings.ReplaceAll(p, "%20", " ")
			return p
		}
	}
	return ""
}
