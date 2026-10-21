# Inkmark — 跨平台 Markdown 编辑器（Wails + Vue）

技术栈：**Go (Wails v2.16) + Vue 3 + Vite 6 + CodeMirror 6 + markdown-it + highlight.js**

> 定位：所写即所见（WYSIWYG 默认）的轻量 Markdown 写作工具——**单栏居中流式**，
> 渲染直接内嵌编辑器（无独立阅读态）；**自绘标题栏**取代原生菜单，窗口形态按平台差异化
> （macOS 毛玻璃保留红绿灯 / Linux、Windows 无边框自绘）。
> 架构与决策背景见 [`docs/HANDOFF.md`](docs/HANDOFF.md)（接手前先读它）。

## 已实现能力

| 功能 | 实现 |
|---|---|
| Markdown 编辑 + 语法高亮 | CodeMirror 6（`src/editor/`），写作工具形态：无行号、无整行高亮；围栏代码块高亮与预览区共用同一套 `--hl-*` 色板 |
| **WYSIWYG 即时渲染（默认）** | `src/editor/wysiwyg.js`：光标所在行及上下相邻 1 行显示 Markdown 源码，其余行呈现渲染效果（列表圆点 / 任务勾选框 / 表格 / 分割线 / 图片以 widget 替换标记符）；仅产装饰、**零文档篡改**；中文输入（IME）时冻结重算；装饰只在可视区计算，大文档不卡 |
| 实时预览 | markdown-it + highlight.js（`src/preview/`），GFM 任务列表（markdown-it-task-lists），highlight.js 按需注册 **79 种语言**（含别名，非整库导入）；正文限宽居中 |
| **预览渲染防抖** | 输入期预览渲染防抖 ~120ms，大文档连续输入不卡；打开 / 恢复文件即时渲染，导出前强制 flush 保证内容最新（`useEditorSession`） |
| **所见即所得渲染** | 编辑器内渐进渲染（Bear 式行内装饰 + 表格真渲染：`src/editor/wysiwyg.js` + `src/editor/tableRender.js`，单元格可编辑并同步回 Markdown 源码）；`⌘⇧F` 专注模式收起界面干扰（`useWorkspace`） |
| **任务列表勾选** | 点勾选框直接翻转 `[ ]` ⇄ `[x]`（`src/editor/taskToggle.js`）；渲染仍在 wysiwyg.js，交互单独一层，不打破「装饰层不碰文档」的约束 |
| **代码块增强** | 代码块内显示行号（各块独立从 1 起）、悬停出现「复制」按钮（复制纯代码，不含围栏）；编辑器侧语法高亮覆盖 js/ts 家族、java、html/xml 家族、css 家族、json 家族、python（`src/editor/codeBlock.js` + `markdownHighlight.js`）。go / rust 等语言**只在预览区**高亮（编辑器侧无对应语言包，本仓不新增依赖） |
| **表格行列增删** | 悬停表格右上角出现操作条：下方插行 / 删当前行 / 右侧插列 / 删当前列（`src/editor/tableOps.js` + `tableWidget.js`）；最少保留 1 行 1 列，操作在 model 上改到自洽再整体序列化，杜绝列数不一致的非法 Markdown |
| **主题 4 档（含跟随系统）** | 浅 Indigo / 深 Indigo / 纸感赭石三套配色（`src/themes/tokens/design-tokens.css`）+ 跟随系统，共 4 档；`system` 偏好由 `theme.js` 解析为具体主题并写入（纸感不会被系统自动选中）；切换只改 `<html data-theme>`，**不重建编辑器** |
| **大纲视图** | `⌘B` 开关（`src/components/Outline.vue` + `editor/outline.js` + `useOutline.js`），从文档提取标题层级、高亮当前节、点击跳转 |
| **历史快照** | `src/components/HistoryPanel.vue`：与自动保存**解耦**——编辑会话每 ≥3 分钟节流一次 + 显式保存 + 切换文件前 + 手动触发；轮转 / 去重由 Go 侧 `SnapshotWrite` 负责 |
| 自动保存 | 改动后 800ms 防抖覆盖原文件，状态栏显示保存态（间隔可配，见「设置面板」） |
| **未保存关闭拦截** | 脏状态下关闭窗口弹系统确认（取消 → 阻止关闭；不保存退出 → 放行）；`dirty` 由前端同步到 Go（`OnBeforeClose`）；自绘关闭按钮走 `App.CloseWindow(dirty)`——dirty 随关闭请求同一条 IPC 携带（先问再退，**不用**会绕过确认的 `Quit`） |
| **图片粘贴 / 拖拽插入** | 编辑器内粘贴或拖入图片 → 写入文档同级 `assets/`（`img-<时间戳>-<随机>.<ext>`），并插入 `![](assets/xxx)`；三条输入通道归一（`useFileAssets`）：① `clipboardData` 图片数据 → `SaveImage`；② `file://` URI → `SaveImageFromPath`；③ **系统剪贴板兜底**（WKWebView 不把剪贴板图片暴露给 `clipboardData`，由 Go 侧 `SaveImageFromClipboard` 读原生剪贴板、按魔数嗅探格式）；文档未落盘时提示先保存；图片**显示**走 `/doc-assets/` 资源服务（Go `docassets.go` 按当前文档目录读盘，前端 `editor/assetUrl.js` 唯一改写口；预览改写、导出保真） |
| **自绘标题栏（跨平台）** | `src/components/TitleBar.vue`：拖拽区 + 下拉菜单（结构由命令表派生，点击外部自动关闭）+ 居中文件名 / 脏圆点 + 窗口按钮；darwin 隐藏自绘按钮、菜单左移约 70px 给红绿灯留白；其余平台无边框 + 自绘三按钮 |
| **斜杠命令面板** | `src/components/SlashCommand.vue` + `editor/slashCommand.js`：新行行首输入 `/` 在光标下方面板弹出，`↑↓` 切换、`Enter` 插入（自动删除 `/`）、`Esc` 关闭；支持代码块 / 表格 / 待办 / 引用 |
| **表格真渲染 + 行列操作** | `editor/tableRender.js` 把 GFM 表格渲染成可编辑 `<table>`（单元格直接打字，`Tab`/`Enter` 换格并在末格自动补行）；悬停操作条含 `+/-` 增删行列与**左/中/右对齐**三档（对齐写回 GFM 分隔行）；表头/行首手柄可**拖拽整列/整行重排**（落点高亮，`Esc` 取消，松手才落一条撤销记录）——`editor/tableWidget.js` + `tableOps.js` + `tableDrag.js` |
| **智能符号补全** | 键入 `*` `_` `` ` `` `[` `(` `"` `'` 自动补右半并把光标放中间；再键入闭合符**越过**而非重复；选中文字后键入自动**包裹选区**；空配对中间退格**一次删两侧**；行首三连反引号展开成围栏代码块。三条 Markdown 守卫：行首裸 `*`（列表标记）、词内 `_`/`'`（`snake_case` / `don't`）、代码上下文一律不干预（`editor/smartInput.js`） |
| **智能标点（可选）** | 设置 → 编辑器：`关` / `弯引号 “”` / `直角引号 「」` 三档。开启后中文语境的半角标点转全角、直引号按**行内就近配平**转形态；英文语境（`Hello, world` / `It's`）与代码块内**一律不动**（`editor/smartPunct.js`） |
| **选区粘贴 URL 转链接** | 选中一段文字后 `⌘V` 粘贴 URL，自动变成 `[选中文字](url)`；无选区时仍是纯文本；选区已是链接或跨行时不叠加（`editor/pasteCommand.js`） |
| **标题定级与升降** | `⌘1`~`⌘6` 直接定级（同级再按还原正文）、`⌘⌥0` 正文、`⌘⌥↑`/`⌘⌥↓` 逐级升降（正文 → h6 → … → h1，两端停住不循环）；选区跨行时按首行级数**整块统一**（`editor/headingLevel.js`） |
| **列表智能缩进** | 有序/无序/任务列表里 `Tab` 缩进（+2 空格）、`Shift+Tab` 反缩进（**吸附父级缩进**）；缩进后**有序列表序号自动重排**，父级断号一并接上；非列表行与代码块里仍走通用缩进（`editor/listIndent.js`） |
| **表格未渲染提示** | 写成管道行却缺 GFM 分隔行时，状态栏**常驻**提示「第 N 行像表格但未渲染：缺分隔行，请在表头下加一行 `\| --- \|`」，改对即消失（`editor/tableHint.js` + `composables/useTableHint.js`） |
| **代码块 Enter 跳出** | 光标位于紧邻结束围栏的空行时按 Enter，跳到围栏之后另起一行（`createEditor.js`） |
| **设置面板** | `⌘,` 打开（`src/components/SettingsPanel.vue`）：外观 6 项（主题 / 正文字体 / 字号 / 行距 / 行宽 / 语言）+ 编辑器 4 项（自动保存间隔 / 快照间隔 / 智能符号 / 智能标点），全部**实时生效**（改完立刻落 CSS 变量，无需重启）、**刷新保持**（`localStorage` 持久化），另有「恢复默认」（二次确认，防误触） |
| **三语国际化** | `src/i18n/`：简体中文 / English / 日本語 三档字典 + `t()`；标题栏菜单、设置面板、弹层、提示全量覆盖，语言偏好实时切换 |
| **排版偏好** | 正文字体（系统 / 衬线 / 等宽）、字号（12–20px 六档，编辑区与预览区**成对同步**）、行距（紧凑 / 标准 / 宽松）、行宽（窄 / 标准 / 宽）——真源 `src/themes/prefs.js`，偏好走**文档作用域**变量 `--font-body-user`，不污染标题栏 / 侧栏等界面外壳 |
| **打印** | `⌘P`：Wails 的 WKWebView **没有实现 `window.print()`**（调用即静默空操作，这正是「⌘P 没反应」的根因），故桌面端把「打印」实现为**生成 PDF**（`exportPdf`，保存对话框 + 路径提示），随后可在系统 PDF 阅读器里打印；非 darwin 桌面 / 浏览器预览下自动回退到 `window.print()`。`@media print` 已隐藏标题栏 / 侧栏 / 状态栏 / 各类遮罩，只输出正文 |
| **预览渲染器（导出共用）** | markdown-it 渲染器（`src/preview/markdown.js`）只服务导出 HTML/PDF 与「复制为 HTML」；阅读态已于 2026-10-14 整体移除（渲染收敛进编辑器） |
| **查找 / 替换** | `⌘F` 查找、`⌘⌥F` 查找并替换（CodeMirror `searchKeymap` + 面板） |
| **跳转到行** | `⌘L` 打开输入框跳转到指定行号 |
| **行操作** | `⌥↑` / `⌥↓` 移动当前行，`⇧⌥↓` 向下复制当前行，`⌘⇧K` 删除当前行（VS Code 惯例） |
| **视图缩放** | `⌘=` 放大 / `⌘-` 缩小 / `⌘0` 重置，80%~150% 六档；状态栏可点击循环。与基础字号**正交叠加**（`--zoom-scale` 独立变量） |
| **工作区开关** | 打字机模式 / 窗口置顶两个勾选项，状态前端 `localStorage` 持久化（`useWorkspace`） |
| **重命名 / 插入目录 / 清除格式** | 重命名走应用内输入对话框（WKWebView 无 `window.prompt`）；「格式 ▸ 插入 ▸ 目录」按标题层级生成 TOC（`editor/commands.js` 的 `insertToc`） |
| 快捷键速查 | `⌘/` 打开应用内弹层；非 macOS 自动把 `⌘/⌥/⇧` 显示为 `Ctrl+/Alt+/Shift+` |
| 快捷键 | 文件 / 编辑 / 格式 / 视图 / 窗口 / 帮助六类，唯一真源是 `useShortcuts.js` 的 `COMMANDS` 表，见下方「快捷键」 |
| 文本导出 | HTML：内联样式模板（46rem 行宽）；PDF：macOS 一键直出（WebKit/PDFKit，dark→light 主题映射，467px 版心），其它平台走系统打印（`src/export/`） |
| 本地文件管理 | 打开文件 / 打开文件夹，递归懒加载文件树（`app.go` + `src/components/FileTree.vue`） |

## 快捷键

> **本节由 `frontend/src/composables/useShortcuts.js` 的 `COMMANDS` 命令表生成**，非人工记忆。
> 该表是键位的**唯一真源**：自绘标题栏的菜单、全局键位分发、应用内速查表三方都读它。
> 改键位只需改命令表，然后跑 `node scripts/verify/verify-shortcuts.mjs` 校验本文节是否同步。
> 标「无快捷键」的项只能走菜单点击（原因见括号）。
> 非 macOS 平台上 `⌘` / `⌥` / `⇧` 分别读作 Ctrl / Alt / Shift。

> 界面为**自绘标题栏**：macOS 隐藏原生长条、保留系统红绿灯（菜单左移约 70px 留白，右侧无自绘窗口按钮）；
> Linux/Windows 为无边框窗口，窗口按钮自绘。
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
| 设置… | ⌘, |
| 打印（导出 PDF）… | ⌘P |
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
| 标题一 | ⌘1 |
| 标题二 | ⌘2 |
| 标题三 | ⌘3 |
| 标题四 | ⌘4 |
| 标题五 | ⌘5 |
| 标题六 | ⌘6 |
| 正文（去标题） | ⌘⌥0 |
| 标题升级 / 降级 | ⌘⌥↑ / ⌘⌥↓ |
| 无序列表 | ⌘⇧8 |
| 有序列表 | ⌘⇧7 |
| 任务列表 | ⌘⇧9 |
| 引用块 | ⌘⇧. |
| 代码块 | ⌘⌥C |
| 图片… | 无快捷键（命令表未分配键位） |
| 表格 | 无快捷键（斜杠命令面板可插入，命令表未分配键位） |
| 分割线 | 无快捷键（仅菜单） |
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
├── main.go              # 入口：按平台差异化窗口形态（darwin 毛玻璃+保留红绿灯 / 其余无边框）、
│                        #   OnBeforeClose 钩子、绑定 App 服务；原生菜单已整体下线
├── app.go               # 核心服务：对话框、文件读写、目录遍历、图片保存三通道入口、dirty 镜像、CloseWindow、版本
├── clipboard_*.go       # 图片粘贴通道③：读系统剪贴板（darwin=cgo+AppKit / linux=xclip、wl-paste / windows=CF_DIB* /
│                        #   其余平台恒空兜底）；clipboard_image.go 为全平台共用的魔数嗅探判据
├── snapshot.go          # 历史快照存储（写入 / 轮转 / 读取，docKey 派生）
├── watcher.go           # 文件树外部变更监听（fsnotify，一层 + 去抖；前端已订阅 fs:changed，待真机确认，见「已知问题」）
├── version.go           # 版本单一真源（构建时 -ldflags -X main.version= 注入）
├── export_pdf_darwin.go # PDF 一键直出（WKWebView/PDFKit）
├── export_pdf_other.go  # 非 darwin 平台的降级实现
├── wails.json           # Wails 配置（前后端构建命令）
├── scripts/             # 工程门禁脚本
│   ├── p0-check-emoji.sh        # P0-1 emoji 扫描（零容忍，CI 门禁之一）
│   ├── smoke/render-check.mjs   # 真渲染冒烟（dev + dist 双路径）
│   ├── probe/                   # CDP 交互探针（斜杠面板 / WYSIWYG 装饰 / 主题计算色 / 表格提示）
│   └── verify/                  # 快捷键契约 / README 数字声明 / i18n 残留 / 目视清单同步 / 图标与主题校验脚本
├── docs/                # 交接说明 HANDOFF.md、架构决策（architecture/ADR-00x）、规格（spec/）、
│                        #   悬而未决登记册（decisions/OPEN-DECISIONS.md）、
│                        #   真机目视验收工具（qa/：visual-checklist.html + VERIFICATION-LOG.md）
└── frontend/
    ├── src/
    │   ├── App.vue          # 装配层（≤150 行硬上限）：实例槽 + 依赖序装配 + 模板，逻辑全在 composables/
    │   ├── i18n/            # 三语字典（zh-CN / en-US / ja-JP）+ t()
    │   ├── editor/          # CodeMirror 封装：createEditor / wysiwyg / slashCommand / outline /
    │   │                    #   commands / anchors / imageDrop / markdownHighlight / sampleDocs /
    │   │                    #   tableHint（表格未渲染的检测，纯函数）
    │   ├── preview/         # markdown-it 渲染配置（highlight.js 按需注册 79 种语言、GFM 任务列表）
    │   ├── export/          # HTML / PDF 导出模板与 exporters
    │   ├── composables/     # useEditorSession（编辑器实例 + 派生状态）/ useDocumentState（dirty /
    │   │                    #   自动保存 / 快照 / 导出 / 历史）/ useCommands（55 条命令处理器 + 菜单结构）
    │   │                    #   / useWorkspace / useFileAssets / usePrefs / useShortcuts（键位唯一真源）
    │   │                    #   / useShortcutsHelp / useOutline / usePlatform / useToast / useDialog /
    │   │                    #   useFileOps / useTableHint（表格提示，模块级单例）
    │   ├── components/      # TitleBar（自绘标题栏）/ Sidebar / SlashCommand / StatusBar / HistoryPanel /
    │   │                    #   SettingsPanel / InputDialog / ShortcutsDialog / AboutDialog / FileTree /
    │   │                    #   Outline / SegmentedControl / icons/
    │   └── themes/          # tokens/design-tokens.css（Token 唯一真源）+ index.css（唯一样式入口）
    │                        #   + app-shell.css / platform-darwin.css / editor-wysiwyg.css
    │                        #   + theme.js（主题解析）/ prefs.js（偏好唯一真源）
    ├── tests/           # node:test 测试网（377 条测试 / 85 个 suite，零第三方依赖），需 Node ≥22
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
npm test         # 测试网（377 条测试，零第三方依赖），【需 Node ≥22】
```

> - `npm test` 用的是 Node **内置** `node:test`（无第三方测试依赖），因此**必须 Node ≥22**；低版本会报 `node --test` 不可用。
> - `npm run build` 会**删掉被 git 跟踪的 `frontend/dist/.gitkeep`**（构建清空 `dist/` 的副作用）。
>   该文件是 `main.go` 的 `//go:embed all:frontend/dist` 内嵌目标，**删掉会导致 Go 编译报 "no matching files found"**。
>   本地每次 build 后请执行 `git checkout -- frontend/dist/.gitkeep` 还原。

### 门禁脚本（与 CI 同口径）

```bash
cd frontend && npm test                                    # 测试网，期望 377/377
node scripts/verify/verify-readme-claims.mjs               # README 数字声明 ↔ 实测（自己会再跑一遍测试网；退出码 1=漂移 / 2=测量失效）
node scripts/verify/verify-shortcuts.mjs                   # 快捷键三方对齐（README ↔ 速查表 ↔ COMMANDS）
node scripts/verify/scan-i18n-residue.mjs                  # i18n 文案残留
./scripts/p0-check-emoji.sh frontend/src main.go app.go    # P0 零 emoji
/usr/local/opt/go/bin/go vet ./...                          # Go 静态检查（注意：go 不在 PATH）
CGO_ENABLED=1 /usr/local/opt/go/bin/go test ./...           # Go 测试（含快照与剪贴板判据；e2e 剪贴板为空时 skip）
CGO_ENABLED=0 GOOS=linux   /usr/local/opt/go/bin/go build -o /dev/null .   # Linux 适配层不腐烂
CGO_ENABLED=0 GOOS=windows /usr/local/opt/go/bin/go build -o /dev/null .   # Windows 适配层不腐烂
node scripts/smoke/render-check.mjs                        # 真渲染冒烟（CI frontend job 第三步；需先 npm run build）
node scripts/verify/verify-visual-checklist.mjs             # 目视清单副本 ↔ HANDOFF §6 同步（退出码 1=漂移 / 2=解析失效）
node scripts/verify/scripts-verify-icons.mjs                # 图标 ↔ phaseC 规格逐字比对（手动，不在 CI；期望 24/24）
node scripts/verify/scripts-verify-theme.mjs                # theme.js 优先级自检（手动，不在 CI；期望 8/8）
```

### 交互探针（验「静默失败」类缺陷，render-check 覆盖不到）

```bash
cd frontend && npx vite --port 5599 --strictPort   # 先起 dev server（DEV 钩子只在 dev 下存在）
cd .. && node scripts/probe/probe-slash.mjs         # 斜杠面板：输入 / 后按 Enter 是否真插入
node scripts/probe/probe-wysiwyg.mjs               # 表格/分割线/图片装饰是否产出 DOM
node scripts/probe/probe-theme.mjs                 # 暗色下各区域实际计算色
node scripts/probe/probe-table-hint.mjs            # 缺分隔行时表格提示是否真的出现 / 改对后消失
node scripts/probe/probe-r11-fixes.mjs             # 第十一轮修复：全角 ／ / Finder file URL 粘贴 / ⌘P（阅读态 5 项已随阅读态移除退役）
```

> 改了 `prefs.js`、命令表或 `App.vue` 结构后，**先跑 `npm test` 再提交**——
> 测试网里有静态契约检查（菜单事件双向闭合、⌘P 唯一性、打印样式存在性、行数门禁、装配顺序）
> 会拦住静默失效。**改门禁本身必须做元测试**（造违规输入 → 确认报红 → 确认退出码非 0）。

> 本机网络需镜像：Go 依赖走 `GOPROXY=https://goproxy.cn,direct`，npm 走 `--registry=https://registry.npmmirror.com`，且先 `unset` 环境里的代理变量。


## 设计要点（为什么这么做）

1. **文件安全写入**：`WriteFile` 先写 `.tmp` 再 `rename`，避免写一半崩溃留下半个文件。
2. **文件树懒加载**：`ListDir` 只返回一层，点击目录才展开——千级文件的仓库也不会卡启动。
3. **主题 = CSS 变量**：编辑器（CodeMirror theme）、预览排版、代码高亮 token 全部引用同一组变量，切换零成本；预览高亮没用 hljs 官方主题 CSS，而是把 token 色值做成变量（`--hl-keyword` 等），保证明暗一致。`data-theme` 始终存「已解析」的具体主题（不存 `system`），切换只改属性、不重建编辑器。
4. **单栏居中流式**：双栏 / 分屏 / 滚动联动已随产品减法整体下线，正文限宽（`--single-measure: 46rem`）居中；阅读态已于 2026-10-14 移除，所见即所得渲染直接内嵌编辑器（表格真渲染见 `src/editor/tableRender.js`）；`useOutline` 只保留大纲高亮与跳转。
5. **窗口拖拽用 `--wails-draggable`**：Wails 不读 `-webkit-app-region`（那是 Chromium 的，macOS WKWebView 不认）。标题栏根节点设 `--wails-draggable: drag`，交互子元素（菜单按钮 / 下拉项 / 窗口按钮）逐个设 `no-drag`——该自定义属性**会向下继承**，只能落在叶子可点元素上，落在布局容器上会把空白区也变成非拖动区。
6. **原生菜单已下线，键位真源在前端**：原生菜单因「Role 不可本地化 / 非 darwin 不展开 / 无边框下无处安放」三条实测约束整体删除，键位收敛到 `useShortcuts.js` 的 `COMMANDS` 表（55 条命令 / 43 项键位），菜单结构、全局分发、速查表三方同源派生；门禁 `verify-shortcuts.mjs` 守着 README 与命令表不漂移。
7. **渲染进程零 Node 能力**：前端只能通过生成的 `wailsjs` 绑定调 Go 方法，文件系统攻击面收在 `app.go`。
8. **WYSIWYG 即时渲染的边界**：只产装饰、绝不 `dispatch` 文档变更（内容零篡改）；`view.composing` 为 true（中文输入中）时冻结重算，避免抖动；装饰只在 `visibleRanges` 内计算（大文档性能）；活跃行向上下各扩 1 行，避免方向键因标记符显隐突变而跳跃。
9. **快照与自动保存解耦**：自动保存 800ms 防抖覆盖原文件；快照独立按「节流 / 显式保存 / 切换文件边界 / 手动」触发，避免每次按键都落快照、污染历史。
10. **交互必须与装饰分层**：wysiwyg.js 的第 5 条架构约束是「只产装饰、永不 dispatch」，所以「点勾选框改文档」不能写在那里 —— 它落在 `taskToggle.js`（用 `EditorView.domEventHandlers` 捕获 mousedown，因为 click 之前 widget 可能已被替换掉）。同理表格的行列操作拆成「model 变换（`tableOps.js`）/ DOM widget（`tableWidget.js`）/ 装饰（`tableRender.js`）/ 自同步标记（`tableSync.js`）」四个文件，既守住 300 有效行的门禁红线，也让循环依赖只在一个无依赖的小模块里断开。
11. **关闭拦截的状态同步（`dirty` 语义已固化为不变量）**：`dirty` 只有一个含义——「编辑器内存内容 ≠ 磁盘内容」（含从未落盘的新文档）。真源在前端、关闭钩子在 Go，前端 `watch(dirty)` 调 `SetDirty` 镜像；Go 侧不读盘比对。硬约束：任何改动文档内容的路径都必须**显式声明**对 `dirty` 的影响（标脏或落盘归零），不得默认继承。对话框异常时保守「阻止关闭」，宁可多问一次也不丢内容。完整定义、生命周期表与多文档扩展路径见 [`docs/architecture/ADR-005-dirty-semantics.md`](docs/architecture/ADR-005-dirty-semantics.md)。
12. **代码块增强的三个实现要点**：① **行号不进文档** —— 走 CodeMirror 的行装饰把编号写进 `data-line` 属性，由 CSS `attr()` 渲染成伪元素；写进 DOM 文本会被复制/编辑带出去，写进文档则污染内容。② **每个代码块独立从 1 计数** —— CSS counter 做不到「按块重置」（CM 的行装饰不提供块级容器），跨块累加会让行号失去定位意义，故编号在 JS 侧算好后经属性下发。③ **复制按钮按光标就近显隐** —— 光标在某块内只给那块显示，光标不在任何块内则全部可见；纯 hover 显现在触屏与无鼠标环境不可达。
13. **原生对话框文案本地化**：打开 / 选目录 / 另存为 / 「未保存」确认框的文案只能由 Go 侧传给系统 API，故由前端随调用传入 locale（`dialogs.go` 按主语言子标签取表，未知语言回落中文）。`OnBeforeClose`（macOS 红绿灯）由 Wails 直接触发、拿不到请求参数，读 `SetLocale` 写入的镜像——**镜像不是真源**，前端每次切换整值覆盖（`main.js` 同步，`app.go` 有裁决注释）。
14. **关闭窗口走 `App.CloseWindow()`**：Wails v2.16 没有 `WindowClose`，`Quit` 是强制退出、会绕过 `OnBeforeClose` 的未保存确认，故自绘关闭按钮统一走「先问再退」的 `CloseWindow`。
15. **图片落盘位置**：写入「文档同级 `assets/`」而非全局目录，让 `.md` 能连附件整体搬移；文件名带时间戳 + 随机，避免同毫秒 / 同名覆盖。
16. **代码块高亮按需注册**：预览侧 `highlight.js` 用 `lib/core` + 注册 79 种常用语言（非整库导入），前端 JS 包从 1756kB 降到 891kB（gzip 603kB → 324kB）。新增语言只需加一行 import + 一行注册。
17. **窗口形态按平台差异化**：darwin 用 `Frameless:false` + `mac.TitleBarHidden()`（隐藏长条、保留红绿灯、内容全尺寸）+ 透明 + 半透明（系统 Vibrant 毛玻璃）；Linux/Windows 用 `Frameless:true` 无边框纯净模式，标题栏与窗口按钮全自绘。一套参数走天下会同时踩「macOS 丢红绿灯」与「无边框平台不能拖」两个坑。
18. **静默失败必须主动提示**：用户写 `| a | b |` 却没看到表格时，标准 Markdown 的行为是「当普通段落渲染、不报错」。这在本仓属于典型的静默失败（构建绿、测试绿、运行时无异常），所以额外做了状态栏常驻提示：判定复用**编辑器同一棵语法树**（顶层 `Paragraph` + 连续 ≥2 行管道行 → 判定为疑似未渲染），**常驻而非 toast**（toast 3.2 秒就消失，而这是「用户没察觉」的问题），且**只读不写文档**。注意 GFM 要求分隔行在**第 2 行**且只含 `-`/`:`，这正是用户最常踩空的规则。

19. **跨层事件名是契约，必须两侧锁名 + 变异自证**：Go 侧 `EventsEmit(a.ctx, "fs:changed", root)` 与前端 `EventsOn('fs:changed', …)` 靠字符串对接，单侧改名不会报错、只会静默失效（本仓最恨的失效模式）。所以测试里有一条**跨文件集合比对契约**（两侧事件名集合必须逐字相等），且变异自证过：前端名改错 → 行为 + 契约测试双红；Go 侧名改错 → 契约测试红。同理，浏览器预览（vite dev 无 Wails runtime）下的订阅必须可选链兜底——具名 import `wailsjs/runtime` 会展开为 `window.runtime.EventsOnMultiple(...)` 直取而必抛，兜底只允许出现在**已知的环境分支**上。**降级路径的用例必须让「降级条件」成为被测代码的显式入参**（`mountOps({ installRuntime: 'no-runtime' })`），不能在用例里靠一次全局赋值当前置条件——helper 里的无条件初始化会静默覆盖它，用例就此变成恒绿的摆设（第九轮 QA 实测抓到过，见 HANDOFF §4 ⑰）。

## 已知问题与待办

> 本节如实登记**未完成**与**未验证**项。原「暂无」说法已移除——README 声称无待办是失真的。

| # | 项 | 状态 / 说明 |
|---|-----|------------|
| 1 | **Windows / Linux 无边框形态未真机验证** | 窗口形态已按平台分流，但无边框拖拽、自绘窗口按钮、关闭守卫**从未在真实 Windows / Linux 上跑过**；导出 PDF 在这些平台降级为系统打印 |
| 2 | **真机目视清单未过** | 自动化只验到「根节点渲染 + 标题栏/编辑区已挂载 + 无异常」。标题栏拖拽、红绿灯留白、毛玻璃、斜杠面板、GFM 任务列表、代码块高亮、「插入目录」跳转等交互**全部需目视**，完整 22 项见 [`docs/HANDOFF.md`](docs/HANDOFF.md) §6。**现在有可执行副本了**：打开 [`docs/qa/visual-checklist.html`](docs/qa/visual-checklist.html)（单文件、双击即开、零依赖）逐项勾选并导出 Markdown，追加进 [`docs/qa/VERIFICATION-LOG.md`](docs/qa/VERIFICATION-LOG.md) 留痕——清单副本与 §6 真源的编号/标题由门禁 4 第二步机检守着 |
| 3 | **macOS 透明窗口的代价** | `WebviewIsTransparent` + `WindowIsTranslucent` 在旧款 Intel Mac 上可能掉帧（透明窗口不能被合成器缓存）；本机是 macOS 12，只验到「能编译」，性能未实测 |
| 4 | **Linux（CachyOS）真机** | 无边框 + 自绘标题栏的 Linux 表现从未在真机跑过；窗口按钮对接的 `WindowMinimise / WindowToggleMaximise / CloseWindow` 在 Linux 后端的行为需目视 |
| 5 | **「最近打开」功能整体下线** | 它的唯一消费方是原生菜单的子菜单；自绘标题栏未做该入口。若要恢复需**重做**：前端加列表 + Go 侧重写持久化（原 `GetRecents` / `recents.json` 逻辑已随原生菜单整体删除，`app.go` 只剩历史注释提及） |
| 6 | **文件树外部变更监听已接线，待真机确认** | 2026-10-13 落地：前端 `useFileOps` 订阅 `fs:changed`（payload 为根目录路径，仅当与当前 `folderPath` 严格相等才自增 `treeSignal`，`FileTree` 收信号后重拉目录）；Go 侧 `watcher.go` 另修一个真实缺陷——切换/停止文件夹时，旧监听残留的去抖定时器会把已失效目录的 `fs:changed` 推给前端（代际校验修复）。沙箱内无法验证真实 fsnotify 事件，需 `wails dev` 真机确认三场景：① 监听目录内新建/删除文件后树即时刷新；② 切到另一文件夹后旧目录的迟到事件不再触发；③ 关闭文件夹（空串）后无事件推送。另有两项已知未修：~~去抖边界双发（同 root 多刷一次，无正确性影响）~~ **（2026-10-17 撤销：实测不成立——该条目从未被真机验证过，同批连续到达的变更只推 1 次，跨窗口的两次独立变更推 2 次是正确行为）**；`w.Errors` 现已记日志（2026-10-15 落地，仍不打扰用户——fsnotify 内部错误时监听可能失效，日志是唯一排查线索）。**2026-10-17 另**：Go 侧去抖改为串行状态机（行为不再取决于调度顺序），语义由 `watcher_test.go` 的 5 条 Go 测试钉死 |
| 7 | **表格真渲染待真机验收** | 2026-10-14 落地：编辑器内 StateField block 装饰渲染真表格（`src/editor/tableRender.js`），单元格可直接编辑并同步回 Markdown 源码；单元测试（`tests/table-render.test.mjs`）已过，光标进出切换渲染/源码、Tab 换格、IME 输入等真机路径仍需目视。原「阅读态跳转未目视」项随阅读态移除而消失 |
| 8 | **`release.yml` 从未跑过** | 需 push 一个 `v*` tag 才会触发三平台打包；三平台构建的坑（Linux 的 webkit2_41 tag、macOS 签名）都还没被它验过 |
| 9 | **检查更新** | 仓库**无任何 Release**，所以现在只会返回「无法检查更新」（不谎报「已是最新」） |
| 10 | **macOS 未签名分发** | Gatekeeper 会拦，需 Apple 开发者账号（$99/年）签名 + 公证 |
| 11 | **无「退出应用」快捷键** | Wails v2.16 没有 `WindowClose`，⌘Q 未设；关闭走 macOS 红绿灯 / Linux 自绘 ×（`App.CloseWindow()`） |
| 12 | **导出产物不跟随正文字体偏好（已裁决）** | 2026-10-13 裁决**不跟随**：导出物是分发格式，把作者本地偏好写死进 HTML/PDF 会让排版随机器漂移；保持主题级 `--font-body` 保证任何机器导出一致。用户偏好是本地阅读体验，不是文档内容。重开条件见 [`docs/decisions/OPEN-DECISIONS.md`](docs/decisions/OPEN-DECISIONS.md) |
| 13 | **零多标签页 / 多文档** | 当前一次只开一个文档。ADR-005 已预留 `dirty` 语义的升级路径，多文档需重新定义「关闭哪个文档」的判定 |
| 14 | **无拼写检查（刻意不做）** | CodeMirror 的 lint 对 CJK 基本无效，中文写作场景是**伪需求**，故不引入。英文拼写需自行接第三方 lint 扩展 |
| 15 | **导出模板文案未国际化** | `export/exporters.js` 的 HTML 模板未接 `t()`（Spec 明确留待后续） |
| 16 | **`App.vue` 行数余量极小** | 装配层硬上限 **总行数** 150 行、当前 148 行（契约 5 实测）。新增行为一律先下沉到 composables/，门禁口径是**总行数**（含注释与空行，比有效行更严） |
| 17 | **Go 侧错误串仍是中文（已裁决的残余）** | 2026-10 复查：原生**对话框**文案已全部本地化（`dialogs.go`，按前端传入的 locale 取表；`OnBeforeClose` 读 `SetLocale` 镜像）。但各方法的**错误信息**（如「同名文件已存在: x」）仍是中文，经 IPC 回到前端后被嵌进本地化模板显示为「保存失败：<中文原因>」。裁决见 `dialogs.go` 文件头：模态对话框必须本地化，错误细节保留技术原文；彻底解决的正确方向是 Go 返回**错误码**由前端查表，属独立协议改造 |
| 18 | **Windows 路径处理未真机验证** | 2026-10 复查修掉了三处只认 `/` 的路径切分（标题栏文件名、侧栏文件夹名、字数统计无关），改为同时认 `\`；逻辑已由 `frontend/src` 内的实现覆盖，但 Windows 真机路径仍未跑过（与 #1 同源） |

## 关于插件系统（现在不做）

第一版全部功能内置。真有扩展需求时，推荐形态：**渲染进程加载 npm 包形式的插件**（Vue 组件 + markdown-it 插件），Go 端只做插件目录扫描和白名单加载，比做进程隔离沙箱成本低一个数量级。
