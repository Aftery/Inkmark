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
	// watchGen 是「当前监听代号」：WatchDir 每次停掉 / 新建监听时，在 watchMu
	// 临界区内自增。去抖回调在建立时记下代号，触发时与当前值不符即说明该监听
	// 已被替换或停止，不再推送——否则切换文件夹的瞬间，旧监听残留的去抖定时器
	// 仍会把已失效目录的 fs:changed 推给前端（陈旧 payload，前端会刷新错误的树）。
	watchGen uint64
)

// WatchDir 开始监听 path（一层）；传空串停止监听。重复调用会替换上一个监听。
// 前端在 folderPath 变化时调用（打开 / 切换文件夹），空串用于关闭。
func (a *App) WatchDir(path string) error {
	watchMu.Lock()
	defer watchMu.Unlock()

	// 先停掉上一个监听。代号自增必须与取消同处 watchMu 临界区：去抖回调要么
	// 看到「旧监听仍完整存活」，要么看到「已失效」，不存在可被观察的中间态；
	// 且即使本次调用因路径非法而失败返回，旧监听残留的定时器也一并失效。
	if watchCancel != nil {
		watchCancel()
		watchCancel = nil
	}
	watchGen++
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
	gen := watchGen
	ctx, cancel := context.WithCancel(base)
	watchCancel = cancel
	go a.watchLoop(ctx, w, path, gen)
	return nil
}

// watchLoop 消费 fsnotify 事件，去抖后向前端发 fs:changed（携带被监听根目录）。
func (a *App) watchLoop(ctx context.Context, w *fsnotify.Watcher, root string, gen uint64) {
	defer func() { _ = w.Close() }()

	var timer *time.Timer
	fire := func() {
		watchMu.Lock()
		live := watchGen == gen
		watchMu.Unlock()
		// live 为假 = 监听已被替换 / 停止（WatchDir 在同一把锁内先取消再自增代号），
		// 此时推送只会把陈旧目录路径送给前端；a.ctx 为 nil 仅见于 startup 之前的防御路径。
		if !live || a.ctx == nil {
			return
		}
		runtime.EventsEmit(a.ctx, "fs:changed", root)
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
