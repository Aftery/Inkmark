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
// 窗口菜单（窗口）与编辑菜单（编辑）自 v1.2 起同样改为自建文本项，三平台统一
// —— 见 ③ 与 ⑥ 处注释。
// 结果：全仓【不再使用任何系统 Role 菜单】，所有标签均可随语言切换（见下方
// 「标签一律走 t(locale, key)」一段与 locales.go）。
//
// Role 陷阱（实测 v2.16.0 源码，即使现已不用 Role 仍需记录，避免后人重犯）：
//   - darwin 的 WailsMenu.m 对 EditMenu/WindowMenu 等 Role 是【硬编码】展开，
//     自定义子项追加到 Role 的 SubMenu 会被无视；标题与条目也已硬编码为英文；
//   - 非 darwin 的 processMenu 只读 Label/SubMenu，Role 完全不展开 ——
//     直接 Append(EditMenu()) 在 Windows/Linux 会渲染成空菜单。
//   - 核实「某 API/Role 是否可用」必须用 go doc 或读源码，不能用 grep 的输出下结论
//     （grep 会匹配到被 /* */ 注释掉的声明，本仓已因此写错两次 Spec）。
//
// 菜单项不在 Go 侧做业务，只向前端发事件（业务逻辑统一在前端，避免两处维护）；
// 例外：隐藏/退出直接调 Wails runtime（无对应前端行为，绕行只会增加一份事件接线）。
//
// 标签一律走 t(locale, key) 查 menuLabels（locales.go），accelerator 不译 ——
// 键位跨语言一致，译它等于改键位（AC-03 要求「键位不变」）。
// 唯一不经 t() 的标签是「最近打开」里的文件名（recentLabels 的输出）：那是用户
// 自己的文件名，不是 UI 文案（SPEC §7 坑 5）。
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

	// 整个菜单共用一份语言快照：避免 SetLocale 恰好在重建中途改动 a.locale，
	// 导致同一菜单里一半新语言一半旧语言。
	locale := app.currentLocale()

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
	inkmarkMenu := appMenu.AddSubmenu(t(locale, "app.name"))
	inkmarkMenu.AddText(t(locale, "app.about"), nil, emit("menu:about"))
	inkmarkMenu.AddSeparator()
	// 「设置…」入口唯一（已从文件菜单移除）；事件名 menu:open-settings 保持不变，前端已接线
	inkmarkMenu.AddText(t(locale, "app.settings"), keys.CmdOrCtrl(","), emit("menu:open-settings"))
	inkmarkMenu.AddText(t(locale, "app.check-update"), nil, emit("menu:check-update"))
	inkmarkMenu.AddSeparator()
	// 隐藏/退出直接调 Wails runtime（不发事件，少绕一圈）；回调闭包延迟读 app.ctx，
	// 因为菜单在 wails.Run 之前构建，ctx 要到 startup 才有值。
	inkmarkMenu.AddText(t(locale, "app.hide"), keys.CmdOrCtrl("h"), func(*menu.CallbackData) {
		if app.ctx != nil {
			runtime.Hide(app.ctx)
		}
	})
	inkmarkMenu.AddSeparator()
	inkmarkMenu.AddText(t(locale, "app.quit"), keys.CmdOrCtrl("q"), func(*menu.CallbackData) {
		if app.ctx != nil {
			runtime.Quit(app.ctx)
		}
	})

	// ② 文件
	fileMenu := appMenu.AddSubmenu(t(locale, "menu.file"))
	fileMenu.AddText(t(locale, "file.new"), keys.CmdOrCtrl("n"), emit("menu:new-file"))
	fileMenu.AddSeparator()
	fileMenu.AddText(t(locale, "file.open"), keys.CmdOrCtrl("o"), emit("menu:open-file"))
	fileMenu.AddText(t(locale, "file.open-folder"), keys.Combo("o", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:open-folder"))

	// 最近打开：列表由 Go 侧持有（recents.json 持久化），前端打开文件后调
	// AddRecent → RefreshMenu 整体重建菜单。空列表显示禁用占位，避免空分组。
	recentsMenu := fileMenu.AddSubmenu(t(locale, "file.recents"))
	if len(app.recents) == 0 {
		empty := menu.Text(t(locale, "file.recents-empty"), nil, nil)
		empty.Disabled = true
		recentsMenu.Append(empty)
	} else {
		labels := recentLabels(app.recents)
		for i, p := range app.recents {
			path := p // 闭包捕获当前值
			// labels[i] 是用户自己的文件名，不查语言表（SPEC §7 坑 5）
			recentsMenu.AddText(labels[i], nil, func(*menu.CallbackData) {
				if app.ctx != nil {
					runtime.EventsEmit(app.ctx, "menu:open-recent", path)
				}
			})
		}
		recentsMenu.AddSeparator()
		recentsMenu.AddText(t(locale, "file.recents-clear"), nil, func(*menu.CallbackData) {
			app.ClearRecents()
		})
	}

	fileMenu.AddSeparator()
	fileMenu.AddText(t(locale, "file.save"), keys.CmdOrCtrl("s"), emit("menu:save"))
	fileMenu.AddText(t(locale, "file.save-as"), keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:save-as"))
	// 重命名走前端输入对话框（WKWebView 没有 window.prompt），不设 accelerator
	fileMenu.AddText(t(locale, "file.rename"), nil, emit("menu:rename"))
	fileMenu.AddSeparator()
	// 历史快照面板：低频入口，按 ADR-004 不分配快捷键（避免误触）
	fileMenu.AddText(t(locale, "file.history"), nil, emit("menu:toggle-history"))
	fileMenu.AddSeparator()
	// 打印：直接走系统打印对话框（前端 window.print()）；@media print 已隐藏 chrome、
	// 只输出预览正文，故无需另建打印视图。键位对齐 macOS 惯例 ⌘P = 打印。
	fileMenu.AddText(t(locale, "file.print"), keys.CmdOrCtrl("p"), emit("menu:print"))
	fileMenu.AddText(t(locale, "file.export-html"), keys.Combo("h", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:export-html"))
	// 非 darwin 平台一键直出不可用（ADR-003 路线 A′ 依赖 WebKit/PDFKit），
	// 菜单项保持可用不置灰，文案显式说明走系统打印；不做 tooltip（原生菜单 tooltip 不可靠）
	exportPDFKey := "file.export-pdf"
	if goruntime.GOOS != "darwin" {
		exportPDFKey = "file.export-pdf-sysprint"
	}
	// 导出 PDF 让位：⌘P 已给打印，降为 ⇧⌘P（macOS 惯例，与「打印…」区分）
	fileMenu.AddText(t(locale, exportPDFKey), keys.Combo("p", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:export-pdf"))

	// ③ 编辑（三平台统一自建，标签随语言切换）
	//
	// 为什么不用系统 EditMenu Role（2026-10-06 修正此前判断）：
	//   Role 的标题与条目在 Wails 源码里硬编码为英文（WailsMenu.m appendRole：
	//   `initWithNSTitle:@"Edit"` + Undo/Redo/Cut/Copy/Paste/Select All/Speech），
	//   Wails 不导出单项 Role、也没有标签覆盖接口 → 想本地化只能整体自建。
	//
	// 此前我判断「自建会让 ⌘C/⌘V 失效」，那次结论是错的，纠正依据（源码实测）：
	//   - 自建项经 AddMenuItem（darwin/menu.go:62-64）把 Accelerator 转成
	//     key + modifier，最终走 newMenuItem:...:keyEquivalent: 与
	//     setKeyEquivalentModifierMask: —— 即 accelerator 会正常注册为系统快捷键；
	//   - 代价只是 action 变成 Wails 的 handleClick（Go 回调）而非原生
	//     copy:/paste: selector。为此前端补齐了剪贴板读写（App.ClipboardGet /
	//     ClipboardSet + CM6 事务插入），因为 document.execCommand('paste')
	//     被浏览器安全策略禁用、不能作为实现途径。
	//   即：功能不丢，只是「谁执行」从系统 responder 链换成前端。
	//
	// 三平台统一自建还消除了原先 GOOS 分流：非 darwin 的 processMenu 根本不展开
	// Role（直接 Append(EditMenu()) 会渲染成空菜单），此前那条分支是必需的，
	// 现在不需要了。
	editMenu := appMenu.AddSubmenu(t(locale, "menu.edit"))
	editMenu.AddText(t(locale, "edit.undo"), keys.CmdOrCtrl("z"), emit("menu:undo"))
	editMenu.AddText(t(locale, "edit.redo"), keys.Combo("z", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:redo"))
	editMenu.AddSeparator()
	editMenu.AddText(t(locale, "edit.cut"), keys.CmdOrCtrl("x"), emit("menu:cut"))
	editMenu.AddText(t(locale, "edit.copy"), keys.CmdOrCtrl("c"), emit("menu:copy"))
	editMenu.AddText(t(locale, "edit.paste"), keys.CmdOrCtrl("v"), emit("menu:paste"))
	editMenu.AddText(t(locale, "edit.select-all"), keys.CmdOrCtrl("a"), emit("menu:select-all"))
	editMenu.AddSeparator()
	editMenu.AddText(t(locale, "edit.find"), keys.CmdOrCtrl("f"), emit("menu:find"))
	editMenu.AddText(t(locale, "edit.find-replace"), keys.Combo("f", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:find-replace"))
	editMenu.AddText(t(locale, "edit.jump-line"), keys.CmdOrCtrl("l"), emit("menu:jump-line"))
	editMenu.AddSeparator()
	editMenu.AddText(t(locale, "edit.move-line-up"), keys.OptionOrAlt("Up"), emit("menu:move-line-up"))
	editMenu.AddText(t(locale, "edit.move-line-down"), keys.OptionOrAlt("Down"), emit("menu:move-line-down"))
	editMenu.AddText(t(locale, "edit.dup-line"), keys.Combo("Down", keys.OptionOrAltKey, keys.ShiftKey), emit("menu:dup-line"))
	editMenu.AddText(t(locale, "edit.delete-line"), keys.Combo("k", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:delete-line"))
	editMenu.AddSeparator()
	editMenu.AddText(t(locale, "edit.copy-as-html"), nil, emit("menu:copy-as-html"))

	// ④ 格式（WYSIWYG 命令；事件名与前端 formatCommands 接线清单严格一致，不得改名）
	formatMenu := appMenu.AddSubmenu(t(locale, "menu.format"))
	headingMenu := formatMenu.AddSubmenu(t(locale, "format.heading"))
	headingMenu.AddText(t(locale, "format.h1"), keys.Combo("1", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h1"))
	headingMenu.AddText(t(locale, "format.h2"), keys.Combo("2", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h2"))
	headingMenu.AddText(t(locale, "format.h3"), keys.Combo("3", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h3"))
	headingMenu.AddText(t(locale, "format.h4"), keys.Combo("4", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h4"))
	headingMenu.AddText(t(locale, "format.h5"), keys.Combo("5", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h5"))
	headingMenu.AddText(t(locale, "format.h6"), keys.Combo("6", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h6"))
	formatMenu.AddSeparator()
	formatMenu.AddText(t(locale, "format.bold"), keys.Combo("b", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-bold"))
	formatMenu.AddText(t(locale, "format.italic"), keys.CmdOrCtrl("i"), emit("menu:format-italic"))
	formatMenu.AddText(t(locale, "format.strike"), keys.Combo("x", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-strike"))
	formatMenu.AddText(t(locale, "format.inline-code"), keys.CmdOrCtrl("`"), emit("menu:format-inline-code"))
	formatMenu.AddText(t(locale, "format.link"), keys.CmdOrCtrl("k"), emit("menu:format-link"))
	formatMenu.AddSeparator()
	formatMenu.AddText(t(locale, "format.list-bullet"), keys.Combo("8", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-bullet"))
	formatMenu.AddText(t(locale, "format.list-ordered"), keys.Combo("7", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-ordered"))
	formatMenu.AddText(t(locale, "format.list-todo"), keys.Combo("9", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-todo"))
	formatMenu.AddText(t(locale, "format.quote"), keys.Combo(".", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-quote"))
	formatMenu.AddText(t(locale, "format.code-block"), keys.Combo("c", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-code-block"))
	formatMenu.AddSeparator()
	// 插入类（图片/表格/分割线命令已存在，目录为新增；命令在 editor/commands.js）
	insertMenu := formatMenu.AddSubmenu(t(locale, "format.insert"))
	insertMenu.AddText(t(locale, "insert.image"), nil, emit("menu:insert-image"))
	insertMenu.AddText(t(locale, "insert.table"), nil, emit("menu:insert-table"))
	insertMenu.AddText(t(locale, "insert.hr"), nil, emit("menu:insert-hr"))
	insertMenu.AddText(t(locale, "insert.toc"), nil, emit("menu:insert-toc"))
	formatMenu.AddSeparator()
	// 缩进不设 accelerator：编辑器里 Tab/Shift+Tab 已由 CM indentWithTab 承接，
	// 菜单挂 Tab 键位会全局吞键，纯写作场景得不偿失
	formatMenu.AddText(t(locale, "format.indent"), nil, emit("menu:indent"))
	formatMenu.AddText(t(locale, "format.outdent"), nil, emit("menu:outdent"))
	formatMenu.AddText(t(locale, "format.clear"), nil, emit("menu:clear-format"))

	// ⑤ 视图
	viewMenu := appMenu.AddSubmenu(t(locale, "menu.view"))
	viewMenu.AddText(t(locale, "view.edit"), keys.CmdOrCtrl("1"), emit("menu:view-edit"))
	viewMenu.AddText(t(locale, "view.preview"), keys.CmdOrCtrl("2"), emit("menu:view-preview"))
	viewMenu.AddText(t(locale, "view.split"), keys.CmdOrCtrl("3"), emit("menu:view-split"))
	// 阅读模式 = 第 4 视图态（ADR-004 裁决：与 ⌘1/2/3 同族；⌘⇧R 废弃不采用）
	viewMenu.AddText(t(locale, "view.reading"), keys.CmdOrCtrl("4"), emit("menu:view-reading"))
	viewMenu.AddText(t(locale, "view.focus"), keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-focus"))
	viewMenu.AddSeparator()
	viewMenu.AddText(t(locale, "view.toggle-outline"), keys.CmdOrCtrl("b"), emit("menu:toggle-outline"))
	// 开关类：checkbox 状态真源在 Go（App.scrollSync / typewriter / alwaysOnTop），
	// 前端挂载时回读同步；菜单切换 → emitChecked 通知前端 + 落 Go 状态
	viewMenu.AddCheckbox(t(locale, "view.scroll-sync"), app.scrollSync, nil,
		emitChecked("menu:toggle-scroll-sync", app.SetScrollSync))
	viewMenu.AddCheckbox(t(locale, "view.typewriter"), app.typewriter, nil,
		emitChecked("menu:toggle-typewriter", app.SetTypewriter))
	viewMenu.AddSeparator()
	viewMenu.AddText(t(locale, "view.zoom-in"), keys.CmdOrCtrl("="), emit("menu:zoom-in"))
	viewMenu.AddText(t(locale, "view.zoom-out"), keys.CmdOrCtrl("-"), emit("menu:zoom-out"))
	viewMenu.AddText(t(locale, "view.zoom-reset"), keys.CmdOrCtrl("0"), emit("menu:zoom-reset"))
	viewMenu.AddSeparator()
	viewMenu.AddText(t(locale, "view.toggle-theme"), keys.Combo("l", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-theme"))
	// 窗口置顶放「视图」而非「窗口」：darwin 的 WindowMenu Role 同样硬编码，
	// 塞不进自定义项；置顶本质是视图行为，放这里三个平台表现一致
	viewMenu.AddCheckbox(t(locale, "view.always-on-top"), app.alwaysOnTop, nil,
		emitChecked("menu:toggle-always-on-top", app.SetAlwaysOnTop))

	// ⑥ 窗口（自建文本项，标签随语言切换）
	//
	// 为什么不用 menu.WindowMenu()：该 Role 的标题与全部条目在 Wails 源码里
	// 硬编码为英文（WailsMenu.m 的 appendRole：`initWithNSTitle:@"Window"` +
	// "Minimize"/"Zoom"/"Full Screen"），既无法本地化，也不接受追加自定义项。
	// 这三项都有精确等价的 runtime API，故自建可完整本地化且不丢功能。
	//
	// [修正] 末段原写「Edit 的 undo:/cut:/… 依赖 responder 链，自建会让 ⌘C/⌘V
	// 失效，所以 Edit 必须保留 Role」—— 该结论已在 ③ 处被源码实测推翻
	// （自建项的 accelerator 照常注册，代价只是 action 变成 Go 回调）。
	windowMenu := appMenu.AddSubmenu(t(locale, "menu.window"))
	windowMenu.AddText(t(locale, "window.minimize"), keys.CmdOrCtrl("m"), func(*menu.CallbackData) {
		if app.ctx != nil {
			runtime.WindowMinimise(app.ctx)
		}
	})
	windowMenu.AddText(t(locale, "window.zoom"), nil, func(*menu.CallbackData) {
		// 系统「缩放」是适配内容尺寸，Wails 无对应 API；
		// 用最大化/还原切换近似（WindowIsMaximised 可判定当前态，不会来回抖）。
		if app.ctx != nil {
			if runtime.WindowIsMaximised(app.ctx) {
				runtime.WindowUnmaximise(app.ctx)
			} else {
				runtime.WindowMaximise(app.ctx)
			}
		}
	})
	windowMenu.AddSeparator()
	windowMenu.AddText(t(locale, "window.fullscreen"), keys.Combo("f", keys.CmdOrCtrlKey, keys.ControlKey), func(*menu.CallbackData) {
		if app.ctx != nil {
			if runtime.WindowIsFullscreen(app.ctx) {
				runtime.WindowUnfullscreen(app.ctx)
			} else {
				runtime.WindowFullscreen(app.ctx)
			}
		}
	})

	// ⑦ 帮助
	helpMenu := appMenu.AddSubmenu(t(locale, "menu.help"))
	helpMenu.AddText(t(locale, "help.shortcuts"), keys.CmdOrCtrl("/"), emit("menu:help-shortcuts"))
	helpMenu.AddText(t(locale, "help.syntax"), nil, emit("menu:help-syntax"))

	return appMenu
}
