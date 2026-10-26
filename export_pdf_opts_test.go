package main

// export_pdf_opts_test.go — 导出契约的跨平台公共部分（默认文件名）。
// 与平台无关：darwin 与 linux 两条实现都读这一份，改名规则必须一致。

import "testing"

func TestPdfExportDefaultName_非法字符与超长(t *testing.T) {
	cases := []struct{ in, want string }{
		{"我的文档", "我的文档.pdf"},
		{"a/b:c*d?e\"f<g>h|i", "a_b_c_d_e_f_g_h_i.pdf"},
		{"  前后空白.  ", "前后空白.pdf"},
		{"", "export.pdf"},
		{"...", "export.pdf"},
	}
	for _, c := range cases {
		if got := pdfExportDefaultName(c.in); got != c.want {
			t.Errorf("pdfExportDefaultName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestPdfExportDefaultName_截断到60字符(t *testing.T) {
	long := ""
	for i := 0; i < 80; i++ {
		long += "字"
	}
	got := pdfExportDefaultName(long)
	want := ""
	for i := 0; i < 60; i++ {
		want += "字"
	}
	want += ".pdf"
	if got != want {
		t.Fatalf("截断结果不符：%q（%d 个字符）", got, len([]rune(got)))
	}
}
