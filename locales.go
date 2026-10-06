package main

// locales.go —— Go 原生菜单的三语言文案表与查表函数。
//
// 为什么单独成文件（而不塞进 main.go）：
//   buildMenu() 的主职是「组装菜单结构」（事件接线 + accelerator），
//   标签只是它的装饰参数。把 ~90 条文案抽到这里后，main.go 里
//   每个 AddText 读起来是 `t(locale, "file.new")` —— 一眼能看出
//   「这里是文案、那里是结构」，改文案不必碰菜单结构。
//
// 契约见 docs/spec/SPEC-i18n-v1.md §3；前端侧的 i18n 在 frontend/src/i18n/，
// 两边共用同一套 locale 字符串（'zh-CN' / 'en-US' / 'ja-JP'）与同一个默认值。

// defaultLocale 基准语言（也是缺 key 时的回退目标）。
// 与 frontend/src/i18n/zh-CN.js 的默认值必须一致 —— 两边不一致会出现
// 「界面英文、菜单中文」的分裂态（SPEC §4 明确要避免的中间态）。
const defaultLocale = "zh-CN"

// supportedLocales 白名单：SetLocale 只接受这三档，其余一律忽略并保持原值。
//
// 为什么是白名单而不是「查表命中即接受」：locale 会从前端 IPC 传进来，
// 属于系统边界上的外部输入。查表命中即接受看似等价，但它把「表里恰好有
// 这么一行」变成了隐式契约 —— 将来表里为了兼容加了别名，白名单会静默放宽。
// 显式白名单让「支持哪几档」只有一个真源。
var supportedLocales = []string{"zh-CN", "en-US", "ja-JP"}

// isSupportedLocale 判断 locale 是否在白名单内。
func isSupportedLocale(locale string) bool {
	for _, l := range supportedLocales {
		if l == locale {
			return true
		}
	}
	return false
}

// menuLabels 菜单标签的三语言文案表。
//
// key 用**语义字符串**而非中文原文（SPEC §3）：标签文案会改，
// 而「新建文件」这一项的身份不会变；用原文当 key 会让改文案变成改 key，
// 于是漏改一处就静默变成「缺 key → 回退中文」。
//
// 只收**标签**。以下三类一律不进表：
//   - accelerator（keys.CmdOrCtrl(...) 等）：键位是跨语言一致的，
//     翻译它等于改键位（AC-03 要求「键位不变」）；
//   - 产品名 Inkmark：进表但三档同值，仍走 t() 以保持表与代码一一对应；
//   - 用户内容（最近打开的文件名 recentLabels）：那是用户的文件名，不是 UI 文案
//     （SPEC §7 坑 5）。recentLabels 的输出直接进 AddText，不经 t()。
//
// 三份 key 集合必须完全一致，由 frontend/tests/contracts.test.mjs 的
// 「Go 菜单 key 完整性」用例守住（SPEC §6.1 第 3 条）。
var menuLabels = map[string]map[string]string{
	"zh-CN": {
		// 应用菜单（产品名三档不译）
		"app.name":         "Inkmark",
		"app.about":        "关于 Inkmark",
		"app.settings":     "设置…",
		"app.check-update": "检查更新…",
		"app.hide":         "隐藏 Inkmark",
		"app.quit":         "退出 Inkmark",
		// 文件
		"menu.file":                "文件",
		"file.new":                 "新建文件",
		"file.open":                "打开文件…",
		"file.open-folder":         "打开文件夹…",
		"file.recents":             "最近打开",
		"file.recents-empty":       "（暂无记录）",
		"file.recents-clear":       "清空最近列表",
		"file.save":                "保存",
		"file.save-as":             "另存为…",
		"file.rename":              "重命名…",
		"file.history":             "历史快照…",
		"file.print":               "打印…",
		"file.export-html":         "导出 HTML…",
		"file.export-pdf":          "导出 PDF…",
		"file.export-pdf-sysprint": "导出 PDF…（本平台走系统打印）",
		// 编辑
		"menu.edit":           "编辑",
		"edit.undo":           "撤销",
		"edit.redo":           "重做",
		"edit.cut":            "剪切",
		"edit.copy":           "拷贝",
		"edit.paste":          "粘贴",
		"edit.select-all":     "全选",
		"edit.find":           "查找…",
		"edit.find-replace":   "查找并替换…",
		"edit.jump-line":      "跳转到行…",
		"edit.move-line-up":   "上移行",
		"edit.move-line-down": "下移行",
		"edit.dup-line":       "重复当前行",
		"edit.delete-line":    "删除当前行",
		"edit.copy-as-html":   "复制选区为 HTML",
		// 格式
		"menu.format":         "格式",
		"format.heading":      "标题",
		"format.h1":           "标题一",
		"format.h2":           "标题二",
		"format.h3":           "标题三",
		"format.h4":           "标题四",
		"format.h5":           "标题五",
		"format.h6":           "标题六",
		"format.bold":         "加粗",
		"format.italic":       "斜体",
		"format.strike":       "删除线",
		"format.inline-code":  "行内代码",
		"format.link":         "链接",
		"format.list-bullet":  "无序列表",
		"format.list-ordered": "有序列表",
		"format.list-todo":    "任务列表",
		"format.quote":        "引用块",
		"format.code-block":   "代码块",
		"format.insert":       "插入",
		"insert.image":        "图片…",
		"insert.table":        "表格",
		"insert.hr":           "分割线",
		"insert.toc":          "目录",
		"format.indent":       "列表缩进",
		"format.outdent":      "列表反缩进",
		"format.clear":        "清除格式",
		// 视图
		"menu.view":           "视图",
		"view.edit":           "编辑模式",
		"view.preview":        "预览模式",
		"view.split":          "双栏模式",
		"view.reading":        "阅读模式",
		"view.focus":          "专注模式",
		"view.toggle-outline": "显示/隐藏大纲",
		"view.scroll-sync":    "滚动联动",
		"view.typewriter":     "打字机模式",
		"view.zoom-in":        "放大",
		"view.zoom-out":       "缩小",
		"view.zoom-reset":     "重置缩放",
		"view.toggle-theme":   "切换主题",
		"view.always-on-top":  "窗口置顶",
		// 窗口
		"menu.window":       "窗口",
		"window.minimize":   "最小化",
		"window.zoom":       "缩放",
		"window.fullscreen": "全屏",
		// 帮助
		"menu.help":      "帮助",
		"help.shortcuts": "快捷键速查",
		"help.syntax":    "Markdown 语法示例",
	},
	"en-US": {
		"app.name":                 "Inkmark",
		"app.about":                "About Inkmark",
		"app.settings":             "Settings…",
		"app.check-update":         "Check for Updates…",
		"app.hide":                 "Hide Inkmark",
		"app.quit":                 "Quit Inkmark",
		"menu.file":                "File",
		"file.new":                 "New File",
		"file.open":                "Open File…",
		"file.open-folder":         "Open Folder…",
		"file.recents":             "Open Recent",
		"file.recents-empty":       "(No Recent Files)",
		"file.recents-clear":       "Clear Recent Files",
		"file.save":                "Save",
		"file.save-as":             "Save As…",
		"file.rename":              "Rename…",
		"file.history":             "History Snapshots…",
		"file.print":               "Print…",
		"file.export-html":         "Export HTML…",
		"file.export-pdf":          "Export PDF…",
		"file.export-pdf-sysprint": "Export PDF… (uses the system print dialog on this platform)",
		"menu.edit":                "Edit",
		"edit.undo":                "Undo",
		"edit.redo":                "Redo",
		"edit.cut":                 "Cut",
		"edit.copy":                "Copy",
		"edit.paste":               "Paste",
		"edit.select-all":          "Select All",
		"edit.find":                "Find…",
		"edit.find-replace":        "Find and Replace…",
		"edit.jump-line":           "Go to Line…",
		"edit.move-line-up":        "Move Line Up",
		"edit.move-line-down":      "Move Line Down",
		"edit.dup-line":            "Duplicate Line",
		"edit.delete-line":         "Delete Line",
		"edit.copy-as-html":        "Copy Selection as HTML",
		"menu.format":              "Format",
		"format.heading":           "Heading",
		"format.h1":                "Heading 1",
		"format.h2":                "Heading 2",
		"format.h3":                "Heading 3",
		"format.h4":                "Heading 4",
		"format.h5":                "Heading 5",
		"format.h6":                "Heading 6",
		"format.bold":              "Bold",
		"format.italic":            "Italic",
		"format.strike":            "Strikethrough",
		"format.inline-code":       "Inline Code",
		"format.link":              "Link",
		"format.list-bullet":       "Bulleted List",
		"format.list-ordered":      "Numbered List",
		"format.list-todo":         "Task List",
		"format.quote":             "Blockquote",
		"format.code-block":        "Code Block",
		"format.insert":            "Insert",
		"insert.image":             "Image…",
		"insert.table":             "Table",
		"insert.hr":                "Horizontal Rule",
		"insert.toc":               "Table of Contents",
		"format.indent":            "Indent List",
		"format.outdent":           "Outdent List",
		"format.clear":             "Clear Formatting",
		"menu.view":                "View",
		"view.edit":                "Edit Mode",
		"view.preview":             "Preview Mode",
		"view.split":               "Split Mode",
		"view.reading":             "Reading Mode",
		"view.focus":               "Focus Mode",
		"view.toggle-outline":      "Show/Hide Outline",
		"view.scroll-sync":         "Scroll Sync",
		"view.typewriter":          "Typewriter Mode",
		"view.zoom-in":             "Zoom In",
		"view.zoom-out":            "Zoom Out",
		"view.zoom-reset":          "Reset Zoom",
		"view.toggle-theme":        "Toggle Theme",
		"view.always-on-top":       "Always on Top",
		"menu.window":              "Window",
		"window.minimize":          "Minimize",
		"window.zoom":              "Zoom",
		"window.fullscreen":        "Full Screen",
		"menu.help":                "Help",
		"help.shortcuts":           "Keyboard Shortcuts",
		"help.syntax":              "Markdown Syntax Examples",
	},
	"ja-JP": {
		"app.name":                 "Inkmark",
		"app.about":                "Inkmark について",
		"app.settings":             "設定…",
		"app.check-update":         "アップデートを確認…",
		"app.hide":                 "Inkmark を隠す",
		"app.quit":                 "Inkmark を終了",
		"menu.file":                "ファイル",
		"file.new":                 "新規ファイル",
		"file.open":                "ファイルを開く…",
		"file.open-folder":         "フォルダを開く…",
		"file.recents":             "最近使った項目",
		"file.recents-empty":       "（記録はありません）",
		"file.recents-clear":       "最近の一覧を消去",
		"file.save":                "保存",
		"file.save-as":             "名前を付けて保存…",
		"file.rename":              "名前を変更…",
		"file.history":             "履歴スナップショット…",
		"file.print":               "印刷…",
		"file.export-html":         "HTML を書き出す…",
		"file.export-pdf":          "PDF を書き出す…",
		"file.export-pdf-sysprint": "PDF を書き出す…（この環境ではシステム印刷を使用）",
		"menu.edit":                "編集",
		"edit.undo":                "元に戻す",
		"edit.redo":                "やり直す",
		"edit.cut":                 "カット",
		"edit.copy":                "コピー",
		"edit.paste":               "ペースト",
		"edit.select-all":          "すべてを選択",
		"edit.find":                "検索…",
		"edit.find-replace":        "検索と置換…",
		"edit.jump-line":           "行へ移動…",
		"edit.move-line-up":        "行を上へ移動",
		"edit.move-line-down":      "行を下へ移動",
		"edit.dup-line":            "行を複製",
		"edit.delete-line":         "行を削除",
		"edit.copy-as-html":        "選択範囲を HTML でコピー",
		"menu.format":              "書式",
		"format.heading":           "見出し",
		"format.h1":                "見出し 1",
		"format.h2":                "見出し 2",
		"format.h3":                "見出し 3",
		"format.h4":                "見出し 4",
		"format.h5":                "見出し 5",
		"format.h6":                "見出し 6",
		"format.bold":              "太字",
		"format.italic":            "斜体",
		"format.strike":            "取り消し線",
		"format.inline-code":       "インラインコード",
		"format.link":              "リンク",
		"format.list-bullet":       "箇条書き",
		"format.list-ordered":      "番号付きリスト",
		"format.list-todo":         "タスクリスト",
		"format.quote":             "引用",
		"format.code-block":        "コードブロック",
		"format.insert":            "挿入",
		"insert.image":             "画像…",
		"insert.table":             "表",
		"insert.hr":                "水平線",
		"insert.toc":               "目次",
		"format.indent":            "インデント",
		"format.outdent":           "インデントを解除",
		"format.clear":             "書式をクリア",
		"menu.view":                "表示",
		"view.edit":                "編集モード",
		"view.preview":             "プレビューモード",
		"view.split":               "分割モード",
		"view.reading":             "リーディングモード",
		"view.focus":               "集中モード",
		"view.toggle-outline":      "アウトラインの表示/非表示",
		"view.scroll-sync":         "スクロール同期",
		"view.typewriter":          "タイプライターモード",
		"view.zoom-in":             "拡大",
		"view.zoom-out":            "縮小",
		"view.zoom-reset":          "ズームをリセット",
		"view.toggle-theme":        "テーマを切り替え",
		"view.always-on-top":       "常に手前に表示",
		"menu.window":              "ウインドウ",
		"window.minimize":          "最小化",
		"window.zoom":              "拡大",
		"window.fullscreen":        "フルスクリーン",
		"menu.help":                "ヘルプ",
		"help.shortcuts":           "キーボードショートカット",
		"help.syntax":              "Markdown 記法の例",
	},
}

// t 按 locale 取标签，三级回退：**该语言 → zh-CN → key 本身**。
//
// 为什么最后一级返回 key 而不是空串（SPEC §2.2 / §7 坑 1）：
// 空串会在菜单栏上留下一个「有高度、没文字」的条目，用户无从判断发生了什么，
// 排查时也看不出是缺了哪条；返回 key 至少把「menu.file」这样的字面量露出来，
// 一眼可辨。t() 永不抛错 —— 菜单构建期抛错会让整个应用起不来。
//
// 回退到 zh-CN 而不是回退到 key：基准语言是 key 最全的一档，
// 「en-US 漏了一条」不该让用户看到裸 key。
func t(locale, key string) string {
	if m, ok := menuLabels[locale]; ok {
		if v, ok := m[key]; ok && v != "" {
			return v
		}
	}
	if m, ok := menuLabels[defaultLocale]; ok {
		if v, ok := m[key]; ok && v != "" {
			return v
		}
	}
	return key
}

// currentLocale 读当前菜单语言，供 buildMenu 使用。
//
// 为什么加锁：locale 由 SetLocale 经前端 IPC 写入，而 RefreshMenu 会在同一进程
// 的另一条入口被触发（菜单回调 → AddRecent/ClearRecents）。不加锁读到的是
// 半个写入的字符串切片 header（撕裂），t() 会拿它去查表 → 落到回退分支，
// 表现为「菜单标题忽然变回中文」。app.mu 已保护同组 UI 状态，复用它而非新开一把锁。
//
// 空值兜底：NewApp 已设默认值，这里仍兜一层是因为 App 可被零值构造
// （测试里 &App{} 很常见），而空 locale 会让整份菜单显示成裸 key。
func (a *App) currentLocale() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.locale == "" {
		return defaultLocale
	}
	return a.locale
}
