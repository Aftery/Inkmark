package main

import (
	"embed"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Inkmark",
		Width:     1280,
		Height:    800,
		MinWidth:  800,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:     app.startup,
		OnBeforeClose: app.OnBeforeClose,
		Bind:          []interface{}{app},
		Menu:          buildMenu(app),
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

// buildMenu 组装原生应用菜单。
//
// 平台差异：macOS 渲染在屏幕顶部系统菜单栏；Windows/Linux 渲染为窗口内顶部菜单条。
//
// 注意：一旦设置 options.Menu，Wails 会用它【整体替换】默认菜单
// （见 internal/frontend/desktop/darwin/window.go 的 UpdateApplicationMenu），
// 因此必须把仍然可用的 Role 手动拼回来 —— 尤其 EditMenu：
// 丢了它，编辑器里的 ⌘C/⌘V/⌘X/撤销/全选 会全部失效。
// 应用菜单（Inkmark）自 v1.1 起改为全自建文本项，不再 Append(AppMenu Role)，
// 原因见下方 ① 处注释（单项 Role 在 v2.16.0 不导出）。
//
// Role 陷阱（实测 v2.16.0 源码）：
//   - darwin 的 WailsMenu.m 对 EditMenu/WindowMenu 等 Role 是【硬编码】展开，
//     自定义子项追加到 Role 的 SubMenu 会被无视；
//   - 非 darwin 的 processMenu 只读 Label/SubMenu，Role 完全不展开 ——
//     直接 Append(EditMenu()) 在 Windows/Linux 会渲染成空菜单。
//     所以「编辑」菜单按平台分流：darwin 用系统 Role，其余自建子菜单。
//
// 菜单项不在 Go 侧做业务，只向前端发事件（业务逻辑统一在前端，避免两处维护）；
// 例外：隐藏/退出直接调 Wails runtime（无对应前端行为，绕行只会增加一份事件接线）。
func buildMenu(app *App) *menu.Menu {
	// 回调闭包延迟读取 app.ctx：菜单在 wails.Run 之前构建，ctx 要到 startup 才有值
	emit := func(event string) func(*menu.CallbackData) {
		return func(*menu.CallbackData) {
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, event)
			}
		}
	}

	// checkbox 回调：darwin 端 Wails 在进入回调前已把 MenuItem.Checked 翻转为
	// 新值（darwin/callbacks.go），因此 data.MenuItem.Checked 即勾选后的状态。
	// set 把新值落回 Go 状态（下次重建菜单时 checkbox 初始态依赖它）。
	emitChecked := func(event string, set func(bool)) func(*menu.CallbackData) {
		return func(data *menu.CallbackData) {
			checked := data != nil && data.MenuItem != nil && data.MenuItem.Checked
			if set != nil {
				set(checked)
			}
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, event, checked)
			}
		}
	}

	appMenu := menu.NewMenu()

	// ① 应用菜单（Apple HIG：必须排在第一位，macOS 用第一个子菜单做「应用菜单」）
	//
	// 为什么全用自建文本项、不用 Role（实测 v2.16.0，非记忆）：
	//   Wails 只导出 AppMenu/EditMenu/WindowMenu 三个【整体】Role；
	//   About/Hide/HideOthers/UnHide/Quit 等【单项】Role 在 pkg/menu/menuroles.go
	//   里全被块注释掉（`go doc .../pkg/menu About` → no symbol）；且 darwin 的
	//   appendRole switch 只认 1/2/3，单项 Role 塞进子菜单也不会渲染。
	//   所以「关于/设置/检查更新/隐藏/退出」无法用 Role 拼，只能自建文本项。
	//
	// 由此产生的两个能力边界（Wails 未提供 API，非本仓缺陷，详见 README 已知问题）：
	//   - 无 hideOtherApplications → 省略「隐藏其他」
	//   - 无 unhideAllApplications → 省略「显示全部」
	//   - 同时放弃系统原生「关于」面板，改前端弹层（版本号取 version.go 单一真源）
	// 非 darwin 平台同样全文本项：processMenu 不展开 Role，Role 只会渲染成空标签。
	inkmarkMenu := appMenu.AddSubmenu("Inkmark")
	inkmarkMenu.AddText("关于 Inkmark", nil, emit("menu:about"))
	inkmarkMenu.AddSeparator()
	// 「设置…」入口唯一（已从文件菜单移除）；事件名 menu:open-settings 保持不变，前端已接线
	inkmarkMenu.AddText("设置…", keys.CmdOrCtrl(","), emit("menu:open-settings"))
	inkmarkMenu.AddText("检查更新…", nil, emit("menu:check-update"))
	inkmarkMenu.AddSeparator()
	// 隐藏/退出直接调 Wails runtime（不发事件，少绕一圈）；回调闭包延迟读 app.ctx，
	// 因为菜单在 wails.Run 之前构建，ctx 要到 startup 才有值。
	inkmarkMenu.AddText("隐藏 Inkmark", keys.CmdOrCtrl("h"), func(*menu.CallbackData) {
		if app.ctx != nil {
			runtime.Hide(app.ctx)
		}
	})
	inkmarkMenu.AddSeparator()
	inkmarkMenu.AddText("退出 Inkmark", keys.CmdOrCtrl("q"), func(*menu.CallbackData) {
		if app.ctx != nil {
			runtime.Quit(app.ctx)
		}
	})

	// ② 文件
	fileMenu := appMenu.AddSubmenu("文件")
	fileMenu.AddText("新建文件", keys.CmdOrCtrl("n"), emit("menu:new-file"))
	fileMenu.AddSeparator()
	fileMenu.AddText("打开文件…", keys.CmdOrCtrl("o"), emit("menu:open-file"))
	fileMenu.AddText("打开文件夹…", keys.Combo("o", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:open-folder"))

	// 最近打开：列表由 Go 侧持有（recents.json 持久化），前端打开文件后调
	// AddRecent → RefreshMenu 整体重建菜单。空列表显示禁用占位，避免空分组。
	recentsMenu := fileMenu.AddSubmenu("最近打开")
	if len(app.recents) == 0 {
		empty := menu.Text("（暂无记录）", nil, nil)
		empty.Disabled = true
		recentsMenu.Append(empty)
	} else {
		labels := recentLabels(app.recents)
		for i, p := range app.recents {
			path := p // 闭包捕获当前值
			recentsMenu.AddText(labels[i], nil, func(*menu.CallbackData) {
				if app.ctx != nil {
					runtime.EventsEmit(app.ctx, "menu:open-recent", path)
				}
			})
		}
		recentsMenu.AddSeparator()
		recentsMenu.AddText("清空最近列表", nil, func(*menu.CallbackData) {
			app.ClearRecents()
		})
	}

	fileMenu.AddSeparator()
	fileMenu.AddText("保存", keys.CmdOrCtrl("s"), emit("menu:save"))
	fileMenu.AddText("另存为…", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:save-as"))
	// 重命名走前端输入对话框（WKWebView 没有 window.prompt），不设 accelerator
	fileMenu.AddText("重命名…", nil, emit("menu:rename"))
	fileMenu.AddSeparator()
	// 历史快照面板：低频入口，按 ADR-004 不分配快捷键（避免误触）
	fileMenu.AddText("历史快照…", nil, emit("menu:toggle-history"))
	fileMenu.AddSeparator()
	// 打印：直接走系统打印对话框（前端 window.print()）；@media print 已隐藏 chrome、
	// 只输出预览正文，故无需另建打印视图。键位对齐 macOS 惯例 ⌘P = 打印。
	fileMenu.AddText("打印…", keys.CmdOrCtrl("p"), emit("menu:print"))
	fileMenu.AddText("导出 HTML…", keys.Combo("h", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:export-html"))
	// 非 darwin 平台一键直出不可用（ADR-003 路线 A′ 依赖 WebKit/PDFKit），
	// 菜单项保持可用不置灰，文案显式说明走系统打印；不做 tooltip（原生菜单 tooltip 不可靠）
	exportPDFTitle := "导出 PDF…"
	if goruntime.GOOS != "darwin" {
		exportPDFTitle = "导出 PDF…（本平台走系统打印）"
	}
	// 导出 PDF 让位：⌘P 已给打印，降为 ⇧⌘P（macOS 惯例，与「打印…」区分）
	fileMenu.AddText(exportPDFTitle, keys.Combo("p", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:export-pdf"))

	// ③ 编辑（macOS 必需：撤销/剪切/拷贝/粘贴/全选）
	if goruntime.GOOS == "darwin" {
		// macOS：系统 EditMenu Role 提供原生 undo:/cut:/paste: selector；
		// 新增的查找/跳转/行操作不在菜单展示（Role 硬编码加不进去），
		// 改由编辑器 keymap 承担（⌘F 查找、⌘L 跳转行、⌥↑↓ 移动行…），
		// 入口统一收在「帮助 → 快捷键速查」。
		appMenu.Append(menu.EditMenu())
	} else {
		// Windows/Linux：自建编辑菜单。剪贴板/撤销类【不设 accelerator】——
		// 让按键直达 WebView 走原生行为（保持既有行为），菜单项仅作鼠标点击入口；
		// 查找/行操作类设 accelerator（由前端 CM 命令承接）。
		editMenu := appMenu.AddSubmenu("编辑")
		editMenu.AddText("撤销", nil, emit("menu:undo"))
		editMenu.AddText("重做", nil, emit("menu:redo"))
		editMenu.AddSeparator()
		editMenu.AddText("剪切", nil, emit("menu:cut"))
		editMenu.AddText("拷贝", nil, emit("menu:copy"))
		editMenu.AddText("粘贴", nil, emit("menu:paste"))
		editMenu.AddText("全选", nil, emit("menu:select-all"))
		editMenu.AddSeparator()
		editMenu.AddText("查找…", keys.CmdOrCtrl("f"), emit("menu:find"))
		editMenu.AddText("查找并替换…", keys.Combo("f", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:find-replace"))
		editMenu.AddText("跳转到行…", keys.CmdOrCtrl("l"), emit("menu:jump-line"))
		editMenu.AddSeparator()
		editMenu.AddText("上移行", keys.OptionOrAlt("Up"), emit("menu:move-line-up"))
		editMenu.AddText("下移行", keys.OptionOrAlt("Down"), emit("menu:move-line-down"))
		editMenu.AddText("重复当前行", keys.Combo("Down", keys.OptionOrAltKey, keys.ShiftKey), emit("menu:dup-line"))
		editMenu.AddText("删除当前行", keys.Combo("k", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:delete-line"))
		editMenu.AddSeparator()
		editMenu.AddText("复制选区为 HTML", nil, emit("menu:copy-as-html"))
	}

	// ④ 格式（WYSIWYG 命令；事件名与前端 formatCommands 接线清单严格一致，不得改名）
	formatMenu := appMenu.AddSubmenu("格式")
	headingMenu := formatMenu.AddSubmenu("标题")
	headingMenu.AddText("标题一", keys.Combo("1", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h1"))
	headingMenu.AddText("标题二", keys.Combo("2", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h2"))
	headingMenu.AddText("标题三", keys.Combo("3", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h3"))
	headingMenu.AddText("标题四", keys.Combo("4", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h4"))
	headingMenu.AddText("标题五", keys.Combo("5", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h5"))
	headingMenu.AddText("标题六", keys.Combo("6", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h6"))
	formatMenu.AddSeparator()
	formatMenu.AddText("加粗", keys.Combo("b", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-bold"))
	formatMenu.AddText("斜体", keys.CmdOrCtrl("i"), emit("menu:format-italic"))
	formatMenu.AddText("删除线", keys.Combo("x", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-strike"))
	formatMenu.AddText("行内代码", keys.CmdOrCtrl("`"), emit("menu:format-inline-code"))
	formatMenu.AddText("链接", keys.CmdOrCtrl("k"), emit("menu:format-link"))
	formatMenu.AddSeparator()
	formatMenu.AddText("无序列表", keys.Combo("8", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-bullet"))
	formatMenu.AddText("有序列表", keys.Combo("7", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-ordered"))
	formatMenu.AddText("任务列表", keys.Combo("9", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-todo"))
	formatMenu.AddText("引用块", keys.Combo(".", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-quote"))
	formatMenu.AddText("代码块", keys.Combo("c", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-code-block"))
	formatMenu.AddSeparator()
	// 插入类（图片/表格/分割线命令已存在，目录为新增；命令在 editor/commands.js）
	insertMenu := formatMenu.AddSubmenu("插入")
	insertMenu.AddText("图片…", nil, emit("menu:insert-image"))
	insertMenu.AddText("表格", nil, emit("menu:insert-table"))
	insertMenu.AddText("分割线", nil, emit("menu:insert-hr"))
	insertMenu.AddText("目录", nil, emit("menu:insert-toc"))
	formatMenu.AddSeparator()
	// 缩进不设 accelerator：编辑器里 Tab/Shift+Tab 已由 CM indentWithTab 承接，
	// 菜单挂 Tab 键位会全局吞键，纯写作场景得不偿失
	formatMenu.AddText("列表缩进", nil, emit("menu:indent"))
	formatMenu.AddText("列表反缩进", nil, emit("menu:outdent"))
	formatMenu.AddText("清除格式", nil, emit("menu:clear-format"))

	// ⑤ 视图
	viewMenu := appMenu.AddSubmenu("视图")
	viewMenu.AddText("编辑模式", keys.CmdOrCtrl("1"), emit("menu:view-edit"))
	viewMenu.AddText("预览模式", keys.CmdOrCtrl("2"), emit("menu:view-preview"))
	viewMenu.AddText("双栏模式", keys.CmdOrCtrl("3"), emit("menu:view-split"))
	// 阅读模式 = 第 4 视图态（ADR-004 裁决：与 ⌘1/2/3 同族；⌘⇧R 废弃不采用）
	viewMenu.AddText("阅读模式", keys.CmdOrCtrl("4"), emit("menu:view-reading"))
	viewMenu.AddText("专注模式", keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-focus"))
	viewMenu.AddSeparator()
	viewMenu.AddText("显示/隐藏大纲", keys.CmdOrCtrl("b"), emit("menu:toggle-outline"))
	// 开关类：checkbox 状态真源在 Go（App.scrollSync / typewriter / alwaysOnTop），
	// 前端挂载时回读同步；菜单切换 → emitChecked 通知前端 + 落 Go 状态
	viewMenu.AddCheckbox("滚动联动", app.scrollSync, nil,
		emitChecked("menu:toggle-scroll-sync", app.SetScrollSync))
	viewMenu.AddCheckbox("打字机模式", app.typewriter, nil,
		emitChecked("menu:toggle-typewriter", app.SetTypewriter))
	viewMenu.AddSeparator()
	viewMenu.AddText("放大", keys.CmdOrCtrl("="), emit("menu:zoom-in"))
	viewMenu.AddText("缩小", keys.CmdOrCtrl("-"), emit("menu:zoom-out"))
	viewMenu.AddText("重置缩放", keys.CmdOrCtrl("0"), emit("menu:zoom-reset"))
	viewMenu.AddSeparator()
	viewMenu.AddText("切换主题", keys.Combo("l", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-theme"))
	// 窗口置顶放「视图」而非「窗口」：darwin 的 WindowMenu Role 同样硬编码，
	// 塞不进自定义项；置顶本质是视图行为，放这里三个平台表现一致
	viewMenu.AddCheckbox("窗口置顶", app.alwaysOnTop, nil,
		emitChecked("menu:toggle-always-on-top", app.SetAlwaysOnTop))

	// ⑥ 窗口（最小化/缩放）
	appMenu.Append(menu.WindowMenu())

	// ⑦ 帮助
	helpMenu := appMenu.AddSubmenu("帮助")
	helpMenu.AddText("快捷键速查", keys.CmdOrCtrl("/"), emit("menu:help-shortcuts"))
	helpMenu.AddText("Markdown 语法示例", nil, emit("menu:help-syntax"))

	return appMenu
}
