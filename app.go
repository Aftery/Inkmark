package main

import (
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
	"sort"
	"strconv"
	"strings"
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
//（无边框窗口 + 自定义关闭逻辑），因此必须在这里显式调用同一套判定。
// macOS 下原生红绿灯由 Wails runtime 接管，会自动调用 OnBeforeClose，
// 但 CloseWindow 只在前端自绘按钮场景下被调用（TitleBar.vue 用 isDarwin 隔离），
// 所以两条路径互不重叠。
func (a *App) CloseWindow(dirty bool) {
	if a.ctx == nil || a.closing {
		return
	}
	a.closing = true
	// 复用 OnBeforeClose 的判定逻辑（含 dirty 检查与确认框）
	shouldBlock := a.confirmClose(a.ctx, dirty)
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
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return "", fmt.Errorf("文件名不能为空")
	}
	if strings.ContainsAny(newName, "/\\") {
		return "", fmt.Errorf("文件名不能包含路径分隔符")
	}
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if newPath == oldPath {
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

func (a *App) OpenFileDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown", Pattern: "*.md;*.markdown;*.txt"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
}

func (a *App) OpenDirectoryDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文件夹",
	})
}

func (a *App) SaveFileDialog(defaultName string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出 / 另存为",
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

func (a *App) WriteFile(path string, content string) error {
	// 写临时文件再 rename，避免写到一半崩溃留下半个文件
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	return os.Rename(tmp, path)
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

	// 目录在前、按名称排序，树更耐看
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
}

// ---------- 未保存关闭拦截 ----------

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
	return a.confirmClose(ctx, a.dirty)
}

// confirmClose 是关闭守卫的判定本体，OnBeforeClose / CloseWindow 两条路径共用，
// 语义不得分叉（ADR-005）：dirty 为假直接放行；为真弹系统确认，返回 true 阻止关闭。
// 说明：不提供「保存并退出」——项目已有 800ms 自动保存，dirty 通常只在输入后的
// 短暂窗口或「未落盘的新文档」为真，此时给一个明确的二选一即可。
func (a *App) confirmClose(ctx context.Context, dirty bool) bool {
	if !dirty {
		return false
	}
	choice, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         "未保存的更改",
		Message:       "当前文档有未保存的更改，确定要退出吗？",
		Buttons:       []string{"取消", "不保存退出"},
		DefaultButton: "取消",
		CancelButton:  "取消",
	})
	if err != nil {
		return true // 对话框异常时保守阻止关闭，避免误丢内容
	}
	// Linux/GTK 下 MessageDialog 返回值因后端而异：
	//   - 点"取消"按钮 → "取消" / "0" / "No"
	//   - 点"不保存退出"按钮 → "不保存退出" / "1" / "Yes"
	//   - 点对话框 X / ESC → "" (空串) 或 "cancel"
	// 策略：只要不是明确的退出选择，一律视为取消（保守保护）。
	trimmed := strings.TrimSpace(choice)
	return trimmed != "不保存退出" && trimmed != "1" && trimmed != "Yes"
}

// ---------- 图片粘贴 / 拖拽插入 ----------

const maxImageBytes = 20 << 20 // 单张图片上限 20MB

// allowedImageExt 允许的图片扩展名（前端已小写，此处再校验一次）。
var allowedImageExt = map[string]bool{
	"png": true, "jpg": true, "jpeg": true, "gif": true,
	"webp": true, "bmp": true, "svg": true, "avif": true,
}

// shortRandHex 生成 n 字节的随机 hex（图片文件名后缀，避免同毫秒冲突）。
func shortRandHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "00000000"
	}
	return hex.EncodeToString(b)
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
	name := fmt.Sprintf("img-%d-%s.%s", time.Now().UnixMilli(), shortRandHex(4), ext)
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
func compareSemver(a, b semver) int {
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			if a[i] > b[i] {
				return 1
			}
			return -1
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
