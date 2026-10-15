package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 端到端：真调 SaveImageFromClipboard，走完整 macOS 剪贴板 → NSPasteboard →
// 魔数嗅探 → assets/ 落盘链路。
//
// 【为什么需要它】单元测试用的是**构造字节**（手工拼 PNG 魔数），
// 它证明「给定这些字节会落盘」，但**证明不了**「macOS 剪贴板真能读到字节」。
// 而 2026-10-15 这次的真机失败恰恰出在「以为能读到、实际读不到」。
// 故必须有一条走真实系统剪贴板的验证。
//
// 【怎么用】本测试**只在剪贴板里真有图片时**才有断言力：
//
//	osascript -e 'set the clipboard to (POSIX file "/path/to/x.png")'
//	go test -run TestE2EClipboard
//
// 剪贴板为空 / 是文本时本测试直接 skip（不算失败）——CI 环境就是这样。
func TestE2EClipboard_真实剪贴板落盘(t *testing.T) {
	raw, filePath := readClipboardImageRaw()
	if raw == nil && filePath == "" {
		t.Skip("剪贴板里没有图片，跳过（CI/日常跑测试时属正常）")
	}
	t.Logf("剪贴板读到：%d 字节图片数据，filePath=%q", len(raw), filePath)

	doc := filepath.Join(t.TempDir(), "e2e.md")
	if err := os.WriteFile(doc, []byte("# e2e\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := &App{}
	rel, err := a.SaveImageFromClipboard(doc)
	if err != nil {
		t.Fatalf("端到端落盘失败: %v", err)
	}
	if rel == "" {
		t.Fatal("剪贴板里有图片，却返回空串（落盘链路断了）")
	}
	abs := filepath.Join(filepath.Dir(doc), rel)
	st, err := os.Stat(abs)
	if err != nil {
		t.Fatalf("返回了 %q 但文件不存在: %v", rel, err)
	}
	if st.Size() == 0 {
		t.Fatal("落盘文件为 0 字节")
	}
	t.Logf("端到端 OK: %s (%d 字节)", rel, st.Size())
}