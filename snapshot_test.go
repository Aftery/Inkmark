package main

// snapshot 的安全逻辑回归测试（永久版）。
//
// 背景：phaseC QA 跑过一轮临时 harness（docKey / 去重 / 轮转 / 路径穿越 /
// 10MB 上限 / 原子写），跑完已删 —— 之后这套判据零覆盖。本文件把它固化为
// 常驻测试，由 CI 的 `CGO_ENABLED=1 go test ./...` 收录。
//
// snapshotsBaseDir 是快照层的测试注入口：每个用例注入独立临时目录并还原，
// 不碰真实用户配置目录。用例间共享进程内全局，禁止 t.Parallel()。

import (
	"crypto/sha1"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withTempSnapshotDir 注入临时快照根目录，返回它；测试结束自动还原旧值。
func withTempSnapshotDir(t *testing.T) string {
	t.Helper()
	old := snapshotsBaseDir
	dir := t.TempDir()
	snapshotsBaseDir = dir
	t.Cleanup(func() { snapshotsBaseDir = old })
	return dir
}

// TestDocKeyDerivation 锁 docKey 的派生契约：sha1(Clean(absPath)) 前 16 位 hex。
// 前端不实现 sha1（防两端各算一份导致写入/读取目录不一致），此函数是唯一派生实现。
func TestDocKeyDerivation(t *testing.T) {
	sum := sha1.Sum([]byte(filepath.Clean("/tmp/docs/a.md")))
	want := hex.EncodeToString(sum[:])[:16]

	if got := docKeyOf("/tmp/docs/a.md"); got != want {
		t.Fatalf("docKeyOf(/tmp/docs/a.md) = %q, want %q", got, want)
	}
	// filepath.Clean 归一化：尾斜杠不改变派生结果
	if got := docKeyOf("/tmp/docs/a.md/"); got != want {
		t.Fatalf("尾斜杠未归一化: got %q, want %q", got, want)
	}
	if n := len(docKeyOf("x")); n != 16 {
		t.Fatalf("docKey 长度 = %d, want 16", n)
	}
	if docKeyOf("/tmp/docs/a.md") == docKeyOf("/tmp/docs/b.md") {
		t.Fatal("不同路径派生出相同 docKey")
	}
	for _, r := range docKeyOf("/tmp/docs/a.md") {
		if !strings.ContainsRune("0123456789abcdef", r) {
			t.Fatalf("docKey 含非小写 hex 字符: %q", docKeyOf("/tmp/docs/a.md"))
		}
	}
}

// TestSnapshotDedup 内容未变时跳过写入（不轮转掉旧版本）；
// 去重只与「最新一份」比对 —— 重写一份更早的内容仍应产生新快照。
func TestSnapshotDedup(t *testing.T) {
	withTempSnapshotDir(t)
	const doc = "/tmp/docs/dedup.md"

	if err := (&App{}).SnapshotWrite(doc, "v1"); err != nil {
		t.Fatalf("首次写入失败: %v", err)
	}
	// 与最新一份内容相同 → 跳过
	if err := (&App{}).SnapshotWrite(doc, "v1"); err != nil {
		t.Fatalf("重复写入报错: %v", err)
	}
	metas, err := (&App{}).SnapshotList(doc)
	if err != nil {
		t.Fatalf("SnapshotList 失败: %v", err)
	}
	if len(metas) != 1 {
		t.Fatalf("相同内容重复写入应去重，实得 %d 份", len(metas))
	}

	if err := (&App{}).SnapshotWrite(doc, "v2"); err != nil {
		t.Fatalf("写入 v2 失败: %v", err)
	}
	// 重写更早的 v1（最新一份是 v2，哈希不同）→ 必须产生新快照
	if err := (&App{}).SnapshotWrite(doc, "v1"); err != nil {
		t.Fatalf("重写 v1 失败: %v", err)
	}
	metas, err = (&App{}).SnapshotList(doc)
	if err != nil {
		t.Fatalf("SnapshotList 失败: %v", err)
	}
	if len(metas) != 3 {
		t.Fatalf("v1→v2→v1 应产生 3 份，实得 %d 份", len(metas))
	}
}

// TestSnapshotRotation 写第 11 份起淘汰最旧，任何时刻目录内 ≤10 份（AC-15）。
func TestSnapshotRotation(t *testing.T) {
	withTempSnapshotDir(t)
	const doc = "/tmp/docs/rotate.md"
	const total = 12

	contents := make([]string, total)
	for i := 0; i < total; i++ {
		contents[i] = "content-" + strings.Repeat("x", i+1) // 内容互异 → 哈希互异
		if err := (&App{}).SnapshotWrite(doc, contents[i]); err != nil {
			t.Fatalf("写入第 %d 份失败: %v", i+1, err)
		}
		metas, err := (&App{}).SnapshotList(doc)
		if err != nil {
			t.Fatalf("SnapshotList 失败: %v", err)
		}
		if len(metas) > snapshotMaxCount {
			t.Fatalf("第 %d 次写入后目录内有 %d 份，超过上限 %d", i+1, len(metas), snapshotMaxCount)
		}
	}

	metas, err := (&App{}).SnapshotList(doc)
	if err != nil {
		t.Fatalf("SnapshotList 失败: %v", err)
	}
	if len(metas) != snapshotMaxCount {
		t.Fatalf("应保留 %d 份，实得 %d", snapshotMaxCount, len(metas))
	}
	// 被淘汰的必须是最旧的 total-snapshotMaxCount 份；幸存内容 = 其后全部写入
	survived := map[string]bool{}
	for _, m := range metas {
		data, err := (&App{}).SnapshotRead(doc, m.Name)
		if err != nil {
			t.Fatalf("读回快照 %s 失败: %v", m.Name, err)
		}
		survived[data] = true
	}
	for i := 0; i < total-snapshotMaxCount; i++ {
		if survived[contents[i]] {
			t.Fatalf("最旧的 %q 应被淘汰，仍在", contents[i])
		}
	}
	for i := total - snapshotMaxCount; i < total; i++ {
		if !survived[contents[i]] {
			t.Fatalf("最新的 %q 应幸存，丢失", contents[i])
		}
	}
}

// TestSnapshotTraversalGuard 快照名是唯一的用户可控片段：
// 含路径分隔符 / ".." / 空串一律拒绝，"." 由「拼接结果必须仍落在快照目录内」
// 的双保险拦下（单看正则它合法）。
func TestSnapshotTraversalGuard(t *testing.T) {
	withTempSnapshotDir(t)
	const doc = "/tmp/docs/guard.md"
	if err := (&App{}).SnapshotWrite(doc, "v1"); err != nil {
		t.Fatalf("准备快照失败: %v", err)
	}

	bad := []string{"", "../evil.md", "..", "a/b.md", `a\b.md`, "snapshot-1.md/../../x"}
	for _, name := range bad {
		if _, err := (&App{}).SnapshotRead(doc, name); err == nil {
			t.Fatalf("SnapshotRead(%q) 应被拒绝，却成功了", name)
		}
	}
	// "." 过了正则与禁 ".." 两关，必须由目录前缀双保险兜住
	if _, err := (&App{}).SnapshotRead(doc, "."); err == nil {
		t.Fatal(`SnapshotRead(".") 应被双保险拒绝，却成功了`)
	}
	// 越界尝试不得在快照目录外留下任何文件
	if _, err := os.Stat(filepath.Join(snapshotsBaseDir, "evil.md")); err == nil {
		t.Fatal("路径穿越把文件写到了快照目录外")
	}

	// 合法名（来自 SnapshotList）可正常读回
	metas, err := (&App{}).SnapshotList(doc)
	if err != nil || len(metas) == 0 {
		t.Fatalf("SnapshotList 失败: %v", err)
	}
	if _, err := (&App{}).SnapshotRead(doc, metas[0].Name); err != nil {
		t.Fatalf("合法快照名读取失败: %v", err)
	}
}

// TestSnapshotSizeLimit 单份内容超 10MB：写入拒绝（目录不留文件），
// 读取同样拒绝（目录里手工植入的超限文件不外泄）。
func TestSnapshotSizeLimit(t *testing.T) {
	dir := withTempSnapshotDir(t)
	const doc = "/tmp/docs/limit.md"

	tooBig := strings.Repeat("a", snapshotMaxBytes+1)
	if err := (&App{}).SnapshotWrite(doc, tooBig); err == nil {
		t.Fatal("超过 10MB 的写入应被拒绝")
	}
	metas, err := (&App{}).SnapshotList(doc)
	if err != nil || len(metas) != 0 {
		t.Fatalf("被拒写入不应留文件，实得 %d 份（err=%v）", len(metas), err)
	}

	// 读取侧：手工植入一份超限文件（绕过写入校验），SnapshotRead 必须拒绝。
	// 超限写入在建目录之前就被拒，此时 docKey 目录尚不存在，需先补建。
	docDir := filepath.Join(dir, docKeyOf(doc))
	if err := os.MkdirAll(docDir, 0o755); err != nil {
		t.Fatalf("建快照目录失败: %v", err)
	}
	name := "snapshot-1234567890123.md"
	if err := os.WriteFile(filepath.Join(docDir, name), []byte(tooBig), 0o644); err != nil {
		t.Fatalf("植入超限文件失败: %v", err)
	}
	if _, err := (&App{}).SnapshotRead(doc, name); err == nil {
		t.Fatal("超限快照的读取应被拒绝")
	}
}

// TestSnapshotAtomicWrite 落盘走「临时文件 + rename」：成功后目录里
// 不残留 .tmp，内容可经 SnapshotRead 逐字读回；空白路径一律拒绝。
func TestSnapshotAtomicWrite(t *testing.T) {
	dir := withTempSnapshotDir(t)
	const doc = "/tmp/docs/atomic.md"

	if err := (&App{}).SnapshotWrite(doc, "# v1\n\n正文\n"); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, docKeyOf(doc)))
	if err != nil {
		t.Fatalf("读快照目录失败: %v", err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("原子写后仍残留临时文件: %s", e.Name())
		}
	}
	metas, err := (&App{}).SnapshotList(doc)
	if err != nil || len(metas) != 1 {
		t.Fatalf("应恰好 1 份快照（err=%v）", err)
	}
	got, err := (&App{}).SnapshotRead(doc, metas[0].Name)
	if err != nil {
		t.Fatalf("读回失败: %v", err)
	}
	if got != "# v1\n\n正文\n" {
		t.Fatalf("内容往返不一致: got %q", got)
	}

	// 空白路径（含纯空白）：写 / 列 / 读 / docKey 四个入口全拒绝
	for _, blank := range []string{"", "   "} {
		if err := (&App{}).SnapshotWrite(blank, "x"); err == nil {
			t.Fatalf("空白路径 %q 的 SnapshotWrite 应拒绝", blank)
		}
		if _, err := (&App{}).SnapshotList(blank); err == nil {
			t.Fatalf("空白路径 %q 的 SnapshotList 应拒绝", blank)
		}
		if _, err := (&App{}).SnapshotRead(blank, "a.md"); err == nil {
			t.Fatalf("空白路径 %q 的 SnapshotRead 应拒绝", blank)
		}
		if _, err := (&App{}).SnapshotDocKey(blank); err == nil {
			t.Fatalf("空白路径 %q 的 SnapshotDocKey 应拒绝", blank)
		}
	}
}
