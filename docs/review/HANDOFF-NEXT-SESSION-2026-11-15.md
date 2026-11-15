# 会话交接：Linux 白屏 SIGABRT 排查（2026-11-13 ~ 11-14）

> 本文给**下一个会话**看：不依赖上轮对话记忆，只凭本文件 + 仓库即可接上。
> 写完时间：2026-11-15。分支 `dev`，HEAD `299746e`（另有本次文档提交）。

---

## 0. 一句话现状

Inkmark 在 Linux（CachyOS / KDE Wayland）上会**白屏**：渲染进程
`WebKitWebProcess` 收到 SIGABRT。**九次崩溃栈逐帧相同**，确定是 WebKit 内部
断言主动中止。**已排除 6 类原因，但确切触发条件仍未定位。**

---

## 1. 已经做完的（可放心当作既有事实）

### 1.1 文档盘点（最早的任务）

- README「已知问题与待办」18 项 + `docs/HANDOFF.md` §7 状态已盘点。
- 修正了两处过期登记：⌘Q 快捷键、导出模板国际化。
- README 测试计数漂移已修（745→762、190→192 suite）。提交 `4c51506`。
- **`main` 分支**：只应用了 HANDOFF 修正（README 计数不适用，main 无测试套件）。
  `dev` 与 `main` 均已 push 到 `git@github.com:Aftery/Inkmark.git`。

### 1.2 真机验收（AT-SPI 驱动，非截图）

`docs/qa/VERIFICATION-LOG.md` 已追加记录（提交 `69406d5`）。
Linux 上通过 6 项：§6-4 关闭守卫、§6-6 脏点、§6-11 缩放、§6-31 标签栏、
§6-33 标签切换保真、§6-45 重启恢复。

### 1.3 白屏缺陷取证（主体工作）

- 缺陷记录：`docs/review/2026-11-13-webkit-crash-linux.md`（12 节 / 589 行）。
- HANDOFF §7 已如实登记为「未修复」。
- 提交链：`799e901` → `84d79e3` → `c7d0d5b` → `299746e`。

### 1.4 已排除的原因（都有实测依据，别再重测）

| 排除项 | 依据 |
|---|---|
| 标签快捷键 / 点击图片 | 第 2 次仅点击、第 9 次点的是文字/空白处，仍崩 |
| base64 内嵌图片本身 | 两张图删成占位文字后，同区域操作**仍崩**（第 4 次） |
| 软件渲染（无 GPU） | 真实桌面 Intel Iris Pro P5200 + crocus 硬件驱动下**仍崩**（第 3、4 次） |
| localStorage 只读 | 该现象**仅限沙箱**；真实桌面可写、持久化正常，仍崩 |
| 纯 WebKit 通用缺陷 | 纯 WebKit 静止页 + JS 定时器页**各跑满 300 秒均不崩** |
| WAL 丢草稿风险 | 真实桌面正常打开时 206KB WAL 正确 checkpoint 归零，数据完好 |

### 1.5 我在本轮犯的两个错误（已订正，务必别再犯）

1. **曾写「根因锁定为快速滚动」**（提交 `c7d0d5b`）——缺对照：没测「不滚动是否也崩」。
   补做对照后证伪，已在 `299746e` 与缺陷记录 §10 订正。
2. **曾写「崩溃由注入脚本引起」**——被第 9 次（纯净二进制 + 用户手动操作）证伪。
   注入变体确实能压崩（85–115 秒），但那是实验引入的变量，不代表真实使用。

**方法教训**：每次实验前**必须清理宿主残留进程**（`build/bin/inkmark` 与
`WebKitWebProcess`）。残留实例会让 AT-SPI 读到已白屏的旧窗口，产生
「健康 0 / 异常 N 但无 coredump」的假阴性——我因此浪费过多轮。

---

## 2. 还没做的（下一会话可从这里接）

### 2.1 白屏根因（最高优先，未完成）

现状：九次崩溃栈相同，可复现（手动），但**不知道具体哪段代码/哪个渲染条件**触发。

建议下一步（按性价比，均已写进缺陷记录 §8）：

1. **二分 CodeMirror 装饰**：崩溃需要 Inkmark/CM 的特定条件（纯 WebKit 不崩）。
   已试过静态 block 装饰不崩；**未试**真实 `TableWidget`（contenteditable +
   多层事件监听，`tableWidget.js` 500 行）与 `wysiwyg`（图片 widget）。
   注意这两者有较深依赖链（`i18n` → `prefs` → `localStorage`、`wailsjs`），
   独立打包需 mock。
2. **加 WebKit debug 符号**后再复现，取有名字的栈帧（当前全是
   `libwebkit2gtk + 0x…` 偏移）。Arch 无 `webkit2gtk-4.1-debug` 包，
   `debuginfod` 在 batch 模式下默认被拒（我试过 `-ex "set debuginfod enabled on"`
   无效，问询早于 `-ex` 执行）——需要其他办法拿符号。
3. **降级验证**：`extra/webkit2gtk-4.1` 有 `2.54.1-1` 可降（当前 `2.54.2-1`，
   是 2026-10-24 从 2.54.1 升级来的）。降级到 2.54.1 复现，可判断是否回归。
   **注意：这要动系统包，须先征得用户同意。**

### 2.2 多标签页目视清单（未完成）

`docs/qa/visual-checklist.html` 的 §6 第 30~45 项，**原先 6 项已验**（见 1.2），
**剩余项目一条都没验**。其中：

- **§6-30（IME 合成期切标签，MD-11 P0 级）**——风险最高，**未验**。
  本轮修好了输入法路径污染（见 3.2），现在具备可测条件。
- 5 条标签快捷键、斜杠命令面板、⌘⇧A 命令面板、⌘W 不得关标签——**均未验**
  （这些验收被白屏崩溃打断）。

**验收纪律**（仓库规则）：只追加到 `docs/qa/VERIFICATION-LOG.md`；
**绝不伪造结果**；真机没验过的不能标通过。

---

## 3. 环境与工具（新会话直接用）

### 3.1 沙箱限制（必须知道）

DSH 沙箱是 `bwrap --ro-bind / / --dev /dev --unshare-pid --die-with-parent`：

- **`/` 只读** → `~/.local/share/inkmark` 不可写 → `localStorage.setItem` **静默失败**
  （被 `persistTabs` 的 try/catch 吞掉，不报错）。**在沙箱里做持久化实验全是假阴性。**
- **`/dev/dri` 不可见** → WebKit 只能软件渲染（`ZINK failed`）。
- **看不到宿主进程**（`--unshare-pid`），`pgrep` 查不到残留实例。

**要真机实验必须用 `sandbox_permissions: danger-full-access`**（本轮已多次获批）。

### 3.2 启动脚本 `.realtest/launch.sh`

已处理两件关键事：

- 自检 `/dev/dri`、home 可写性、`glxinfo`/`eglinfo`（输出到 `.realtest/gpu-before.log`）。
- **修掉输入法路径污染**：DSH（AppImage）把 `GTK_IM_MODULE_FILE` 指向自身挂载点，
  该清单**不含 fcitx**；脚本无条件指回 `/usr/lib/gtk-3.0/3.0.0/immodules.cache`
  （含 `im-fcitx5.so`，且 `org.fcitx.Fcitx5` 在 dbus 上）。修完 IM 警告归零。

### 3.3 只读探针 `.realtest/rd.py`

AT-SPI 读状态，替代截图（本机 Electron 禁用图像解码，`read_image` 不可用）。

**已修的关键坑**：必须用 `Atspi.Text.get_text(ti, 0, n)` 这种显式调用。
写成 `ti.get_text(0, n)` 会被解析到 `Accessible.get_text`（只收 1 参）抛
`TypeError`，被 `except` 吞成空串 → 误报「entry 有 0 字符」。
改对后能读到真实文本。

其他可用脚本：`monitor.py`（周期采样）、`watch_real.py`、`watch_scrollonly.py`。

### 3.4 构建注意

- `wails build` 会**重编前端**，覆盖对 `frontend/dist/index.html` 的任何注入。
  要保留注入须用 `go build -tags "webkit2_41 production" -o build/bin/inkmark .`。
- **缺 `production` 标签会运行时失败**：`Error: Wails applications will not build
  with the correct build tags.`
- `wails build` / `npm run build` 会删掉 `frontend/dist/.gitkeep`（仓库已知问题），
  构建后 `git checkout -- frontend/dist/.gitkeep` 恢复，否则
  `verify-readme-paths` 门禁判红。
- 构建需重定向缓存：`export GOCACHE=$PWD/.gocache GOPATH=$PWD/.gopath GOFLAGS=-mod=mod`
  （`~/.cache` 只读）。

### 3.5 门禁脚本

`node scripts/verify/{verify-readme-claims,verify-readme-paths,verify-shortcuts,verify-visual-checklist}.mjs`
——提交前应全绿。

---

## 4. 用户数据（重要，别弄丢）

- 真实数据在 `~/.local/share/inkmark/localstorage/wails_wails_0.localstorage`。
- 备份在 `.realtest/backup/`（含原始 WAL）与 `.realtest/hello.md.orig`。
- `~/Desktop/hello.md` 原文件 md5 = `e267b51f6c2e063881018e13fb42709b`。
  **本轮为做「删图对照」曾临时替换过，已还原并校验 md5 一致。**
- `.realtest/` 已加入 `.gitignore`（实验产物 + 用户数据备份，仅本地留存不入库）。

---

## 5. 下一步建议（给用户看的优先级）

1. **（高）** 用 §2.1 的二分法继续定位白屏根因——这是唯一会**丢数据**的缺陷。
   在根因明确前，建议用户重要内容 `Ctrl+S` 落盘，别只依赖 localStorage。
2. **（中）** 补验 §6 剩余目视项，尤其 **§6-30 IME（P0）**。
3. **（低）** 若定位到是 webkit2gtk 2.54.2 回归，考虑降级或等上游修复。

---

## 6. 关键文件索引

| 文件 | 用途 |
|---|---|
| `docs/review/2026-11-13-webkit-crash-linux.md` | 白屏缺陷完整记录（§1–§11，含所有实验数据与教训） |
| `docs/HANDOFF.md` §7 | 未修复项登记（白屏条目） |
| `docs/qa/VERIFICATION-LOG.md` | 真机验收记录（只追加） |
| `docs/qa/visual-checklist.html` | §6 目视清单（§6-30~45 未验） |
| `.realtest/rd.py` | AT-SPI 只读探针（已修 get_text 坑） |
| `.realtest/launch.sh` | 真机启动（含 GPU 自检、IM 路径修正） |
| `.realtest/judge_webkit.py` | 纯 WebKit 判定实验（300 秒版） |
