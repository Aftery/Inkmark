//go:build linux

package main

/*
void inkmarkApplyCSD(void);
*/
import "C"

// applyClientSideDecorations 让 GTK 进入 CSD 模式，避免 KWin（Wayland）在
// 自绘标题栏之上再叠一层服务端标题栏。缺陷与机制见 window_linux.c 文件头。
func applyClientSideDecorations() {
	C.inkmarkApplyCSD()
}
