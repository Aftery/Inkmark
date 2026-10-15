package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 通道③ 的判据测试：sniffImageMagic 决定「什么字节才算图片」。
//
// 【为什么这些断言值得写】判据错了的后果是**把文本/半个文件写进 assets/**
// （用户会发现文档旁边多出垃圾文件），而这类失败全程无报错 —— 正是本仓
// 最难抓的那一类。故这里对**每个已知格式 + 每个必须拒绝的形态**都钉死断言。
//
// 【测试纪律：断言要打在差异上】不写「调用没 panic」这种恒真断言，
// 而是断言**返回的扩展名**与**拒绝时的 nil** —— 两者都是可观测差异。

// 各格式的最小合法文件头（后缀随便补，嗅探只看头部）。
func pngBytes() []byte  { return append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 32)...) }
func jpegBytes() []byte { return append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 32)...) }
func gifBytes() []byte  { return append([]byte("GIF89a"), make([]byte, 32)...) }
func bmpBytes() []byte  { return append([]byte("BM"), make([]byte, 32)...) }
func tiffLEBytes() []byte {
	return append([]byte{0x49, 0x49, 0x2A, 0x00}, make([]byte, 32)...)
}
func tiffBEBytes() []byte {
	return append([]byte{0x4D, 0x4D, 0x00, 0x2A}, make([]byte, 32)...)
}

// webp 必须是完整的 RIFF....WEBP 容器（RIFF 家族共用前4 字节）。
func webpBytes(secondType string) []byte {
	b := make([]byte, 12)
	copy(b[0:], "RIFF")
	copy(b[4:], []byte{0x24, 0x00, 0x00, 0x00}) // size（不校验）
	copy(b[8:], secondType)
	return append(b, make([]byte, 16)...)
}

func TestSniffImageMagic_各格式魔数(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"PNG", pngBytes(), "png"},
		{"JPEG", jpegBytes(), "jpg"},
		{"GIF87/89", gifBytes(), "gif"},
		{"BMP", bmpBytes(), "bmp"},
		{"TIFF 小端标记", tiffLEBytes(), "tiff"},
		{"TIFF 大端标记", tiffBEBytes(), "tiff"},
		{"WEBP", webpBytes("WEBP"), "webp"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := sniffImageMagic(c.data)
			if got == nil {
				t.Fatalf("%s 应被识别为图片，实际返回 nil（会被丢弃→用户粘不进图）", c.name)
			}
			if got.Ext != c.want {
				t.Errorf("%s 扩展名 = %q, 期望 %q", c.name, got.Ext, c.want)
			}
			// 字节必须原样透传，不能被嗅探过程改写
			if !bytes.Equal(got.Data, c.data) {
				t.Errorf("%s 字节被改写：原 %d 字节, 得 %d 字节", c.name, len(c.data), len(got.Data))
			}
		})
	}
}

func TestSniffImageMagic_拒绝非图片(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{"空输入", nil},
		{"零长度切片", []byte{}},
		{"纯文本", []byte("hello world")},
		{"文件名文本", []byte("1643208705644.jpg")},
		{"Markdown 行", []byte("![](assets/x.png)")},
		{"HTML 片段", []byte("<img src=\"a.png\">")},
		// WAV 也以 RIFF 开头 —— 只匹配前 4 字节会把它误判成 webp
		{"RIFF 但非 WEBP（WAV）", webpBytes("WAVE")},
		{"RIFF 但类型未知", webpBytes("XXXX")},
		{"半个 PNG 头（截断）", []byte{0x89, 'P', 'N'}},
		{"PDF", []byte("%PDF-1.7\n")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := sniffImageMagic(c.data); got != nil {
				t.Errorf("%s 不该被识别为图片，实际返回 ext=%q（会把垃圾写进 assets/）",
					c.name, got.Ext)
			}
		})
	}
}

func TestSniffImageMagic_SVG文本格式(t *testing.T) {
	cases := []struct {
		name  string
		data  []byte
		want  bool
		why   string
	}{
		{"纯 svg 根元素", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), true, "基本形态"},
		{"带 XML 声明", []byte(`<?xml version="1.0"?><svg width="10"></svg>`), true, "导出器常带声明"},
		{"带注释", []byte(`<!-- by excalidraw --><svg></svg>`), true, "手写 SVG 常带注释"},
		{"带 BOM", append([]byte{0xEF, 0xBB, 0xBF}, []byte(`<svg></svg>`)...), true, "部分编辑器会加 BOM"},
		{"大小写混写", []byte(`<SVG></SVG>`), true, "SVG 大小写敏感但根元素写法宽松"},
		{"非 svg 的 XML", []byte(`<?xml version="1.0"?><html></html>`), false, "有声明但根元素不是 svg"},
		{"HTML 片段", []byte(`<div>hello</div>`), false, "别把任意标签当图片"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := sniffImageMagic(c.data)
			if c.want {
				if got == nil {
					t.Fatalf("%s 应识别为 svg，实际 nil", c.name)
				}
				if got.Ext != "svg" {
					t.Errorf("%s ext = %q, 期望 svg", c.name, got.Ext)
				}
			} else if got != nil {
				t.Errorf("%s 不该被识别为图片，实际 ext=%q", c.name, got.Ext)
			}
		})
	}
}

// 【本文件曾有一条恒真断言，已删除】原先有TestSniffImageMagic_二进制优先于SVG文本，
// 想钉住「SVG 分支排在魔数分支之后」。变异自证证明它是**恒真**的：
// looksLikeSVG 只看去掉前导空白后的头4 字节，而没有任何图片格式以 "<svg" 开头，
// 两个分支天然互斥，调换顺序不改变任何输出 —— 属**等价变异体**，
// 断言打在了一个不存在的差异上（同 HANDOFF §4⑱⑲ 那类「假绿」）。
// 真正有区分度的是「前导空白是否被容忍」，见TestSniffImageMagic_容忍前导空白。
//
// 【变异自证记录 —— 2026-10-15】按仓库铁律，改判据必须自证「改坏了测试会红」：
//   方向1 删除 RIFF 二次确认（WAV 被误判成 webp）
//        → 精确报红：TestSniffImageMagic_拒绝非图片/RIFF_但非_WEBP（WAV）
//   方向2 调换 SVG 与魔数分支顺序
//        → **未报红**，查出上面那条恒真断言并删除（等价变异体）
//   方向3 让实现改成 trim 后匹配魔数（过度容错）
//        → 精确报红：TestSniffImageMagic_容忍前导空白
//   即当前判据既有「能测出真缺陷」的用例，也经得起等价变异的探查。

// 前导空白容忍：SVG 常带缩进 / 换行 /BOM，二进制格式则必须**在偏移 0 命中魔数**。
func TestSniffImageMagic_容忍前导空白(t *testing.T) {
	// 缩进 + 换行的 SVG 应被认出（剪贴板里带格式的 SVG 很常见）
	indented := []byte("\n\n   <svg width=\"10\"></svg>")
	if got := sniffImageMagic(indented); got == nil || got.Ext != "svg" {
		t.Errorf("带前导空白的 SVG 应被识别为 svg，实际 %+v", got)
	}
	// 前导空白 + 二进制魔数：**不**应被识别 ——
	// 若实现改成「trim 后再找魔数」，PNG 就会被误当成有效图片落盘。
	shifted := append([]byte("\n\n"), pngBytes()...)
	if got := sniffImageMagic(shifted); got != nil {
		t.Errorf("魔数被空白顶开后不应识别为图片，实际 ext=%q"+
			"（说明实现做了 trim 后匹配，容错过头会把任意数据当图片）", got.Ext)
	}
}

// writeImageAsset 是三条通道共用的落盘实现：校验 → 建 assets/ → 命名 → 写盘。
func TestWriteImageAsset_落盘并返回相对路径(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "note.md")

	rel, err := writeImageAsset(doc, pngBytes(), "png")
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if !strings.HasPrefix(rel, "assets/") {
		t.Errorf("相对路径应以 assets/ 开头，实际 %q", rel)
	}
	abs := filepath.Join(dir, rel)
	raw, err := os.ReadFile(abs)
	if err != nil {
		t.Fatalf("图片未落盘: %v", err)
	}
	if !bytes.Equal(raw, pngBytes()) {
		t.Error("落盘字节与输入不一致")
	}
}

func TestWriteImageAsset_未落盘文档被拒(t *testing.T) {
	// 通道③ 与前两条通道共用的守卫：没有目录就没有 assets/，
	// 静默失败只会让用户以为粘贴坏了。
	if _, err := writeImageAsset("", pngBytes(), "png"); err == nil {
		t.Error("文档未保存时应报错（否则图片无处可放，用户却毫无提示）")
	}
}

func TestWriteImageAsset_空数据与超限被拒(t *testing.T) {
	doc := filepath.Join(t.TempDir(), "n.md")
	if _, err := writeImageAsset(doc, nil, "png"); err == nil {
		t.Error("空图片数据应报错（空文件进assets/ 是垃圾）")
	}
	oversize := make([]byte, maxImageBytes+1)
	if _, err := writeImageAsset(doc, oversize, "png"); err == nil {
		t.Error("超过 20MB 上限应报错")
	}
}

// 通道③ 的入口：剪贴板为空时返回空串且**不报错**。
// 这条语义前端依赖（取不到就退回默认粘贴，不弹错误 toast）。
// 注意本测试只在 macOS 上有断言力（其它平台无剪贴板实现恒返回空）。
func TestSaveImageFromClipboard_空剪贴板返回空串且不报错(t *testing.T) {
	doc := filepath.Join(t.TempDir(), "n.md")
	a := &App{}
	rel, err := a.SaveImageFromClipboard(doc)
	// 剪贴板里若恰好有图片（本机真有可能），则返回路径，不算失败
	if err != nil {
		t.Fatalf("空剪贴板不应报错: %v", err)
	}
	if rel == "" {
		return // 期望路径
	}
	// 若真取到了图，落盘文件必须存在且非空（不能是 0 字节垃圾）
	abs := filepath.Join(filepath.Dir(doc), rel)
	st, err := os.Stat(abs)
	if err != nil {
		t.Errorf("返回了相对路径 %q 但文件不存在: %v", rel, err)
		return
	}
	if st.Size() == 0 {
		t.Error("落盘文件为 0 字节")
	}
}