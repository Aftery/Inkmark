package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 文件树外部变更监听（fsnotify）。
//
// 范围：只监听当前文件夹的「一层」（非递归）。fsnotify 本身不递归，递归整棵树在
// 大仓库下句柄与开销都不可接受；一层已覆盖「在文件夹里新建/删除/重命名文件」这类
// 最常见的外部变更，子目录内部的变更在重新展开时再刷新。
//
// 去抖：一次保存/重命名常产生多个事件，合并为一次 fs:changed 推送，避免前端抖动刷新。

const watchDebounce = 250 * time.Millisecond

var (
	watchMu     sync.Mutex
	watchCancel context.CancelFunc
)

// WatchDir 开始监听 path（一层）；传空串停止监听。重复调用会替换上一个监听。
// 前端在 folderPath 变化时调用（打开 / 切换文件夹），空串用于关闭。
func (a *App) WatchDir(path string) error {
	watchMu.Lock()
	defer watchMu.Unlock()

	// 先停掉上一个监听
	if watchCancel != nil {
		watchCancel()
		watchCancel = nil
	}
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("无法访问目录: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("不是目录: %s", path)
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("创建监听失败: %w", err)
	}
	if err := w.Add(path); err != nil {
		_ = w.Close()
		return fmt.Errorf("监听目录失败: %w", err)
	}

	base := a.ctx
	if base == nil {
		base = context.Background()
	}
	ctx, cancel := context.WithCancel(base)
	watchCancel = cancel
	go a.watchLoop(ctx, w, path)
	return nil
}

// watchLoop 消费 fsnotify 事件，去抖后向前端发 fs:changed（携带被监听根目录）。
func (a *App) watchLoop(ctx context.Context, w *fsnotify.Watcher, root string) {
	defer func() { _ = w.Close() }()

	var timer *time.Timer
	fire := func() {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "fs:changed", root)
		}
	}

	for {
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case _, ok := <-w.Events:
			if !ok {
				return
			}
			if timer != nil {
				timer.Stop()
			}
			timer = time.AfterFunc(watchDebounce, fire)
		case _, ok := <-w.Errors:
			if !ok {
				return
			}
			// 监听错误不打扰用户：下一次变更仍可正常触发
		}
	}
}
