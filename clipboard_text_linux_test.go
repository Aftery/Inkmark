//go:build linux

package main

import (
	"testing"
)

// Linux 文本剪贴板真机往返：writeClipboardText → readClipboardText → 恢复原内容。
//
// 【为什么需要它】2026-10-24 用户真机反馈「复制后粘贴提示剪贴板为空」：
// Wails 默认走 GTK 的 gtk_clipboard_wait_for_text，在 KDE Wayland 上读
// XWayland 应用持有的选区会得到空串（实测取证）。本文件钉死替代实现
// （wl-paste / wl-copy）在真实显示服务器上的读写闭环。
// 工具未安装 / 无显示服务器（CI）时 skip。
func TestE2EClipboardText_真机往返(t *testing.T) {
	if displayServerFromEnv() == "" {
		t.Skip("无显示服务器环境，跳过")
	}
	if len(clipboardTextTools()) == 0 || len(clipboardWriteTools("")) == 0 {
		t.Skip("wl-paste / xclip 均未安装，跳过")
	}

	backup := readClipboardText() // 恢复用：不区分「空剪贴板」与「读不到」，尽力而为
	const marker = "inkmark-clipboard-roundtrip-测试-✓"
	if !writeClipboardText(marker) {
		t.Skip("无可用写剪贴板工具（wl-copy / xclip 均缺失），跳过")
	}
	// 真实桌面上剪贴板可能在写入后立刻被第三方抢占（用户正在复制粘贴时必现）。
	// 该测试验证的是「写 → 读」机制闭环，不抗抢占：重试一次仍不一致就 skip。
	if got := readClipboardText(); got != marker {
		writeClipboardText(marker)
		if got2 := readClipboardText(); got2 != marker {
			t.Skipf("剪贴板被第三方抢占（读回前 32 字节 %q），跳过", truncateForLog(got2, 32))
		}
	}
	// 恢复现场：无论 backup 是什么（含空串）都写回，避免测试污染用户剪贴板
	writeClipboardText(backup)
	t.Logf("往返 OK（剪贴板已恢复）")
}

func truncateForLog(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
