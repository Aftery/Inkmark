package main

import "testing"

// dialogs_test.go — 原生对话框文案表的契约测试。
//
// 【为什么值得测】dialogTextFor 的两个失效形态都是**静默**的：
//   ① 某个语言缺字段（空串）→ 系统对话框标题变成空白，看起来像弹窗没加载；
//   ② confirmClose 的按钮文案来自本表，若「不保存退出」在某种语言下与「取消」
//      文案相同，用户点哪个都退不掉 / 都可能误退 —— 那是数据安全问题，不是外观问题。
// 这两类都不会让编译失败，也不会被任何前端测试覆盖（它在 Go 侧）。

// TestDialogTextsAllLocalesComplete 每个语言、每个字段都必须非空。
func TestDialogTextsAllLocalesComplete(t *testing.T) {
	for lang, t2 := range dialogTexts {
		fields := map[string]string{
			"OpenFileTitle":   t2.OpenFileTitle,
			"OpenFileFilter":  t2.OpenFileFilter,
			"OpenDirTitle":    t2.OpenDirTitle,
			"SaveTitle":       t2.SaveTitle,
			"UnsavedTitle":    t2.UnsavedTitle,
			"UnsavedMessage":  t2.UnsavedMessage,
			"UnsavedCancel":   t2.UnsavedCancel,
			"UnsavedDiscard":  t2.UnsavedDiscard,
			"ExportFailedPDF": t2.ExportFailedPDF,
		}
		for name, v := range fields {
			if v == "" {
				t.Errorf("语言 %q 的 %s 为空 —— 系统对话框会显示空白", lang, name)
			}
		}
	}
}

// TestUnsavedButtonsDiffer 退出确认的两个按钮文案必须不同：
// confirmClose 靠「返回值 != 退出文案」判定用户是否真的要退出，
// 两个按钮同文案时，判定结果只取决于后端返回哪一个，行为不可预期。
func TestUnsavedButtonsDiffer(t *testing.T) {
	for lang, t2 := range dialogTexts {
		if t2.UnsavedCancel == t2.UnsavedDiscard {
			t.Errorf("语言 %q 的取消/退出按钮文案相同（%q）：confirmClose 无法区分用户选择",
				lang, t2.UnsavedCancel)
		}
	}
}

// TestDialogTextForLocaleFallback 语言标签的解析与回落口径。
func TestDialogTextForLocaleFallback(t *testing.T) {
	cases := []struct {
		locale string
		want   string // 期望命中的语言（用该表的 OpenDirTitle 做指纹）
	}{
		{"zh-CN", "zh"},
		{"en-US", "en"},
		{"ja-JP", "ja"},
		{"EN-us", "en"}, // 大小写不敏感
		{"ja", "ja"},    // 无地区子标签
		{"", "zh"},      // 空串回落默认
		{"fr-FR", "zh"}, // 未支持语言回落默认
		{"  zh-TW  ", "zh"},
	}
	for _, c := range cases {
		got := dialogTextFor(c.locale).OpenDirTitle
		want := dialogTexts[c.want].OpenDirTitle
		if got != want {
			t.Errorf("dialogTextFor(%q) = %q，期望 %q（%s 文案）", c.locale, got, want, c.want)
		}
	}
}

// TestLocaleMirrorRoundTrip App 的语言镜像：未同步时回落默认，同步后读到原值。
func TestLocaleMirrorRoundTrip(t *testing.T) {
	a := &App{}
	if got := a.localeSnapshot(); got != "" {
		t.Errorf("未同步时镜像应为空串，实得 %q", got)
	}
	// 空镜像 → 默认语言
	if got, want := dialogTextFor(a.localeSnapshot()).OpenDirTitle,
		dialogTextFor("zh").OpenDirTitle; got != want {
		t.Errorf("空镜像应回落默认语言，实得 %q", got)
	}
	for _, loc := range []string{"en-US", "ja-JP", "zh-CN", ""} {
		a.SetLocale(loc)
		if got := a.localeSnapshot(); got != loc {
			t.Errorf("SetLocale(%q) 后镜像为 %q", loc, got)
		}
	}
}
