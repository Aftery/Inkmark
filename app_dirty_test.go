// app_dirty_test.go —— Go 侧逐文档 dirty 映射（ADR-005 §四）
// ============================================================================
// 【守的是什么】关闭窗口的拦截判定。多标签后若仍用一个布尔量，两份文档的落盘状态
// 会挤进同一个字段；漏掉某个文档的脏标记 = 关窗口不弹确认 = **静默丢稿**。
// 判据打在「逐文档映射」的行为上，不是「SetDirty 能存进去」。
package main

import "testing"

// TestAnyDirtyAcrossDocs 锁「任一文档脏 ⇒ anyDirty 为真」与「全清才为假」。
// 单文档下的 `a.dirty` 布尔量在多文档场景会漏判，这条就是它的替身。
func TestAnyDirtyAcrossDocs(t *testing.T) {
	a := NewApp()
	if a.anyDirty() {
		t.Fatal("空映射时 anyDirty() 必须为 false")
	}

	a.SetDirty("t1", true)
	if !a.anyDirty() {
		t.Fatal("t1 脏时 anyDirty() 必须为 true")
	}

	// 第二个文档进来：**不得**因为「不是当前文档」就被忽略
	a.SetDirty("t2", true)
	if !a.anyDirty() {
		t.Fatal("t2 也脏时 anyDirty() 必须为 true")
	}

	// 清掉一个，另一个还脏着 ⇒ 仍须为真（单布尔量在此处会误判成假、放行关闭）
	a.SetDirty("t1", false)
	if !a.anyDirty() {
		t.Fatal("t1 已清但 t2 仍脏，anyDirty() 必须仍为 true —— 此处误判即静默丢稿")
	}

	a.SetDirty("t2", false)
	if a.anyDirty() {
		t.Fatal("全部清干净后 anyDirty() 必须为 false")
	}
}

// TestForgetDocRemovesEntry 锁「标签关闭后映射条目要摘掉」。
// 不摘的后果：用户关掉一个脏标签（已确认不保存）后，它的脏标记还留在映射里，
// 关窗口会被一个**已经不存在的文档**拦住。
func TestForgetDocRemovesEntry(t *testing.T) {
	a := NewApp()
	a.SetDirty("t1", true)
	a.SetDirty("t2", true)

	a.ForgetDoc("t1")
	if len(a.dirtyByDoc) != 1 {
		t.Fatalf("ForgetDoc 后应只剩 1 条，实际 %d 条", len(a.dirtyByDoc))
	}
	if !a.anyDirty() {
		t.Fatal("t2 还脏着，anyDirty() 必须为 true")
	}

	a.ForgetDoc("t2")
	if a.anyDirty() {
		t.Fatal("全部 Forget 后 anyDirty() 必须为 false")
	}
}

// TestDirtyKeyOf 锁「未落盘文档的键不得与已落盘文档的 docKey 相撞」。
// 未落盘用 "u:"+tabId 独立命名空间，与 16 位 hex 的 docKey 不相交 ——
// 若相撞，一个未落盘标签的脏标记会污染另一份已落盘文档。
func TestDirtyKeyOf(t *testing.T) {
	// 未落盘：原样透传
	if got := dirtyKeyOf("u:t1"); got != "u:t1" {
		t.Fatalf(`dirtyKeyOf("u:t1") = %q, want "u:t1"`, got)
	}

	// 已落盘：走 docKeyOf（与 snapshot.go 的唯一派生一致）
	p := "/tmp/docs/a.md"
	if got, want := dirtyKeyOf(p), docKeyOf(p); got != want {
		t.Fatalf("dirtyKeyOf(%q) = %q, want docKeyOf = %q", p, got, want)
	}

	// 两类键必须不同（命名空间不相交）
	if dirtyKeyOf("u:t1") == dirtyKeyOf("/tmp/docs/a.md") {
		t.Fatal("未落盘键与已落盘 docKey 相撞 —— 映射会串文档")
	}

	// docKey 是 16 位 hex；未落盘前缀 "u:" 不是 hex，天然不会撞
	if len(docKeyOf(p)) != 16 {
		t.Fatalf("docKeyOf 长度 = %d, want 16", len(docKeyOf(p)))
	}
}

// TestSetDirtyTrueOverwrites 锁「反复置脏/清脏不产生残留条目」。
// map 若只增不减（只 set true、不清 false），标签反复编辑保存后会堆积条目；
// 更糟的是「清脏」若用 false 覆盖而不是 delete，anyDirty 的遍历会读到 false ——
// 行为虽对，但 ForgetDoc 之后就多出幽灵条目。
func TestSetDirtyTrueOverwrites(t *testing.T) {
	a := NewApp()
	a.SetDirty("t1", true)
	a.SetDirty("t1", true) // 重复置脏
	if len(a.dirtyByDoc) != 1 {
		t.Fatalf("重复 SetDirty(true) 不应产生多条，实际 %d 条", len(a.dirtyByDoc))
	}
	a.SetDirty("t1", false)
	if len(a.dirtyByDoc) != 0 {
		t.Fatalf("SetDirty(false) 应删掉条目而不是留着 false 值，实际 %d 条", len(a.dirtyByDoc))
	}
}
