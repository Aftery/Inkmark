//go:build linux

package main

// export_pdf_linux_test.go — Linux 导出桥里纯 Go 的那一小块（base URI 拼装）。
//
// 打印本体需要 GTK 主循环与真实 WebKit 进程，不在 go test 里跑；它已由真机
// 端到端验证（导出 A4/3 页/图片正常，见 commit 说明）。

import "testing"

func TestFileURIForDir(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"   ", ""},
		{"/tmp/opencode", "file:///tmp/opencode/"},
		{"/home/me/我的 文档", "file:///home/me/%E6%88%91%E7%9A%84%20%E6%96%87%E6%A1%A3/"},
	}
	for _, c := range cases {
		if got := fileURIForDir(c.in); got != c.want {
			t.Errorf("fileURIForDir(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
