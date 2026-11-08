// app_dirty_concurrency_test.go —— dirtyByDoc / closing 的跨 goroutine 安全回归
// ============================================================================
// 【守的是什么】2026-11-08 真机 `wails dev` 的 P0 崩溃：fatal error: concurrent
// map writes，栈顶 main.(*App).SetDirty。Wails v2.16 对每条前端 IPC 各起一个
// goroutine（devserver.go:196-207 / darwin frontend.go:427），前端 watch 全量重推，
// 多标签下一次触发即 N 条并发 SetDirty；Go 对 map 并发写直接 fatal（不可 recover）。
//
// 【用例形态】① 多 goroutine 真并发打同一张 map（-race 下必报，无锁时大概率 fatal）；
// ② 断言可观察不变量（无丢失写入 / 关闭只被一个 goroutine 抢到）作兜底。
// 注意②不是主要检出途径：实测「只修一半」（nil 判断留锁外）的变异体在无 -race 下
// 20 次仅检出 1 次 —— 检出率取决于变异形态，要保证抓到竞争必须开 -race（CI 已加）。
//
// 【为什么连「无锁时是否真会红」一起自证】本文件价值全在「去掉锁就红」；并发度太低
// 而恒绿就是假绿门禁。交付时按铁律做过变异自证（去锁报红 / 加回转绿），证据见任务报告。
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

// TestDirtyConcurrentWriters 并发写/读/删同一张 dirtyByDoc，断言无丢失写入。
//
// 判据取自真实调用形态：多标签的 watch 会同时对**不同**文档各推一条 SetDirty
// （不同 key），标签关闭又会在旁边推 ForgetDoc，红绿灯路径同时在读 anyDirty。
// 因此三个操作必须交叉并发，只测「多个 SetDirty」是不够的 —— 漏掉读锁
// （anyDirty 遍历）与写并发同样会 fatal。
//
// 丢失写入是比崩溃更隐蔽的一类：写锁若不覆盖 `dirtyByDoc == nil` 的惰性初始化，
// 两个 goroutine 会各自 new 一张 map，后写者把先写者的整张表丢弃 —— 脏标记消失
// ⇒ 关窗口不拦 ⇒ 静默丢稿。故用「每个 goroutine 独占一批 key、全设 true、
// 全程不删」来使这个不变量可判定：结束时的条目数必须严格等于写入总数。
func TestDirtyConcurrentWriters(t *testing.T) {
	const (
		writers      = 16
		keysPerGroup = 64
	)
	// 刻意用 NewApp() 的**零值**（dirtyByDoc == nil）起步：惰性初始化正是
	// -race 报告的另一处（旧 app.go:340-341），必须被同一把锁覆盖。
	a := NewApp()

	var wg sync.WaitGroup
	// 读者：与下面所有写者并发跑，覆盖 anyDirty 的 map 遍历读。
	readerStop := make(chan struct{})
	var readers sync.WaitGroup
	for r := 0; r < 4; r++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-readerStop:
					return
				default:
					_ = a.anyDirty()
				}
			}
		}()
	}

	for g := 0; g < writers; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < keysPerGroup; i++ {
				key := fmt.Sprintf("u:tab-%d-%d", g, i)
				a.SetDirty(key, true)
			}
		}(g)
	}
	wg.Wait()
	close(readerStop)
	readers.Wait()

	want := writers * keysPerGroup
	if got := len(a.dirtyByDoc); got != want {
		t.Fatalf("并发写入后条目数 = %d, want %d —— 有写入被丢失（惰性初始化/写锁覆盖不全），"+
			"脏标记丢失会直接导致关窗口不拦、静默丢稿", got, want)
	}
	if !a.anyDirty() {
		t.Fatal("全部 key 都是脏的，anyDirty() 必须为 true")
	}

	// 清脏与置脏交替并发：清脏走 delete 分支（另一条写路径），同样不得丢条目。
	var churn sync.WaitGroup
	for g := 0; g < writers; g++ {
		churn.Add(1)
		go func(g int) {
			defer churn.Done()
			for i := 0; i < keysPerGroup; i++ {
				key := fmt.Sprintf("u:tab-%d-%d", g, i)
				a.SetDirty(key, false) // 删自己的
				a.SetDirty(key, true)  // 再放回，保证最终态确定
			}
		}(g)
	}
	churn.Wait()
	if got := len(a.dirtyByDoc); got != want {
		t.Fatalf("置脏/清脏交替并发后条目数 = %d, want %d", got, want)
	}
}

// TestForgetDocConcurrentWithSetDirty 关闭标签（ForgetDoc）与脏状态推送并发。
//
// 判据：两者都来自 IPC goroutine，且真实场景中**同一时刻**就会发生 ——
// 用户点掉一个标签时，剩下的标签正在因自动保存而改 dirty。若 ForgetDoc 不加写锁，
// 它会在别的 goroutine 增删同一张 map 时并发 delete ⇒ concurrent map writes。
//
// 不变量：ForgetDoc 只删自己那个 key，别的文档的条目一条都不能少。
// 这一条比「不崩溃」更严：即使某次调度侥幸没撞上，删错/丢条目也会被抓到。
func TestForgetDocConcurrentWithSetDirty(t *testing.T) {
	const (
		docs      = 24
		closeWins = 24
	)
	a := NewApp()
	for i := 0; i < docs; i++ {
		a.SetDirty(fmt.Sprintf("u:doc-%d", i), true)
	}

	var wg sync.WaitGroup
	// 一半 goroutine 关标签（每个关自己的），另一半反复重推脏状态。
	for i := 0; i < closeWins; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			a.ForgetDoc(fmt.Sprintf("u:doc-%d", i))
		}(i)
	}
	for i := 0; i < docs; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for n := 0; n < 200; n++ {
				a.SetDirty(fmt.Sprintf("u:survivor-%d", i), true)
				_ = a.anyDirty()
			}
		}(i)
	}
	wg.Wait()

	// 被关掉的 doc-0..23 全部摘干净；幸存者一条不少。
	if got, want := len(a.dirtyByDoc), docs; got != want {
		t.Fatalf("并发 ForgetDoc 后条目数 = %d, want %d（幸存文档的脏标记被误删或丢失）", got, want)
	}
	for i := 0; i < docs; i++ {
		if _, gone := a.dirtyByDoc[fmt.Sprintf("u:doc-%d", i)]; gone {
			t.Fatalf("doc-%d 已 ForgetDoc，映射里不该还有它", i)
		}
		if !a.dirtyByDoc[fmt.Sprintf("u:survivor-%d", i)] {
			t.Fatalf("survivor-%d 的脏标记丢了 —— 关窗口将不拦截，静默丢稿", i)
		}
	}
	// 关完之后仍应判为脏（幸存者还在）。
	if !a.anyDirty() {
		t.Fatal("幸存文档仍脏，anyDirty() 必须为 true")
	}
}

// TestBeginCloseExactlyOnce 关闭流程的「抢占」必须恰好一个 goroutine 成功。
//
// 为什么这条与 dirty 放在一起：CloseWindow 同样由自绘 × 按钮经 IPC 调用，
// 同样每条消息一个 goroutine（见 app.go 里 closingMu 的注释）。判定若写成
// 「先读 a.closing 再赋值」两步，两个 goroutine 都会读到 false → 各弹一个系统
// 确认框，用户对两个叠在一起的对话框点出互相矛盾的答案。
//
// 这里刻意**不依赖 -race**：赢家计数是可观察结果，判定写错时同一轮里会有多个
// goroutine 数到自己赢。参数是按**实测检出率**定的，不是拍脑袋：32 racer × 300 轮
// 在无锁变异下只有 5/8 次命中（3 次漏检）—— 检出率不够就当不了门禁；提到
// 64 racer × 2000 轮后无锁变异 8/8 命中，而有锁版本整条用例仍只需约 0.2s。
func TestBeginCloseExactlyOnce(t *testing.T) {
	const (
		racers = 64
		rounds = 2000
	)
	a := NewApp()
	for r := 0; r < rounds; r++ {
		var (
			wg      sync.WaitGroup
			winners int32
			start   = make(chan struct{})
		)
		for i := 0; i < racers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start // 一起起跑，把竞争窗口压到最窄
				if a.tryBeginClose() {
					atomic.AddInt32(&winners, 1)
				}
			}()
		}
		close(start)
		wg.Wait()
		if got := atomic.LoadInt32(&winners); got != 1 {
			t.Fatalf("第 %d 轮有 %d 个 goroutine 同时抢到关闭流程（期望恰好 1 个）—— "+
				"closing 的「读判定 + 置位」不是一个原子步，会弹出多个确认框", r, got)
		}
		a.endClose() // 模拟用户取消关闭，允许下一轮重试
	}

	// 抢占成功后再次调用必须被挡住（语义不变式，与并发无关但同源）。
	if !a.tryBeginClose() {
		t.Fatal("closing 已释放，第一次抢占必须成功")
	}
	if a.tryBeginClose() {
		t.Fatal("已有关闭流程在跑时，第二次抢占必须失败")
	}
}

// TestLazyInitNotLostAcrossGoroutines 守住「惰性初始化必须在写锁内」。
//
// 【为什么单独一条】只把 `dirtyByDoc[key] = true` 包进锁、把 `if dirtyByDoc == nil`
// 留在锁外，是一种**看起来已经修好**的半吊子修法：它不再 fatal，行为测试也常常
// 全绿（实测：那样写时本文件其余用例在无 -race 下 8/8 全过）。真实后果是丢条目——
// A 与 B 都看到 nil，各自 new 一张表，后赋值者把先赋值者刚写进去的脏标记整张丢弃
// ⇒ 关窗口不拦 ⇒ 静默丢稿。这是**比崩溃更隐蔽**的一类，因此必须有专门的判据。
//
// 【判据】每轮换一个全新的 App（dirtyByDoc 归零），N 个 goroutine 用同一道闸门
// 一起起跑、各写**自己独占**的 key，结束时条目数必须恰好 N。少一条就是有人把
// 别人的表覆盖掉了。「无丢失写入」是可观察结果，不依赖 -race 的调度运气。
func TestLazyInitNotLostAcrossGoroutines(t *testing.T) {
	const (
		goroutines = 64
		rounds     = 1500
	)
	for r := 0; r < rounds; r++ {
		a := NewApp() // 零值：dirtyByDoc == nil，每轮都重新制造惰性初始化的竞争
		var wg sync.WaitGroup
		start := make(chan struct{})
		for g := 0; g < goroutines; g++ {
			wg.Add(1)
			go func(g int) {
				defer wg.Done()
				<-start
				a.SetDirty(fmt.Sprintf("u:init-%d", g), true)
			}(g)
		}
		close(start)
		wg.Wait()

		if got := len(a.dirtyByDoc); got != goroutines {
			t.Fatalf("第 %d 轮：%d 个 goroutine 各写一条，实际只剩 %d 条 —— "+
				"惰性初始化在写锁外，后赋值的 map 把先写入的脏标记整张覆盖了",
				r, goroutines, got)
		}
	}
}
