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
		OnStartup: app.startup,
		Bind:      []interface{}{app},
		Menu:      buildMenu(app),
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
// 因此必须把 AppMenu / EditMenu / WindowMenu 三个 Role 手动拼回来 ——
// 尤其 EditMenu：丢了它，编辑器里的 ⌘C/⌘V/⌘X/撤销/全选 会全部失效。
//
// 菜单项不在 Go 侧做业务，只向前端发事件（业务逻辑统一在前端，避免两处维护）。
func buildMenu(app *App) *menu.Menu {
	// 回调闭包延迟读取 app.ctx：菜单在 wails.Run 之前构建，ctx 要到 startup 才有值
	emit := func(event string) func(*menu.CallbackData) {
		return func(*menu.CallbackData) {
			if app.ctx != nil {
				runtime.EventsEmit(app.ctx, event)
			}
		}
	}

	appMenu := menu.NewMenu()

	// ① AppMenu Role 必须排第一 —— macOS 用第一个子菜单做「应用菜单」（关于/退出）
	appMenu.Append(menu.AppMenu())

	// ② 文件
	fileMenu := appMenu.AddSubmenu("文件")
	fileMenu.AddText("打开文件…", keys.CmdOrCtrl("o"), emit("menu:open-file"))
	fileMenu.AddText("打开文件夹…", keys.Combo("o", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:open-folder"))
	fileMenu.AddSeparator()
	fileMenu.AddText("保存", keys.CmdOrCtrl("s"), emit("menu:save"))
	fileMenu.AddText("另存为…", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:save-as"))
	// 历史快照面板：低频入口，按 ADR-004 不分配快捷键（避免误触）
	fileMenu.AddText("历史快照…", nil, emit("menu:toggle-history"))
	fileMenu.AddSeparator()
	fileMenu.AddText("导出 HTML…", keys.Combo("h", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:export-html"))
	// 非 darwin 平台一键直出不可用（ADR-003 路线 A′ 依赖 WebKit/PDFKit），
	// 菜单项保持可用不置灰，文案显式说明走系统打印；不做 tooltip（原生菜单 tooltip 不可靠）
	exportPDFTitle := "导出 PDF…"
	if goruntime.GOOS != "darwin" {
		exportPDFTitle = "导出 PDF…（本平台走系统打印）"
	}
	fileMenu.AddText(exportPDFTitle, keys.CmdOrCtrl("p"), emit("menu:export-pdf"))

	// ③ 编辑（macOS 必需：撤销/剪切/拷贝/粘贴/全选）
	appMenu.Append(menu.EditMenu())

	// ④ 格式（WYSIWYG 命令；事件名与前端 formatCommands 接线清单严格一致，不得改名）
	formatMenu := appMenu.AddSubmenu("格式")
	formatMenu.AddText("加粗", keys.Combo("b", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-bold"))
	formatMenu.AddText("斜体", keys.CmdOrCtrl("i"), emit("menu:format-italic"))
	formatMenu.AddText("删除线", keys.Combo("x", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-strike"))
	formatMenu.AddText("行内代码", keys.CmdOrCtrl("`"), emit("menu:format-inline-code"))
	formatMenu.AddText("链接", keys.CmdOrCtrl("k"), emit("menu:format-link"))
	formatMenu.AddSeparator()
	formatMenu.AddText("标题一", keys.Combo("1", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h1"))
	formatMenu.AddText("标题二", keys.Combo("2", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h2"))
	formatMenu.AddText("标题三", keys.Combo("3", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h3"))
	formatMenu.AddText("标题四", keys.Combo("4", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h4"))
	formatMenu.AddText("标题五", keys.Combo("5", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h5"))
	formatMenu.AddText("标题六", keys.Combo("6", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-h6"))
	formatMenu.AddSeparator()
	formatMenu.AddText("无序列表", keys.Combo("8", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-bullet"))
	formatMenu.AddText("有序列表", keys.Combo("7", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-ordered"))
	formatMenu.AddText("任务列表", keys.Combo("9", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-list-todo"))
	formatMenu.AddText("引用块", keys.Combo(".", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:format-quote"))
	formatMenu.AddText("代码块", keys.Combo("c", keys.CmdOrCtrlKey, keys.OptionOrAltKey), emit("menu:format-code-block"))

	// ⑤ 视图
	viewMenu := appMenu.AddSubmenu("视图")
	viewMenu.AddText("编辑模式", keys.CmdOrCtrl("1"), emit("menu:view-edit"))
	viewMenu.AddText("预览模式", keys.CmdOrCtrl("2"), emit("menu:view-preview"))
	viewMenu.AddText("双栏模式", keys.CmdOrCtrl("3"), emit("menu:view-split"))
	// 阅读模式 = 第 4 视图态（ADR-004 裁决：与 ⌘1/2/3 同族；⌘⇧R 废弃不采用）
	viewMenu.AddText("阅读模式", keys.CmdOrCtrl("4"), emit("menu:view-reading"))
	viewMenu.AddSeparator()
	viewMenu.AddText("专注模式", keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-focus"))
	viewMenu.AddSeparator()
	viewMenu.AddText("显示/隐藏大纲", keys.CmdOrCtrl("b"), emit("menu:toggle-outline"))
	viewMenu.AddText("切换主题", keys.Combo("l", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-theme"))

	// ⑥ 窗口（最小化/缩放）
	appMenu.Append(menu.WindowMenu())

	return appMenu
}
