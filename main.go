package main

import (
	"embed"

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
	fileMenu.AddSeparator()
	fileMenu.AddText("导出 HTML…", keys.Combo("h", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:export-html"))
	fileMenu.AddText("导出 PDF…", keys.CmdOrCtrl("p"), emit("menu:export-pdf"))

	// ③ 编辑（macOS 必需：撤销/剪切/拷贝/粘贴/全选）
	appMenu.Append(menu.EditMenu())

	// ④ 视图
	viewMenu := appMenu.AddSubmenu("视图")
	viewMenu.AddText("编辑模式", keys.CmdOrCtrl("1"), emit("menu:view-edit"))
	viewMenu.AddText("预览模式", keys.CmdOrCtrl("2"), emit("menu:view-preview"))
	viewMenu.AddText("双栏模式", keys.CmdOrCtrl("3"), emit("menu:view-split"))
	viewMenu.AddSeparator()
	viewMenu.AddText("专注模式", keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-focus"))
	viewMenu.AddSeparator()
	viewMenu.AddText("显示/隐藏大纲", keys.CmdOrCtrl("b"), emit("menu:toggle-outline"))
	viewMenu.AddText("切换主题", keys.Combo("l", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-theme"))

	// ⑤ 窗口（最小化/缩放）
	appMenu.Append(menu.WindowMenu())

	return appMenu
}
