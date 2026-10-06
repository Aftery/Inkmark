package main

import (
	"embed"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

// main 是纯应用入口：窗口形态 + 启动。业务与系统能力全在 app.go。
//
// 【原生菜单已整体下线（2026-10-06 单栏重构）】
// 此前 buildMenu()（约 300 行）在这里注册原生应用菜单，现已整段删除，
// 连带删除的还有 locales.go 的 Go 侧菜单语言表、app.go 的 RefreshMenu /
// SetLocale / 三个 checkbox 镜像与 recents 菜单态。
// 删除理由（不是「原生菜单做不了自定义」，而是三条实测约束）：
//  1. Role 不可本地化：AppMenu/EditMenu/WindowMenu 的标题与全部条目在 Wails
//     源码里硬编码为英文，且 v2.16.0 不导出单项 Role（menuroles.go 内被块注释），
//     想中文化只能整体自建 —— 而自建后就失去了「一份 accelerator 真源」。
//  2. 非 darwin 平台 Role 根本不展开（processMenu 只读 Label/SubMenu），
//     跨平台行为不一致。
//  3. 无边框窗口下原生菜单无处安放：菜单会浮到屏幕顶部脱离窗口，
//     与自绘标题栏（TitleBar.vue）风格割裂。
//
// 键位真源随之**迁移到前端**（frontend/src/composables/useShortcuts.js 的
// COMMANDS 表 + 统一分发），门禁 scripts/verify/verify-shortcuts.mjs 改为
// 解析该表 —— 详见该脚本头注。
//
// 【窗口形态按平台差异化 —— 为什么不能一套参数走天下】
//
//	darwin（毛玻璃优先）：
//	  Frameless: false + mac.TitleBarHidden()
//	    - TitleBarHidden() = { TitlebarAppearsTransparent, HideTitle, FullSizeContent }
//	      即「隐藏原生长条、保留红绿灯、内容铺满整个窗口」。
//	      注：Wails v2.16 **没有** TitleBarHiddenWithFullSizeContent 这个构造器
//	      （go doc 核实 pkg/options/mac/titlebar.go 只有 Default/Hidden/HiddenInset），
//	      TitleBarHidden() 正是需求里那句描述对应的 API。
//	    - Frameless 必须为 false：无边框窗口会连红绿灯一起吃掉，就失去了
//	      macOS 的原生观感；代价是 --wails-draggable 拖拽区失效（系统标题栏
//	      区域仍可拖动，够用），故 darwin 侧不做窗口按钮（TitleBar 用
//	      v-if="!isDarwin" 隐藏，见 components/TitleBar.vue）。
//	  WebviewIsTransparent + WindowIsTranslucent：打开系统级 Vibrant 毛玻璃；
//	  CSS 侧必须让出底色才能透出材质（themes/platform-darwin.css）。
//
//	linux / windows（纯净无边框优先，如 CachyOS 的高性能混成器）：
//	  Frameless: true —— 标题栏 / 菜单 / 窗口按钮全部前端自绘，
//	  这也是 --wails-draggable 拖拽区生效的前置条件。
//	  不开透明：合成器下透明窗口的重绘代价与撕裂风险都高于收益。
//
// 【关闭守卫】OnBeforeClose 读 app.go 里由前端 SetDirty 实时同步的镜像值：
// 为 true 时弹系统确认框，防止未保存内容丢失。CloseWindow（自绘关闭按钮）
// 走同一套判定，不直接 Quit —— Quit 是强制退出，会绕过这道确认。
func main() {
	app := NewApp()

	opts := &options.App{
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
	}

	// Menu 保持 nil（原生菜单已下线；显式不写即零值，此处注释即裁决）
	if goruntime.GOOS == "darwin" {
		opts.Frameless = false // 保留红绿灯
		opts.Mac = &mac.Options{
			TitleBar:             mac.TitleBarHidden(),
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		}
	} else {
		opts.Frameless = true // 无边框纯净模式：标题栏/菜单/窗口按钮全自绘
	}

	if err := wails.Run(opts); err != nil {
		println("Error:", err.Error())
	}
}
