package main

// watcher_test.go — 文件树外部变更监听（fsnotify）的去抖语义契约
// ============================================================================
// 【为什么需要这个文件】
// 2026-10-17 第十六轮之前，「去抖边界双发（同 root 多刷一次）」在 README 与
// HANDOFF §6/§7 里被登记为**已知未修项**。本轮实测发现：
//
//	① 该条目**从未被实测过**（目视清单第 22 项在 VERIFICATION-LOG 里是「未验」）；
//	② 旧实现（time.AfterFunc + 独立 goroutine 回调）**并不存在**「同一次保存
//	   被推两次」的缺陷 —— 实测同一批连续到达的变更（簇跨度 100ms / 300ms）
//	   **都只推 1 次**；真实原子保存（4 个事件、簇内间隔 121ms）每次也**恰好 +1**；
//	③ AfterFunc 的 Stop() 在定时器已到期时确实停不掉回调（实测 200/200 命中），
//	   但那个窄窗口里那次 fire **本来就应该发** —— 不是重复。
//
// 旧写法真正的毛病是**行为取决于调度顺序**（fire 跑在独立 goroutine，与事件
// 循环并发），即「能跑≠行为确定」。本轮把去抖改成**单一 goroutine 内的串行
// 状态机**（见 watcher.go runDebounced），行为只由事件到达时刻决定。
//
// 于是「去抖语义」必须被**钉死成契约**，否则下一个改它的人又会靠推测走偏。
// 本文件就是那份契约，且**每条判据都注明它挡住的是什么错误**。
//
// 【为什么能测】
// 去抖本体已从 watchLoop 抽出为 runDebounced —— 它不碰 Wails runtime
// （runtime.EventsEmit 需要真实 Wails 上下文才能跑），故可在 Go 测试里
// 用注入通道 + 真实 time 直接驱动。
//
// 【与前端的关系】
// 前端 watcher-wiring.test.mjs 已锁「事件名两侧逐字一致」与 shouldReloadTree
// 守卫语义；本文件锁 Go 侧「几个事件 → 几次推送」。两侧合起来才覆盖整条链路。
// ============================================================================

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

// watchDebounce 的测试替身：把窗口缩到 60ms，让用例在百毫秒级跑完，
// 而不必真的等 250ms（否则整个 Go 测试要多花十几秒）。
// 语义与生产一致：窗口内的事件合并成一次，跨窗口的独立变更分次触发。
const testDebounce = 60 * time.Millisecond

// TestWatchDebounceIsPositive 包级窗口常量必须是正数（生产路径用）。
func TestWatchDebounceIsPositive(t *testing.T) {
	if watchDebounce <= 0 {
		t.Fatalf("watchDebounce 必须为正，实际 %v", watchDebounce)
	}
}

// countingFirer 记录 onFire 被调用了几次（并发安全）。
type countingFirer struct {
	mu    sync.Mutex
	count int
}

func (c *countingFirer) fire() {
	c.mu.Lock()
	c.count++
	c.mu.Unlock()
}

func (c *countingFirer) get() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}

// startDebouncer 起一个去抖循环，返回：推送计数器、注入事件的通道、停止函数。
func startDebouncer(t *testing.T, window time.Duration) (*countingFirer, chan fsnotify.Event, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	events := make(chan fsnotify.Event, 16)
	errs := make(chan error, 4)
	firer := &countingFirer{}
	go runDebouncedWindow(ctx, events, errs, firer.fire, window)
	return firer, events, func() {
		cancel()
		time.Sleep(20 * time.Millisecond) // 等 goroutine 退出
	}
}

// sendEvent 注入一个事件（不阻塞）。
func sendEvent(events chan<- fsnotify.Event) {
	select {
	case events <- fsnotify.Event{Op: fsnotify.Write}:
	default:
	}
}

// TestDebounceMergesBatchWithinWindow 同一批变更（落在去抖窗口内）→ **只推 1 次**。
//
// 这条守住的是：去抖的基本语义。若它红，说明有人把去抖去掉了 → 前端会跟着
// 一次保存刷新多次文件树。
func TestDebounceMergesBatchWithinWindow(t *testing.T) {
	firer, events, stop := startDebouncer(t, testDebounce)
	defer stop()

	// 一批事件：间隔 10ms，全部落在 60ms 窗口内
	for i := 0; i < 5; i++ {
		sendEvent(events)
		time.Sleep(10 * time.Millisecond)
	}
	// 等窗口到期后留出触发时间
	time.Sleep(testDebounce + 60*time.Millisecond)

	if got := firer.get(); got != 1 {
		t.Fatalf("窗口内的 5 个事件应合并为 1 次推送，实际 %d 次", got)
	}
}

// TestDebounceFiresTwiceForSeparateChanges 跨窗口的两次独立变更 → **推 2 次**。
//
// 这条守住的是上一条的反面，也是 2026-10-17 那轮最关键的澄清：
// **「推 2 次」不等于「双发缺陷」**。两次相隔超过去抖窗口的独立变更，
// 本来就该推 2 次（前端多刷一次是正确行为，不是重复推送）。
//
// 若这条被改成「只推 1 次」，那意味着引入了静默期：**真实的后续变更会被漏掉**，
// 文件树将不反映最新磁盘状态 —— 那比多刷一次严重得多。
func TestDebounceFiresTwiceForSeparateChanges(t *testing.T) {
	firer, events, stop := startDebouncer(t, testDebounce)
	defer stop()

	sendEvent(events)
	// 等第一次触发
	time.Sleep(testDebounce + 40*time.Millisecond)
	if got := firer.get(); got != 1 {
		t.Fatalf("第一次变更应触发 1 次推送，实际 %d 次", got)
	}

	// 第二次变更：明确晚于上一轮窗口
	time.Sleep(testDebounce + 40*time.Millisecond)
	sendEvent(events)
	time.Sleep(testDebounce + 60*time.Millisecond)

	if got := firer.get(); got != 2 {
		t.Fatalf("跨窗口的两次独立变更应触发 2 次推送，实际 %d 次", got)
	}
}

// TestDebounceClusterSpanningBoundaryStillFiresOnce 一批事件的**簇跨度超过窗口**
// → 仍只推 1 次。
//
// 这条是 2026-10-17 那轮专门查证的形态：真实原子保存会产生
// CREATE tmp → REMOVE doc → CREATE doc → RENAME tmp 四个事件，
// 簇内最大间隔实测 121ms（> 60ms 的测试窗口），若事件**连续到达**，
// 最后一枚事件落在窗口外时，**旧实现与新实现都只推 1 次**。
//
// 它守住的是「去抖是按事件到达时刻重置窗口，不是按『距首次事件的时长』切分」。
func TestDebounceClusterSpanningBoundaryStillFiresOnce(t *testing.T) {
	firer, events, stop := startDebouncer(t, testDebounce)
	defer stop()

	// 三个事件连续到达，簇总跨度 90ms > 窗口 60ms，
	// 但每个事件都在前一个事件之后 30ms 到达 → 窗口被不断重置 → 只推 1 次
	for i := 0; i < 3; i++ {
		sendEvent(events)
		time.Sleep(30 * time.Millisecond)
	}
	time.Sleep(testDebounce + 80*time.Millisecond)

	if got := firer.get(); got != 1 {
		t.Fatalf("簇跨度超过窗口但事件连续到达，应只推 1 次，实际 %d 次", got)
	}
}

// TestDebounceStopsOnContextCancel ctx 取消 → 立即退出，不再触发。
//
// 这条守住的是「停止监听后，残留的定时器不得再推送陈旧目录」——
// 那是 HANDOFF §6 第 22 项场景③（关闭文件夹后无事件推送）的后半段。
func TestDebounceStopsOnContextCancel(t *testing.T) {
	firer, events, stop := startDebouncer(t, testDebounce)

	sendEvent(events)
	stop() // 取消 ctx

	// 取消后即便还有事件到达，也不得触发推送
	time.Sleep(30 * time.Millisecond)
	sendEvent(events)
	time.Sleep(testDebounce + 80*time.Millisecond)

	if got := firer.get(); got != 0 {
		t.Fatalf("ctx 取消后不得再触发推送，实际触发了 %d 次", got)
	}
}
