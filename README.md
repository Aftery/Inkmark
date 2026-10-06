# Inkmark — 跨平台 Markdown 编辑器（Wails + Vue）

技术栈：**Go (Wails v2) + Vue 3 + CodeMirror 6 + markdown-it + highlight.js**

> 定位：Typora 式「所写即所见」写作工具——默认即时渲染，可切纯源码 / 纯预览 / 双栏 / 阅读多种视图。

## 已实现能力

| 功能 | 实现 |
|---|---|
| Markdown 编辑 + 语法高亮 | CodeMirror 6（`src/editor/`），写作工具形态：无行号、无整行高亮、正文栈 15px |
| **WYSIWYG 即时渲染（默认）** | `src/editor/wysiwyg.js`：光标所在行及上下相邻 1 行显示 Markdown 源码，其余行呈现渲染效果（列表圆点 / 任务勾选框以 widget 替换标记符）；仅产装饰、**零文档篡改**；中文输入（IME）时冻结重算；装饰只在可视区计算，大文档不卡 |
| 实时预览 | markdown-it + highlight.js（`src/preview/`），正文限宽居中 |
| **预览渲染防抖** | 输入期预览渲染防抖 ~120ms，大文档连续输入不卡；打开 / 恢复文件即时渲染，导出前强制 flush 保证内容最新（`App.vue`） |
| **视图四态** | 编辑 `⌘1` / 预览 `⌘2` / 双栏 `⌘3` / 阅读 `⌘4`（`App.vue`）；阅读模式只渲染、隐藏编辑器 |
| **专注模式** | `⌘⇧F` 收起界面干扰、强制进入编辑态（`App.vue`） |
| **主题 4 档（含跟随系统）** | 浅 Indigo / 深 Indigo / 纸感赭石三套配色（`src/themes/tokens/design-tokens.css`）+ 跟随系统，共 4 档；`system` 偏好由 `theme.js` 解析为具体主题并写入（纸感不会被系统自动选中）；切换只改 `<html data-theme>`，**不重建编辑器** |
| **大纲视图** | `⌘B` 开关（`src/components/Outline.vue` + `outline.js` + `useOutlineSync.js`），从文档提取标题层级、点击跳转 |
| **历史快照** | `src/components/HistoryPanel.vue`：与自动保存**解耦**——编辑会话每 ≥3 分钟节流一次 + 显式保存 + 切换文件前 + 手动触发；轮转 / 去重由 Go 侧 `SnapshotWrite` 负责 |
| 自动保存 | 改动后 800ms 防抖覆盖原文件，状态栏显示保存态（间隔可配，见「设置面板」） |
| **未保存关闭拦截** | 脏状态下关闭窗口弹系统确认（取消 → 阻止关闭；不保存退出 → 放行）；`dirty` 由前端同步到 Go（`OnBeforeClose`） |
| **图片粘贴 / 拖拽插入** | 编辑器内粘贴或拖入图片 → 写入文档同级 `assets/`（`img-<时间戳>-<随机>.<ext>`），并插入 `![](assets/xxx)`（Go 侧 `SaveImage`） |
| **文件树外部变更监听** | 打开文件夹后监听其**一层**增删改（fsnotify，`watcher.go`），去抖后自动刷新文件树 |
| **代码块 Enter 跳出** | 光标位于紧邻结束围栏的空行时按 Enter，跳到围栏之后另起一行（`createEditor.js`） |
| 原生菜单栏 | macOS 顶部系统菜单栏；Windows/Linux 窗口内菜单条（`main.go` 的 `buildMenu`，事件发给前端） |
| **设置面板** | `⌘,` 打开（`src/components/SettingsPanel.vue`）：外观 5 项（主题 / 正文字体 / 字号 / 行距 / 行宽）+ 编辑器 2 项（自动保存间隔 / 快照间隔），全部**实时生效**（改完立刻落 CSS 变量，无需重启）、**刷新保持**（`localStorage` 持久化），另有「恢复默认」（二次确认，防误触） |
| **排版偏好** | 正文字体（系统 / 衬线 / 等宽）、字号（12–20px 六档，编辑区与预览区**成对同步**）、行距（紧凑 / 标准 / 宽松）、行宽（窄 / 标准 / 宽）——真源 `src/themes/prefs.js`，偏好走**文档作用域**变量 `--font-body-user`，不污染工具条 / 侧栏等界面外壳 |
| **主题 4 档** | 设置面板内可选（跟随系统 / 浅色 / 深色 / 纸感），`⌘⇧L` 循环切换；`system` 由 `theme.js` 解析为具体主题后写入，纸感主题不会被系统自动选中 |
| **打印** | `⌘P` 走系统打印对话框（前端 `window.print()`）；`@media print` 已隐藏工具条 / 侧栏 / 各类遮罩，只输出正文 |
| **查找 / 替换** | `⌘F` 查找、`⌘⌥F` 查找并替换（CodeMirror `searchKeymap` + 面板） |
| **跳转到行** | `⌘L` 打开输入框跳转到指定行号（`App.vue` 全局 keydown） |
| **行操作** | `⌥↑` / `⌥↓` 移动当前行，`⇧⌥↓` 向下复制当前行，`⌘⇧K` 删除当前行（VS Code 惯例） |
| **视图缩放** | `⌘=` 放大 / `⌘-` 缩小 / `⌘0` 重置，80%~150% 六档；状态栏可点击循环。与基础字号**正交叠加**（`--zoom-scale` 独立变量） |
| **视图开关（checkbox）** | 滚动联动 / 打字机模式 / 窗口置顶三个勾选项，状态真源在 Go 侧，前端挂载时回读同步 |
| **最近打开** | 菜单「文件 ▸ 最近打开」子菜单：去重置顶、上限截断、`recents.json` 持久化，可一键清空（`app.go`） |
| **重命名** | 菜单「文件 ▸ 重命名…」走应用内输入对话框（WKWebView 无 `window.prompt`） |
| **插入目录** | 菜单「格式 ▸ 插入 ▸ 目录」，按标题层级生成 TOC（`editor/commands.js` 的 `insertToc`） |
| 快捷键速查 | `⌘/` 打开应用内速查弹层；非 macOS 自动把 `⌘/⌥/⇧` 显示为 `Ctrl+/Alt+/Shift+` |
| 快捷键 | 文件 / 编辑 / 格式 / 视图 / 帮助五类，**逐条对齐 `main.go` 的 accelerator**，见下方「快捷键」 |
| 文本导出 | HTML：内联样式模板（46rem 行宽）；PDF：macOS 一键直出（WebKit/PDFKit，dark→light 主题映射，467px 版心），其它平台走系统打印（`src/export/`） |
| 本地文件管理 | 打开文件 / 打开文件夹，递归懒加载文件树（`app.go` + `src/components/FileTree.vue`） |
| 编辑/预览滚动联动 | 双栏模式下**标题锚点映射** + 互斥锁（`App.vue` / `useOutlineSync.js`） |
| 分栏宽度可拖 | 编辑/预览分割条可拖动调宽（20%~80%），双击复位，宽度持久化 |

## 快捷键

> **本节由 `frontend/src/composables/useShortcuts.js` 的 `COMMANDS` 命令表生成**，非人工记忆。
> 该表是键位的**唯一真源**：自绘标题栏的菜单、全局键位分发、应用内速查表三方都读它。
> 改键位只需改命令表，然后跑 `node scripts/verify/verify-shortcuts.mjs` 校验本文节是否同步。
> 标「无快捷键」的项只能走菜单点击（原因见括号）。
> 非 macOS 平台上 `⌘` / `⌥` / `⇧` 分别读作 Ctrl / Alt / Shift。

> 界面为**自绘标题栏**（无边框窗口）：菜单与窗口按钮都在窗口顶部，不再使用系统菜单栏。
> 格式命令另有更快的入口：在新行输入 `/` 唤起斜杠命令面板（代码块 / 表格 / 待办 / 引用）。

**文件**

| 操作 | 快捷键 |
|---|---|
| 新建 | ⌘N |
| 打开… | ⌘O |
| 打开文件夹… | ⌘⇧O |
| 保存 | ⌘S |
| 另存为… | ⌘⇧S |
| 重命名… | 无快捷键（走应用内输入对话框） |
| 打印… | ⌘P |
| 导出 HTML… | ⌘⇧H |
| 导出 PDF… | ⌘⇧P |

**编辑**

| 操作 | 快捷键 |
|---|---|
| 撤销 | ⌘Z |
| 重做 | ⌘⇧Z |
| 剪切 | ⌘X |
| 拷贝 | ⌘C |
| 粘贴 | ⌘V |
| 全选 | ⌘A |
| 查找… | ⌘F |
| 查找并替换… | ⌘⌥F |
| 跳转到行… | ⌘L |
| 上移行 | ⌥↑ |
| 下移行 | ⌥↓ |
| 重复当前行 | ⇧⌥↓ |
| 删除当前行 | ⌘⇧K |
| 复制选区为 HTML | 无快捷键（仅菜单入口） |

**格式**

| 操作 | 快捷键 |
|---|---|
| 加粗 | ⌘⇧B |
| 斜体 | ⌘I |
| 删除线 | ⌘⇧X |
| 行内代码 | ⌘` |
| 链接 | ⌘K |
| 标题一 | ⌘⌥1 |
| 标题二 | ⌘⌥2 |
| 标题三 | ⌘⌥3 |
| 无序列表 | ⌘⇧8 |
| 有序列表 | ⌘⇧7 |
| 任务列表 | ⌘⇧9 |
| 引用块 | ⌘⇧. |
| 代码块 | ⌘⌥C |
| 图片… | 无快捷键（斜杠命令面板可插入，命令表未分配键位） |
| 表格 | 无快捷键（斜杠命令面板可插入，命令表未分配键位） |
| 分割线 | 无快捷键（仅菜单（也可用斜杠面板）） |
| 目录 | 无快捷键（仅菜单） |
| 清除格式 | 无快捷键（仅菜单） |

**视图**

| 操作 | 快捷键 |
|---|---|
| 专注模式 | ⌘⇧F |
| 显示/隐藏大纲 | ⌘B |
| 放大 | ⌘= |
| 缩小 | ⌘- |
| 重置缩放 | ⌘0 |
| 切换主题 | ⌘⇧L |
| 打字机模式 | 无快捷键（开关项，未分配键位） |
| 窗口置顶 | 无快捷键（开关项，未分配键位） |

**窗口**

| 操作 | 快捷键 |
|---|---|
| 最小化 | ⌘M |
| 缩放 | 无快捷键（仅菜单；Wails 无「适配内容尺寸」API，以最大化/还原近似） |

**帮助**

| 操作 | 快捷键 |
|---|---|
| 快捷键速查 | ⌘/ |
| 关于 Inkmark | 无快捷键（仅菜单） |
| Markdown 语法示例 | 无快捷键（仅菜单） |

## 目录结构

```
inkmark/
├── main.go              # 入口：窗口配置、原生应用菜单、OnBeforeClose 钩子、绑定 App 服务
├── app.go               # 核心服务：对话框、文件读写、目录遍历、图片保存、dirty 状态
├── snapshot.go          # 历史快照存储（写入 / 轮转 / 读取，docKey 派生）
├── watcher.go           # 文件树外部变更监听（fsnotify，一层 + 去抖推送）
├── export_pdf_darwin.go # PDF 一键直出（WKWebView/PDFKit）
├── export_pdf_other.go  # 非 darwin 平台的降级实现
├── wails.json           # Wails 配置（前后端构建命令）
├── scripts/             # 工程门禁脚本
│   ├── p0-check-emoji.sh    # P0-1 emoji 扫描（零容忍，CI 门禁之一）
│   └── verify/              # 图标 / 主题契约的 Node 校验脚本
├── docs/                # 架构决策记录（architecture/ADR-00x）、规格（spec/）、方案（plan/）、
│                        # 悬而未决登记册（decisions/OPEN-DECISIONS.md）
└── frontend/
    ├── src/
    │   ├── App.vue          # 主界面：视图四态、顶栏、侧栏、双栏布局、滚动联动、预览防抖
    │   ├── editor/          # CodeMirror 封装：createEditor.js / wysiwyg.js / outline.js / commands.js
    │   ├── preview/         # markdown-it 渲染配置（highlight.js core 按需注册）
    │   ├── export/          # HTML / PDF 导出模板与 exporters
    │   ├── composables/     # useDocumentState（dirty/自动保存/快照/导出）/ useEditorSession（编辑器）
    │   │                    # useCommands（命令注册面）/ useFileAssets（图片落盘）/ useWorkspace
    │   ├── components/      # FileTree / TreeNode / Outline / HistoryPanel / Toolbar / StatusBar
    │   │                    # + SettingsPanel（设置面板）/ SegmentedControl（分段控件）/ icons/
    │   └── themes/          # tokens/design-tokens.css（单文件三主题 Token）+ theme.js（主题解析）
    │                        # + prefs.js（排版/编辑器偏好唯一真源）/ base.css / preview.css
    ├── tests/           # node:test 测试网（prefs 行为 + 静态契约），需 Node ≥22
    └── wailsjs/         # Wails 自动生成的 IPC 绑定（勿手改）
```

> **图标与许可**：界面图标几何衍生自 [Lucide](https://github.com/lucide-icons/lucide)（版本 `lucide-static@1.48.0`），
> 采用 **ISC 许可**（其中 `chevron-down` / `chevron-right` / `download` / `moon` / `x` 源自 Feather 项目，为 MIT 许可）。
> 许可全文见 [`frontend/src/components/icons/LICENSE`](frontend/src/components/icons/LICENSE)。
> 所有图标统一经 `frontend/src/components/icons/AppIcon.vue` 渲染，几何数据与语义白名单在 `paths.js`。

## 常用命令

> **前置**：`wails` 命令依赖 PATH 中的 `go`。本机 go 由 Homebrew 安装，**未加入默认 PATH**，
> 需先自行把 go 的 bin 目录加入 PATH（常见位置 `/usr/local/opt/go/bin` 或 `/usr/local/bin`，
> 以 `go version` 能否跑通为准），否则报 `exec: "go": executable file not found`。

```bash
# 开发（热重载，推荐）
~/go/bin/wails dev

# 生产构建（产物在 build/bin/）
~/go/bin/wails build

# 重新生成前端 IPC 绑定（改了 app.go 等导出方法后【必须】执行）
~/go/bin/wails generate module
```

### 前端

```bash
cd frontend
npm install

npm run dev      # 本地开发服务器
npm run build    # 生产构建 → frontend/dist
npm test         # 测试网（prefs 行为 + 静态契约），【需 Node ≥22】
```

> - `npm test` 用的是 Node **内置** `node:test`（无第三方测试依赖），因此**必须 Node ≥22**；低版本会报 `node --test` 不可用。
> - `npm run build` 会**删掉被 git 跟踪的 `frontend/dist/.gitkeep`**（构建清空 `dist/` 的副作用）。
>   该文件是 `main.go` 的 `//go:embed all:frontend/dist` 内嵌目标，**删掉会导致 Go 编译报 "no matching files found"**。
>   本地每次 build 后请执行 `git checkout -- frontend/dist/.gitkeep` 还原。

### 门禁脚本

```bash
# P0-1：emoji 扫描（零容忍，CI 同款）
./scripts/p0-check-emoji.sh frontend/src
```

> 改了 `prefs.js`、菜单事件或 `App.vue` 结构后，**先跑 `npm test`** 再提交——
> 测试网里有静态契约检查（菜单事件双向闭合、⌘P 唯一性、打印样式存在性、行数门禁）会拦住静默失效。

> 本机网络需镜像：Go 依赖走 `GOPROXY=https://goproxy.cn,direct`，npm 走 `--registry=https://registry.npmmirror.com`，且先 `unset` 环境里的代理变量。


## 设计要点（为什么这么做）

1. **文件安全写入**：`WriteFile` 先写 `.tmp` 再 `rename`，避免写一半崩溃留下半个文件。
2. **文件树懒加载**：`ListDir` 只返回一层，点击目录才展开——千级文件的仓库也不会卡启动。
3. **主题 = CSS 变量**：编辑器（CodeMirror theme）、预览排版、代码高亮 token 全部引用同一组变量，切换零成本；预览高亮没用 hljs 官方主题 CSS，而是把 token 色值做成变量（`--hl-keyword` 等），保证明暗一致。`data-theme` 始终存「已解析」的具体主题（不存 `system`），切换只改属性、不重建编辑器。
4. **滚动同步用标题锚点映射**：双栏模式下按标题位置对齐编辑 / 预览滚动，体验优于纯比例映射；仍用互斥锁防回环（一边滚动时锁另一边，松开再放开）。
5. **窗口拖拽用 `--wails-draggable`**：Wails 不读 `-webkit-app-region`（那是 Chromium 的，macOS WKWebView 不认）。顶栏设 `--wails-draggable: drag`，交互子元素设 `no-drag`。
6. **操作全在系统菜单栏**：设置 `options.Menu` 会整体替换默认菜单，必须把 `AppMenu` / `EditMenu` / `WindowMenu` 三个 Role 手动拼回来——尤其 EditMenu，丢了它 macOS 下 ⌘C/⌘V 会失效。菜单项只在 Go 侧发事件，业务逻辑统一在前端。
7. **渲染进程零 Node 能力**：前端只能通过生成的 `wailsjs` 绑定调 Go 方法，文件系统攻击面收在 `app.go`。
8. **WYSIWYG 即时渲染的边界**：只产装饰、绝不 `dispatch` 文档变更（内容零篡改）；`view.composing` 为 true（中文输入中）时冻结重算，避免抖动；装饰只在 `visibleRanges` 内计算（大文档性能）；活跃行向上下各扩 1 行，避免方向键因标记符显隐突变而跳跃。
9. **快照与自动保存解耦**：自动保存 800ms 防抖覆盖原文件；快照独立按「节流 / 显式保存 / 切换文件边界 / 手动」触发，避免每次按键都落快照、污染历史。
10. **关闭拦截的状态同步（`dirty` 语义已固化为不变量）**：`dirty` 只有一个含义——「编辑器内存内容 ≠ 磁盘内容」（含从未落盘的新文档）。真源在前端、关闭钩子在 Go，前端 `watch(dirty)` 调 `SetDirty` 镜像；Go 侧不读盘比对。硬约束：任何改动文档内容的路径都必须**显式声明**对 `dirty` 的影响（标脏或落盘归零），不得默认继承。对话框异常时保守「阻止关闭」，宁可多问一次也不丢内容。完整定义、生命周期表与多文档扩展路径见 [`docs/architecture/ADR-005-dirty-semantics.md`](docs/architecture/ADR-005-dirty-semantics.md)。
11. **图片落盘位置**：写入「文档同级 `assets/`」而非全局目录，让 `.md` 能连附件整体搬移；文件名带时间戳 + 随机，避免同毫秒 / 同名覆盖。
12. **代码块高亮按需注册**：`highlight.js` 用 `lib/core` + 注册 22 种常用语言（非整库导入），前端 JS 包从 1756kB 降到 891kB（gzip 603kB → 324kB）。新增语言只需加一行 import + 一行注册。

## 已知问题与待办

> 本节如实登记**未完成**与**未验证**项。原「暂无」说法已移除——README 声称无待办是失真的。

| # | 项 | 状态 / 说明 |
|---|-----|------------|
| 1 | **`App.vue` 拆分** | 进行中。`App.vue` 现 1352 行，远超 300 行门禁，「一个文件塞四件事」（视图四态 / 侧栏 / 对话框 / 焦点模式）。计划按职责抽 composable（`useDialog` / `useShortcutsHelp` / `useFileOps` / `useDivider`）到 `frontend/src/composables/`，**要求行为零变更**。拆分完成后本条更新为实际结果，并下调行数门禁豁免阈值。 |
| 2 | **Windows / Linux 未真机验证** | 菜单分流代码**已写**（`main.go` 中 `GOOS != darwin` 时自建「编辑」菜单，因为非 darwin 的 `processMenu` 不展开 Role，直接 `Append(EditMenu())` 会渲染成空菜单），但**从未在真实 Windows / Linux 上跑过**，该分支的渲染与事件接线均属未验证。导出 PDF 在这些平台降级为系统打印。 |
| 3 | **原生 accelerator 端到端未自动化验证** | `⌘P` / `⌘,` 等由**原生菜单 accelerator** 承接的键位，需在图形环境**人工点按确认**。本机无 GUI 自动化权限，自动化测试覆盖不到这一层——测试网只能校验「声明与接线一致」，不能证明「按下真的触发」。 |
| 4 | **导出产物是否跟随正文字体偏好（OPEN）** | 导出 HTML / PDF 仍读主题级 `--font-body`，**不跟随**用户「正文字体」偏好（R4 只把偏好作用域收进编辑区 + 预览区，未动导出链路）。当前倾向**不跟随**（导出物是分发格式，应保持主题级稳定排版），待用户确认。见 [`docs/decisions/OPEN-DECISIONS.md`](docs/decisions/OPEN-DECISIONS.md)。 |
| 5 | **零多标签页 / 多文档** | 当前一次只开一个文档。ADR-005 已预留 `dirty` 语义的升级路径（`dirty` 现为单一不变量：编辑器内存内容 ≠ 磁盘内容），多文档需重新定义「关闭哪个文档」的判定。 |
| 6 | **无拼写检查（刻意不做）** | CodeMirror 的 lint 对 CJK 基本无效，中文写作场景是**伪需求**，故不引入。英文拼写需自行接第三方 lint 扩展。 |
| 7 | **应用菜单缺「隐藏其他 / 显示全部」（Wails 能力边界，非本仓缺陷）** | Wails v2.16 只导出 `AppMenu` / `EditMenu` / `WindowMenu` 三个**整体** Role，不导出 `About` / `Hide` / `HideOthers` / `UnHide` / `Quit` 等**单项** Role（`pkg/menu/menuroles.go` 中全被注释；darwin `appendRole` 的 switch 也只认 1/2/3）。因此应用菜单只能全用自建文本项：`隐藏 Inkmark ⌘H` 走 `runtime.Hide`、`退出 Inkmark ⌘Q` 走 `runtime.Quit`；而 `hideOtherApplications` / `unhideAllApplications` **无对应 API**，故「隐藏其他」「显示全部」两项**直接省略**（未置灰、未用 `runtime.Show` 冒充）。 |
| 8 | **放弃系统原生「关于」面板（同 7 的连带）** | 因单项 `About` Role 不可用，应用菜单的「关于 Inkmark」改为**应用内自建弹层**（复用既有对话框样式），内容为应用名 / 版本 / 一行描述 / 仓库链接；版本号取自 Go 单一真源 `App.Version()`（`version.go`），前端不另写版本号。 |
| 9 | **「编辑」菜单仍是英文（刻意保留，非漏改）** | 该菜单用系统 `EditMenu` Role，标题与条目在 Wails 源码里**硬编码为英文**（`WailsMenu.m` 的 `appendRole`），且未导出单项 Role、没有标签覆盖接口。想中文化只能整体自建，但它的条目挂的是**原生 selector**（`undo:` / `cut:` / `copy:` / `paste:` / `selectAll:`），走 macOS responder 链；Wails 的 `MenuItem.Click` 只是 Go 回调、**挂不上 selector**，换成文本项后按 ⌘C/⌘V 不会报错但**会没反应**（静默失效，比英文标题更糟）。对照：「窗口」菜单的三项都有 runtime API 等价实现，已在 v1.2 换成自建中文菜单（见下条）。待 Wails 支持标签覆盖或改用支持 selector 的菜单库后再处理。 |
| 10 | **「窗口 → 缩放」用最大化近似** | 系统该项是「适配窗口内容尺寸」，Wails runtime 无对应 API。已用 `WindowIsMaximised` 判定并在最大化/还原间切换（不会来回抖），视觉上与系统「缩放」不完全等价。最小化（⌘M）与全屏（⌃⌘F）均为精确等价实现。 |

历史待办五项（预览渲染防抖 / 代码块 Enter 跳出 / 未保存关闭拦截 / 图片粘贴拖拽 / 文件树外部变更监听）已于 2026-10-02 全部完成。

## 关于插件系统（现在不做）

第一版全部功能内置。真有扩展需求时，推荐形态：**渲染进程加载 npm 包形式的插件**（Vue 组件 + markdown-it 插件），Go 端只做插件目录扫描和白名单加载，比做进程隔离沙箱成本低一个数量级。
