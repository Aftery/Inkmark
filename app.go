package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是暴露给前端的核心服务。所有"接触操作系统"的能力都收敛在这里，
// 前端通过生成的 JS 绑定直接调用这些方法（Wails 自动做 IPC）。
type App struct {
	ctx   context.Context
	dirty bool // 未保存更改标记：由前端 SetDirty 同步，OnBeforeClose 读取
}

// DirEntry 是文件树的一个节点（只展开一层，前端点击目录时再懒加载）
type DirEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Ext     string `json:"ext"` // 方便前端按类型显示图标
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// SetDirty 由前端 watch(dirty) 调用，把未保存状态同步到后端。
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
