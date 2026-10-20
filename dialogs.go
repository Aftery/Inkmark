// dialogs.go — 原生系统对话框文案的本地化
// ----------------------------------------------------------------------------
// 【为什么需要这一层】界面语言由前端 i18n 单点持有（见 main.go 对原生菜单下线的
// 裁决），但**原生对话框的文案只能由 Go 侧传给系统**：打开/保存/退出确认框是
// Wails runtime 调系统 API 弹出的，前端改不到里面的字。于是出现过这样的缺口：
// 界面已是 en-US / ja-JP，点「打开文件」弹出的却是中文标题 —— 属于用户直接可见
// 的不一致，而不是内部实现细节。
//
// 【语言从哪来】前端调用时显式传入（App 直接收 locale 字符串），Go 侧**不持久化**
// 语言状态：语言真源仍然只有前端一处，Go 只是「按当次请求的语言取一张文案表」。
// 这样既没有第二份语言状态需要同步，也不会出现「Go 侧缓存的语言过期」。
//
// 【新增语言怎么做】在 dialogTexts 里加一个 key（BCP-47 主语言子标签），
// 前端 i18n 的 locale 前缀正好与之对齐（zh-CN → zh，en-US → en，ja-JP → ja）。
// 查不到时回落中文 —— 与默认语言一致，且不会出现空标题。
//
// 【本文件不覆盖什么 —— 如实登记的残余】Go 侧还有一类用户可见文字：各方法的
// **错误信息**（如「同名文件已存在: x」「读取失败: …」）。它们经 IPC 回到前端后
// 被嵌进本地化模板（`t('toast.saveFailedWith', { error })`）显示为
// 「保存失败：<中文原因>」。之所以不在此翻译：
//
//	① 错误串数量多且分散在业务逻辑里，逐条改造成带 locale 的错误码，
//	   会把「校验逻辑」与「展示语言」耦合起来（本仓明确反对的方向）；
//	② 系统底层错误（os.PathError 等）本身只有英文/本地化文案两种，
//	   再包一层翻译必然丢失技术细节。
//
// 故裁决：**模态对话框必须本地化**（用户被迫阅读、且它是产品语气的一部分），
// 错误细节保留原样（技术信息，用户可据此排查）。后续若要彻底解决，
// 正确方向是让 Go 返回错误**码**而非错误**串**，由前端查表 —— 那是一次独立的
// 协议改造，不该夹在文案本地化里顺手做。
package main

import "strings"

// dialogText 是一组原生对话框文案。
type dialogText struct {
	OpenFileTitle   string
	OpenFileFilter  string // 「所有文件」过滤器名
	OpenDirTitle    string
	SaveTitle       string
	UnsavedTitle    string // 退出确认框标题
	UnsavedMessage  string
	UnsavedCancel   string // 取消按钮
	UnsavedDiscard  string // 「不保存退出」按钮
	ExportFailedPDF string // 非 darwin 平台一键导出不可用
}

var dialogTexts = map[string]dialogText{
	"zh": {
		OpenFileTitle:   "打开 Markdown 文件",
		OpenFileFilter:  "所有文件",
		OpenDirTitle:    "选择文件夹",
		SaveTitle:       "导出 / 另存为",
		UnsavedTitle:    "未保存的更改",
		UnsavedMessage:  "当前文档有未保存的更改，确定要退出吗？",
		UnsavedCancel:   "取消",
		UnsavedDiscard:  "不保存退出",
		ExportFailedPDF: "当前平台不支持一键导出 PDF，请改用系统打印",
	},
	"en": {
		OpenFileTitle:   "Open Markdown File",
		OpenFileFilter:  "All Files",
		OpenDirTitle:    "Choose Folder",
		SaveTitle:       "Export / Save As",
		UnsavedTitle:    "Unsaved Changes",
		UnsavedMessage:  "This document has unsaved changes. Quit anyway?",
		UnsavedCancel:   "Cancel",
		UnsavedDiscard:  "Quit Without Saving",
		ExportFailedPDF: "One-click PDF export is not supported on this platform; use system print instead",
	},
	"ja": {
		OpenFileTitle:   "Markdown ファイルを開く",
		OpenFileFilter:  "すべてのファイル",
		OpenDirTitle:    "フォルダを選択",
		SaveTitle:       "エクスポート / 名前を付けて保存",
		UnsavedTitle:    "保存されていない変更",
		UnsavedMessage:  "この文書には保存されていない変更があります。終了しますか？",
		UnsavedCancel:   "キャンセル",
		UnsavedDiscard:  "保存せずに終了",
		ExportFailedPDF: "このプラットフォームでは PDF のワンクリック書き出しに対応していません。システムの印刷をご利用ください",
	},
}

// dialogTextFor 按 locale 取文案表；未知语言回落中文（与默认语言一致）。
//
// 只取主语言子标签：前端传来的可能是 zh-CN / en-US / ja-JP，而文案表按语言
// 而非地区划分（同一语言不因地区改文案）。空串 / 无分隔符也安全。
func dialogTextFor(locale string) dialogText {
	lang := strings.ToLower(strings.TrimSpace(locale))
	if i := strings.IndexAny(lang, "-_"); i >= 0 {
		lang = lang[:i]
	}
	if t, ok := dialogTexts[lang]; ok {
		return t
	}
	return dialogTexts["zh"]
}
