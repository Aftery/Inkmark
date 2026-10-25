//go:build linux

// clipboard_linux.go — Linux 剪贴板适配层：图片（通道③）+ 纯文本读写
//
// ⚠️ 2026-10-24 已在真机（KDE Wayland / KWin / wl-clipboard 2.2.1）验证：
//   wl-paste / wl-copy 的图片与文本通道全部跑通（含中文路径、XWayland 边界）。
//
// 【为什么文本读写也要绕开 Wails 默认实现】Wails v2 在 Linux 用 GTK3 的
// gtk_clipboard_wait_for_text 读剪贴板，实测在 KDE Wayland 上**不可靠**：
// 当剪贴板内容的所有者是 XWayland 应用时读出空串（GTK 的 Wayland 客户端走
// wl_data_device，经 XWayland 桥接的选区数据传输会失败），用户侧表现为
// 「复制后粘贴提示剪贴板为空」。wl-clipboard 走 wlr-data-control 协议，
// 不依赖焦点、跨 X11/Wayland 边界都可靠，且与本文件图片通道同一套工具链。
// 工具缺失时退回 Wails 默认实现（GTK）——宁可降级也不引入新的失败模式。
//
// 【工具选择】X11 用 xclip，Wayland 用 wl-paste / wl-copy —— 二者是各自生态的
// 标准工具。用 exec 而非 cgo：GLib 的 clipboard API 需要事件循环上下文，
// 在 Go 里初始化代价与风险都远高于调一个现成命令。
package main

import (
	"context"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// clipboardToolTimeout 是外部命令的超时上限。
// 剪贴板读取是**同步阻塞在 paste 事件里**的：一个卡住的 xclip 会让编辑器
// 看起来「粘贴没反应」——正是本仓最厌恶的失败形态。故必须有硬超时。
const clipboardToolTimeout = 2 * time.Second

// runClipboardTool 跑一条取字节的命令，带硬超时。
// 只返回 stdout；任何错误、超时、空输出都返回 nil。
func runClipboardTool(name string, args ...string) []byte {
	out, err := runClipboardToolStdin(name, nil, args...)
	if err != nil || len(out) == 0 {
		return nil // 与旧契约一致：空输出一律视为「取不到」
	}
	return out
}

// runClipboardToolStdin 同 runClipboardTool，但可附带 stdin（wl-copy / xclip -i 写剪贴板用）。
// 成败只看退出码：写剪贴板成功的输出是空的，无法按「空输出 = 失败」判定。
func runClipboardToolStdin(name string, stdin []byte, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), clipboardToolTimeout)
	defer cancel()

	path, err := exec.LookPath(name)
	if err != nil {
		return nil, err // 工具不存在 → 调用方决定降级路径
	}
	cmd := exec.CommandContext(ctx, path, args...)
	if stdin != nil {
		cmd.Stdin = strings.NewReader(string(stdin))
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, err // 超时 / 非零退出
	}
	return out, nil
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
			// 百分号解码必须完整（%E5%… 的中文路径只解 %20 会读不到文件）。
			// net/url 是标准库，无新增依赖；解码失败（% 后跟非法字符）时保留原样。
			if decoded, err := url.PathUnescape(p); err == nil {
				return decoded
			}
			return p
		}
	}
	return ""
}

// ---------- 纯文本剪贴板（app.go 的 ClipboardGet / ClipboardSet 在 Linux 的实现） ----------

// readClipboardText 读剪贴板纯文本；取不到返回空串（「空剪贴板」与「工具缺失」
// 都折叠成空串，由调用方决定是否再退回 GTK 实现）。
func readClipboardText() string {
	// --type text/plain 让 wl-clipboard 在多种文本 MIME（UTF8_STRING /
	// text/plain;charset=utf-8 …）之间做转换；剪贴板只有图片时该命令非零退出 → nil。
	tools := clipboardTextTools()
	for _, t := range tools {
		if out, err := runClipboardToolStdin(t.name, nil, t.args...); err == nil {
			return string(out)
		}
	}
	return ""
}

// writeClipboardText 写剪贴板纯文本。返回是否真的写成功（用于决定要不要
// 退回 GTK 实现）。
func writeClipboardText(text string) bool {
	for _, t := range clipboardWriteTools(text) {
		if _, err := runClipboardToolStdin(t.name, []byte(text), t.args...); err == nil {
			return true
		}
	}
	return false
}

type clipboardCmd struct {
	name string
	args []string
}

// clipboardTextTools 按当前显示服务器给出「读文本」命令的降级链。
// Wayland 优先 wl-paste（wlr-data-control：不依赖焦点、跨 XWayland 边界可读）；
// 无该工具时退回 xclip（XWayland 下 KDE 会桥接选区，通常仍可用）。
func clipboardTextTools() []clipboardCmd {
	switch displayServerFromEnv() {
	case "wayland":
		return []clipboardCmd{
			{"wl-paste", []string{"--no-newline", "--type", "text/plain"}},
			{"xclip", []string{"-selection", "clipboard", "-o", "-t", "text/plain;charset=utf-8"}},
		}
	case "x11":
		return []clipboardCmd{
			{"xclip", []string{"-selection", "clipboard", "-o", "-t", "text/plain;charset=utf-8"}},
			{"wl-paste", []string{"--no-newline", "--type", "text/plain"}},
		}
	}
	return nil
}

// clipboardWriteTools 同上，但给出「写文本」命令链。
// wl-copy / xclip -i 都会 fork 出一个驻留进程持有选区，写命令本身立即返回。
func clipboardWriteTools(text string) []clipboardCmd {
	switch displayServerFromEnv() {
	case "wayland":
		return []clipboardCmd{
			{"wl-copy", []string{"--type", "text/plain;charset=utf-8"}},
			{"xclip", []string{"-selection", "clipboard", "-t", "text/plain;charset=utf-8", "-i"}},
		}
	case "x11":
		return []clipboardCmd{
			{"xclip", []string{"-selection", "clipboard", "-t", "text/plain;charset=utf-8", "-i"}},
			{"wl-copy", []string{"--type", "text/plain;charset=utf-8"}},
		}
	}
	return nil
}

// ---------- app.go 的平台分发入口 ----------

// platformClipboardGetText：先走外部工具（可靠、免焦点），不可用时退回
// Wails 默认实现（GTK）。空串语义与 Wails 一致：剪贴板里没有文本。
func platformClipboardGetText(ctx context.Context) (string, error) {
	if displayServerFromEnv() != "" {
		if s := readClipboardText(); s != "" {
			return s, nil
		}
	}
	return runtime.ClipboardGetText(ctx)
}

// platformClipboardSetText：同上的写侧。
func platformClipboardSetText(ctx context.Context, text string) error {
	if displayServerFromEnv() != "" && writeClipboardText(text) {
		return nil
	}
	return runtime.ClipboardSetText(ctx, text)
}
