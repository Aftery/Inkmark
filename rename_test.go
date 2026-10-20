package main

import (
	"os"
	"path/filepath"
	"testing"
)

// rename_test.go — RenameFile 的边界契约。
//
// 【为什么值得测】旧实现只校验了 newName，没有校验 oldPath：
//   - oldPath 为空串时 filepath.Dir("") == "."，会在进程当前工作目录里造文件；
//   - oldPath 是目录时会把目录改名。
// 两者都是「绑定方法被直接调用」才会出现的路径（前端不会这么调），
// 但 Wails 绑定是公开入口，且这类越界写一旦发生没有任何报错提示 ——
// 属于本仓明确要拦的静默失效。

func newApp(t *testing.T) *App {
	t.Helper()
	return &App{}
}

// TestRenameFileRejectsBadOldPath oldPath 为空 / 不存在 / 是目录时必须报错且不动盘。
func TestRenameFileRejectsBadOldPath(t *testing.T) {
	a := newApp(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	if err := os.WriteFile(doc, []byte("# a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct{ name, oldPath, newName string }{
		{"空路径", "", "b.md"},
		{"纯空白路径", "   ", "b.md"},
		{"不存在的路径", filepath.Join(dir, "missing.md"), "b.md"},
		{"目录", sub, "renamed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got, err := a.RenameFile(c.oldPath, c.newName); err == nil {
				t.Fatalf("应拒绝（oldPath=%q），实得 %q", c.oldPath, got)
			}
		})
	}
	// 目录仍在原处（没被改名）
	if st, err := os.Stat(sub); err != nil || !st.IsDir() {
		t.Fatalf("目录被动了: err=%v", err)
	}
}

// TestRenameFileRejectsBadNewName newName 的各类非法形态。
func TestRenameFileRejectsBadNewName(t *testing.T) {
	a := newApp(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	if err := os.WriteFile(doc, []byte("# a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "   ", "x/y.md", `x\y.md`, ".", ".."} {
		if _, err := a.RenameFile(doc, bad); err == nil {
			t.Errorf("newName=%q 应被拒绝", bad)
		}
	}
	// 原文件必须还在
	if _, err := os.Stat(doc); err != nil {
		t.Fatalf("原文件被动了: %v", err)
	}
}

// TestRenameFileUnchangedNameIsRejected 改成本名（含 ./ 等价形态）不算有效操作。
func TestRenameFileUnchangedNameIsRejected(t *testing.T) {
	a := newApp(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	if err := os.WriteFile(doc, []byte("# a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 用带 ./ 前缀的等价路径，验证判等走 Clean 而不是原样字符串比较
	slashDoc := dir + string(os.PathSeparator) + "." + string(os.PathSeparator) + "a.md"
	if _, err := a.RenameFile(slashDoc, "a.md"); err == nil {
		t.Fatal("改成同一个名字应被拒绝")
	}
}

// TestRenameFileSuccess 正常路径：改名成功、返回新路径、内容不丢。
func TestRenameFileSuccess(t *testing.T) {
	a := newApp(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	const body = "# 原内容\n"
	if err := os.WriteFile(doc, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := a.RenameFile(doc, "b.md")
	if err != nil {
		t.Fatalf("改名失败: %v", err)
	}
	want := filepath.Join(dir, "b.md")
	if got != want {
		t.Fatalf("返回路径 %q，期望 %q", got, want)
	}
	data, err := os.ReadFile(want)
	if err != nil {
		t.Fatalf("新文件读不到: %v", err)
	}
	if string(data) != body {
		t.Fatalf("内容不一致: %q", string(data))
	}
	if _, err := os.Stat(doc); !os.IsNotExist(err) {
		t.Fatal("旧文件应已不存在")
	}
}

// TestRenameFileConflict 目标已存在时拒绝，且原文件不动。
func TestRenameFileConflict(t *testing.T) {
	a := newApp(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "a.md")
	dst := filepath.Join(dir, "b.md")
	for _, p := range []string{src, dst} {
		if err := os.WriteFile(p, []byte(p), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.RenameFile(src, "b.md"); err == nil {
		t.Fatal("目标已存在时应拒绝")
	}
	if data, err := os.ReadFile(dst); err != nil || string(data) != dst {
		t.Fatalf("目标文件被改动了: %q err=%v", string(data), err)
	}
}
