# 缺陷记录：Linux 真机 WebKitWebProcess SIGABRT（白屏）

> 记录日期：2026-11-13
> 记录人：AI 助手（自动化取证，无人工目视）
> 状态：**已确证崩溃事实，未锁定稳定复现路径**。本文不写「已修复」，也不写「必现」。

---

## 1. 现象

在 Linux（CachyOS / KDE Plasma 6 / Wayland）真机上，Inkmark 运行约 2 分钟后**整个内容区变成纯白**。
GTK 窗口（含自绘标题栏、窗口按钮）仍在且可响应，但正文、标签栏、状态栏均消失。

复现时的操作背景：用户按 **5 条标签快捷键**（⌘⇧T / ⌘T / ⌘⌥→ / ⌘⌥← / ⌘⌥W / ⌘W 一组），
在 19:22:00–19:22:37 期间做了新建、关闭、恢复、切换标签的密集操作。

---

## 2. 确证证据

### 2.1 渲染进程被 SIGABRT 杀死（内核级）

```
$ coredumpctl list
TIME                          PID  UID  GID SIG     COREFILE EXE                                       SIZE
Fri 2026-11-13 19:22:56 CST 15056 1000 1000 SIGABRT present  /usr/lib/webkit2gtk-4.1/WebKitWebProcess 21.2M
```

```
$ coredumpctl info 15056
        Signal: 6 (ABRT)
     Timestamp: Fri 2026-11-13 19:22:40 CST
  Command Line: /usr/lib/webkit2gtk-4.1/WebKitWebProcess 4 23
      Size on Disk: 21.2M
   Storage: /var/lib/systemd/coredump/core.WebKitWebProces.1000.<bootid>.15056.1794568960000000.zst
```

**关键点**：崩溃的是 **WebKitWebProcess（渲染子进程）**，不是 Inkmark 主进程。

### 2.2 崩溃栈

```
Stack trace of thread 39:
#0  pthread_kill                       (libc.so.6)
#1  raise                              (libc.so.6)
#2  abort                              (libc.so.6)
#3  n/a                                (libwebkit2gtk-4.1.so.0 + 0x1432c4a)
#4  n/a                                (libwebkit2gtk-4.1.so.0 + 0x1432c39)
#5  n/a                                (libwebkit2gtk-4.1.so.0 + 0x442a2f2)
#6  n/a                                (libwebkit2gtk-4.1.so.0 + 0x485bcf9)
#7  n/a                                (libwebkit2gtk-4.1.so.0 + 0x4daa20d)
#8  n/a                                (libwebkit2gtk-4.1.so.0 + 0x4db01cc)
#9  n/a                                (libwebkit2gtk-4.1.so.0 + 0x1cf3937)
#10 n/a                                (libjavascriptcoregtk-4.1.so.0 + 0x25bea2a)
#11 n/a                                (libjavascriptcoregtk-4.1.so.0 + 0x25be61d)
#12 WTF::RunLoop::run()                (libjavascriptcoregtk-4.1.so.0 + 0x25bf1ba)
#13 WebKit::WebProcessMain(int, char**) (libwebkit2gtk-4.1.so.0 + 0x1d2034c)
```

栈含义：主线程 `RunLoop` → JS 引擎上下文 → **WebKit 内部 `abort()`**。
这是 WebKit 主动调用的 `CRASH()` / `RELEASE_ASSERT`，**不是**段错误（SIGSEGV），
即 WebKit 自己判定「不该发生的情况发生了」。

### 2.3 白屏的形态（AT-SPI 取证）

崩溃后 AT-SPI 树的状态：

```
frame | Inkmark        ← 窗口还在
  filler
  filler
    filler
      filler
        filler
          ← 子树在此断开，取任何子节点都抛：
             atspi_error: The name is not activatable (1)
```

对照：**崩溃前**同一棵树里能读到 `entry（编辑区）`、6 个菜单、3 个 `page tab`、状态栏缩放按钮。
崩溃后这些全部消失，只剩空的 filler 链。

**结论**：窗口外壳活着，WebView 渲染进程已死 → 用户看到白屏。不是样式问题、不是数据问题。

### 2.4 崩溃前最后一次成功读取的状态

监控器（400ms 采样）在崩溃前的最后一条正常快照：

```
19:22:37  激活第 1 个标签（未命名），text_len=433
19:22:40  atspi_error: Did not receive a reply   ← 渲染进程在此刻死亡
```

崩溃前 3 秒内的状态序列（`*` = 激活）：

```
19:22:35  未命名  未命名*  未命名   hello.md
19:22:36  未命名  未命名   未命名   hello.md*
19:22:37  未命名* 未命名   未命名   hello.md     ← text_len 从 31 变 433
19:22:40  ★崩溃★
```

**注意 19:22:37**：切到标签 0 后 `text_len=433`，开头 `# Inkmark\n- 单栏居中流式排版…`。

**已核实：这不是内容串味**。标签 0 在 localStorage 里的完整草稿是 **633 字符**，
其开头为 `# Inkmark\n\n一个安静的 **Markdown** 写作工具…`，且**同时包含**
「单栏居中流式排版」与「引用与行内元素」两段文字 —— 说明 433 只是 AT-SPI
读到的**可视区域片段**（长文档不会整篇暴露在无障碍树里），内容本身是同一篇、未错乱。

> 教训：AT-SPI 的 `text_len` **不等于文档长度**，只反映当前暴露给无障碍树的文本量。
> 用它比对内容前，必须先确认比较口径一致，否则会把「可视片段」误判成「内容被改写」。
> （本记录初稿一度把 433 读成「草稿被大幅改写」，经比对 localStorage 全量后推翻。）

---

## 3. 未能复现

在**可写缓存目录**下（排除 §4.1 的只读干扰），用自动化重放了「关闭标签 × 12 轮」序列：

```
轮1~轮12: tabs=0 alive=True   （全部正常，未崩溃）
```

**未能稳定复现**。因此：

- ❌ 不能断言「某个具体按键必然导致崩溃」
- ✅ 只能说「在高频标签操作下崩溃过一次」
- 该栈是 WebKit 内部 abort，可能是渲染线程/内存竞态，这类崩溃未必可稳定复现

**也注意一个观测干扰**：自动化重放时 tabs 恒为 0，是因为**单标签时标签栏按设计隐藏**
（`App.vue:100`，`v-show="!focusOn && sessions.length > 1"`），
导致 `page tab` 角色读不到 —— 这不等于「标签全丢」，勿误判。

---

## 4. 环境因素（已排除与未排除）

### 4.1 已排除：`~/.cache` 只读（沙箱限制）

本次运行在 DSH 沙箱内，`~/.cache` 与 `~/.config` 均为**只读文件系统**：

```
$ touch ~/.cache/.probe
touch: 无法 touch '/home/aftery/.cache/.probe': 只读文件系统

（应用日志）
(inkmark:4): GLib-GIO-WARNING: Failed to create /home/aftery/.config/glib-2.0/settings: 只读文件系统
```

WebKit 无法写磁盘缓存是个**真实的干扰变量**。改用可写 XDG 目录后：

```
XDG_CACHE_HOME=$PWD/.probe/xdg/cache ./build/bin/inkmark
→ .probe/xdg/cache/inkmark/WebKitCache/Version 17   ← 缓存正常创建
→ 同一批操作未再崩溃
```

**故该因素已排除**（至少不是充分条件）。

### 4.2 未排除：无 GPU / 软件渲染

```
MESA: error: ZINK: vkEnumeratePhysicalDevices failed (VK_ERROR_INITIALIZATION_FAILED)
MESA: error: ZINK: failed to choose pdev
MESA-EGL: warning: egl: failed to create dri2 screen
```

容器内无 GPU，走软件渲染。WebKit 在软件渲染路径下的崩溃率高于硬件路径，
**这是本文未能排除的变量**。在真实桌面（有 GPU）上是否仍会崩，需另行验证。

### 4.3 版本

| 组件 | 版本 |
|---|---|
| webkit2gtk-4.1 | 2.54.2-1 |
| Wails | v2.16.0 |
| Go | 1.27.3 |
| 构建标签 | `webkit2_41` |

---

## 5. 附带的第二个问题：WAL 未 checkpoint（草稿有丢失风险）

**这是独立于崩溃的持久化问题**，取证时顺带发现。

### 5.1 事实

WebKit 的 localStorage 是 SQLite，位于
`~/.local/share/inkmark/localstorage/wails_wails_0.localstorage`。实测文件状态：

| 文件 | 大小 | mtime |
|---|---|---|
| 主库 `*.localstorage` | 12 KB | 2026-11-10 **14:01** |
| WAL `*.localstorage-wal` | 206 KB | 2026-11-10 **16:20** |
| SHM | 32 KB | 2026-11-10 16:27 |

**最新数据长期滞留在 WAL 里，两小时没有 checkpoint 回主库。**

### 5.2 两份数据的差异（同一时刻读取）

```
主库（immutable=1，不看 WAL）: tabs=2  active=0   草稿 633 / 23 字符
含 WAL（正常读）           : tabs=3  active=2   草稿 633 / 39 字符
```

即：**主库是旧快照，含 WAL 才是最新**。

### 5.3 风险

`useTabPersistence.restoreTabs()` 读的是 `localStorage.getItem(TABS_KEY)`。正常情况下
WebKit 会合并 WAL 返回最新值 —— 本次也确实恢复出了 3 个标签（active=2 的 `hello.md`，正文 229 字符，
与磁盘文件一致）。

**但进程被强杀（本次即 SIGABRT）时，WAL 是否被正常回收不受应用控制**。
若某次强杀后 WAL 丢失/损坏，启动就会退回到主库那份旧快照（tabs=2, active=0），
**丢掉一个草稿与激活位置**。

### 5.4 建议（不属本次改动）

- 短期：用户不应把 localStorage 当作草稿的唯一归宿；重要内容应 Ctrl+S 落盘。
- 中期：`persistTabs` 之外，是否需要一个「落盘前的显式快照」路径，属产品决策。
- 该问题是 **WebKit 的 SQLite 实现细节**，应用层只能规避、无法直接控制 checkpoint 时机。

---

## 6. 未做的事（避免误读）

- ❌ **没有修复任何代码**。本文只记录现象与证据。
- ❌ **没有在真实桌面（有 GPU）上验证**是否会崩。
- ❌ **没有抓到 WebKit 的 `RELEASE_ASSERT` 具体断言内容**（需要 debug 符号或 `WEBKIT_DEBUG` 日志）。
- ❌ **没有确认崩溃与「文本长度变化」的因果关系** —— 19:22:37 的 `text_len=433` 经核实是
  AT-SPI 可视片段（标签 0 全量 633 字符，内容未错乱），**不是**内容被改写，因此该数值
  与崩溃无关，不应作为线索。

---

## 7. 后续排查建议（按性价比排序）

1. **在有 GPU 的真实桌面上跑同一批操作**，确认崩溃是否与软件渲染相关（本轮为无 GPU 容器，
   走软件渲染，是最大未排除变量）。
2. **在有 GPU 的真实桌面上跑同一批操作**，确认崩溃是否与软件渲染相关。
3. **装 WebKit debug 符号**（`webkit2gtk-4.1-debug`）后复现，取有名字的栈帧，
   定位到具体断言。
4. **开 `WEBKIT_DEBUG=all`** 复现，抓崩溃前的最后几条内部日志。
