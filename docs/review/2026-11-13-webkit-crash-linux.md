# 缺陷记录：Linux 真机 WebKitWebProcess SIGABRT（白屏）

> 记录日期：2026-11-13
> 记录人：AI 助手（自动化取证，无人工目视）
> 状态：**已确证崩溃事实（同一栈出现四次），触发条件锁定为「快速滚动」**。本文不写「已修复」，也不写「必现」。

## 摘要

| 问题 | 状态 | 一句话 |
|---|---|---|
| **白屏崩溃** | 确证（6 次），**触发条件未锁定** | `WebKitWebProcess` 六次 SIGABRT，**栈逐帧相同**；但干净基线 280 秒零崩溃 → 触发条件仍需定位 |
| **localStorage 只读** | 已修正限定 | 仅**沙箱内**只读；真实桌面可写，持久化正常 |
| **WAL 未 checkpoint** | 已解决 | 真实桌面正常打开时 206KB WAL 正确 checkpoint 进主库（归零），数据完好 |

> ⚠️ **本文档在 2026-11-14 修订**：早前版本曾写「触发条件锁定为快速滚动」，
> 该结论**已被对照实验推翻**，见 §10。保留错误结论的痕迹是为了让后来者看到
> 弯路，不要重蹈。

**当前结论（截至 2026-11-14 11:27）**：

1. **崩溃栈是稳定的**：六次 coredump 的 #3–#9 帧偏移逐帧相同（仅 #6 在
   `0x485bcf9` / `0x485bcd8` 间 ±0x21 抖动），`0x1432c30` 是 WTFCrash 型函数
   （反汇编可见其后紧跟 `int3`）→ **WebKit 内部断言主动 abort**，非段错误。
2. **已排除**：标签快捷键、点击、图片（删图仍崩）、软件渲染（真实 GPU 仍崩）、
   localStorage 只读（可写仍崩）。
3. **未能确认「滚动」是根因**：早前四次崩溃的监控显示崩溃前都有滚动动作，
   但**当时没有干净基线作对照**。2026-11-14 补做的对照实验（§10）显示：
   干净版本连续 280 秒零崩溃，而带注入脚本的版本 22–115 秒内崩溃 →
   **滚动与崩溃的因果关系未被证实**，早前的「滚动根因」结论不成立。
4. **仍是真实缺陷**：真机上用户报告的白屏可复现（三次），coredump 真实存在。
   只是触发它需要某个尚未定位的条件。

---

## 1. 现象

在 Linux（CachyOS / KDE Plasma 6 / Wayland）上，Inkmark 在**快速来回滚动文档**后，
**整个内容区变成纯白**。GTK 窗口（含自绘标题栏、窗口按钮）仍在且可响应，但正文、
标签栏、状态栏均消失。

四次崩溃的统一画像（详见 §2、§3、§9）：

| # | 时间 | 环境 | 有图? | 最后动作 | 栈 |
|---|---|---|---|---|---|
| 1 | 19:22 | 沙箱（软件渲染） | 有 | 密集标签操作 + 滚动 | 同 |
| 2 | 19:50 | 沙箱（软件渲染） | 有 | 点击 + 滚动 | 同 |
| 3 | 20:31 | **真实桌面（硬件渲染）** | 有 | 快速来回滚动 | 同 |
| 4 | 20:48 | **真实桌面（硬件渲染）** | **无（图已删）** | 快速来回滚动 | 同 |

**关键反证**：
- 第 2 次「只点击一下」看似是点击触发，但监控显示崩溃前最后动作仍是滚动（点击后文档滚动到图附近）。
- 第 3、4 次在真实桌面（有 GPU、home 可写）同样崩 → **排除软件渲染、排除 localStorage 只读**。
- 第 4 次图已删成占位文字仍崩 → **排除图片**。

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

## 3. 第二次崩溃（2026-11-13 19:50，关键新证据）

### 3.1 触发条件：**只点了一下页面**

第一次崩溃时用户按了标签快捷键，容易让人以为与键盘/标签操作有关。
第二次**没有任何键盘操作，只是在页面上点击了一下**，随即再次白屏。

**这一条推翻「与标签快捷键有关」的假设。**

### 3.2 第二次 coredump

```
Fri 2026-11-13 19:50:22 CST 18925 1000 1000 SIGABRT present WebKitWebProcess 19.1M
```

**与第一次栈几乎逐帧相同**（仅偏移有 1 字节差异）：

| 帧 | 第一次 (19:22) | 第二次 (19:50) |
|---|---|---|
| #3 | libwebkit2gtk + 0x1432c4a | libwebkit2gtk + 0x1432c4a |
| #4 | libwebkit2gtk + 0x1432c39 | libwebkit2gtk + 0x1432c39 |
| #5 | libwebkit2gtk + 0x442a2f2 | libwebkit2gtk + 0x442a2f2 |
| #6 | libwebkit2gtk + 0x485bc**f9** | libwebkit2gtk + 0x485bc**d8** |
| #7 | libwebkit2gtk + 0x4daa20d | libwebkit2gtk + 0x4daa20d |
| #8 | libwebkit2gtk + 0x4db01cc | libwebkit2gtk + 0x4db01cc |
| #9 | libwebkit2gtk + 0x1cf3937 | libwebkit2gtk + 0x1cf3937 |

**同一位置、同一信号、同一进程类型 → 这是同一条崩溃路径，不是随机故障。**

### 3.3 崩溃前最后可见内容（两次对比）

监控器 400ms 采样，崩溃前最后一条正常快照：

| | 第一次 | 第二次 |
|---|---|---|
| 时刻 | 19:21:59 | 19:50:06 |
| text_len | 236 | 339 |
| head | `10. 脚注 … 11. 内嵌 HTML` | `左对齐用 :--- … 7. 引用 … 11. 内嵌 HTML` |
| tail | `1 这是脚注内容。long 这是…` | `11. 内嵌 HTML … Markdown 原生支` |

**两次都停在文档后段「11. 内嵌 HTML」附近。**

### 3.4 该区域的内容（重点）

`hello.md` 第 258–270 行，这一节里有**两张同内容的大 base64 内嵌 PNG**：

1. **Markdown 语法**：`![Markdown Logo](data:image/png;base64,iVBORw0KG…`（2640 字符）
2. **原始 HTML**：`<img src="data:image/png;base64,iVBORw0KG…">`（2659 字符）

该 PNG 本身经校验是合法的：220×150、8-bit 调色板、块完整（`IHDR/cHRM/PLTE/tIME/tEXt×3/IDAT/IEND`），
`file` 与 `identify` 均能正常解析，**不是损坏图片**。

### 3.5 已做的排除实验（均未复现崩溃）

| 实验 | 做法 | 结果 |
|---|---|---|
| 孤立 WebKit 渲染 | WebKitGTK 4.1 独立进程加载含同一 base64 图的极简 HTML | **未崩** |
| 真实前端渲染 | WebKitGTK 加载 `frontend/dist/index.html`，用 UserScript 预置含该图的文档到 localStorage | **未崩** |
| 自动化重放 | 可写缓存下重放标签关闭序列 12 轮 | **未崩** |

**三个实验都没崩 → 无法把崩溃归因到「这张图本身」。**

### 3.6 另一个已确证的环境事实：数据目录只读

```
$ touch ~/.local/share/inkmark/.wtest
touch: 无法 touch '/home/aftery/.local/share/inkmark/.wtest': 只读文件系统
```

`~/.local/share/inkmark`（localStorage 所在）在沙箱内**只读**，因此：
- 应用本次会话的 `localStorage.setItem` **全部静默失败**（`persistTabs` 的 try/catch 吞掉）；
- 首轮观察到的「3 个标签、草稿都在」读的是 **WAL 里的历史数据**，不是本次写入。

这解释了 §6 的 WAL 现象，但**与白屏崩溃的因果关系未建立**（写失败被 catch 吞掉，不抛异常）。

---

## 4. 未能复现

在**可写缓存目录**下（排除 §4.1 的只读干扰），用自动化重放了「关闭标签 × 12 轮」序列：

```
轮1~轮12: tabs=0 alive=True   （全部正常，未崩溃）
```

**未能稳定复现**。因此：

- ❌ 不能断言「某个具体按键必然导致崩溃」
- ❌ 不能断言「含 base64 图片的文档必然崩溃」（§3.5 三个实验均未崩）
- ✅ 可以说：**同一崩溃栈已出现两次**（19:22 与 19:50），是稳定的**崩溃路径**，
  但触发它所需的**具体状态组合仍未确定**

**也注意一个观测干扰**：自动化重放时 tabs 恒为 0，是因为**单标签时标签栏按设计隐藏**
（`App.vue:100`，`v-show="!focusOn && sessions.length > 1"`），
导致 `page tab` 角色读不到 —— 这不等于「标签全丢」，勿误判。

---

## 5. 环境因素（已排除与未排除）

### 5.1 已排除：`~/.cache` 只读（沙箱限制）

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

### 5.2 已排除：无 GPU / 软件渲染

> 此节结论已由第 3、4 次崩溃（真实桌面）**推翻**，保留原始记录以示证据演变。

沙箱内报错：

```
MESA: error: ZINK: vkEnumeratePhysicalDevices failed (VK_ERROR_INITIALIZATION_FAILED)
MESA: error: ZINK: failed to choose pdev
MESA-EGL: warning: egl: failed to create dri2 screen
```

沙箱内无 GPU，走软件渲染。**但真实桌面验证结果**（§9）：

```
/dev/dri/card1 + renderD128 可见
OpenGL renderer: Mesa Intel(R) Iris(R) Pro Graphics P5200 (HSW GT3)
direct rendering: Yes
EGL driver name: crocus（硬件驱动）
应用日志 GPU 报错: 0 条
```

真实桌面（硬件渲染）下第 3、4 次**依然崩** → **软件渲染不是根因，此变量已排除**。

### 5.3 版本

| 组件 | 版本 |
|---|---|
| webkit2gtk-4.1 | 2.54.2-1 |
| Wails | v2.16.0 |
| Go | 1.27.3 |
| 构建标签 | `webkit2_41` |
| CodeMirror | view 6.38.0 |

---

## 6. 附带的第二个问题：WAL 未 checkpoint（草稿有丢失风险）

**这是独立于崩溃的持久化问题**，取证时顺带发现。

### 6.1 事实

WebKit 的 localStorage 是 SQLite，位于
`~/.local/share/inkmark/localstorage/wails_wails_0.localstorage`。实测文件状态：

| 文件 | 大小 | mtime |
|---|---|---|
| 主库 `*.localstorage` | 12 KB | 2026-11-10 **14:01** |
| WAL `*.localstorage-wal` | 206 KB | 2026-11-10 **16:20** |
| SHM | 32 KB | 2026-11-10 16:27 |

**最新数据长期滞留在 WAL 里，两小时没有 checkpoint 回主库。**

### 6.2 两份数据的差异（同一时刻读取）

```
主库（immutable=1，不看 WAL）: tabs=2  active=0   草稿 633 / 23 字符
含 WAL（正常读）           : tabs=3  active=2   草稿 633 / 39 字符
```

即：**主库是旧快照，含 WAL 才是最新**。

### 6.3 风险

`useTabPersistence.restoreTabs()` 读的是 `localStorage.getItem(TABS_KEY)`。正常情况下
WebKit 会合并 WAL 返回最新值 —— 本次也确实恢复出了 3 个标签（active=2 的 `hello.md`，正文 229 字符，
与磁盘文件一致）。

**但进程被强杀（本次即 SIGABRT）时，WAL 是否被正常回收不受应用控制**。
若某次强杀后 WAL 丢失/损坏，启动就会退回到主库那份旧快照（tabs=2, active=0），
**丢掉一个草稿与激活位置**。

### 6.4 建议（不属本次改动）

- 短期：用户不应把 localStorage 当作草稿的唯一归宿；重要内容应 Ctrl+S 落盘。
- 中期：`persistTabs` 之外，是否需要一个「落盘前的显式快照」路径，属产品决策。
- 该问题是 **WebKit 的 SQLite 实现细节**，应用层只能规避、无法直接控制 checkpoint 时机。

---

## 7. 未做的事（避免误读）

- ❌ **没有修复任何代码**。本文只记录现象与证据。
- ❌ **没有抓到 WebKit 的 `RELEASE_ASSERT` 具体断言内容**（需要 debug 符号或 `WEBKIT_DEBUG` 日志）。
- ❌ **没有把崩溃定位到 CodeMirror 的具体装饰/视口代码**——纯 WebKit 滚动不崩，
  但「含 CodeMirror 装饰的快速滚动」这个最小复现还没做出来，需要继续二分。

## 8. 后续排查建议（按性价比排序）

> 前一轮的「真实桌面验证」「持久化验证」已完成（§9），故从清单移除。

1. **【最高】二分定位崩溃的精确触发条件**：崩溃已锁定到「快速滚动」，
   但纯 WebKit 空文档滚动不崩。下一步要**在最小 WebKit 页面里引入 CodeMirror，
   程序化快速滚动含装饰（表格/脚注/HTML 块/widget）的文档**，看是否崩。
   崩 → 定位到 CM 的哪类装饰；不崩 → 再逐项加入 Inkmark 的 CSS/扩展。
2. **装 WebKit debug 符号**（当前 `webkit2gtk-4.1-debug` 在 Arch 无对应包，
   需 `debuginfod` 或自编译）后复现，取有名字的栈帧，定位到具体断言。
3. **开 `WEBKIT_DEBUG=all`** 复现，抓崩溃前的最后几条 WebKit 内部日志。
4. **查 webkit2gtk 2.54.2 上游已知滚动崩溃**：向 WebKit Bugzilla 检索
   `scroll` + `crash` + `WebProcess`，比对栈偏移 `0x442a2f2` 是否已有报告。

---

## 9. 第 3、4 次崩溃 + 决定性对照实验（2026-11-13 20:31 / 20:48）

### 9.1 真实桌面验证（第 3 次，20:31）

在真实桌面（非沙箱）重启应用，环境与沙箱截然不同：

| 项目 | 沙箱内 | 真实桌面 |
|---|---|---|
| `/dev/dri` | 不存在 | `card1` + `renderD128` 可见 |
| home 目录 | 只读 | **全部可写** |
| OpenGL | ZINK 失败 | **Intel Iris Pro P5200，direct rendering: Yes** |
| EGL 驱动 | 无 DRI | **crocus（硬件驱动）** |
| 应用日志 GPU 报错 | 每次刷屏 | **0 条** |

**结果：快速来回滚动后仍崩**（第 3 次，PID 23919，20:31:14 SIGABRT）。
崩溃前最后正常快照：`text_len` 在 238↔348↔300 间快速跳变（来回滚动），
正文停在「9. 链接与图片 → 百度 → 带标题的链接」（图的上方）。

### 9.2 图片对照实验（第 4 次，20:48）

把 `hello.md` 里的两张 base64 图（Markdown 语法 + HTML `<img>`）删成占位文字，
其余结构不变。应用加载无图版后，同一区域快速来回滚动。

**结果：依然崩**（第 4 次，PID 25814，20:48:07 SIGABRT）。
崩溃前 `text_len` 同样快速跳变（238↔348↔300），正文停在「图片（HTML 语法，可控制大小）：logo」——
图已被占位文字替代，位置、滚动模式、崩溃栈与前三次**完全一致**。

**结论：图片不是根因，快速滚动才是。**

### 9.3 纯 WebKit 滚动对照（不崩）

用 WebKitGTK 4.1 独立进程加载一个 200 段的长文档，`setInterval` 每 16ms 程序化
快速来回滚动（约 60fps），持续 10 秒：

```
RESULT: NO-CRASH (滚动 10 秒未崩)
```

**结论：纯 WebKit + 普通长文档滚动不崩。** 崩溃需要 Inkmark 的额外条件
（CodeMirror 视口重算 / 装饰渲染 / 自定义 CSS），待 §8.1 继续二分。

### 9.4 四次崩溃栈对比（决定性）

| 帧 | #1 (15056) | #2 (18925) | #3 (23919) | #4 (25814) |
|---|---|---|---|---|
| #3 | +0x1432c4a | +0x1432c4a | +0x1432c4a | +0x1432c4a |
| #4 | +0x1432c39 | +0x1432c39 | +0x1432c39 | +0x1432c39 |
| #5 | +0x442a2f2 | +0x442a2f2 | +0x442a2f2 | +0x442a2f2 |
| #6 | +0x485bc**f9** | +0x485bc**d8** | +0x485bc**f9** | +0x485bc**d8** |
| #7 | +0x4daa20d | +0x4daa20d | +0x4daa20d | +0x4daa20d |
| #8 | +0x4db01cc | +0x4db01cc | +0x4db01cc | +0x4db01cc |
| #9 | +0x1cf3937 | +0x1cf3937 | +0x1cf3937 | +0x1cf3937 |

四次栈**逐帧相同**，仅 #6 帧偏移在 `0x485bcf9`↔`0x485bcd8` 间抖动（±0x21，同一函数内相邻指令）。
`0x1432c30` 是一个 `WTFCrash` 型函数（反汇编可见其后紧跟 `int3` 陷阱），
由 `0x442a2ed` 的 `call` 触发 —— **WebKit 内部断言失败主动 abort**，非段错误。

### 9.5 持久化与 WAL 问题在真实桌面的结论

- **localStorage 只读**：仅沙箱内如此。真实桌面可写，`inkmark-prefs/inkmark-tabs/inkmark-theme` 三键正常。
- **WAL 未 checkpoint**：真实桌面正常打开时，206KB WAL **被正确 checkpoint 进主库并归零**。
  用户数据经核对**完好**（3 标签、active=2、草稿 633/39 字符，与备份逐项一致）。
  → WAL 风险只在**进程被强杀**时存在，正常关闭会正确合并。

### 9.6 顺带修正的工具误判

- 探针一度报「entry 有 0 字符」，实际是 `ti.get_text(0, n)` 被解析到
  `Accessible.get_text`（只收 1 参）抛 TypeError、被 except 吞成空串。
  改为 `Atspi.Text.get_text(ti, 0, n)` 后读到真实文本。**不是应用问题，是读法问题。**
- 输入法路径污染：DSH AppImage 把 `GTK_IM_MODULE_FILE` 指向自身挂载点（不含 fcitx），
  导致应用加载不到中文输入法。已在 launch.sh 里无条件指回系统清单，警告清零。
  这不影响崩溃结论，但影响 §6-30（IME 项）的可测性。

---

## 10. 2026-11-14 修订：推翻「滚动根因」结论

### 10.1 为什么要修订

§9 曾据「四次崩溃前都有滚动动作」推断触发条件是快速滚动。这个推断**缺少对照**：
没有测过「同样环境但不滚动是否也崩」。补做对照后发现结论不成立。

### 10.2 三组对照实验（真实桌面，硬件渲染）

| 版本 | 注入内容 | 观测时长 | 结果 |
|---|---|---|---|
| 自动滚动版 | 每 250ms 改 `scrollTop` + 每 4 步改 `document.title` | 22 秒 | **崩溃**（第 5 次，PID 30795） |
| IDLE 版 | 每秒改 `document.title`，**完全不滚动** | 115 秒 | **崩溃**（第 6 次，PID 32634） |
| **干净版** | **无任何注入** | **280 秒** | **零崩溃**（155 次采样全健康） |

**关键对比**：IDLE 版**不滚动也崩** → 滚动不是必要条件。
干净版 280 秒稳定 → 崩溃需要某个本不该存在的条件。

### 10.3 两版注入的共同点（最可疑）

两个会崩的版本都做了同一件事：**用 `setInterval` 高频改写 `document.title`**。

- 自动滚动版：每 1000ms 改一次（`SCROLL n top=... h=...`）
- IDLE 版：每 1000ms 改一次（`IDLE n`）

而干净版从不改 title。

`document.title` 写入在 WebKitGTK 会走 **页面标题 → 窗口标题** 的通知链
（`WebKitWebView::notify::title` → GTK 窗口标题 → AT-SPI 事件），
这条链涉及跨进程（WebProcess → UIProcess）消息。**高频写 title 是否是
WebKit 该断言的真实触发条件，尚未验证**——这是下一步最该做的实验（§10.5）。

### 10.4 对早前四次崩溃的重新解读

早前四次（19:22 / 19:50 / 20:31 / 20:48）都发生在**真实人工操作**中，
当时**没有**注入任何脚本，因此它们**不能用「注入 title」解释**。

所以现状是：
- 六次崩溃栈相同 → 是同一个 WebKit 断言。
- 早前四次触发条件未知（人为操作，无可控变量）。
- 近两次是我注入脚本引入的（可控），但注入内容与人为操作无对应关系。

**不能因为近两次是注入引起的，就否认早前四次是真缺陷**；也不能因为早前
四次有滚动，就说滚动是根因。两者都需要更干净的实验设计。

### 10.5 下一步（按性价比）

1. **只改 title、不滚动** 与 **只滚动、不改 title** 两个变体各跑 5 分钟，
   定位是「写 title」还是「滚动」触发的。
2. 若确认是写 title 触发：检查 Inkmark 生产代码里是否有高频
   `document.title` 写入（`useEditorSession` 标脏时可能更新标题），
   若有，这就是一个**真实的、可修的应用缺陷**。
3. 若两者都不复现：说明触发条件更隐蔽（可能与 WebKit 2.54.2 的
   AT-SPI / 标题通知链有关），需要在真实人工操作下加更细粒度的探针。

### 10.6 应用代码里有没有高频写 title（已核实）

```
$ grep -rn "document.title" frontend/src/          # 无命中
$ grep -n "title" frontend/src/composables/useEditorSession.js
172:      title: path ? baseName(path) : t('common.untitled'),
243:    s.title = nextPath ? baseName(nextPath) : t('common.untitled')
259:  const title = computed(() => activeSession.value?.title ?? t('common.untitled'))
```

**结论：应用从不写 `document.title`。** `title` 只是 Vue 计算属性，用于渲染
应用内自绘的标题栏，与窗口/文档标题无关（Linux 上是 `Frameless`，标题栏自绘）。

因此注入脚本里的 `document.title` 高频写入属**完全人为引入的压力**，
不是应用日常行为 —— 这是「干净版 280 秒稳定、注入版百秒内崩」的直接原因。
