# Inkmark Phase C 技术架构

> 版本：v1（2026-10-01）
> 基线：`085c3d8`（工作区仅 3 个未跟踪文档，见 `DECISIONS-phaseC-v1.md`）
> 上游：`docs/spec/DECISIONS-phaseC-v1.md`（D-1~D-4 已拍板）
> 关联：`docs/architecture/ADR-003-pdf-export.md`、`ADR-004-keybinding-map.md`、`ADR-001-icon-strategy.md`、`ADR-002-token-layering.md`
> 本文只做架构与接口契约；具体交互细节见设计侧 `docs/design/`，验收句式见 Spec 侧。

---

## 1. 版本锚定（先核版本，再按该版本 API 写）

### 1.1 运行时与依赖（实测自 `node_modules` 与 `go.mod`，非文档声明）

| 组件 | `package.json`/`go.mod` 声明 | **实际安装/解析版本** | 证据 |
|---|---|---|---|
| Wails | `v2.16.0` | `v2.16.0` | `go.mod:5`；`~/go/pkg/mod/github.com/wailsapp/wails/v2@v2.16.0` |
| Go | `1.25.0` | 本机工具链 `go1.27.1 darwin/amd64` | `go.mod:3`；`go version` |
| Vue | `^3.5.13` | 见 `node_modules/vue` | `frontend/package.json:24` |
| @codemirror/view | `^6.38.0` | **6.43.13** | `node_modules/@codemirror/view/package.json` |
| @codemirror/state | `^6.5.2` | 6.7.6 | 同上 |
| @codemirror/language | `^6.11.0` | 6.12.4 | 同上 |
| @codemirror/lang-markdown | `^6.3.2` | 6.5.2 | 同上 |
| @lezer/markdown | （传递依赖） | 1.7.2 | 同上 |
| markdown-it | `^14.1.0` | 见 `node_modules` | `frontend/package.json:23` |
| highlight.js | `^11.11.1` | 见 `node_modules` | `frontend/package.json:22` |

> **版本漂移警示（已处理）**：`DECISIONS-phaseC-v1.md:14` 与团队基线均写「CodeMirror 6.38」，但 `package.json` 用的是 `^6.38.0` **caret 范围**，实际锁到 **6.43.13**。本文所有 CM API 断言均以 **6.43.13 的 `dist/*.d.ts` / `dist/index.js` 实测**为准（team-lead 已独立复核 `node_modules`，数值一致）。
> **收敛状态（2026-10-01）**：`DECISIONS-phaseC-v1.md` 中「6.38」的表述由 **team-lead 修正**；本架构文档系列已按 **6.43.13 主版本 + 各包分别标注**定稿（见上表）。**纪律**：本项目禁止按「6.38」的模糊印象写 API（呼应 `generated-code-failure-modes.md §3`）。

### 1.2 平台基线

| 项 | 值 | 证据 |
|---|---|---|
| 开发机 macOS | 12.7.6 | `sw_vers` |
| 本机 Xcode SDK | 13.1 | `xcrun --show-sdk-version` |
| clang | Apple clang 14.0.0 | `clang --version` |
| WKWebView PDF API 可用性 | `macos(11.0)` 起 | `WKWebView.h:442` |

---

## 2. 技术架构总览

Inkmark 是**单进程本地桌面应用**：Go 负责「接触操作系统」的边界，前端负责全部业务与渲染，二者经 Wails 绑定（IPC）通信。Phase C **不引入后端、HTTP API、数据库、认证**，仅在既有分层上扩展。

```
+---------------------------------------------------------------------------------+
|  表现层 (frontend/src)                                                          |
|  App.vue(编排) · components/(StatusBar·HistoryPanel·Outline·FileTree·AppIcon)    |
|  editor/(createEditor · wysiwyg · formatCommands · markdownStructure · outline) |
|  preview/(markdown)  export/(exporters)  composables/(useTheme)                 |
|  themes/(index → tokens/design-tokens → base → preview → wysiwyg)               |
+--------------------------------------|------------------------------------------+
                                       |  Wails 绑定（自动生成 JS ↔ Go IPC）
+--------------------------------------|------------------------------------------+
|  系统边界层 (Go, package main)                                                 |
|  app.go        对话框 / 读写文件 / 目录遍历                                     |
|  snapshots.go  历史快照存储（应用支持目录 + 10 版轮转）                          |
|  export_pdf_darwin.go/.m   cgo+ObjC：离屏 WKWebView → 分页 PDF → PDFKit 合并     |
|  export_pdf_other.go       非 darwin 降级（返回错误，前端退回 window.print）      |
|  main.go       原生菜单 / accelerator / 生命周期                                |
+---------------------------------------------------------------------------------+
                                       |
+---------------------------------------------------------------------------------+
|  macOS 系统框架：AppKit(菜单/窗口) · WebKit(WKWebView) · PDFKit · CSPreferences  |
+---------------------------------------------------------------------------------+
```

依赖铁律（与 ADR-002 一脉相承）：组件层禁止裸 hex；Go 层不承载业务规则（业务统一在前端，菜单只发事件）。

---

## 3. 模块一：WYSIWYG 装饰器架构（D-2）

> 目标：Markdown 标记符在**非活跃行隐藏**、在**光标/选区所在行显形**；中文输入（IME）必须安全。

### 3.1 数据模型与更新链路

**结论：装饰集由 `ViewPlugin` 在 `visibleRanges` 内计算，不做全文档扫描。**

依据（`@codemirror/view@6.43.13` 实测）：

- 装饰可经「直接提供」（`StateField`）或「函数提供」（`ViewPlugin` 的 `decorations: v => v.decorations`）。**函数提供者在视口计算之后调用**，因此性能天然受限于可见区（`dist/index.d.ts` 中 `EditorView.decorations` 注释原文）。
- 函数提供的装饰集被施加两条硬限制（`dist/index.js:2772-2776` 实测原文）：

```js
if (this.disallowBlockEffectsFor[index]) {
    if (deco.block)
        throw new RangeError("Block decorations may not be specified via plugins");
    if (to > this.view.state.doc.lineAt(from).to)
        throw new RangeError("Decorations that replace line breaks may not be specified via plugins");
}
```

推论（决定架构形状）：
1. **禁止**在 `ViewPlugin` 里用 `block: true` 装饰。
2. **禁止**跨行替换（`to > lineAt(from).to`）。但**允许** [line.from, line.to] 的整行内联替换（`to == lineAt(from).to`，不触发）。

因此本模块**统一使用「行内替换」**（`Decoration.replace`，不设 `block`），把标记符逐个隐藏；需要视觉替身（列表圆点）时用**行内 widget**（`Decoration.replace({widget})`）。

**更新链路（StateEffect 驱动 + 视口内重算）**：

```
外部（App.vue / 菜单事件）
   → view.dispatch({ effects: setWysiwyg(true|false) })
        │  StateField<boolean>  wysiwygField      （只存开关，零 DOM 成本）
        ▼
   ViewPlugin.update(update)
     触发重算的条件：docChanged || selectionSet || viewportChanged
                   || wysiwygField 值变化
     重算范围：仅 update.view.visibleRanges
     产出：this.decorations（DecorationSet）—— 经 { decorations: v => v.decorations } 挂载
```

**为什么开关放 `StateField` 而非组件 ref**：与 `createEditor.js:59` 的 `setFocusMode` 完全同构（StateEffect 从外部 dispatch，编辑器内部持有状态），保证「App.vue 只发命令、不感知 Decoration 细节」。

### 3.2 显形判定规则（边界如何取）

**「活跃」= 与任一 selection range 相交的行**。

```
activeLines(view):
  set = ∅
  for r in view.state.selection.ranges:            // 含 main + 多选区
     for ln in doc.lineAt(r.from).number .. doc.lineAt(r.to).number:
        set.add(ln)
  return set
```

- **只对「隐藏型」替换做显形抑制**：若标记符所在行 ∈ activeLines，则该行内所有隐藏替换退化为「不隐藏」（保持原样文本），其它装饰（字号/字重等 mark 类样式）**照常应用**——这样才「显形而非失样式」。
- **为什么不按「段落块」显形**：显形粒度过大（多行段落整体弹开标记符）会造成视觉跳动。以「行」为最小单位，与 `#`/`>`/列表符这些**行首标记**的语义对齐。
- **边界情形**：
  - 多行选区：选区触及的每一行都显形（逐行判定，不做区间并集扩张）。
  - 光标停在行尾（`r.from == r.to == line.to`）：`lineAt(to).number` 归入该行（行尾属本行），该行显形。
  - 空行：无标记，无操作。
- **显形与隐藏的确定性**：同一行要么全显形、要么全隐藏（不做「一半」），避免光标进入半隐藏区时出现「光标跳格」（见 §3.3）。

### 3.3 `atomicRanges`：必要，不是可选

若不声明 `atomicRanges`，隐藏区（如 `**` 的两个星号位置）仍可被光标落入，表现为：

- 左右方向键「按一下不动」（光标在隐藏字符间移动，视觉无变化）。
- 行首 Backspace 需按多次才删得掉一个不可见标记。

**做法**（`dist/index.d.ts:1351` 实测 facet 签名）：

```js
// 只把「隐藏型替换」的区间作为原子区，styled 的 mark 不纳入
EditorView.atomicRanges.of(view => view.plugin(wysiwygPlugin)?.atomicRanges ?? RangeSet.empty)
```

**必要性判定：必要**。它是「隐藏标记符」这一形态可用性的前提。注意官方说明：原子区**不阻止程序化 selection 更新**进入（`dist/index.d.ts` 原文），因此 `jumpToHeading` 等 dispatch 不受影响。

### 3.4 IME 保护（中文输入为硬需求）

两条防线：

1. **合成期间冻结装饰重算**：`ViewPlugin.update` 开头判断 `update.view.composing`（`dist/index.d.ts:776` 实测存在 `get composing(): boolean`）。为真时**直接返回、沿用上一次 decorations**，绝不在合成中途改动 DOM —— 否则 IME 候选窗/预编辑文本可能被清掉。
2. **活跃行显形天然覆盖合成点**：合成发生在光标处，而光标行本就显形（§3.2），故合成所在行不会处于「标记被隐藏」的状态。

补充：`App.vue` 现有的 `onGlobalKeydown` 已带 `!e.isComposing` 守卫（`App.vue:298`），新增的全局键处理必须沿用同一守卫。**禁止**在任何 keydown 处理里对 `view.composing` 为真的按键做 `preventDefault`。

### 3.5 性能策略

| 策略 | 做法 | 依据 |
|---|---|---|
| 只算可见区 | 遍历 `view.visibleRanges`，用 `syntaxTree(view.state).iterate({from, to, enter})` 取节点 | 满足「禁止全文档扫描」硬要求 |
| 复用增量语法树 | `@codemirror/lang-markdown` 的 Lezer 树是增量的；视口外不解析 | 依赖既有依赖行为 |
| 重算触发最小化 | 仅在 `docChanged / selectionSet / viewportChanged / 开关变化` 时重算；纯滚动不改变选择时由 `viewportChanged` 覆盖 | 与 `createEditor.js:86-93` 的 focusPlugin 同构 |
| `RangeSetBuilder` 顺序 | 装饰必须**按 from 升序**逐个 `add`，否则 `finish()` 抛错 | CM `RangeSetBuilder` 契约 |
| 大文档（≥5000 行） | 上述机制天然 O(可见行数)；**不做**全文档预扫描缓存 | 见 §3.6 的守卫 |

**大文档验收指标**：5000 行文档下，光标移动 / 输入的单次重算不得引发可感卡顿（目标：`visibleRanges` 内节点数 < 200）。

### 3.6 与现有专注模式共存

现状（`createEditor.js:72-115`）：专注模式 = `focusField`（StateField<boolean>）+ `focusPlugin`（ViewPlugin，产出 `Decoration.line` 的 `cm-focus-dim` / `cm-focus-active`）。

共存结论：**无 StateField 冲突，无需调整更新顺序。**

- CM6 允许多个 `StateField` 各自独立（冲突只发生在「同一个扩展实例被重复提供」）。`focusField` 与新增 `wysiwygField` 是两个不同实例，互不干扰。
- CM6 允许多个 `ViewPlugin` 各自提供 `decorations`，视图层会把多个 RangeSet **合并**渲染。`focusPlugin` 提供 `Decoration.line`，`wysiwygPlugin` 提供「行内 replace + mark + 行内 widget + 少量 line」，二者可共存。
- **同一行叠加两条 `Decoration.line`** 是允许的（class 合并）：专注的 `cm-focus-dim` 与 WYSIWYG 的 `.cm-md-heading` 会同时存在于该行 class 列表。
- **唯一需注意**：`createEditor.js:134-172` 的 `EditorView.theme` 是**单一 theme 扩展**，两套装饰的样式类都必须在其中或外部 CSS 里定义，**不得再新建第二个 theme 扩展后忘记合并**（`EditorView.theme` 多次提供会后者覆盖同键）。
- 扩展数组顺序建议：`[..., updateListener, focusField, focusPlugin, wysiwygField, wysiwygPlugin, EditorView.atomicRanges.of(...)]`。`atomicRanges` 需在 `wysiwygPlugin` 之后注册以能读到 `view.plugin(wysiwygPlugin)`。

### 3.7 适用标记符清单（逐条：隐藏 / 显形规则）

节点名均实测自 `@lezer/markdown@1.7.2`（`node_modules/@lezer/markdown/dist/index.js`），**非记忆推断**。

| 标记 | Lezer 节点 | 处理 | 活跃行规则 | 说明 |
|---|---|---|---|---|
| `#`（1~6） | `ATXHeading1..6` 内的 `HeaderMark` | 隐藏 `HeaderMark`（含其后空格）；标题正文加 mark | 活跃行显形全部 `#` | 字号由既有 `mdHighlight` 的 `heading1..6` 提供，**不重复定义** |
| `**` / `__` | `StrongEmphasis` 内的 `EmphasisMark`（2 个） | 隐藏两个 `EmphasisMark`；正文加 `font-weight` mark | 活跃行显形 | 字重须与 `createEditor.js:26`（510）一致，避免显形/隐藏字重跳变 |
| `*` / `_` | `Emphasis` 内的 `EmphasisMark` | 隐藏；正文 `font-style: italic` mark | 活跃行显形 | |
| `~~` | `Strikethrough` 内的 `StrikethroughMark`（实测存在） | 隐藏；正文 `text-decoration: line-through` | 活跃行显形 | |
| `` ` `` | `InlineCode` 内的 `CodeMark` | 隐藏；正文加行内代码 mark | 活跃行显形 | 底色沿用 `--code-inline-bg` |
| `[ ]( )` | `Link` 内的 `LinkMark`、`URL`、`LinkTitle` | 隐藏 `LinkMark` + `URL` + `LinkTitle`；`LinkLabel` 文字加链接样式 | 活跃行显形全部 | 内容取 `LinkLabel`（节点名实测存在） |
| `>` | `Blockquote` 内的 `QuoteMark` | 隐藏 `QuoteMark`；该行加 `.cm-md-quote` 行样式 | 活跃行显形 | 引用样式沿用 `--surface-warm` |
| 列表符 `-`/`*`/`+` | `ListMark`（`BulletList` 下） | **替换为行内 bullet widget**（渲染 `•`） | 活跃行显形原文符号 | 需 widget 才能保留视觉圆点 |
| `1.` 等 | `ListMark`（`OrderedList` 下） | 替换为「序号 + `.`」行内 widget | 活跃行显形原文 | 序号取自原文，不重算 |
| 任务列表 `- [ ]` | `Task` / `TaskMarker`（实测存在） | `TaskMarker` 替换为方框 widget（勾选态读原文） | 活跃行显形 | |
| 围栏 ``` / ~~~ | `FencedCode` 内的 `CodeMark` + `CodeInfo` | 隐藏 `CodeMark` 与 `CodeInfo`（**行内替换，整行内容变空**） | 活跃行显形 | 空行仍在代码块底色内，视觉上表现为内边距；**不使用** block 装饰（被插件限制禁止） |

### 3.8 明确不做（out-of-scope，附理由）

| 不做项 | 理由 |
|---|---|
| **表格对齐渲染** | 表格需重排为网格，超出「隐藏标记符」范畴；由预览态承担。若强做需 block widget（插件层被禁）+ 大量测量逻辑，收益低、风险高 |
| **setext 标题**（`标题\n===`） | 其「标记」是**下一行的整行下划线**，无法用行内替换隐藏而不破坏行结构；且 `App.vue:326-328` 已确认 setext 在现有锚点体系里本就不参与。保持可见 |
| **嵌套列表深层缩进可视化** | 多层 `ListMark` 的缩进可视化需测量与重排，属编辑器排版工程，非本期目标。仅隐藏标记、保留原始缩进 |
| **HTML 块（`HTMLBlock`）** | 按原文展示，不解析、不隐藏；隐藏会让用户看不见原始 HTML 导致误删 |
| **图片 `![alt](url)` 内联渲染** | 需要资源加载与尺寸测量，属独立特性；本期仅隐藏标记符、保留 `alt` 文本 |
| **自动补全（输入 `**` 自动补另一半）** | 属输入辅助，非装饰；且与 IME 交互复杂，单列后续 |
| **软换行 / 硬换行折叠** | 改变行结构，超出装饰能力 |

---

## 4. 模块二：三主题 Token 分层扩展（D-1）

### 4.1 现状与增量原则

现状（实测 `frontend/src/themes/tokens/design-tokens.css`）：**单文件**四层 A1/A2/B/C（用注释分节）+ 结构尺度块 + 预览尺度块；别名层已于 ADR-002 M3 删除。三主题块**已经存在**：`:root[data-theme='light']`（31 行）、`[data-theme='dark']`（90 行）、`[data-theme='paper']`（150 行）。

关键现状核对：
- **Token 文件已按 D-1 预置三主题**（`design-tokens.css:5` 文件头即写「三主题一套 Token」）。**因此本 phase 的主题工作在 Token 层几乎已完成**，剩下的是「接线」（JS 侧 theme 解析）+ 少量新增装饰 token。
- `themes/index.css` 当前 `@import` 顺序：`tokens/design-tokens.css` → `base.css` → `preview.css`（`index.css:13-15`）。

**增量方案（不推翻 ADR-002 结构）**：

1. **不新增 token 文件**，继续维持单文件 `tokens/design-tokens.css`（ADR-002 终版冻结项）。
2. 仅在其内**追加**一个「编辑器 / WYSIWYG 装饰面」小节（C-extension），供 §3 的装饰类使用（示例键名，设计侧可更名）：
   `--md-mark-dim`（隐藏态可选淡化）、`--md-code-inline-bg`（复用 `--code-inline-bg` 亦可）、`--md-bullet-color`、`--md-quote-bar`。**若设计侧对既有 C-extension 已有等价项，则直接复用、不新增**（防止 token 膨胀）。
3. ~~新增 `frontend/src/themes/wysiwyg.css`~~ **【实施偏差回写】** 装饰类（`.cm-md-*`）最终并入 `createEditor.js` 内唯一的 `EditorView.theme(...)` 定义（CodeMirror 6 生成的类挂编辑器实例，且符合 §3.6「禁止第二 theme」硬约束），值仍只引用语义 token、无裸 hex。未落地独立 wysiwyyg.css 文件。
4. ~~`themes/index.css` 追加 @import~~ 同上，随之取消（无新 CSS 文件）。

```
themes/
├── index.css                 （改：+1 行 @import）
├── tokens/design-tokens.css  （改：三主题已存在；+少量装饰 token）
├── base.css                  （不变）
├── preview.css               （不变）
└── wysiwyg.css               （新：装饰类，仅引用语义 token）
```

### 4.2 跟随系统深浅 + 用户手动覆盖

**优先级（高→低）**：`用户手动选择` > `系统 prefers-color-scheme`。

**关键设计（与 `design-tokens.css:22-24` 的既有约定一致）**：`<html data-theme>` **始终保存「已解析的具体主题」**（`light|dark|paper`），CSS 侧**不需要** `prefers-color-scheme` 分支。解析在 JS 完成。

```
持久化键：localStorage['inkmark-theme'] ∈ {'system','light','dark','paper'}
  - 'system'（默认）→ 监听 matchMedia('(prefers-color-scheme: dark)')
                        解析为 'dark' 或 'light'，写入 dataset.theme
  - 'light'|'dark'|'paper' → 用户显式覆盖，忽略系统；dataset.theme 即该值
```

**要点**：
- `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件监听器**只在 mode==='system' 时生效**；切到手动模式时移除监听，避免「用户选了浅色却被系统切换改回去」。
- 现有 `App.vue:458-462` 的 `toggleTheme` 只在 light/dark 间二选一且**直接改 dataset + localStorage**。本期须重写为三主题 + 系统态的循环，并抽出到 `composables/useTheme.js`（`theme` 仍以 ref 暴露给 `exportHtml` 使用，`App.vue:21` 的消费保持不变）。
- **纸感主题（paper）不在系统解析范围内**（系统只有 light/dark）——paper 只能由用户显式选择。
- **导出 PDF/HTML 的主题**：导出时取**当前已解析的主题**（`exporters.js:13` 的 `data-theme`），不做系统跟随（导出产物必须是确定值）。

---

## 5. 模块三：历史快照存储

### 5.1 需求与职责切分

「最近 10 个版本」的轻量历史（替代 Git）。与**自动保存（800ms 防抖）**是两个独立机制：

| 机制 | 目标 | 频率 | 落点 |
|---|---|---|---|
| 自动保存 | 不丢当前稿 | 800ms 防抖 | **覆盖原文件**（复用现有 `WriteFile`） |
| 历史快照 | 可回退到旧版本 | **低频**（见 §5.3） | 应用支持目录内的独立快照文件 |

**若快照跟随自动保存频率，10 版会在数秒内被轮转光**——这是本模块最大的坑，必须在架构层隔离两者触发源。

### 5.2 存储规格

| 项 | 规格 |
|---|---|
| 根目录 | `os.UserConfigDir()` 下的 `Inkmark/snapshots/`（macOS 实为 `~/Library/Application Support/Inkmark/snapshots/`）。**用 Go 求路径**，不硬编码 |
| 文档键 | `docKey = hex(sha1(filepath.Clean(absPath)))[:16]`，**由 Go 内部派生**（前端不实现，见 §5.4）。避免把含 `/`、`:`、中文的路径直接做目录名 |
| 目录结构 | `snapshots/<docKey>/` |
| 单快照文件 | `YYYYMMDD-HHmmss-<seq>.md`，内容 = **该时刻的完整文档文本**（朴素、可读、可直接 diff） |
| 元数据 | `snapshots/<docKey>/index.json`：`[{ name, size, createdAt(ms), contentHash }]`，按 createdAt 倒序 |
| 轮转 | 每次写入后保留**最新 10 个**（按 createdAt 倒序），其余删除（文件 + index 同步） |
| 去重 | 写入前比对 `contentHash`（sha1 of content），若与**最新一条相同**则跳过（防止「没改动也生成版本」） |
| 原子性 | 快照文件写临时文件后 `rename`（与 `app.go:71-78` 的 `WriteFile` 同法） |

### 5.3 触发时机（与自动保存解耦）

- **定时**：编辑「活跃累计时长」每满 **5 分钟**且内容有变化 → 生成一次快照（前端计时，非 wall-clock 轮询）。
- **破坏性事件前**：打开另一个文件 / 新建 / 退出应用 / 「另存为」覆盖已存在路径前 → 立即生成快照。
- **手动**：历史面板内「立即快照」按钮。
- **不触发**：单纯的 800ms 自动保存不触发快照。

### 5.4 Go 侧新增绑定函数签名（**需要 Go 配合**）

> **契约已裁决（team-lead，2026-10-01）**：采用「**Go 内部派生 `docKey`**」，前端**不**实现 sha1 / 路径规则；绑定层参数用 **`absPath`**（前端唯一可靠持有的文档标识，`App.vue:18` 的 `filePath`）。原因：两端各写一份 sha1 + 路径归一化，必然产生「前端算的 key ≠ Go 算的 key」的沉默不一致（快照写到一个目录、读时查另一个目录，无报错、静默丢历史）。

```go
// snapshots.go
package main

type SnapshotInfo struct {
    Name        string `json:"name"`        // 文件名，如 20261001-153012-0.md
    Size        int64  `json:"size"`        // 字节
    CreatedAt   int64  `json:"createdAt"`   // Unix 毫秒
    ContentHash string `json:"contentHash"` // sha1(content)
}

// docKeyOf 是 docKey 的**唯一**派生实现（快照层内部使用，不跨绑定边界）：
//   docKey = hex(sha1(filepath.Clean(absPath)))[:16]
// 说明：对归一化后的绝对路径取 sha1，取前 16 位十六进制；避免把含 "/" ":" 或中文的
//       路径直接做目录名（非法文件名 / 跨平台差异 / 长度失控）。
func docKeyOf(absPath string) string

// SnapshotWrite 为某文档写一份快照并做 10 版轮转；内容与最新一条相同则跳过并返回该条。
// absPath 为文档绝对路径（Go 内部派生 docKey）；content 为完整文档文本。
func (a *App) SnapshotWrite(absPath string, content string) (SnapshotInfo, error)

// SnapshotList 列出某文档的快照（按时间倒序，最多 10）。
func (a *App) SnapshotList(absPath string) ([]SnapshotInfo, error)

// SnapshotRead 读取某快照内容。name 必须来自 SnapshotList，禁止路径穿越。
func (a *App) SnapshotRead(absPath string, name string) (string, error)

// SnapshotDelete 删除单条快照（供 UI 清理）。返回删除后剩余数量。
func (a *App) SnapshotDelete(absPath string, name string) (int, error)

// SnapshotDocKey 是可选的只读辅助：把 absPath 映射为 docKey 回传前端，
// 供前端做 UI 分组 / 调试对齐。**不是**写入路径的必需参数。
func (a *App) SnapshotDocKey(absPath string) (string, error)
```

**安全硬约束**：`name` 来自前端，**必须**校验为 `[0-9A-Za-z._-]+` 且不含 `..` / `/`。`absPath` 经 `filepath.Clean` 后派生 `docKey`，派生结果**天然只含 `[0-9a-f]`**，故目录名侧无穿越风险；`name` 是唯一的用户可控路径片段，须单独校验。否则存在路径穿越（写出/读到快照目录之外）风险。

> **对齐说明（可审计）**：team-lead 指令原文为「签名改为 `ExportSnapshot(docKey string) error` 一类形态」。本设计与之一致之处：`docKey` **由 Go 内部派生**（单实现）；差异之处有二 ——
> ① **命名**：本 ADR 用 `SnapshotWrite/List/Read/Delete` 动词族（`ExportSnapshot` 视为「写一份快照」的示例名，语义等价于 `SnapshotWrite`）；若 team-lead 要求统一命名，改名零成本。
> ② **绑定层参数**：用 `absPath` 而非 `docKey`。若绑定层收 `docKey`，则必须由前端先算出它，正是裁决要消除的「两端各算一份」风险。若 team-lead 坚持绑定层收 `docKey`，则应改为「前端先调 `SnapshotDocKey(absPath)` 取回 `docKey`，再以 `docKey` 调其余四法」的两段式；**本 ADR 不采用，理由如上**。

### 5.5 纯前端部分

- **不计算 `docKey`**（Go 内部派生，见 §5.4）。前端只提供 `absPath`——`App.vue:18` 的 `filePath` 直接可用。
- 活跃计时、历史面板 UI、恢复（把快照内容 `dispatch` 覆盖编辑器，并提示「已恢复到某版本，可 ⌘Z 撤销」）。
- 去重由 Go 侧按 `contentHash` 完成，前端不做预判（单实现，避免两端规则漂移）。


---

## 6. 模块四：PDF 导出（D-3）

**完整结论与证据见 `ADR-003-pdf-export.md`。** 此处只摘架构落点：

- Go 侧新增 `ExportPDF(html string, defaultName string) (string, error)`：弹保存对话框 → 调 darwin 桥 → 返回路径。
- darwin 桥（cgo+ObjC）：离屏 `WKWebView`（正文宽 **467pt**）加载自包含 HTML → 逐页 `createPDFWithConfiguration(rect=(0, i*714, 467, 714))` → PDFKit 合成 595×842 页并**叠加页眉页脚** → 合并 → 落盘。**注意两套坐标系**：`rect` 用 Web 页坐标（原点左上），落页用 PDF 坐标（原点左下），详见 ADR-003 §11 坑 20。
- **页面几何（分页硬约束）**：页面 595×842pt、页边距 64pt、页眉/页脚带宽 24pt（**边距内可用带宽上限，不参与相加**）、**正文可用宽 467pt / 正文可用高 714pt**；`pages = ceil(H / 714)`。正文不得进入页眉/页脚基线所落的 24pt 带宽。（已裁决：取读法 B，正文带 714pt，见 ADR-003 §已裁决与待办）
- **页眉页脚：本期必做（P0，team-lead 裁决 2026-10-01）**，规格见 `docs/design/phaseC-visual-spec.md` §8。在 PDFKit 阶段用 `NSAttributedString` 逐页叠加：字号恒 9pt；**四角色字色分别映射**（文档名 `--muted` / 日期 `--meta` / 当前页 `--fg-2` / `/ N 页` `--muted`）；字体 `--font-body`（非 chrome 的 `--font-ui`）；页脚右对齐「第 X / N 页」（斜杠两侧各一空格）；不加分隔线。
- **主题映射（钉死，非跟随）**：`light → light`、`paper → paper`、**`dark → 强制 light`**（深底浅字不适纸面）。故 PDF 页眉页脚只取 light / paper 列。
- 非 darwin：`export_pdf_other.go` 顶替（**菜单项保持可用、不置灰**），触发 `window.print()`；菜单文案 darwin「导出 PDF…」/ 非 darwin「导出 PDF…（本平台走系统打印）」（L2/L3 降级链见 ADR-003 §降级路径）。
- **超大文档**：页数上限 **500**；超限**必须明确报错并中止**，禁止静默截断或崩溃。
- 导出 HTML 复用 `export/exporters.js:11-27` 的 `buildHtmlDocument`，**与 HTML 导出同源**；但 PDF 导出的正文版式须按 **467pt** 宽（`exporters.js` 现有的 `max-width:46rem` 需参数化，见 §11 坑 19）。

---

## 7. 模块五：快捷键

**全量分配表与冲突消解见 `ADR-004-keybinding-map.md`。** 架构落点：

- 全部 accelerator 在 `main.go` 的 `buildMenu` 声明（单一真源），新增「格式」子菜单承载 WYSIWYG 命令。
- 菜单回调只 `runtime.EventsEmit`（沿用 `main.go:55-61` 的 `emit` 闭包），前端 `safeEventsOn` 消费（沿用 `App.vue:470-484`）。
- 前端把格式事件映射为 CodeMirror 命令（`editor/formatCommands.js`），**不在 CM keymap 重复绑定**（避免菜单与 keymap 争抢同一键导致静默失效）。
- **阅读模式 = 第 4 视图态 `⌘4`**（team-lead 裁决 2026-10-01，废弃候选 `⌘⇧R`）：与 `⌘1/2/3` 同族；`Esc` 退出后回到**进入前的视图态**，复用专注模式的 `modeBeforeFocus` 机制（`App.vue:271-286`）。

---

## 8. 文件清单（新增 / 变更，含预期行数）

> 行数为**预估新增/改动量**（非总行数），用于 story 拆分与 review 规模控制。单文件硬上限 300 行（`references/01-standards/code-organization.md`）。

### 8.1 前端

| 文件 | 动作 | 预估 | 职责 |
|---|---|---|---|
| `frontend/src/editor/wysiwyg.js` | 新增 | ~230 | `wysiwygField` + `setWysiwyg` effect + `wysiwygPlugin` + `atomicRanges` |
| `frontend/src/editor/markdownStructure.js` | 新增 | ~120 | 从 Lezer 树抽取「可隐藏标记区间」与「行类型」，供 wysiwyg 使用 |
| `frontend/src/editor/formatCommands.js` | 新增 | ~150 | 加粗/斜体/删除线/行内代码/链接/标题/列表/引用的 toggle 命令 |
| `frontend/src/editor/createEditor.js` | 变更 | +~25 | 注册 wysiwyg 扩展与 atomicRanges；与 focusPlugin 共存（§3.6） |
| `frontend/src/editor/snapshots.js` | 新增 | ~110 | 活跃计时、触发策略、面板数据桥接 |
| `frontend/src/composables/useTheme.js` | 新增 | ~80 | 三主题 + 跟随系统解析 + 持久化 |
| `frontend/src/components/StatusBar.vue` | 新增 | ~90 | 保存态 / 行列 / 字数 / 缩放（DECISIONS §三） |
| `frontend/src/components/HistoryPanel.vue` | 新增 | ~120 | 快照列表 / 预览 / 恢复 |
| `frontend/src/App.vue` | 变更 | +~130 | 阅读模式、格式事件、自动保存、主题接线、状态栏挂载 |
| `frontend/src/themes/wysiwyg.css` | 新增 | ~60 | `.cm-md-*` 装饰类（仅引用语义 token） |
| `frontend/src/themes/index.css` | 变更 | +1 | `@import './wysiwyg.css'` |
| `frontend/src/themes/tokens/design-tokens.css` | 变更 | +~10 | 装饰面 C-extension token（能复用则零新增） |

### 8.2 Go

| 文件 | 动作 | 预估 | 职责 |
|---|---|---|---|
| `main.go` | 变更 | +~40 | 「格式」子菜单、⌘4 阅读模式、⌘P 文案改为「一键导出 PDF…」 |
| `app.go` | 变更 | +~15 | 登记新绑定（Wails `Bind` 已含 `app`，方法自动暴露） |
| `snapshots.go` | 新增 | ~150 | 快照读写 / 轮转 / 索引 / 路径校验 |
| `export_pdf_darwin.go` | 新增 | ~80 | cgo 桥 Go 侧（build tag `darwin && cgo`） |
| `export_pdf_darwin.m` | 新增 | ~170 | ObjC：离屏 WKWebView → 逐页 PDF → PDFKit 合并 |
| `export_pdf_darwin.h` | 新增 | ~25 | 桥接头 |
| `export_pdf_other.go` | 新增 | ~30 | build tag `!darwin`，返回「当前平台不支持一键导出」 |

> 注：`.m/.h` 不参与 Go 函数长度限制，但同样受单文件 300 行约束（本表均在限内）。

---

## 9. Go 侧新增绑定函数签名（汇总）

```go
// export_pdf_darwin.go —— 仅 darwin 编译
// ExportPDF 把自包含 HTML 渲染为分页 A4 PDF 并写入用户所选路径，返回保存路径。
func (a *App) ExportPDF(html string, defaultName string) (string, error)

// export_pdf_other.go —— 非 darwin 编译（同名方法，返回错误）
func (a *App) ExportPDF(html string, defaultName string) (string, error)

// snapshots.go —— 全平台
func (a *App) SnapshotWrite(absPath string, content string) (SnapshotInfo, error)
func (a *App) SnapshotList(absPath string) ([]SnapshotInfo, error)
func (a *App) SnapshotRead(absPath string, name string) (string, error)
func (a *App) SnapshotDelete(absPath string, name string) (int, error)

// 复用/无需新增：
//   WriteFile  —— 自动保存沿用（app.go:71）
//   SaveFileDialog —— PDF/HTML 保存对话框沿用（app.go:54）
```

**Wails 绑定注意**：`Bind: []interface{}{app}`（`main.go:31`）已注册整个 `*App`，**新增方法无需改 `main.go` 的 Bind**，但 `wails dev`/`build` 后需重新生成 `frontend/wailsjs/`（构建脚本自动完成）。

---

## 10. 验收可测点清单

### 10.1 WYSIWYG（D-2）

| # | 可测点 | 判据 |
|---|---|---|
| W1 | 非活跃行隐藏标记符 | `# 标题` 在光标离开后 `#` 不可见，标题字号不变 |
| W2 | 活跃行显形 | 光标移入该行，`#` 立即出现，且不改变文本内容（`doc.toString()` 前后一致） |
| W3 | 选区显形 | 多行选区所覆盖的每一行标记符均显形 |
| W4 | atomicRanges 生效 | 光标在 `**粗体**` 左侧，按 → 一次径直落到「粗」字后（不卡在星号间） |
| W5 | IME 安全 | 中文拼音输入合成期间，隐藏态不闪断、候选框不消失、预编辑文本不丢 |
| W6 | 内容零篡改（硬） | 全流程任意显隐操作后，`doc.toString()` **必须逐字节等于**用户键入的 Markdown 原文 |
| W7 | 与专注模式共存 | ⌘⇧F 打开时，WYSIWYG 隐藏规则与 `cm-focus-dim` 同时生效，无异常 |
| W8 | 大文档性能 | 5000 行文档下连续输入 20 字无掉帧（手测 + Performance 面板） |

> **W6 是最高优先级硬验收**：装饰器任何「回写文档」都是缺陷；WYSIWYG 只做展示层装饰，**永不改动 state**。

### 10.2 主题（D-1）

| # | 可测点 | 判据 |
|---|---|---|
| T1 | 三主题可切换 | light/dark/paper 三态下 `--accent` 分别为 `#4F46E5`/`#6E76F0`/`#9D5A2F`（`design-tokens.css:39/98/158`） |
| T2 | 跟随系统 | 系统切深浅 → 应用即时跟随（mode=system 时） |
| T3 | 手动覆盖优先 | 选 paper 后切换系统深浅，主题**不变** |
| T4 | 持久化 | 重启后恢复上次选择；`localStorage['inkmark-theme']` 值正确 |
| T5 | 纸感衬线 | paper 下正文 `font-family` 解析为衬线栈（`design-tokens.css:161`） |
| T6 | 禁用紫→粉渐变（P0） | 全仓 grep 无该渐变；`--accent` 单一强调色 |
| T7 | 无 emoji 图标（P0） | 见 §11 门禁命令 |

### 10.3 PDF（D-3）

| # | 可测点 | 判据 |
|---|---|---|
| P1 | 一键直出 | 点击/⌘P → 仅出现「保存到哪」对话框，**不出现系统打印面板** |
| P2 | 真分页 | 长文档产物为多页 A4（`file` 报 `N pages`；每页 MediaBox `595 842`）；页数 = `ceil(H/714)` |
| P3 | 矢量文字 | 产物文字可选中/可搜索（非位图） |
| P4 | 内容完整 | 与预览一致；无截断、无缺页 |
| P5 | 与预览同源 | PDF 样式与预览区一致（同一份导出 CSS） |
| P6 | 降级可用（不置灰） | 非 darwin 上菜单项**仍可用**（未置灰）、文案为「导出 PDF…（本平台走系统打印）」，触发后退回 `window.print()`，不崩溃 |
| P7 | 页眉页脚（P0 本期） | 每页有页眉（左=文档名去扩展名 / 右=日期）与页脚（右=`第 X / N 页`）；字号恒 9pt；字色四角色映射（`--muted`/`--meta`/`--fg-2`/`--muted`）；字体 `--font-body`；正文不侵入页眉/页脚区 |
| P8 | 主题映射 | `light`→light、`paper`→paper、**`dark`→light**（深色下导出为白纸黑字） |
| P9 | 超限不静默 | 构造 >500 页文档导出 → 出现**明确可读的错误提示**并中止；**无**静默截断、无崩溃 |

### 10.4 快照与自动保存

| # | 可测点 | 判据 |
|---|---|---|
| S1 | 自动保存不丢稿 | 输入后 800ms 内落盘；崩溃后重开内容在 |
| S2 | 快照低频 | 连续快速输入 1 分钟，快照数 ≤ 1（**不随自动保存刷屏**） |
| S3 | 10 版轮转 | 生成 12 次后目录内仅 10 个文件，最旧的 2 个被删 |
| S4 | 去重 | 内容未变时再触发不新增快照 |
| S5 | 路径穿越防护 | `SnapshotRead(..., "../../x")` 被拒绝（返回错误） |
| S6 | 恢复可用 | 从面板恢复旧版 → 编辑器内容变更，且可 ⌘Z 撤销 |

### 10.5 快捷键（D-4）

| # | 可测点 | 判据 |
|---|---|---|
| K1 | D-4 零回归 | ⌘B 仍是「显示/隐藏大纲」（`main.go:90` 未改） |
| K2 | 加粗键 | ⌘⇧B 触发加粗；⌘B 不触发加粗 |
| K3 | 无重复 | `main.go` 内所有 accelerator 唯一（脚本比对） |
| K4 | 格式命令生效 | 每个格式键产生对应 Markdown 变更 |
| K5 | 阅读模式族一致 | ⌘4 进入阅读模式；⌘1/2/3 仍为编辑/预览/双栏；**⌘⇧R 在本项目不绑定任何行为** |
| K6 | 阅读模式退出 | Esc 退出阅读模式后，回到**进入前的视图态**（与专注模式行为一致） |

---

## 11. 已知坑清单（内嵌为硬约束）

1. **CM6 插件装饰两条禁令**（`dist/index.js:2774/2776`）：`ViewPlugin` 提供的装饰**不得** `block:true`、**不得**跨行替换。违反即抛 `RangeError`（运行时崩，非静默）。→ WYSIWYG 一律行内替换（§3.1）。
2. **CM6 `ViewUpdate` 没有 `scrollChanged`**（`createEditor.js:118-121` 已记录）：滚动联动必须用原生 `scroll` 事件，写了 `update.scrollChanged` 永远 `undefined`（静默失效）。
3. **CM6 `display:none` 期间度量失真**（`App.vue:230-231,250-251,256-258`）：切回可见必须 `requestMeasure()`。WYSIWYG 若在隐藏态被 enable，需在同一时机 `requestMeasure`。
4. **IME 与装饰互斥**：合成期间（`view.composing`）不得重建装饰（§3.4）。
5. **Wails 菜单 `showsPrintPanel = YES` 硬编码**（`Application.m:492`）：`WindowPrint` 无法做到「不弹面板」，D-3 必须自建 PDF 通路（ADR-003）。
6. **菜单 accelerator 先于 WebView 消费按键**（`App.vue:464-466`）：同一键不得同时出现在菜单与 CM keymap。
7. **Vue scoped 会把 `:global(body.x) 后代` 拍平**（`App.vue:605-608,821-823`）：曾导致 body 被涂色、整窗不可交互。新增样式勿踩。
8. **需求文档 `template` 里的 emoji 是占位符不是设计**（`DECISIONS:60-63`）：顶栏的三个占位符号必须映射为 `AppIcon` 语义图标（`pen-line` / `moon-sun` / `panel-left`，ADR-001）。正文里的庆祝符号会污染 `DEFAULT_DOC`（`20c722a` 修掉的违规项）。
9. **`--font-ui` 与 `--font-body` 分离**（`design-tokens.css:282-283`）：paper 主题下**界面外壳仍用无衬线**，只有正文走衬线。新增 chrome 组件（状态栏）必须用 `--font-ui`。
10. **`@media print` 必须 `!important` 覆盖内联 `display:none`**（`App.vue:806-817`）：三态用 `v-show`，隐藏侧是内联样式，样式表不加 `!important` 覆盖不掉。若新增阅读模式态，打印规则须同步。
11. **`exporters.js` 的自包含 CSS 是第二份样式源**（`exporters.js:36-116`）：改动 `design-tokens.css` 的语义值后**必须同步** `exporters.js` 内联 CSS，否则导出与预览分叉（ADR-002 已记录该漂移风险）。
12. **`vite.config.js` 无 `@` 别名**（ADR-002 记录）：import 一律相对路径，`docs/` 不得作为构建依赖。
13. **快照频率必须与自动保存解耦**（§5.1）：否则 10 版被秒级轮转光。
14. **`splitting` 必须是 `ref`**（`App.vue:488`）：模块级 `let` 不驱动 class。同类状态管理新增勿踩。
15. **Wails 拖拽用 `--wails-draggable` 而非 `-webkit-app-region`**（`App.vue:651-652,662`）：新增 chrome 若要拖窗，用前者。
16. **版本漂移：文档写「CodeMirror 6.38」是错的**（§1.1）：`package.json` 的 `^6.38.0` 实际锁 `@codemirror/view 6.43.13`。**按 6.38 的印象去查 API 会查到不存在/已变更的签名**（幻觉 API 高发区）。**纪律**：涉及 CM/Lezer 的 API 断言，一律先在 `node_modules/<pkg>/package.json` 与 `dist/*.d.ts` 实测后再写。
17. **阅读模式是「第 4 视图态」不是「叠加态」**（ADR-004 裁决）：它与 `⌘1/2/3` 同族、互斥；不可做成与专注模式（`⌘⇧F`）同类的叠加开关。`⌘⇧` 前缀在本项目专属于「叠加态」，**不得**再分配给视图态；`⌘⇧R` 明确不予采用。
18. **快照明文存储会随修改累积**（§5.2）：单快照存完整文本（便于直接 diff / 恢复），靠**只留 10 版**控制体积；若后续放宽版数，须重新评估磁盘占用与轮转策略。
19. **导出 HTML 的 `max-width:46rem` 与 PDF 正文宽 467pt 不一致**（`exporters.js:71-74`）：HTML 导出用 46rem 舒适行宽，但 PDF 正文带固定 **467pt**（≈31 中文字/行，见设计规格 §8.4）。`buildHtmlDocument` 须支持**按用途传版式宽度**；**禁止**用 CSS 缩放去凑（会破坏 1px = 1pt 约定，见坑 16 与 ADR-003 风险 6）。**取值由设计规格 §8 锚定**：正文宽 467pt、正文带 714pt（已裁决取读法 B——页眉/页脚 24pt 在 64pt 边距之内，**不参与相加**）。
20. **PDF 页眉页脚与正文是两次绘制**（ADR-003 §页面几何）：正文由 `createPDFWithConfiguration` 出图、页眉页脚由 PDFKit 叠加——两者的**坐标系不同**（前者 Web 页坐标、原点左上；后者 PDF 坐标、原点左下）。合成时须显式换算，漏换会把页眉画到页脚位置（且不报错）。

---

## 12. 端到端验证步骤（收尾即验收）

```bash
# 0) 前置：构建前端并启动桌面应用
cd /Users/aftery/Desktop/myapp/inkmark
wails build            # 或 wails dev
./build/bin/inkmark    # 启动应用

# 1) WYSIWYG（D-2）
#    - 打开/新建文档，粘贴含 # ** * ~~ ` [ ]( ) > - 1. ``` 的样例
#    - 光标移出 > 观察标记符隐藏；光标移入 > 观察显形
#    - 用中文输入法输入「测试」：合成中隐藏态不闪断
#    - 断言内容零篡改：保存文件后 diff 与手写原文逐字节一致

# 2) 主题（D-1）
#    - 切换 light/dark/paper；系统切深浅验证跟随；选 paper 后切系统验证不跟随
#    - 重启验证持久化

# 2b) 阅读模式（第 4 视图态）
#    - ⌘4 进入阅读模式（隐藏 chrome + 正文加宽）；⌘⇧R 应无任何反应
#    - Esc 退出后回到进入前的视图态（如从双栏进入则回双栏）

# 3) PDF（D-3）—— 关键路径
#    - 点击「一键导出 PDF…」（或 ⌘P）
#    - 断言：只出现保存对话框，无系统打印面板
file ~/Desktop/out.pdf          # 期望：PDF document, version 1.x, N pages；每页 MediaBox 595 842
#    - 打开产物：A4 多页、文字可选中、样式与预览一致
#    - 页眉页脚（P0）：左=文档名（去扩展名）/ 右=日期；页脚右=「第 X / N 页」；恒 9pt；
#      字色四角色映射（文档名 --muted / 日期 --meta / 当前页 --fg-2 / 「/ N 页」--muted）；
#      字体随主题（纸感走衬线）；正文未侵入页眉/页脚区
#    - 主题映射：light→light、paper→paper、dark→light（深色下导出为白纸黑字）

# 4) 快照
#    - 连续编辑 1 分钟，检查 ~/Library/Application\ Support/Inkmark/snapshots/<key>/
ls -1 .../snapshots/<key>/*.md | wc -l    # 期望：10 版以内
#    - 从历史面板恢复旧版，断言内容变化且 ⌘Z 可撤销

# 5) 回归门禁（P0 规则）
cd frontend
# 无 emoji 作功能图标（UI 层）
grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' src/App.vue src/components/*.vue && echo "FAIL: emoji" || echo "OK"
# 组件层无裸 hex（token 定义文件与 exporters 自包含模板豁免）
grep -rniE '#[0-9a-f]{3,8}\b' src/components src/editor src/preview | grep -v 'exporters.js' || echo "OK"
# 禁止紫→粉渐变
grep -rniE 'linear-gradient[^;]*(#(a|b|c|d|e|f)[0-9a-f]{5}[^;]*#f)' src/ || echo "OK"
# 快捷键唯一性（人工核对 main.go accelerator 列表）
grep -n 'keys\.\(CmdOrCtrl\|Combo\)' main.go

# 6) 关键错误/边界流
#    - 非 darwin 构建下：菜单「导出 PDF…（本平台走系统打印）」仍可点（未置灰），触发后走 window.print()，不崩溃
#    - 超长文档（>500 页）导出 → 明确报错并中止，无静默截断、无崩溃
#    - 5000 行文档下连续输入 → 无卡顿
#    - 快照越权访问 SnapshotRead(path, "../../etc/passwd") → 拒绝
```

**完成定义**：上述 1~6 全通过 + §10 验收点满足 + 回归为零。

---

## 13. 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-01 | 初版：WYSIWYG 装饰器架构 / 三主题 Token / 快照存储 / PDF 落点 / 文件清单 / 验收点 / 已知坑 | Phase C 启动 |
| 2026-10-01 | v1.1：吸纳 team-lead 三项裁决与两项补做——(a) 版本锚定收敛为 6.43.13 并标注各包版本；(b) 快照绑定签名改用 `absPath`、`docKey` 由 Go 内部派生并写清派生规则；(c) PDF 页眉页脚升为 P0 本期实施、非 mac 走 L2 不置灰；(d) 阅读模式定为第 4 视图态 ⌘4、`⌘⇧R` 废弃；(e) 新增已知坑 16~18、验收点 K5/K6 与 P6/P7 判据更新 | team-lead 复核裁决 |
| 2026-10-01 | v1.2：对齐设计规格 §8 —— §6 写入 PDF 页面几何硬约束（正文带 **666pt** / 正文宽 **467pt** / 边距 64 / 页眉页脚区 24）、四角色字色映射（`--muted`/`--meta`/`--fg-2`/`--muted`）、`dark → 强制 light` 映射、非 darwin 菜单文案；§10.3 新增 P8（主题映射）与 P9（超限不静默）并更新 P2/P6/P7；新增已知坑 19（`exporters.js` 版式宽参数化）与 20（双坐标系换算）；§12 同步 | team-lead A1/A2/A3 裁决 |
| 2026-10-01 | **v1.3：正文带 666 → 714pt（§8.4 基线裁决，取读法 B）** —— 页眉/页脚 24pt 落在 64pt 边距**之内**、**不参与相加**，正文带 = `842 − 64×2 = 714pt`；§6 rect 改 `(0, i*714, 467, 714)`、正文可用高 714pt、`pages = ceil(H/714)`；§10.3 P2 判据 `ceil(H/714)`；§11 坑 19 补「取值由设计规格 §8 锚定」；（同步 ADR-003 §页面几何 / §Consequences / §已裁决与待办） | team-lead 终审裁决（阅读 B） |
