package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fileops_test.go — WriteFile / ListDir 的行为契约。
//
// 【为什么 WriteFile 值得一条并发测试】它是「自动保存」的落点，被 800ms 防抖
// 与手动 ⌘S 同时驱动，两次写入撞在一起是常态而非边缘场景。旧实现用固定名
// path+".tmp"，并发时后一次会截断前一次的临时文件，rename 之后落盘的是
// 「一半 A 一半 B」的混合内容 —— 而且不会有任何错误。这条测试钉住「并发写
// 之后文件仍是某一次完整写入的内容」。

// TestWriteFileAtomicRoundTrip 基本往返 + 不留临时文件。
func TestWriteFileAtomicRoundTrip(t *testing.T) {
	a := &App{}
	dir := t.TempDir()
	path := filepath.Join(dir, "doc.md")

	for _, content := range []string{"# v1\n", "# v2 内容\n", ""} {
		if err := a.WriteFile(path, content); err != nil {
			t.Fatalf("写入 %q 失败: %v", content, err)
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("读回失败: %v", err)
		}
		if string(got) != content {
			t.Fatalf("内容不一致: got %q want %q", string(got), content)
		}
	}

	// 目录里只应剩目标文件本身（临时文件必须已被 rename 或清理）
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "doc.md" {
			t.Fatalf("残留临时文件: %s", e.Name())
		}
	}
}

// TestWriteFileFileMode 落盘后权限应是 0644（CreateTemp 建的是 0600，需还原）。
func TestWriteFileFileMode(t *testing.T) {
	a := &App{}
	dir := t.TempDir()
	path := filepath.Join(dir, "mode.md")
	if err := a.WriteFile(path, "x"); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := st.Mode().Perm(); perm != 0o644 {
		t.Fatalf("权限 %o，期望 644", perm)
	}
}

// TestWriteFileConcurrentKeepsOneCompleteContent 并发写同一路径后，
// 落盘内容必须是**某一次**完整写入，不能是两次写入的碎片拼接。
func TestWriteFileConcurrentKeepsOneCompleteContent(t *testing.T) {
	a := &App{}
	dir := t.TempDir()
	path := filepath.Join(dir, "race.md")

	// 两份长度相同、内容不同的正文：截断/交错会产生既非 A 也非 B 的混合体
	bodyA := strings.Repeat("A", 4096)
	bodyB := strings.Repeat("B", 4096)

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := bodyA
			if i%2 == 1 {
				body = bodyB
			}
			if err := a.WriteFile(path, body); err != nil {
				t.Errorf("并发写失败: %v", err)
			}
		}(i)
	}
	wg.Wait()

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if string(got) != bodyA && string(got) != bodyB {
		t.Fatalf("落盘内容是混合体（长度 %d，首字节 %q）—— 并发写互相截断了临时文件",
			len(got), string(got[:1]))
	}

	// 并发结束后不应残留任何临时文件
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "race.md" {
			t.Fatalf("并发写后残留临时文件: %s", e.Name())
		}
	}
}

// TestListDirOrdering 目录在前、同组内按小写名升序；隐藏项与 node_modules 被跳过。
func TestListDirOrdering(t *testing.T) {
	a := &App{}
	dir := t.TempDir()
	for _, name := range []string{"b.md", "A.md", "c.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"zdocs", "adocs"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 应被跳过的项
	for _, name := range []string{".hidden", "node_modules"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := a.ListDir(dir)
	if err != nil {
		t.Fatalf("ListDir 失败: %v", err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name)
	}
	want := []string{"adocs", "zdocs", "A.md", "b.md", "c.txt"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("排序不符合契约:\n got %v\nwant %v", names, want)
	}
}
