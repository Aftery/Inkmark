package main

import (
	"context"
	"fmt"
	"log"
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

// watchState 是「当前监听」的全部可变状态。
//
// 【为什么是 App 的字段而不是包级变量】监听的生命周期属于 App 实例（WatchDir 是
// 它的绑定方法），状态挂在包级 = 隐式全局单例：多实例（测试、未来的多窗口）会
// 互相踩，且测试无法在不碰全局的情况下并行。收进结构体后，「监听状态归谁」在类型
// 上就写明了。
//
// 【为什么单开一把锁而不是复用 App 的其它字段】临界区只有两处（WatchDir 建立 /
// fire 校验），粒度极细、绝不与 IO 或 UI 调用交织 —— 这正是它不会成为性能点、
// 也不会造成锁序反转的原因。
type watchState struct {
	mu sync.Mutex
	// cancel 停掉当前监听的 context；nil 表示没有活跃监听。
	cancel context.CancelFunc
	// gen 是「当前监听代号」：WatchDir 每次停掉 / 新建监听时，在 mu 临界区内自增。
	// 去抖回调在建立时记下代号，触发时与当前值不符即说明该监听已被替换或停止，
	// 不再推送——否则切换文件夹的瞬间，旧监听残留的去抖定时器仍会把已失效目录的
	// fs:changed 推给前端（陈旧 payload，前端会刷新错误的树）。
	gen uint64
}

// WatchDir 开始监听 path（一层）；传空串停止监听。重复调用会替换上一个监听。
// 前端在 folderPath 变化时调用（打开 / 切换文件夹），空串用于关闭。
func (a *App) WatchDir(path string) error {
	a.watch.mu.Lock()
	defer a.watch.mu.Unlock()

	// 先停掉上一个监听。代号自增必须与取消同处临界区：去抖回调要么
	// 看到「旧监听仍完整存活」，要么看到「已失效」，不存在可被观察的中间态；
	// 且即使本次调用因路径非法而失败返回，旧监听残留的定时器也一并失效。
	if a.watch.cancel != nil {
		a.watch.cancel()
		a.watch.cancel = nil
	}
	a.watch.gen++
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
	gen := a.watch.gen
	ctx, cancel := context.WithCancel(base)
	a.watch.cancel = cancel
	// emitCtx 与 gen 一起「快照」给 goroutine：goroutine 内不再读 a.ctx / a.watch.gen
	// 这类会被别处改写的字段，避免「起 goroutine 之后字段又被改」的读写竞争
	// （a.ctx 在 startup 写入、fire 在 watcher goroutine 读，此前就属这类跨 goroutine 读）。
	go a.watchLoop(ctx, w, path, gen, base)
	return nil
}

// watchLoop 消费 fsnotify 事件，去抖后向前端发 fs:changed（携带被监听根目录）。
// emitCtx 是建立监听时的 App ctx 快照（见 WatchDir），用于 EventsEmit。
func (a *App) watchLoop(ctx context.Context, w *fsnotify.Watcher, root string, gen uint64, emitCtx context.Context) {
	defer func() { _ = w.Close() }()

	// fire 是去抖到期后的唯一推送动作。live 代际校验照旧：监听被替换/停止后
	// 残留的定时器不得把陈旧目录推给前端。
	fire := func() {
		a.watch.mu.Lock()
		live := a.watch.gen == gen
		a.watch.mu.Unlock()
		// live 为假 = 监听已被替换 / 停止（WatchDir 在同一把锁内先取消再自增代号），
		// 此时推送只会把陈旧目录路径送给前端；emitCtx 为 nil 仅见于 startup 之前的防御路径。
		if !live || emitCtx == nil {
			return
		}
		runtime.EventsEmit(emitCtx, "fs:changed", root)
	}

	// 去抖本体抽成独立函数（见 runDebounced）：它不碰 Wails runtime，可被
	// Go 测试直接驱动 —— 「去抖语义」从此是被钉死的契约，而不是只能靠真机目视。
	// fsnotify 错误通道一并交给它：监听内部错误不打扰用户，但必须留痕
	// （静默吞掉会让「监听已死」无从排查，README 已知问题 #6 的建议落地）。
	runDebounced(ctx, w.Events, w.Errors, fire)
}

// runDebounced 是去抖本体（生产入口，窗口固定为 watchDebounce）。
func runDebounced(ctx context.Context, events <-chan fsnotify.Event, errs <-chan error, onFire func()) {
	runDebouncedWindow(ctx, events, errs, onFire, watchDebounce)
}

// runDebouncedWindow 是去抖本体：消费 events，每个事件把去抖窗口重置到「现在 + 窗口」，
// 窗口内无新事件才调用 onFire 一次。errs 只用于记日志（不触发推送、不中断监听）。
//
// 【为什么窗口做成入参，而不是写死常量】
// 窗口若写死，测试要么按 250ms 真等（每个用例多花 0.3s），要么**复制一份实现**
// 到测试里 —— 后者就是本仓 §4 ⑱⑲ 记过的假绿灯（「断言了条数不等于断言了行为」
// 「源码正则守不住接线」）：测的是副本，改的是本体。
// 故本体把窗口作为入参，测试直接驱动**本体**、只把窗口调小。
//
// 【为什么独立成函数 —— 为了可测】
// 原实现内嵌在 watchLoop 里，而 watchLoop 末尾调 runtime.EventsEmit，
// 那需要 Wails runtime 才能跑，Go 测试里无法直接驱动。抽出来后，
// watcher_test.go 用真实 time 与注入通道即可把语义钉死：
//
//	① 窗口内的一批事件 → 只触发 1 次；
//	② 跨窗口的两次独立变更 → 触发 2 次（**这是正确行为，不是缺陷**）；
//	③ 簇跨度超窗口但事件连续到达 → 仍只触发 1 次；
//	④ ctx 取消 → 立即退出，不再触发。
//
// 【串行状态机：定时器与事件在同一个 select 里】
// 用 *time.Timer + Reset（而非 time.AfterFunc）让「到期」回到本 goroutine 的
// select 通道，与事件到达**严格串行**。AfterFunc 的回调跑在独立 goroutine，
// 与事件循环并发；实测 200/200 命中「定时器已到期时 Stop() 返回 false、
// 停不掉已在执行的回调」这一 API 事实。旧写法真正的毛病不是「会多推一次」
// （实测同批变更只推 1 次），而是**行为取决于调度顺序**——
// 「能跑≠行为确定」。去掉并发后，行为只由事件到达时刻决定。
func runDebouncedWindow(ctx context.Context, events <-chan fsnotify.Event, errs <-chan error, onFire func(), window time.Duration) {
	// timer 为 nil 表示「当前没有待触发的去抖」
	var timer *time.Timer
	var timerC <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()

	for {
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case <-timerC:
			// 去抖到期：触发一次，并把定时器归位（下一批事件重新起算一个周期）
			timerC = nil
			onFire()
		case _, ok := <-events:
			if !ok {
				if timer != nil {
					timer.Stop()
				}
				return
			}
			// 新事件：把去抖窗口重置到「现在 + 窗口」。
			// 若定时器已到期（timerC 已消费、fire 已发出），这里起的是**新的一轮**
			// —— 那说明这批事件确实晚于上一轮去抖窗口，属于独立的后续变更，
			// 应当再触发一次（这与「同一次保存被拆成两次」是两件事，不可混同）。
			if timer == nil {
				timer = time.NewTimer(window)
			} else {
				if !timer.Stop() {
					// 定时器已到期且其值已被消费（timerC 已是 nil）：无需 drain
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(window)
			}
			timerC = timer.C
		case err, ok := <-errs:
			if !ok {
				if timer != nil {
					timer.Stop()
				}
				return
			}
			// 监听错误不打扰用户（下一次变更仍可正常触发），但必须留痕：
			// 静默吞掉会让「监听已死」无从排查（README 已知问题 #6 的建议落地）
			log.Printf("[watcher] fsnotify 错误（监听继续）: %v", err)
		}
	}
}
