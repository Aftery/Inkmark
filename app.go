package main

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是暴露给前端的核心服务。所有「接触操作系统」的能力都收敛在这里，
// 前端通过生成的 JS 绑定直接调用这些方法（Wails 自动做 IPC）。
//
// 【2026-10-06 单栏重构：菜单态方法已下线】
// 原本这里有一批「只服务于原生菜单」的状态与方法：scrollSync / typewriter /
// alwaysOnTop 三个 checkbox 镜像、RefreshMenu、SetLocale、以及 recents 列表
// （AddRecent / ClearRecents / loadRecents / saveRecents / recentLabels）。
// 菜单改为前端自绘（TitleBar.vue）后它们全部失去调用方，已删除。
// 行为本体没有丢：滚动联动随双栏视图一起下线；打字机 / 窗口置顶改由前端直接
// 调 Wails runtime；界面语言由前端 i18n 单点持有（不再需要两侧同步）。
type App struct {
	ctx context.Context
	// dirty 是前端文档「是否落后于磁盘」状态的镜像：
	// true ⟺ 编辑器内存内容 ≠ 磁盘内容（含从未落盘的新文档）。
	// 真源在前端，此处只镜像、不读盘比对、不自行推断；由 SetDirty 写入、OnBeforeClose 读取。
	// 语义定义、生命周期与扩展路径见 docs/architecture/ADR-005-dirty-semantics.md；
	// 若扩展为多文档，本字段应升级为 docKey→dirty 映射，不得在此布尔量上叠加第二种含义。
	dirty bool
	// closing 防止关闭流程中重复弹确认框（Linux Frameless + 自定义 CloseWindow 场景）。
	closing bool
	// docDir 是当前文档所在目录的镜像（真源在前端 filePath，由 SetDocDir 写入），
	// /doc-assets/ 资源服务（docassets.go）据此把 URL 解析到磁盘文件。
	// 与 dirty 同族：「前端真源 → Go 镜像」；空串（含从未同步）= 没有已落盘文档。
	// 并发说明：资源服务跑在 asset server 的 goroutine，镜像用 atomic.Value。
	docDir atomic.Value
	// watch 是文件树监听的当前状态（见 watcher.go）。零值即「没有活跃监听」。
	watch watchState
	// locale 是「界面当前语言」的最小镜像，**只服务于 Wails 直接调用的钩子**：
	// OnBeforeClose（macOS 红绿灯）由 runtime 触发，不经过前端，拿不到当次请求
	// 的语言；此时只能读一个镜像值。除这条路之外，所有对话框的 locale 都随
	// 调用传入，不做任何持久化 —— 语言真源仍只在前端 i18n 一处（见 dialogs.go）。
	locale atomic.Value
}

// NewApp 新建 App。
func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// CloseWindow 关闭主窗口（自绘标题栏的关闭按钮调用）。
//
// 【为什么需要自己实现，以及为什么不用 runtime.Quit】
// Wails v2.16 的 runtime 包**只有 Quit、没有 WindowClose**（go doc 核实：
// pkg/runtime 的窗口方法里最小化/最大化/隐藏齐全，唯独没有「正常关闭」）。
// 而 Quit 是**强制退出**：它不走 OnBeforeClose，于是「文档有未保存更改时弹
// 确认框」这道保护会被绕过 —— 用户点一下标题栏的 × 就丢稿，且没有任何提示。
// 原生菜单时代关闭入口在系统菜单（走正常流程），菜单下线后这个缺口才暴露。
//
// 【dirty 为什么是入参而不是读镜像】watch(dirty) → SetDirty 是异步镜像，
// 用户快速输入后立即点 × 时镜像可能还是旧值（误判干净文档、直接放行丢稿）。
// 此前用「先 await SetDirty 再关 + 50ms sleep」补救，依赖的是无法证实的
// IPC 时序假设；让 dirty 随关闭请求走同一条 IPC 后不存在竞态。
// 红绿灯路径（OnBeforeClose 钩子）没有这个时序问题，仍读镜像。
// 判定本体与 OnBeforeClose 共用 confirmClose 一份，语义不得分叉（ADR-005）。
//
// 【Linux 特殊处理】
// Linux/GTK 下，自绘关闭按钮点击不会自动触发 Wails 的 OnBeforeClose 钩子
// （无边框窗口 + 自定义关闭逻辑），因此必须在这里显式调用同一套判定。
// macOS 下原生红绿灯由 Wails runtime 接管，会自动调用 OnBeforeClose，
// 但 CloseWindow 只在前端自绘按钮场景下被调用（TitleBar.vue 用 isDarwin 隔离），
// 所以两条路径互不重叠。
func (a *App) CloseWindow(dirty bool, locale string) {
	if a.ctx == nil || a.closing {
		return
	}
	a.closing = true
	// 复用 OnBeforeClose 的判定逻辑（含 dirty 检查与确认框）
	shouldBlock := a.confirmClose(a.ctx, dirty, locale)
	if !shouldBlock {
		runtime.Quit(a.ctx)
	} else {
		// 用户取消关闭，重置标志位允许下次尝试
		a.closing = false
	}
}

// ---------- 系统剪贴板 ----------

// ClipboardGet 读取系统剪贴板纯文本。
//
// 为什么需要它（不是为了「能读剪贴板」，而是绕不开的限制）：
// 原生 EditMenu Role 的标题与条目被 Wails 源码硬编码为英文且不可覆盖，
// 而自建菜单项挂的是 Wails 的 Go 回调、**挂不上原生的 copy:/paste: selector**
// —— 于是必须在前端自行完成剪贴板读写。
// 而 document.execCommand('paste') 被浏览器安全策略禁用（无用户手势 / 被 iframe
// 与权限模型限制），所以粘贴只能走系统 API 再由前端插入文档。
func (a *App) ClipboardGet() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("应用尚未初始化")
	}
	return runtime.ClipboardGetText(a.ctx)
}

// ClipboardSet 写入系统剪贴板纯文本（剪切 / 拷贝走它）。
func (a *App) ClipboardSet(text string) error {
	if a.ctx == nil {
		return fmt.Errorf("应用尚未初始化")
	}
	return runtime.ClipboardSetText(a.ctx, text)
}

// DirEntry 是文件树的一个节点（只展开一层，前端点击目录时再懒加载）
type DirEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Ext   string `json:"ext"` // 方便前端按类型显示图标
}

// ---------- 文件重命名 ----------

// RenameFile 重命名当前文档（仅限同目录改名），返回新路径供前端更新 filePath。
// 通过 window.go.main.App.RenameFile 调用（新方法，未走 wailsjs 代码生成）。
func (a *App) RenameFile(oldPath, newName string) (string, error) {
	// oldPath 必须是一个真实存在的**文件**：空串下 filepath.Dir("") 是 "."，
	// 会把文件建到进程当前工作目录（对 GUI 应用而言那是位置不明的目录）。
	// 前端只会在已落盘文档上调用，但绑定是公开入口，不能靠调用方自觉。
	if strings.TrimSpace(oldPath) == "" {
		return "", fmt.Errorf("文档路径不能为空")
	}
	info, err := os.Stat(oldPath)
	if err != nil {
		return "", fmt.Errorf("读取文件信息失败: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("不能重命名目录: %s", oldPath)
	}

	newName = strings.TrimSpace(newName)
	if newName == "" {
		return "", fmt.Errorf("文件名不能为空")
	}
	if strings.ContainsAny(newName, "/\\") {
		return "", fmt.Errorf("文件名不能包含路径分隔符")
	}
	if newName == "." || newName == ".." {
		return "", fmt.Errorf("非法的文件名: %q", newName)
	}
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	// 用 Clean 后比较而非原样字符串比较：oldPath 可能是 ./a.md 或带冗余分隔符的
	// 等价形态，直接比会把「改成同一个名字」误判成有效操作，随后 rename 到自身
	// 在多数平台上虽不报错，却会让前端拿到一个「看起来变了」的路径。
	if filepath.Clean(newPath) == filepath.Clean(oldPath) {
		return "", fmt.Errorf("文件名未变化")
	}
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("同名文件已存在: %s", newName)
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return "", fmt.Errorf("重命名失败: %w", err)
	}
	return newPath, nil
}

// ---------- 对话框 ----------
//
// 原生的三只对话框（打开 / 选目录 / 另存为）都在系统层弹出，文案只能由 Go 传给
// 系统 API。locale 参数由前端随调用传入（语言真源仍只在前端一处，见 dialogs.go）。
// 参数为 BCP-47 标签（zh-CN / en-US / ja-JP），空串按默认语言处理。

func (a *App) OpenFileDialog(locale string) (string, error) {
	t := dialogTextFor(locale)
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: t.OpenFileTitle,
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown", Pattern: "*.md;*.markdown;*.txt"},
			{DisplayName: t.OpenFileFilter, Pattern: "*.*"},
		},
	})
}

func (a *App) OpenDirectoryDialog(locale string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: dialogTextFor(locale).OpenDirTitle,
	})
}

func (a *App) SaveFileDialog(defaultName string, locale string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           dialogTextFor(locale).SaveTitle,
		DefaultFilename: defaultName,
	})
}

// ---------- 文件读写 ----------

func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取失败: %w", err)
	}
	return string(data), nil
}

// WriteFile 原子写：先写同目录临时文件，再 rename 覆盖目标。
//
// 【为什么临时名必须是唯一的】自动保存（800ms 防抖）与手动保存可能交错触发，
// 固定名 path+".tmp" 会让两次写入共用同一个临时文件：后一次截断前一次的字节，
// rename 之后落盘的就是「A 的内容被 B 写了一半」的混合体 —— 静默损坏。
// os.CreateTemp 每次给出唯一名（且落在同一目录，rename 才是同一文件系统内的原子操作）。
// 保留 ".tmp" 后缀是 README「先写 .tmp 再 rename」那条声明的口径。
//
// 【失败路径必须清理】写失败 / rename 失败都要删掉临时文件，否则用户目录里
// 会永久残留一份 .tmp 垃圾（README 已知问题 #16 同族：静默残留最难被发现）。
func (a *App) WriteFile(path string, content string) error {
	dir, base := filepath.Split(path)
	if dir == "" {
		dir = "."
	}
	tmpFile, err := os.CreateTemp(dir, base+".*.tmp")
	if err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	tmp := tmpFile.Name()
	// 命名成功之后才登记清理：CreateTemp 失败时没有文件可删。
	defer func() { _ = os.Remove(tmp) }()

	if _, err := tmpFile.WriteString(content); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("写入失败: %w", err)
	}
	// 显式 Close 而非 defer：rename 之前必须确保刷盘句柄已释放
	// （Windows 上句柄未关时 rename 会失败，且 defer 顺序会让 Close 晚于 rename）。
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	// CreateTemp 建的是 0600，按项目惯例还原成 0644
	if err := os.Chmod(tmp, 0o644); err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	return nil
}

// ---------- 目录遍历（文件树用，只返回一层） ----------

func (a *App) ListDir(path string) ([]DirEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("读取目录失败: %w", err)
	}

	result := make([]DirEntry, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		// 跳过隐藏文件和 node_modules 这类噪音
		if strings.HasPrefix(name, ".") || name == "node_modules" {
			continue
		}
		full := filepath.Join(path, name)
		result = append(result, DirEntry{
			Name:  name,
			Path:  full,
			IsDir: e.IsDir(),
			Ext:   strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), "."),
		})
	}

	// 目录在前、按名称排序，树更耐看。
	// 用 slices.SortStableFunc（Go 1.21+ 的现代写法）而非 sort.Slice：
	// 稳定性保证「大小写仅差的同名项」保持 os.ReadDir 给出的字典序，不再依赖排序算法实现。
	slices.SortStableFunc(result, func(a, b DirEntry) int {
		if a.IsDir != b.IsDir {
			if a.IsDir {
				return -1
			}
			return 1
		}
		return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return result, nil
}

// ---------- 未保存关闭拦截 ----------

// SetLocale 由前端在语言切换时调用，把当前界面语言镜像给后端。
//
// 【为什么需要这个镜像】原生「未保存」确认框有两条触发路径：
// 自绘关闭按钮（CloseWindow，locale 随参数传入）与 macOS 红绿灯 / 系统菜单
// （OnBeforeClose，Wails 直接调用，没有参数通道）。后者只能读镜像。
// 这不是「Go 侧持有语言状态」的复活：镜像只被 OnBeforeClose 读一次，
// 且不存在需要与前端对账的第二真源（前端每次切换都整值覆盖）。
func (a *App) SetLocale(locale string) {
	a.locale.Store(locale)
}

// localeSnapshot 取语言镜像；从未同步过（Load 返回 nil）按空串处理，
// 由 dialogTextFor 回落到默认语言。
func (a *App) localeSnapshot() string {
	v, _ := a.locale.Load().(string)
	return v
}

// SetDirty 由前端 watch(dirty) 调用，把「文档是否落后于磁盘」镜像到后端。
// 只接收、不推断：Go 侧不读盘比对内容；语义与生命周期以 ADR-005 为准。
// 不加锁：读写都发生在 Wails 主事件循环序列内，最坏是一次多余的确认框，不影响数据安全。
func (a *App) SetDirty(d bool) {
	a.dirty = d
}

// OnBeforeClose 在窗口关闭前由 Wails 调用，返回 true 阻止关闭（Wails 约定）。
// 读 SetDirty 镜像判定；自绘关闭按钮路径（CloseWindow）用请求携带的 dirty
// 走同一份判定，见 confirmClose。
func (a *App) OnBeforeClose(ctx context.Context) bool {
	return a.confirmClose(ctx, a.dirty, a.localeSnapshot())
}

// confirmClose 是关闭守卫的判定本体，OnBeforeClose / CloseWindow 两条路径共用，
// 语义不得分叉（ADR-005）：dirty 为假直接放行；为真弹系统确认，返回 true 阻止关闭。
// 说明：不提供「保存并退出」——项目已有 800ms 自动保存，dirty 通常只在输入后的
// 短暂窗口或「未落盘的新文档」为真，此时给一个明确的二选一即可。
func (a *App) confirmClose(ctx context.Context, dirty bool, locale string) bool {
	if !dirty {
		return false
	}
	t := dialogTextFor(locale)
	choice, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         t.UnsavedTitle,
		Message:       t.UnsavedMessage,
		Buttons:       []string{t.UnsavedCancel, t.UnsavedDiscard},
		DefaultButton: t.UnsavedCancel,
		CancelButton:  t.UnsavedCancel,
	})
	if err != nil {
		return true // 对话框异常时保守阻止关闭，避免误丢内容
	}
	// Linux/GTK 下 MessageDialog 返回值因后端而异：
	//   - 点「取消」按钮 → 取消文案 / "0" / "No"
	//   - 点「不保存退出」按钮 → 退出文案 / "1" / "Yes"
	//   - 点对话框 X / ESC → "" (空串) 或 "cancel"
	// 策略：只要不是明确的退出选择，一律视为取消（保守保护）。
	// 按文案比较时必须用**本次语言的文案** —— 写死中文会让 en/ja 界面下的
	// 「Quit Without Saving」被误判成取消，退出永远失败。
	trimmed := strings.TrimSpace(choice)
	return trimmed != t.UnsavedDiscard && trimmed != "1" && trimmed != "Yes"
}

// ---------- 图片粘贴 / 拖拽插入 ----------

const maxImageBytes = 20 << 20 // 单张图片上限 20MB

// allowedImageExt 允许的图片扩展名（前端已小写，此处再校验一次）。
var allowedImageExt = map[string]bool{
	"png": true, "jpg": true, "jpeg": true, "gif": true,
	"webp": true, "bmp": true, "svg": true, "avif": true,
}

// shortRandHex 生成 n 字节的随机 hex（图片文件名后缀，避免同毫秒冲突）。
//
// 【失败为什么必须报错而不是回退常量】旧实现在 rand.Read 失败时返回 "00000000"：
// 那会让文件名退化成「只由中国时间戳区分」，同毫秒的两张图互相覆盖 —— 用户看到的是
// 「粘了第二张，第一张不见了」，而代码里没有任何错误。宁可让这一次插图失败并提示，
// 也不能静默替换掉用户的文件。
func shortRandHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("生成文件名随机后缀失败: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// SaveImage 把粘贴/拖拽的图片写入「文档同级 assets/ 目录」，返回可写进 Markdown 的
// 相对路径（assets/<文件名>）。docPath 为空（文档尚未落盘）时返回错误。
// 输入是 base64 图片数据（DataTransfer.files 通道，见前端 imageDrop.js）。
func (a *App) SaveImage(docPath, dataBase64, ext string) (string, error) {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	if !allowedImageExt[ext] {
		return "", fmt.Errorf("不支持的图片类型: %s", ext)
	}
	raw, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return "", fmt.Errorf("图片数据解码失败: %w", err)
	}
	return writeImageAsset(docPath, raw, ext)
}

// SaveImageFromPath 把「Finder 里 ⌘C 复制的本地图片文件」读盘后写入 assets/。
// 为什么需要它：macOS 复制文件时剪贴板里只有 file URL（text/uri-list），
// 图片数据并不在剪贴板里；而 webview 受跨源策略限制无法 fetch(file://)，
// 读盘只能由 Go 侧完成（前端 imageDrop.js 的 onImagePath 通道）。
// 扩展名从路径取，白名单/大小校验与 SaveImage 完全同一套（writeImageAsset）。
func (a *App) SaveImageFromPath(docPath, srcPath string) (string, error) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(srcPath), "."))
	if !allowedImageExt[ext] {
		return "", fmt.Errorf("不支持的图片类型: %s", ext)
	}
	raw, err := os.ReadFile(srcPath)
	if err != nil {
		return "", fmt.Errorf("读取图片失败: %w", err)
	}
	return writeImageAsset(docPath, raw, ext)
}

// SaveImageFromClipboard 实现通道③：从**系统剪贴板**取图片并落盘，返回相对路径。
//
// 【为什么需要它 —— 2026-10-15 真机复验的根因】
// 前两条通道（SaveImage / SaveImageFromPath）在真机上对「复制的图片」全部落空：
// WKWebView（Safari 内核）**不把剪贴板图片暴露给 clipboardData.files / .items**，
// 也不在 text/uri-list 里给 file://。实测剪贴板里只有 public.png 等图片数据
// （osascript 'clipboard info' 证据），而 WebKit 的默认粘贴行为是
// **把文件名当纯文本插入** —— 即用户看到的「粘贴只是文件名」，全程无任何报错。
//
// 【为什么必须由 Go 读】webview 里没有合法途径同步读到系统剪贴板的二进制图片：
// fetch(file://) 被跨源策略拦死，navigator.clipboard.read() 无权限且异步
// （paste 事件里等不到）。只有进程内原生剪贴板 API 能拿到字节。
//
// 【返回空串的语义】「剪贴板里没有图片」—— 不是错误，不弹 toast。
// 前端只在「本来就没有图片通道可用」时才调它，取不到就退回默认粘贴行为，
// 用户至多看到「文件名被当文本插入」（即修复前的状态），不会更糟。
func (a *App) SaveImageFromClipboard(docPath string) (string, error) {
	pngBytes, filePath := readClipboardImageRaw()

	// ① 剪贴板里是「复制的文件」→ 与通道② 汇流（保留原始格式，不经重编码）
	if filePath != "" {
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
		if allowedImageExt[ext] {
			raw, err := os.ReadFile(filePath)
			if err == nil {
				return writeImageAsset(docPath, raw, ext)
			}
			// 读盘失败不直接返回错误：继续尝试图片数据分支（剪贴板可能两者都有）
		}
	}

	// ② 剪贴板里有图片数据 → 按魔数嗅探格式后落盘
	// 嗅探而非信任平台给的格式名：各平台口径不同（UTI / 无扩展名），
	// 字节才是唯一真源（详见 clipboard_image.go）。
	if magic := sniffImageMagic(pngBytes); magic != nil {
		return writeImageAsset(docPath, magic.Data, magic.Ext)
	}

	// 兜底：文件路径拿到了但读不出来 → 如实报错（区别于「压根没有图片」）
	if filePath != "" {
		if _, err := os.Stat(filePath); err != nil {
			return "", fmt.Errorf("读取图片失败: %w", err)
		}
		return "", fmt.Errorf("不支持的图片类型: %s", filepath.Ext(filePath))
	}
	return "", nil
}

// writeImageAsset 是两条图片通道共用的落盘实现：校验 → 建 assets/ → 命名 → 写盘。
// 校验集中在这里，两个入口（SaveImage / SaveImageFromPath）不可能各漏一套。
func writeImageAsset(docPath string, raw []byte, ext string) (string, error) {
	if strings.TrimSpace(docPath) == "" {
		return "", fmt.Errorf("文档尚未保存，无法确定图片存放位置")
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("图片数据为空")
	}
	if len(raw) > maxImageBytes {
		return "", fmt.Errorf("图片超过 %dMB 上限", maxImageBytes>>20)
	}
	dir := filepath.Join(filepath.Dir(docPath), "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("无法创建 assets 目录: %w", err)
	}
	// 文件名 img-<unix毫秒>-<随机>.<ext>：避免同毫秒 / 同名覆盖
	suffix, err := shortRandHex(4)
	if err != nil {
		return "", err
	}
	name := fmt.Sprintf("img-%d-%s.%s", time.Now().UnixMilli(), suffix, ext)
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o644); err != nil {
		return "", fmt.Errorf("写入图片失败: %w", err)
	}
	return "assets/" + name, nil
}

// ---------- 检查更新 ----------

const (
	// latestReleaseAPI GitHub「最新 Release」接口。仓库尚无 Release 时返回 404。
	latestReleaseAPI = "https://api.github.com/repos/Aftery/Inkmark/releases/latest"
	// releasesPageURL 兜底下载页（无 Release / 解析失败时指向 releases 列表）。
	releasesPageURL = "https://github.com/Aftery/Inkmark/releases"
	// updateCheckTimeout 网络超时上限，避免离线时界面长时间无响应。
	updateCheckTimeout = 5 * time.Second
)

// UpdateInfo 是「检查更新」的返回结构（直接序列化给前端）。
//
// 用 Status 做三态判定而非让前端猜 note 文本：
//   - "update" 发现新版本；"latest" 已是最新；"error" 无法检查。
//
// error 覆盖超时 / 网络失败 / 404（仓库无 Release）/ 非 200 / 返回不可解析等情况，
// 绝不会谎报「已是最新」。
type UpdateInfo struct {
	Status    string `json:"status"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	HasUpdate bool   `json:"hasUpdate"`
	URL       string `json:"url"`
	Note      string `json:"note"`
}

// semver 只保留比较所需的 major.minor.patch（预发布/构建后缀在解析时丢弃）。
type semver [3]int

// parseSemver 从版本串取 major.minor.patch：容忍前导 v 与 -/+ 后缀，缺段补 0。
// 段数超过 3 或含非十进制数字则失败（返回 ok=false，调用方据此走「无法比较」）。
func parseSemver(s string) (semver, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return semver{}, false
	}
	parts := strings.Split(s, ".")
	if len(parts) > 3 {
		return semver{}, false
	}
	var out semver
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return semver{}, false
		}
		out[i] = n
	}
	return out, true
}

// compareSemver 返回 a 与 b 的大小关系：a>b 为正，a==b 为 0，a<b 为负。
// 逐段比较等价于 slices.Compare(a[:], b[:])，但省掉切片分配与 reflect 化路径；
// 语义（含返回符号）与基准包保持一致，调用方只判符号。
func compareSemver(a, b semver) int {
	for i := range a {
		if c := cmp.Compare(a[i], b[i]); c != 0 {
			return c
		}
	}
	return 0
}

// CheckUpdate 查询 GitHub 最新 Release，与当前 version 做 semver 比较。
//
// 全程优雅降级：任何失败都返回 Status="error" + 可读 Note，不抛 panic、不弹窗，
// 也绝不把「查不到」伪装成「已是最新」。
// 说明：仓库当前尚无 Release，接口会返回 404 → 本函数返回「无法检查更新：暂无已发布的版本」，
// 这是预期内的正常降级，打出第一个 Release 后即返回真实结果。
func (a *App) CheckUpdate() UpdateInfo {
	info := UpdateInfo{Status: "error", Current: version, URL: releasesPageURL}

	ctx, cancel := context.WithTimeout(context.Background(), updateCheckTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseAPI, nil)
	if err != nil {
		info.Note = "无法检查更新：请求构造失败"
		return info
	}
	// GitHub API 要求带 User-Agent，缺失会被 403。
	req.Header.Set("User-Agent", "Inkmark-UpdateCheck")
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		info.Note = "无法检查更新：网络连接失败"
		return info
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		info.Note = "无法检查更新：暂无已发布的版本"
		return info
	case resp.StatusCode != http.StatusOK:
		info.Note = fmt.Sprintf("无法检查更新：服务返回 %d", resp.StatusCode)
		return info
	}

	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	// 限长读取，避免异常响应体撑爆内存。
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		info.Note = "无法检查更新：返回内容无法解析"
		return info
	}
	latest := strings.TrimSpace(release.TagName)
	if latest == "" {
		info.Note = "无法检查更新：发布信息缺少版本号"
		return info
	}
	if release.HTMLURL != "" {
		info.URL = release.HTMLURL
	}
	info.Latest = latest

	cur, curOK := parseSemver(version)
	lat, latOK := parseSemver(latest)
	if !curOK || !latOK {
		info.Note = "无法检查更新：版本号格式无法比较"
		return info
	}

	if compareSemver(lat, cur) > 0 {
		info.Status = "update"
		info.HasUpdate = true
		info.Note = fmt.Sprintf("发现新版本 %s（当前 %s）", latest, version)
		return info
	}
	info.Status = "latest"
	info.Note = fmt.Sprintf("已是最新版本（%s）", version)
	return info
}
