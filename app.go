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
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是暴露给前端的核心服务。所有"接触操作系统"的能力都收敛在这里，
// 前端通过生成的 JS 绑定直接调用这些方法（Wails 自动做 IPC）。
type App struct {
	ctx context.Context
	// dirty 是前端文档「是否落后于磁盘」状态的镜像：
	// true ⟺ 编辑器内存内容 ≠ 磁盘内容（含从未落盘的新文档）。
	// 真源在前端，此处只镜像、不读盘比对、不自行推断；由 SetDirty 写入、OnBeforeClose 读取。
	// 语义定义、生命周期与扩展路径见 docs/architecture/ADR-005-dirty-semantics.md；
	// 若扩展为多文档，本字段应升级为 docKey→dirty 映射，不得在此布尔量上叠加第二种含义。
	dirty bool

	// mu 保护下方可变 UI 状态（菜单回调 / 前端 IPC 两个入口并发触碰）。
	mu sync.Mutex
	// 滚动联动 / 打字机模式 / 窗口置顶：菜单 checkbox 的初始态真源在 Go。
	// 行为本体在前端；前端挂载时回读自身 localStorage 后调 Set* 同步到这里，
	// 菜单切换时 emitChecked 先落这里、再广播事件给前端。
	scrollSync   bool
	typewriter   bool
	alwaysOnTop  bool
	recents      []string // 最近打开的文件（新 → 旧，上限 recentFileLimit）
}

// recentFileLimit 最近打开列表上限（菜单里超过 10 项的列表没有检索价值）
const recentFileLimit = 10

// DirEntry 是文件树的一个节点（只展开一层，前端点击目录时再懒加载）
type DirEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Ext     string `json:"ext"` // 方便前端按类型显示图标
}

func NewApp() *App {
	return &App{scrollSync: true} // 滚动联动默认开（历史行为）
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadRecents()
}

// ---------- 菜单状态（checkbox / 最近打开） ----------

// SetScrollSync 由前端挂载时回读 localStorage 后调用，同步 checkbox 初始态。
func (a *App) SetScrollSync(v bool) {
	a.mu.Lock()
	a.scrollSync = v
	a.mu.Unlock()
}

// SetTypewriter 同上。
func (a *App) SetTypewriter(v bool) {
	a.mu.Lock()
	a.typewriter = v
	a.mu.Unlock()
}

// SetAlwaysOnTop 由菜单 checkbox 回调调用：落状态 + 应用到窗口。
func (a *App) SetAlwaysOnTop(v bool) {
	a.mu.Lock()
	a.alwaysOnTop = v
	a.mu.Unlock()
	if a.ctx != nil {
		runtime.WindowSetAlwaysOnTop(a.ctx, v)
	}
}

// RefreshMenu 用当前状态整体重建应用菜单。
// 最近打开列表 / checkbox 状态变化后调用（MenuSetApplicationMenu 是 v2 提供的
// 唯一菜单更新通道——整体替换，不做增量）。
func (a *App) RefreshMenu() {
	if a.ctx == nil {
		return
	}
	runtime.MenuSetApplicationMenu(a.ctx, buildMenu(a))
}

// AddRecent 前端成功打开文件后调用：去重置顶、截断上限、持久化并重建菜单。
func (a *App) AddRecent(path string) {
	if strings.TrimSpace(path) == "" {
		return
	}
	a.mu.Lock()
	out := []string{path}
	for _, p := range a.recents {
		if p != path && len(out) < recentFileLimit {
			out = append(out, p)
		}
	}
	a.recents = out
	a.mu.Unlock()
	a.saveRecents()
	a.RefreshMenu()
}

// ClearRecents 清空最近打开列表（文件菜单入口）。
func (a *App) ClearRecents() {
	a.mu.Lock()
	a.recents = nil
	a.mu.Unlock()
	a.saveRecents()
	a.RefreshMenu()
}

// recentLabels 生成展示名：默认文件名；重名时追加「 — 上级目录名」消歧。
func recentLabels(paths []string) []string {
	counts := make(map[string]int, len(paths))
	for _, p := range paths {
		counts[filepath.Base(p)]++
	}
	labels := make([]string, len(paths))
	for i, p := range paths {
		base := filepath.Base(p)
		if counts[base] > 1 {
			labels[i] = base + " — " + filepath.Base(filepath.Dir(p))
		} else {
			labels[i] = base
		}
	}
	return labels
}

// recentsPath 配置文件位置：<UserConfigDir>/inkmark/recents.json；拿不到目录返回空串跳过持久化。
func (a *App) recentsPath() string {
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "inkmark", "recents.json")
}

func (a *App) loadRecents() {
	p := a.recentsPath()
	if p == "" {
		return
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return // 首次启动无文件，正常
	}
	var list []string
	if json.Unmarshal(data, &list) == nil {
		a.recents = list
	}
}

func (a *App) saveRecents() {
	p := a.recentsPath()
	if p == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return
	}
	a.mu.Lock()
	data, err := json.Marshal(a.recents)
	a.mu.Unlock()
	if err == nil {
		_ = os.WriteFile(p, data, 0o644)
	}
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
// 有未保存更改时弹系统确认：取消 → 阻止；不保存退出 → 放行。
// 说明：不提供「保存并退出」——项目已有 800ms 自动保存，dirty 通常只在输入后的
// 短暂窗口或「未落盘的新文档」为真，此时给一个明确的二选一即可。
func (a *App) OnBeforeClose(ctx context.Context) bool {
	if !a.dirty {
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
	return choice != "不保存退出"
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
func (a *App) SaveImage(docPath, dataBase64, ext string) (string, error) {
	if strings.TrimSpace(docPath) == "" {
		return "", fmt.Errorf("文档尚未保存，无法确定图片存放位置")
	}
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	if !allowedImageExt[ext] {
		return "", fmt.Errorf("不支持的图片类型: %s", ext)
	}
	raw, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return "", fmt.Errorf("图片数据解码失败: %w", err)
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
