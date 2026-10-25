package main

// save_image_test.go — SaveImageFromPath 的「扩展名不可信」分支回归。
//
// 缺陷本体（2026-10-25 真机取证）：WebKitGTK 从文件管理器拖入的路径常常没有
// 扩展名（浏览器下载的图片就叫「Wallpaper Alchemy - Arch Linux 4K 壁纸」，
// 实际是 PNG）。旧实现按扩展名白名单直接拒绝 → 拖拽「什么都没发生」。
// 新实现：扩展名未知时读盘按字节嗅探；不是图片则静默返回空串。

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 最小 PNG 头（sniffImageMagic 只认魔数，不校验完整结构）
func pngHeader() []byte {
	return []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
}

func TestSaveImageFromPath_无扩展名按魔数嗅探为PNG(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "note.md")
	// 文件名带空格与中文、且**没有扩展名** —— 真机形态
	src := filepath.Join(dir, "Wallpaper Alchemy - Arch Linux 4K 壁纸")
	if err := os.WriteFile(src, pngHeader(), 0o644); err != nil {
		t.Fatal(err)
	}

	rel, err := (&App{}).SaveImageFromPath(doc, src)
	if err != nil {
		t.Fatalf("嗅探到 PNG 必须成功，实际错误: %v", err)
	}
	if !strings.HasPrefix(rel, "assets/img-") || !strings.HasSuffix(rel, ".png") {
		t.Fatalf("落盘路径必须是 assets/img-*.png，实际 %q", rel)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(rel))); err != nil {
		t.Fatalf("落盘文件不存在: %v", err)
	}
}

func TestSaveImageFromPath_无扩展名且不是图片_静默返回空(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "note.md")
	src := filepath.Join(dir, "readme")
	if err := os.WriteFile(src, []byte("这不是图片"), 0o644); err != nil {
		t.Fatal(err)
	}

	rel, err := (&App{}).SaveImageFromPath(doc, src)
	if err != nil {
		t.Fatalf("非图片不得报错（前端据此静默忽略），实际: %v", err)
	}
	if rel != "" {
		t.Fatalf("非图片不得落盘，实际返回 %q", rel)
	}
	if _, err := os.Stat(filepath.Join(dir, "assets")); !os.IsNotExist(err) {
		t.Fatal("非图片不得创建 assets/ 目录")
	}
}

func TestSaveImageFromPath_目录_静默返回空(t *testing.T) {
	dir := t.TempDir()
	rel, err := (&App{}).SaveImageFromPath(filepath.Join(dir, "note.md"), dir)
	if err != nil || rel != "" {
		t.Fatalf("拖入目录必须静默忽略，实际 rel=%q err=%v", rel, err)
	}
}
