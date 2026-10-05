# Spec - Inkmark 白屏热修 + 应用菜单 + 多平台发布 v1.0

> 生成日期：2026-10-05
> 状态：已确认（用户「开始执行」）
> 路径：轻量级（前端 + Go 菜单 + CI），无 API/DB → 前端 + QA 双线
> 前置：上一轮工程底座已落地（12 commit，未 push）；本轮依赖其中的测试网与 `scripts/verify/`

---

## 1. P0：白屏热修（最高优先级）

### 1.1 根因（已由我定位，证据确凿）

```js
frontend/src/App.vue:492   const { ... } = useFileOps({ ..., askInput, ... })
frontend/src/App.vue:616   const { dialog, dialogInputEl, askInput, closeDialog } = useDialog()
```

`askInput` 是 `const`，**声明在调用之后**。setup 期执行到 492 行读取它 → 命中 **暂时性死区（TDZ）** →
`ReferenceError: Cannot access 'askInput' before initialization` → Vue 树未渲染 → **白屏**。

由上一轮 `beec8c8`（抽 composable）引入。Composable 本身无缺陷，**是调用方注入依赖时的顺序错了**。

### 1.2 修法（二选一，前端定夺但要说明理由）
- **A（推荐）**：把 `useDialog()` 整块上移到 `useFileOps({...})` **之前**，并加注释写明该顺序约束
- **B**：注入处改惰性包装 `askInput: (...a) => askInput(...a)`（箭头函数体在调用时求值）

**必须同时排查**是否有其他同类风险：`useFileOps` 的 14 个依赖逐个核对「声明行号 < 492」。
已知安全项（不必改）：`showToast`（函数声明有提升）、`persistence`(160)、`title`(47)、`filePath`(38)、
`getEditor: () => editor`（闭包，editor 在 onMounted 赋值）。

### 1.3 ⚠️ 验收方式必须改变（这是本轮最重要的流程修正）

上一轮我的「冒烟」只查了 **进程存活**：

```
open build/bin/inkmark.app && pgrep -x inkmark  →  "进程存活"
```

**窗口开着但 WebView 白屏，进程一样存活。** 我验的是「没崩」，不是「渲染出来了」——
所以白屏是我放过去的，不是运气问题。

**本轮 P0 的验收标准（缺一不可）**：
1. ✅ `wails build` 通过
2. ✅ **真渲染验证**：起 `npm run dev`，用无头浏览器加载该 URL，**断言 DOM 中出现应用根节点**（如 `.app` / `.editor-host`），且 **console 无 error**
   - 原理：该 TDZ 错误发生在 `setup()` 内，**与 Wails 无关**，浏览器里必然同样复现——所以这条网真的能抓到本次这类 bug
3. ✅ 打包后**再次启动应用，并由用户目视确认非白屏**（我不能替你目视，但必须跑到第 2 步）

## 2. 两道防回归守卫（QA 交付）

### 2.1 静态顺序守卫（零依赖，进 `npm test`）
**断言**：`App.vue` 中每个 `useXxx({ ... })` 调用注入的标识符，其**声明行号必须早于调用行号**。
- 覆盖 `const`/`let` 声明与 `import` 绑定；函数声明（`function f()`）因有提升**不参与**判定
- 找不到声明 → 报红并指名「来源不明，可能是 TDZ 风险」
- **变异自证**：把 `useDialog()` 移回 492 之后 → 必须报红，报错文案指明 `askInput` 与两处行号

### 2.2 真渲染冒烟（新增，脚本形式可复用）
落位 `scripts/smoke/render-check.mjs`（或等价），职责：启动/复用 vite dev → 无头浏览器加载 →
断言根节点存在 + console 无 error → **退出码 0/1**。
- 若本机无可用无头浏览器：**如实报告「未验证」**，不要用「构建通过」冒充渲染验证
- 该脚本要能被我作为最终门禁直接运行

## 3. Inkmark 应用菜单（前端，Go 侧）

### 3.1 现状约束（已实测）
`main.go:90` 的 `appMenu.Append(menu.AppMenu())` 在 macOS 端**硬编码展开**，无法追加自定义项——
这正是当初「设置…」被放进文件菜单末尾的原因。

### 3.2 目标结构（对齐 Apple HIG 的应用菜单顺序）

> ⚠️ **本节的实现方案已于 2026-10-05 修正（原方案不可实现，见 §3.2.1）。**

```
Inkmark
  关于 Inkmark
  ─────
  设置…            ⌘,
  检查更新…
  ─────
  隐藏 Inkmark      ⌘H
  ─────
  退出 Inkmark      ⌘Q
```

**实现**：`appMenu.AddSubmenu("Inkmark")`，**全部用 `AddText`**（不用任何 Role）：
| 项 | 实现 |
|----|------|
| 关于 Inkmark | `AddText` → emit `menu:about` → 前端自建关于弹层（版本取自 `App.Version()`） |
| 设置… ⌘, | `AddText` → emit `menu:open-settings`（**事件名不变**，前端已接线） |
| 检查更新… | `AddText` → emit `menu:check-update` |
| 隐藏 Inkmark ⌘H | `AddText` → `runtime.Hide(ctx)` |
| 退出 Inkmark ⌘Q | `AddText` → `runtime.Quit(ctx)` |

- **「设置…」必须从文件菜单移除**（入口唯一）
- 新增事件名 `menu:about` / `menu:check-update` **必须在前端 `App.vue` 注册**——
  仓库有「事件双向闭合」契约测试（`frontend/tests/contracts.test.mjs`），Go 发出而前端未注册会报红

### 3.2.1 为什么不能用 Role（原方案作废 · 实测证据）

原 Spec 写的是「自建子菜单 + 逐项回填 `menu.About()` / `Hide()` / `HideOthers()` / `UnHide()` / `Quit()`」，
**该方案在 Wails v2.16.0 下不可能实现**：

1. `pkg/menu/menuroles.go` 中这五个函数**整体位于 `/* */` 注释块内**（第 39~214 行），
   Role 常量同样被注释（`// HideOthersRole Role = "hideOthers"`）。
   实测：`go doc .../pkg/menu About` → `doc: no symbol About`（Quit/HideOthers/UnHide 同）。
2. Role 类型是 `int`，**仅** `AppMenu=1 / EditMenu=2 / WindowMenu=3` 三个常量有效。
3. darwin 端 `processMenu`（`internal/frontend/desktop/darwin/menu.go:85`）的判断顺序是
   「先看 `SubMenu != nil` → 建普通子菜单并递归」，只有**无 SubMenu** 的项才走 `processMenuItem`
   触发 `appendRole`。→ **把 Role 塞进自建子菜单在架构上也不成立**（子菜单项一律按普通 submenu 处理，Role 被无视）。

**这正是当初「设置…」只能放文件菜单的根因。**

### 3.2.2 能力边界（如实记录，不假装能实现）

| 期望项 | Wails v2.16 是否支持 | 处置 |
|--------|---------------------|------|
| 隐藏其他（hideOtherApplications） | ❌ 无 API | **省略**（不置灰——原生菜单 tooltip 不可靠，灰色项无法解释原因，看起来像坏了） |
| 显示全部（unhideAllApplications） | ❌ 无 API | **省略**（`runtime.Show` 是 app 级近似，语义不同，不冒充） |
| 隐藏 / 退出 | ✅ `runtime.Hide` / `runtime.Quit`（源码已核实） | 自建文本项 + accelerator |
| 系统原生「关于」面板 | ⚠️ `mac.Options.About` 存在，但**只在原生 AppMenu 下可达** | 弃用该 Role 后改为自建弹层；`mac.Options.About` 保持不设置 |
| 非 darwin 平台 | 无 Role 问题 | 全文本项，三平台结构一致 |

上述两项省略需写进 `README.md` 的「已知问题与待办」（Wails 能力边界，非本仓缺陷）。

### 3.3 关于 Inkmark
优先 `menu.About()`（系统原生关于面板）；若其嵌在自建子菜单中不生效，则改为自建文本项 + 前端弹层
（内容：应用名 / 版本 / 一行描述 / 仓库链接）。**版本号必须来自 §4 的单一版本源**。

## 4. 版本源（Go）

新增 `version.go`（或等价）：
```go
// version 由构建时注入覆盖；本地开发回落 dev 值
var version = "0.1.0-dev"
```
- 构建注入：`wails build -ldflags "-X main.version=<tag>"`
- 暴露给前端：`func (a *App) Version() string`
- **禁止**在前端另写一份版本号（`package.json` 的 version 不参与运行时，本轮不作为真源）

## 5. 检查更新（Go，P2）

### 5.1 机制
```
GET https://api.github.com/repos/Aftery/Inkmark/releases/latest
  → tag_name（如 "v0.2.0"）
  → 与 version 做 semver 比较（只比 major.minor.patch，忽略预发布后缀）
  → 返回 { hasUpdate bool, latest string, url string, current string }
```
- 超时/网络失败/仓库无 Release（404）**必须优雅降级**：返回「无法检查更新」而**不是**抛错弹窗
- 菜单项「检查更新…」→ 前端调该方法 → 弹提示（发现新版 → 显示版本 + 「前往下载」；否则「已是最新」）
- **不做自动下载替换**（未签名应用的 Gatekeeper 限制），第一版只提示 + 打开下载页

### 5.2 前置条件（必须如实告知用户）
仓库当前**没有任何 Release / tag**，接口会返回 404 → 在跑通 §6 并打出第一个 Release 之前，
「检查更新」只能返回「无法检查」。**实现要能优雅处理这种情况**，不能假装已是最新。

## 6. 多平台发布 workflow（前端，CI）

`.github/workflows/release.yml`：
- 触发：`on: push: tags: ['v*']`（另留 `workflow_dispatch` 便于手动试跑）
- **matrix（必须跨 runner，Wails 不支持跨平台编译）**：
  | runner | `-platform` | 产物 |
  |---|---|---|
  | `macos-latest` | `darwin/universal` | `inkmark.app` → zip |
  | `windows-latest` | `windows/amd64` | `inkmark.exe` |
  | `ubuntu-latest` | `linux/amd64` | 二进制 + 必要说明 |
- 版本注入：从 tag 派生（`v0.2.0` → `main.version=0.2.0`）走 `-ldflags`
- 产物上传：`actions/upload-artifact`；可选 `softprops/action-gh-release` 自动建 Release
- **Linux 必须装系统依赖**（`libwebkit2gtk-4.1-dev` 等），否则构建必失败——请查 Wails 官方文档确认包名，不要凭记忆写
- 注释用中文说明「每个 job 卡的是什么」（与 `ci.yml` 风格一致）

## 7. 验收标准（EARS）

| 编号 | 标准 |
|------|------|
| AC-01 | When 修复后启动应用，Then 界面**必须**渲染出应用根节点，且 console 无 error（真渲染验证，非进程存活） |
| AC-02 | When `AskInput` 类依赖被移到调用之后，Then 静态顺序守卫**必须**报红并指名标识符与行号 |
| AC-03 | When 运行真渲染冒烟脚本，Then 退出码 0；若环境不支持无头浏览器，**必须**如实报「未验证」 |
| AC-04 | When 打开 Inkmark 菜单，Then **必须**出现自定义文本项且顺序为：关于 Inkmark → 分隔 → 设置… ⌘, → 检查更新… → 分隔 → 隐藏 Inkmark ⌘H → 分隔 → 退出 Inkmark ⌘Q。「隐藏其他 / 显示全部」按 §3.2.2 能力边界**省略**，不算未达标（须在 README 待办中如实登记） |
| AC-05 | While 文件菜单中**必须**不再有「设置…」（入口唯一） |
| AC-06 | When 构建时传入 `-ldflags "-X main.version=1.2.3"`，Then `App.Version()` **必须**返回 `1.2.3`；不传时为 dev 值 |
| AC-07 | When 仓库无 Release，Then 检查更新**必须**返回「无法检查」而非抛错、也**不得**谎报「已是最新」 |
| AC-08 | When push 一个 `v*` tag，Then release workflow **必须**在三个平台产出可下载产物（配置正确性 + 本机命令自证；真 runner 验证需 push，如实标注） |
| AC-09 | 全仓零 emoji（P0-1）；`npm test` 全绿；`go vet` 通过 |

## 8. 已知坑（从 `pitfalls.jsonl` 召回）

| 坑 | 对本轮的影响 |
|----|------------|
| **`const` TDZ：依赖声明晚于调用 → setup 崩 → 白屏** | 本轮 P0 本身就是它；§2.1 守卫专治 |
| **「进程存活」不等于「渲染成功」** | §1.3 强制真渲染验证；禁止再用 `pgrep` 冒充冒烟 |
| `npm run build` 会删 `frontend/dist/.gitkeep` | 每次 build 后 `git checkout -- frontend/dist/.gitkeep` |
| bash `grep` 在本仓 UTF-8 文件上会静默无输出 | 契约检查用 Node 脚本或专用检索工具 |
| 一时刻只允许一个人写仓库 | 两个 worker 的文件必须互不重叠，变异自证必须串行 |
| 「看起来像就是是」类解析错误（已 3 次） | 新增解析逻辑先剥注释；零结果/异常数量先质疑解析器 |
| **`grep "^func"` 会匹配到被注释掉的函数声明** | 本轮真实踩到：我据此判定 `menu.About()`/`Hide()` 等单项 Role 可用，实际它们在 `/* */` 块内。**核实 API 是否存在，必须用 `go doc <pkg> <Symbol>` 或读源码，不能用 grep 的输出下结论**（`go doc` 只认真符号） |
| **`import.meta.env.DEV` 块立即读取后声明的 `const` → 生产绿 / dev 红** | 本轮第二处 TDZ（比第一处隐蔽得多）：`App.vue:354` 的 `if (import.meta.env.DEV) { window.__inkmark = { ..., openFile, openTreeFile } }` 是 **setup 顶层立即执行**的块，对象字面量的 shorthand 会**立刻读取**这两个标识符，而它们在 `:504` 才由 `useFileOps()` 解构出来 → dev 下 setup 抛 `ReferenceError: Cannot access 'openFile' before initialization` → **dev 白屏**；生产构建把 `import.meta.env.DEV` 静态替换为 `false`、整块剔除，所以 dist 正常。**后果：所有面向生产产物的检查（含我此前那只验 dist 的渲染冒烟）都看不见这个 bug**。修法：把该块下移到 `useFileOps` 解构之后，或改用 getter（`get openFile() { return openFile }`，惰性求值） |

## 9. 交付物与分工（文件互不重叠）

| 角色 | 交付 | 文件边界 |
|------|------|---------|
| 前端 | P0 修复、Inkmark 菜单、版本源、检查更新、release workflow | `frontend/src/App.vue`、`main.go`、`version.go`(新)、`app.go`、`.github/workflows/release.yml`(新) |
| QA | 静态顺序守卫（进 `npm test`）、真渲染冒烟脚本 | `frontend/tests/**`、`scripts/smoke/**`(新) |
| 总监 | 交叉验证 AC-01~AC-09、真渲染门禁、`wails build`、提交把关 | — |
