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
| **三主题 + 跟随系统** | 浅 Indigo / 深 Indigo / 纸感赭石（`src/themes/tokens/design-tokens.css`）；`system` 偏好由 `theme.js` 解析为具体主题并写入；切换只改 `<html data-theme>`，**不重建编辑器** |
| **大纲视图** | `⌘B` 开关（`src/components/Outline.vue` + `outline.js` + `useOutlineSync.js`），从文档提取标题层级、点击跳转 |
| **历史快照** | `src/components/HistoryPanel.vue`：与自动保存**解耦**——编辑会话每 ≥3 分钟节流一次 + 显式保存 + 切换文件前 + 手动触发；轮转 / 去重由 Go 侧 `SnapshotWrite` 负责 |
| 自动保存 | 改动后 800ms 防抖覆盖原文件，状态栏显示保存态 |
| **未保存关闭拦截** | 脏状态下关闭窗口弹系统确认（取消 → 阻止关闭；不保存退出 → 放行）；`dirty` 由前端同步到 Go（`OnBeforeClose`） |
| **图片粘贴 / 拖拽插入** | 编辑器内粘贴或拖入图片 → 写入文档同级 `assets/`（`img-<时间戳>-<随机>.<ext>`），并插入 `![](assets/xxx)`（Go 侧 `SaveImage`） |
| **文件树外部变更监听** | 打开文件夹后监听其**一层**增删改（fsnotify，`watcher.go`），去抖后自动刷新文件树 |
| **代码块 Enter 跳出** | 光标位于紧邻结束围栏的空行时按 Enter，跳到围栏之后另起一行（`createEditor.js`） |
| 原生菜单栏 | macOS 顶部系统菜单栏；Windows/Linux 窗口内菜单条（`main.go` 的 `buildMenu`，事件发给前端） |
| 快捷键 | 文件 / 格式 / 视图三类，见下方「快捷键」 |
| 文本导出 | HTML：内联样式模板（46rem 行宽）；PDF：macOS 一键直出（WebKit/PDFKit，dark→light 主题映射，467px 版心），其它平台走系统打印（`src/export/`） |
| 本地文件管理 | 打开文件 / 打开文件夹，递归懒加载文件树（`app.go` + `src/components/FileTree.vue`） |
| 编辑/预览滚动联动 | 双栏模式下**标题锚点映射** + 互斥锁（`App.vue` / `useOutlineSync.js`） |
| 分栏宽度可拖 | 编辑/预览分割条可拖动调宽（20%~80%），双击复位，宽度持久化 |

## 快捷键

**文件**

| 操作 | 快捷键 |
|---|---|
| 打开文件 | ⌘O |
| 打开文件夹 | ⌘⇧O |
| 保存 | ⌘S |
| 另存为 | ⌘⇧S |
| 历史快照面板 | 菜单「文件 ▸ 历史快照…」（无快捷键，ADR-004 避免误触） |
| 导出 HTML | ⌘⇧H |
| 导出 PDF | ⌘P |

**格式（WYSIWYG 命令）**

| 操作 | 快捷键 |
|---|---|
| 加粗 | ⌘⇧B |
| 斜体 | ⌘I |
| 删除线 | ⌘⇧X |
| 行内代码 | ⌘` |
| 链接 | ⌘K |
| 标题 1–6 | ⌘⌥1 … ⌘⌥6 |
| 无序列表 | ⌘⇧8 |
| 有序列表 | ⌘⇧7 |
| 任务列表 | ⌘⇧9 |
| 引用块 | ⌘⇧. |
| 代码块 | ⌘⌥C |

> 菜单「格式」各项事件名与前端 `formatCommands` 接线清单严格一致，改名需前后端同步。

**视图**

| 操作 | 快捷键 |
|---|---|
| 编辑模式 | ⌘1 |
| 预览模式 | ⌘2 |
| 双栏模式 | ⌘3 |
| 阅读模式 | ⌘4 |
| 专注模式 | ⌘⇧F |
| 显示 / 隐藏大纲 | ⌘B |
| 切换主题 | ⌘⇧L |

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
├── docs/                # 架构决策记录（architecture/ADR-00x）、规格（spec/）、方案（plan/）
└── frontend/
    ├── src/
    │   ├── App.vue          # 主界面：视图四态、顶栏、侧栏、双栏布局、滚动联动、预览防抖
    │   ├── editor/          # CodeMirror 封装：createEditor.js / wysiwyg.js / outline.js / commands.js
    │   ├── preview/         # markdown-it 渲染配置（highlight.js core 按需注册）
    │   ├── export/          # HTML / PDF 导出模板与 exporters
    │   ├── composables/     # useDocumentPersistence（保存/快照/导出）/ useOutlineSync（大纲+滚动锚点）
    │   ├── components/      # FileTree / TreeNode / Outline / HistoryPanel / Toolbar / StatusBar + icons/
    │   └── themes/          # tokens/design-tokens.css（单文件三主题 Token）+ theme.js + base.css / preview.css
    └── wailsjs/             # Wails 自动生成的 IPC 绑定（勿手改）
```

> **图标与许可**：界面图标几何衍生自 [Lucide](https://github.com/lucide-icons/lucide)（版本 `lucide-static@1.48.0`），
> 采用 **ISC 许可**（其中 `chevron-down` / `chevron-right` / `download` / `moon` / `x` 源自 Feather 项目，为 MIT 许可）。
> 许可全文见 [`frontend/src/components/icons/LICENSE`](frontend/src/components/icons/LICENSE)。
> 所有图标统一经 `frontend/src/components/icons/AppIcon.vue` 渲染，几何数据与语义白名单在 `paths.js`。

## 常用命令

```bash
# 开发（热重载，推荐）
~/go/bin/wails dev

# 生产构建（产物在 build/bin/）
~/go/bin/wails build

# 重新生成前端 IPC 绑定（改了 app.go 等导出方法后【必须】执行）
~/go/bin/wails generate module
```

> 本机网络需镜像：Go 依赖走 `GOPROXY=https://goproxy.cn,direct`，npm 走 `--registry=https://registry.npmmirror.com`，且先 `unset` 环境里的代理变量。
> `wails` 命令依赖 PATH 中的 `go`；若报 `exec: "go": executable file not found`，先 `export PATH="/usr/local/bin:$PATH"`。

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

暂无。原历史待办五项（预览渲染防抖 / 代码块 Enter 跳出 / 未保存关闭拦截 / 图片粘贴拖拽 / 文件树外部变更监听）已于 2026-10-02 全部完成。

## 关于插件系统（现在不做）

第一版全部功能内置。真有扩展需求时，推荐形态：**渲染进程加载 npm 包形式的插件**（Vue 组件 + markdown-it 插件），Go 端只做插件目录扫描和白名单加载，比做进程隔离沙箱成本低一个数量级。
