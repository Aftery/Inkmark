# Inkmark 多标签页 / 多文档技术架构方案

- Status: Proposed（待评审，本轮只出文档不动代码）
- Date: 2026-10-28
- Owner: architect
- 范围：单窗口内的多标签页 / 多文档（产品已锁定，见 §0.3）
- 事实源（本文所有断言的出处，括号内为文件:行号）：
  `frontend/src/App.vue`、`frontend/src/composables/{useEditorSession,useDocumentState,useFileOps,useOutline,useTableHint,useCommands,useShortcuts,useWorkspace,usePrefs,useDialog,useFileAssets}.js`、`frontend/src/editor/{createEditor,assetContext,assetUrl,wysiwyg}.js`、`frontend/src/components/{TitleBar,StatusBar}.vue`、`frontend/tests/{contracts,tdz-order}.test.mjs`、`app.go`、`main.go`、`snapshot.go`、`docassets.go`、`docs/architecture/ADR-005-dirty-semantics.md`
- API 实证源码：`frontend/node_modules/@codemirror/view/dist/index.js`（下称 view.js，版本 6.43.13）、`frontend/node_modules/@codemirror/state`（下称 state.js）
- **配套文档**：`docs/plan/multi-tab-test-plan.md`（QA 产出的验收标准 EARS + 测试计划）。两份文档的**合并口径见该文 §10**：测试文件清单以该文 §6.1 为唯一真源（`frontend/tests/` 由 QA 独占，见 `frontend/tests/README.md:4`），决策点映射以该文 §10.1 为准，**裁决后两处都要改**。本文不复制该文的清单，只给架构侧的责任与判据要求。

---

## 0. 结论摘要

### 0.1 一句话结论

**采纳「单 `EditorView` + 按标签切换 `EditorState`」**，会话注册表落在 `useEditorSession`，Go 侧 dirty 按 ADR-005 §四 升级为 `docKey → dirty` 映射，共分 **8 个可独立提交的阶段 + 1 个行为定稿闸门**（P0b 闸门不产出代码，但未过闸不得进 P1）。

### 0.2 与项目总监既有方向的复核结果

| 项目总监的方向 | 复核结论 | 依据 |
|---|---|---|
| 单 EditorView + 按 tab 换 EditorState | **采纳** | `EditorState` 内含 `history()` 撤销栈 / selection / `wysiwygField` / `tableRenderField`（均为模块级 StateField，值随 state 走，见 `wysiwyg.js:53-59`、`createEditor.js:132-138`）；本仓既有换文档路径就是 `replaceDocument` → `view.setState`（`createEditor.js:210-217`） |
| 每个 tab = 一份 `DocSession`（id/path/title/EditorState/dirty/saveState/saveTimer/lastSnapshotAt） | **采纳并补两个字段** | 补 `scrollTop`（不在 `EditorState` 里，切走必须手动存）与 `markdown`（预览防抖源，见 §3.2） |
| 关单个 tab = 前端弹层；关窗口 = Go `OnBeforeClose` 汇总 anyDirty | **采纳** | ADR-005 §五 的两条路径分工不变；聚合口径见 §6.3 |
| Go 侧 `dirty bool` → `map[docKey]bool`，`docDir` 保持单值 | **采纳**，`docDir` 单值成立的前提已核实 | `/doc-assets/` 只服务激活文档；切 tab 时 `assetContext.applyDocPath` 的 `SetDocDir` 镜像同步（`assetContext.js:52-66`），已有唯一同步点，无需新通道 |
| 风险：App.vue 150 行门禁 | **确认，且比预估更紧** | App.vue 当前总行数 **150**（`contracts.test.mjs:920-934` 口径），**余量为 0**；需净腾出 6 行，见 §4.11 |
| 风险：`useTableHint` 是模块级单例 | **确认** | `useTableHint.js:30` 是模块级 `ref`，`StatusBar.vue:57-59` 直接消费；切换时必须 clear + 重算，见 §5.2 |
| 风险：`openSeq` 竞态 | **确认，且语义要改** | 多标签下「后一次打开取代前一次」不再成立（两次打开应产生两个标签），见 §5.1 |
| 风险：滚动位置不在 EditorState 里 | **确认** | `view.setState` 会重建 `docView` 并新建 `ViewState`（view.js:8094-8124），滚动位置**归零**，必须手动存/恢复 |

### 0.3 范围硬边界（产品已锁定）

**必须包含**：标签栏（自绘 TitleBar 下方一行）、每标签独立的 dirty/error 标记、同路径幂等、拖拽重排、右键菜单、关闭后落点策略（`activate_on_close = history`，即回到上一个访问过的标签）、每标签独立记忆 selection + scrollTop、标签状态持久化。

**明确不含（进 Backlog，本方案不实现）**：分屏 / 并排 / 标签组 / 标签拖出成新窗口 / 插件化标签面板。

### 0.4 本方案给出的显式结论

1. **后台标签同样自动保存**（选项 a）。理由与代价见 §6.5，标注为**待 team-lead 拍板**（D1）。PM 已表态支持 (a)，并补充要求「状态栏必须显示**当前标签**的保存态」（见 §11 的 P2 判据）。
2. **不做「⌘1..9 直跳第 N 个标签」**。`⌘1..⌘6` 已被 `format.h1..h6` 占用、`⌘⌥0` 是 `format.body`（`useShortcuts.js:84-91`），改键要动既有肌肉记忆与 README 速查节两处门禁；`⌘⌥1..9` 虽空闲但与既有 `⌘⌥` 家族（`⌘⌥F` 替换 / `⌘⌥C` 代码块 / `⌘⌥↑↓` 标题升降）语义噪声大。改用 **MRU 顺序的 `⌘⌥→` / `⌘⌥←`** + Tab Switcher 浮层承担「精确选一个标签」，鼠标点标签作为兜底。见 §5.5。
3. **不绑定 `⌘W`**。`⌘W` 在 macOS 是「关闭窗口」的通用肌肉记忆，而 Inkmark 是单窗口应用；绑定它等于把「关标签」与「关窗口」绑成一件事。关闭标签用 **`⌘⌥W`**（空闲、无冲突）。是否改用 Zettlr 式 `⌘W`（关标签，无标签时关窗口，关窗口改 `⌘⇧W`）列为**待裁决项 D2**，本方案不自行拍板。
4. **「按住循环」必须用按下瞬间的 MRU 快照**（PM 缺口 1 的裁决，§4.10）。若按实时 MRU 循环，「每次激活把目标移到 MRU 头部」会让按住不放**只在最近两个标签之间抖动**，第三个标签永远轮不到。
5. **IME 合成中切标签 = P0**，机制选「**延迟切换**」（合成结束后再切），不是阻断式提示（会打断 CJK 用户的自然流程）、也不是 hack 强制提交（CM6 无公开 API）。已写进 §5.2 的**步骤 0**（守卫），并列为 §11 的 **P0b 闸门**第一项 —— 它会反过来改写 §5.2 的时序，故必须抢在 §5.2 定稿前验。
6. **关闭最后一个标签 → 应用保持运行 + 空状态，不退出**（PM 缺口 3 的裁决，§5.3）。「关掉这个文档」与「退出 Inkmark」是两件事。空状态只提供「新建文档」「打开文件」两个入口。

---

## 1. 现状基线：单文档假设清单

> 判据：下面每一条都能在括号里的文件:行号指到。凡本文后面引用「现状」，均指本表。

### 1.1 前端：状态所有权全部挂在单例上

| # | 假设 | 位置 | 证据 |
|---|---|---|---|
| F1 | 文档路径是**一个全局 ref**，不是每个文档一份 | `useEditorSession.js:77` | `const filePath = ref('')`；全仓唯一的路径真源 |
| F2 | 路径 ref 是**可写**的，写入点有三处 | `useFileOps.js:93`、`useDocumentState.js:213`、`useFileOps.js:166` | `filePath.value = path` / `= newPath`（另存为 / 改名） |
| F3 | 标题由路径派生，全局一份 | `useEditorSession.js:82` | `computed(() => filePath.value ? baseName(filePath.value) : t('common.untitled'))` |
| F4 | markdown 正文是**一个全局 ref**，预览与导出都从它渲染 | `useEditorSession.js:76,88,91` | `markdown = ref('')`；`previewHtml` / `exportHtml` 两个 computed 都读它 |
| F5 | caret（行列）是**一个全局 ref** | `useEditorSession.js:83,151-157` | `caret = ref({line:1,col:1})`，每次 update 覆写 |
| F6 | 预览防抖是**全局一套定时器** | `useEditorSession.js:112-147` | `previewTimer` / `pendingDoc` 是模块内单例，`cancelPendingPreview` 是唯一的丢弃口 |
| F7 | `dirty` 是**一个全局 ref**，语义 = 当前文档内存 ≠ 磁盘 | `useDocumentState.js:68` | `const dirty = ref(false)`；ADR-005 §一 |
| F8 | `saveState` 是**一个全局 ref** | `useDocumentState.js:63` | `const saveState = ref('unsaved')` |
| F9 | 自动保存定时器是**一个全局变量** | `useDocumentState.js:80,134-136` | `let saveTimer = null`；`markDirty` 里 `clearTimeout(saveTimer)` |
| F10 | 快照时钟是**一个全局变量** | `useDocumentState.js:86,185` | `let lastSnapshotAt = Date.now()`，`resetSession` 重置它 |
| F11 | `dirty → Go` 的镜像 watch 读的是**全局 dirty** | `useDocumentState.js:76-78` | `watch(dirty, d => SetDirty(d))` |
| F12 | 落盘后的「内容是否仍是最新」判定用**全局 filePath** 比对 | `useDocumentState.js:118` | `if (filePath.value === path && docText() !== written)` —— 这是 ADR-005 §三那条防丢稿判据的落点，多标签下必须按标签比对 |
| F13 | `switchFile()` 是**唯一的破坏性边界**，语义 = 「切走前先留快照」 | `useDocumentState.js:175-186` | `switchFile()` → `writeSnapshot(true)` → `resetSession()` |
| F14 | 「打开文件 / 新建 / 载入语法示例」三条路径都走 `switchFile()` | `useFileOps.js:125,140,145`、`useCommands.js:203` | 打开 = 丢弃当前文档，所以要先留底 |
| F15 | 打开文件的落点是**整份替换当前文档** | `useFileOps.js:90-95` | `loadDocument` = `replaceDocument` + `syncAfterDocReplace` + `filePath.value = path` + `docState.resetSession()` |
| F16 | `openSeq` 竞态守卫把「后一次打开」当「取代前一次」 | `useFileOps.js:101,109,118` | `if (seq !== openSeq) return` —— 直接丢弃先发起的读取结果 |
| F17 | 打开的路径判重只有「是不是当前文件」 | `useFileOps.js:139` | `if (path === filePath.value) return` |
| F18 | 表格提示是**模块级单例 ref** | `useTableHint.js:30` | `export const tableHint = ref(null)`；`StatusBar.vue:24,57` 直接 import 消费 |
| F19 | 表格提示在整份替换后**手工重算**（因为 setState 不触发 updateListener） | `useEditorSession.js:179` | `if (editorRef.value) checkTableHint(editorRef.value.state)` |
| F20 | 大纲数组是**一个全局 ref**，由 `editorRef.value.state.doc` 派生 | `App.vue:42,87-91` | `const outline = ref([])`；`refreshOutline` 读 `editorRef.value.state.doc` |
| F21 | 大纲度量缓存（`ysCache`）**不区分文档** | `useOutline.js:27-34,38-58` | `ysCache` / `ysDirty` 是模块内单例，只有 `invalidateMeasure()` 能让它失效 |
| F22 | 文档路径变化是**唯一的资源同步点**，且是 `flush:'sync'` | `useEditorSession.js:98-104` | `watch(filePath, p => applyDocPath(p, editorRef.value), { flush: 'sync' })` |
| F23 | `/doc-assets/` 的目录镜像是**单值** | `docassets.go:38-50` | `SetDocDir` 存 `filepath.Dir(docPath)`；`resolveDocAsset` 只读这一个目录 |
| F24 | 导出 / 打印用的 HTML 取的是**全局 exportHtml** | `useDocumentState.js:229,277`、`App.vue:118-120` | `buildHtmlDocument(title.value, renderedHtml.value, ...)` |
| F25 | 历史面板的文件路径是**全局 filePath** | `App.vue:128` | `<HistoryPanel :file-path="filePath" ...>` |
| F26 | 图片落盘的「当前文档路径」取自**全局 filePath** | `App.vue:58,80` | `useFileAssets({ getFilePath: () => filePath.value })`；`canSaveImage: () => Boolean(filePath.value)` |
| F27 | 文件夹（文件树根）是**窗口级单值**，与文档无关 | `useEditorSession.js:78`、`useFileOps.js:132` | `folderPath = ref('')`；`openFolder` 赋值 |
| F28 | 缩放是**窗口级偏好**，通过 Compartment 作用在 state 上 | `usePrefs.js:79-100`、`createEditor.js:179-187` | `zoomCompartment` 是模块级 Compartment；`setEditorZoom` dispatch 一个 reconfigure effect |
| F29 | 专注模式是**state 内的 StateField** | `createEditor.js:119,132-138` | `focusField` 的值随 `EditorState` 走 |
| F30 | `setWysiwyg` effect **全仓没有任何 dispatch 点** | `wysiwyg.js:51-59` | grep 全仓：仅定义处与 `docs/spec/phaseC-architecture.md` 提及，`wysiwygField` 恒为 `create: () => true` |
| F31 | 标题栏的脏标记是**当前文档**的 dirty | `App.vue:100`、`TitleBar.vue:46,226,172-178` | `:is-dirty="dirty"`；红点 `.tb-dirty` 用 `var(--danger)`；`CloseWindow(props.isDirty, getLocale())` |
| F32 | 关闭守卫的输入有两条路径，判定本体共用 | `app.go:92-105,338-371` | `CloseWindow(dirty, locale)` / `OnBeforeClose` → 共用 `confirmClose` |
| F33 | Go 侧 dirty 是**一个 bool** | `app.go:41,331-333` | `dirty bool`；`SetDirty(d bool)` |
| F34 | Go 侧 docKey 派生只此一份 | `snapshot.go:48-58` | `docKeyOf(absPath) = hex(sha1(filepath.Clean(absPath)))[:16]` |
| F35 | App.vue 是**纯装配层**，总行数硬上限 150 | `App.vue`（实测 150 行）、`contracts.test.mjs:920-934` | 口径 = `countTotalLines`（含注释空行） |
| F36 | 装配顺序是契约：`editorRef` 槽先于任何 composable 调用 | `App.vue:36`、`tdz-order.test.mjs:85-106` | 契约点名 11 个 composable 必须被解析到 |
| F37 | 命令处理器注册面只有 `useCommands.js` 一个文件 | `contracts.test.mjs:276` | `EVENT_SURFACE_FILES = ['src/composables/useCommands.js']` |
| F38 | 键位唯一真源是 `useShortcuts.js` 的 `COMMANDS` 表（62 条命令 / 50 项键位） | `useShortcuts.js:46-129`、`README.md:295` | 实测解析：命令 62、accel 50、accel 唯一 50 |
| F39 | `createEditor.js` 已在行数豁免名单里，有效行 **257 / 阈值 260** | `contracts.test.mjs:805-813` | 实测 `countEffectiveLines` = 257，**余量仅 3 行** |

### 1.2 结论：单文档假设集中在三处

1. **状态所有权**：F1–F11、F18–F21、F24–F26 —— 全部是「一份」。
2. **破坏性边界**：F13–F17 —— 「打开 = 丢弃当前」是当前架构的地基，多标签下这条地基要换成「打开 = 新增一个标签」。
3. **Go 镜像**：F23、F32–F34 —— 一个 bool + 一个目录。

---

## 2. 选型决策与取舍

### 2.1 三个候选方案

| | 方案 A：单 `EditorView` + 按标签换 `EditorState` | 方案 B：N 个 `EditorView` 实例（每标签一个） | 方案 C：每标签独立 DOM（自绘编辑器 / iframe） |
|---|---|---|---|
| 核心做法 | 一个 `EditorView`，每个标签持一份 `EditorState`，切换时 `view.setState(tab.state)` | 每个标签一个 `EditorView`，各自挂在自己的 `.editor-host` 上，切标签切 `display` | 每标签一套独立渲染栈，不复用 CM6 |
| 撤销栈 | 天然隔离（`history()` 是 StateField，值随 state 走） | 天然隔离（每 view 一份 state） | 需自研 |
| 内存 | 一份 view + N 份 state | N 份 view（各带完整 `DocView` + 各套 ViewPlugin 实例） | N 套渲染栈 |
| 与既有路径的关系 | 复用 `replaceDocument` → `setState` 的既成路径（`createEditor.js:210-217`） | 与既有路径分叉：换文档要决定改哪个 view | 完全另起 |
| 切标签代价 | 整棵重绘（与「打开文件」同量级），滚动需手动恢复 | 切 `display`，无重绘，但触发 CM6 隐藏态度量陷阱 | 未知 |

### 2.2 对比矩阵

评分口径：5 = 好，1 = 差。**「本仓适配度」权重最高**——本仓既有大量围绕「单 view + setState 换文档」建立的不变量。

| 维度 | 权重 | A：单 view 换 state | B：N 个 view 实例 | C：独立 DOM |
|---|---|---|---|---|
| 本仓适配度（复用 `replaceDocument`/`setState` 路径） | 高 | 5 | 2 | 1 |
| 内存占用 | 中 | 4 | 2 | 1 |
| 切标签延迟 | 中 | 3 | 5 | 3 |
| 撤销栈 / selection / 装饰隔离 | 高 | 5 | 5 | 2 |
| 派生状态同步复杂度（tableHint / outline / 预览 / 行列） | 高 | 3 | 2 | 1 |
| 图片资源链路（`/doc-assets/` 单目录） | 中 | 4 | 3 | 2 |
| 实现改动面 | 高 | 3 | 2 | 1 |
| 测试可写性（node:test 无头驱动） | 中 | 4 | 2 | 1 |
| **加权合计** | — | **35** | **21** | **12** |

### 2.3 结论：采纳 A

**A 的三个决定性优势**：

1. **派生状态只有一个来源**。本仓的「文档内容 → 界面派生」链路有五处：预览 markdown（`useEditorSession.js:88`）、行列（`:151-157`）、字数（`:109`）、表格提示（`useTableHint.js:38`）、大纲（`App.vue:87-91`）。A 方案下它们全部只需回答「当前 state 是哪个」，B 方案下每处都要回答「当前 view 是哪个 + 它是不是激活的」——五处各写一遍「是不是激活的判断」就是五个新的不一致源。
2. **与本仓唯一已验证的换文档路径同构**。`createEditor.js:198-209` 的注释写明了为什么用 `setState` 而不是 `dispatch`：CM6 对 `setState` 的说明正是「新状态并非派生自旧状态」这一场景，且规避 6.43.x 的 tile 增量崩溃（实测会抛 `TypeError: Cannot destructure property 'tile' of 'parents.pop(...)'`）。A 方案把这条已踩过坑的路径复用为「切标签」，而不是新开一条。
3. **`setState` 的插件重建语义正好帮我们省事**。view.js:8094-8124 显示 `setState` 会 `plugin.destroy()` → 新建 `PluginInstance` → 重新 `buildDecorations`。也就是说 wysiwyg 装饰、表格 widget、代码块行号插件在切标签后**自动按新文档重建**，不需要我们手工触发。

### 2.4 被否决方案的理由（逐条写明为什么否决）

**方案 B（N 个 `EditorView` 实例）—— 否决。**

1. **派生状态要写五遍「当前是哪个」**。上表「派生状态同步复杂度」给 2 分不是凭感觉：`useTableHint` 是模块级单例（`useTableHint.js:30`），`StatusBar` 直接 import 消费（`StatusBar.vue:24`）；B 方案下 N 个 view 各自更新同一个模块级 `tableHint`，「谁最后写的」就成了随机事件。A 方案下只有一个 view，天然单写者。
2. **隐藏态度量陷阱**。B 方案切标签必然要用 `display:none`（N 个 host 同时在 DOM 里），而本仓已经踩过这个坑并写进了方案文档（`docs/plan/focus-mode-architecture.md:46`）：CM6 在 `display:none` 期间 `coordsAtPos` / `posAtCoords` / `scrollDOM` 度量全部失真，离屏块高度缓存为 0，长文档会出现滚动高度错误。A 方案的 `setState` 不产生隐藏态，绕开了整个问题域。
3. **N 份 view = N 份插件与装饰**。每个 `EditorView` 都会创建 `wysiwygPlugin` / `tableRenderField` / `codeLinePlugin` / `codeCopyPlugin` / `focusPlugin` / `search` 等一整套 ViewPlugin 实例并各自持有装饰缓存。标签数不可控，内存与 GC 压力随标签数线性增长，而 A 方案只增加 `EditorState`（一份不可变快照 + 一个撤销栈）。
4. **与既有「打开文件」路径分叉**。`useFileOps.loadDocument`（`useFileOps.js:90-95`）今天是「整份替换当前文档」。B 方案下要额外决定「替换当前 view 的 state 还是新建一个 view」，路径一分为二，后续每个新功能都要在两条路径上各做一遍。

**方案 C（每标签独立 DOM / 自绘编辑器）—— 否决。**

1. **等于重写编辑器**。本仓的 WYSIWYG 装饰（`wysiwyg.js`，487 行）、表格真渲染（`tableRender.js` + `tableWidget.js` 500 行 + `tableDrag.js` + `tableFocus.js` + `tableHeight.js`）、代码块行号（`codeBlock.js`）、块级渲染（`wysiwygBlocks.js`）全部是 CM6 扩展，自绘等于全部重写。
2. **与「所见即所得」的产品定位正面冲突**。本仓的定位是 Typora 式单栏所见即所得（MEMORY.md「2026-10-06 单栏重构后的形态」），渲染发生在编辑器内（`editor/tableRender.js`）。自绘一套 DOM 会立刻分裂出「编辑器内一套 DOM + 自绘一套 DOM」两套渲染口径。
3. **本轮目标不匹配**。多标签页要解决的是「同时打开多份文档」，不是「换一套渲染架构」。选 C 会把一次会话管理特性变成一次渲染引擎重写。

### 2.5 选 A 必须付的三笔代价（本节即风险清单的前三条）

| 代价 | 说明 | 缓解 |
|---|---|---|
| 切标签 = 整棵重绘 | `setState` 重建 `docView`，与「打开文件」同量级 | 标签数少（写作工具通常 <10），可接受；实测见 §11 阶段验证 |
| 滚动位置归零 | view.js:8094-8124 的 `new ViewState(this, newState)` 不保留 scrollTop | 每个 session 存 `scrollTop`，切回时手动恢复（§5.2 步骤 8） |
| `EditorState` 里混着窗口级开关 | `zoomCompartment`（`createEditor.js:179`）与 `focusField`（`:132`）的值随 state 走 → 切标签后旧档位会「复活」 | 切回时把窗口级开关重放到新 state 上（§5.2 步骤 9） |

---

## 3. 数据模型：`DocSession`

### 3.1 接口定义

```ts
/**
 * DocSession —— 一个标签页对应的文档会话。
 *
 * 【不变量】
 *  I1. id 全局唯一、单调递增、创建后不变（它是 dirty 映射键的一部分）。
 *  I2. path 为绝对路径；未落盘文档为 ''。
 *  I3. state 是该文档**最新一次**的 EditorState；任何影响该文档的事务之后
 *      必须回写（否则切回时内容回退）。
 *  I4. dirty ⟺ 内存内容 ≠ 磁盘内容（ADR-005 §一，逐字不变）。
 *  I5. saveState 与 dirty 正交（ADR-005 §二）。
 *  I6. scrollTop 不在 EditorState 里，必须单独存。
 *  I7. saveTimer / lastSnapshotAt 是 per-session 的，不共享。
 */
interface DocSession {
  /** 会话内唯一标识，形如 "t3"。既是 React key，也是未落盘文档的键后缀。 */
  id: string

  /** 绝对路径；未落盘为 ''。同一路径在注册表内唯一（同路径幂等）。 */
  path: string

  /** 显示名：path 的最后一段；未落盘为 i18n 的「未命名」。 */
  title: string

  /** 该标签的编辑器状态：文档内容 + 撤销栈 + 光标 + 选区 + 装饰字段值。 */
  state: EditorState

  /** 滚动位置（px）。EditorState 不含它，切走时记下、切回时恢复。 */
  scrollTop: number

  /** 该标签的防抖预览源（markdown 原文）。切标签时立即同步，不走防抖。 */
  markdown: string

  /** ADR-005 §一：内存内容 ≠ 磁盘内容。 */
  dirty: boolean

  /** 'unsaved' | 'saving' | 'saved' | 'error'；与 dirty 正交。 */
  saveState: 'unsaved' | 'saving' | 'saved' | 'error'

  /** 自动保存防抖计时器句柄；该标签自己的。 */
  saveTimer: number | null

  /** 快照节流时钟；该标签自己的。 */
  lastSnapshotAt: number
}
```

### 3.2 字段语义与不变量（逐条）

| 字段 | 语义 | 不变量 / 理由 |
|---|---|---|
| `id` | 会话内唯一序号 | **不可变、不可复用**。它是 Go 侧 dirty 映射键的组成部分（未落盘文档的键 = `u:` + id），复用会导致旧键的脏状态泄漏到新文档 |
| `path` | 绝对路径 / 空串 | 空串 = 未落盘。**同一路径在注册表内最多一条**（同路径幂等，见 §5.1） |
| `title` | 标签显示名 | 由 `path` 派生；`path` 变化时（另存为 / 重命名）同步更新。**不是真源**，`path` 才是 |
| `state` | `EditorState` 快照 | 必须在每次影响该文档的事务后回写。`EditorState` 不可变，持有旧引用 = 内容回退 |
| `scrollTop` | 滚动位置 | `setState` 会归零（view.js:8094-8124），必须手动存/恢复。存的是 `view.scrollDOM.scrollTop`（`useOutline.js:81` 用的也是它） |
| `markdown` | 防抖预览源 | 与 `state.doc.toString()` 内容一致，但**更新时机不同**：编辑中走 120ms 防抖（`useEditorSession.js:29,121-130`），切标签时立即同步 |
| `dirty` | ADR-005 §一 | 逐字沿用。**不得**叠加第二种含义（如「有未提交的窗口布局」——ADR-005 §四 明文禁止） |
| `saveState` | 四态机 | 与 `dirty` 正交（ADR-005 §二）。`error` 态是标签栏上「异常标记」的来源之一 |
| `saveTimer` | 防抖句柄 | per-session。后台标签的定时器**继续跑**（§6.5 结论 a）；关闭标签时必须 `clearTimeout` |
| `lastSnapshotAt` | 快照节流时钟 | per-session。切标签**不重置**（多标签下「重置」会丢掉节流保护） |

### 3.3 文档身份与 Go 侧键口径

**身份（identity）** —— 前端给 Go 的**唯一**标识，Go 侧据此派生映射键：

```
identity = session.path !== '' ? session.path : `untitled:${session.id}`
```

**映射键（key）** —— Go 侧派生，前端**不实现 sha1**（沿用 `snapshot.go:48-55` 的纪律：绑定层只收身份串，两端各算一份会「写入目录 A、读取目录 B」）：

| 身份形态 | 映射键 | 依据 |
|---|---|---|
| 已落盘（绝对路径） | `docKeyOf(path)` = `hex(sha1(filepath.Clean(path)))[:16]` | 与 `snapshot.go:55-58` **逐字同一函数**，实现放在 `snapshot.go` 里被 `app.go` 复用，不新增第二份派生 |
| 未落盘（`untitled:<id>`） | `"u:" + id` | 独立命名空间。`u:` 前缀不可能与 16 位 hex 撞上（`docKeyOf` 输出恒为 `[0-9a-f]{16}`） |

**为什么未落盘文档需要独立命名空间**：它没有路径，`docKeyOf` 无输入；且**未落盘文档天然是一对一**（一个标签一份内容），用标签 id 天然唯一。

**为什么已落盘文档按 docKey 而不是按标签 id**：ADR-005 §四 明文要求「docKey 沿用 `snapshot.go` 的 `SnapshotDocKey` 派生规则」。代价是**同一路径不得开第二个标签**（否则两个标签共用一个键，映射退化）—— 这条已由产品锁定为架构约束（§0.3「同路径幂等」），本文 §5.1 落地。

---

## 4. 分层改造方案

### 4.1 分层总览

```
App.vue（装配层，总行数 ≤150）
 │
 ├─ usePrefs / useToast / useWorkspace / useOutline / useDialog      ← 基本不动
 │
 ├─ useEditorSession   【改】持有 EditorView + 会话注册表 + 派生状态
 │    └─ editor/createEditor.js  【改】抽出 buildExtensions()，供多份 EditorState 共用
 │
 ├─ useFileAssets       【改】注入 getFilePath 改为「激活标签的路径」（本来就是闭包，改动一行）
 │
 ├─ useDocumentState    【改】状态从全局 ref 改为 per-session 字段
 │
 ├─ useTabLifecycle     【新】关闭标签 / 关闭其他 / 关闭右侧 / 恢复已关闭标签
 │
 ├─ useFileOps          【改】「打开 = 开标签」，不再销毁当前文档
 │
 ├─ useCommands         【改】注册 5 条新命令
 │
 └─ 组件：TabBar.vue / TabSwitcher.vue / TabContextMenu.vue  【新】
```

**依赖方向（无环）**：`useEditorSession` 持有注册表 → `useDocumentState` 通过 `getActiveSession()` 读注册表 → `useTabLifecycle` 同时用两者 → `useFileOps` / `useCommands` 用 `useTabLifecycle`。

### 4.2 `frontend/src/editor/createEditor.js`（改）

**改什么**：把 `EditorState.create({ doc, extensions })` 里的 `extensions` 数组抽成可复用的构建函数，使 N 份 `EditorState` 能共用**同一份扩展定义**。

**为什么必须改**：`createEditor.js` 当前有效行 **257 / 豁免阈值 260**（`contracts.test.mjs:805-813`，实测余量 3 行），**加任何东西都会触顶**。而且扩展数组内联在函数体里（`createEditor.js:243-399`，157 行），不抽出来就没法在 `createEditor` 之外造第二份 state。

**怎么改**：新增 `frontend/src/editor/extensions.js`，导出：

```js
// extensions.js — 编辑器扩展清单的唯一真源（从 createEditor.js 抽出）
//
// 【为什么要抽出来】多标签页要造 N 份 EditorState，而扩展数组原先内联在
// createEditor 的函数体里（157 行）。抽出来后 N 份 state **共用同一份扩展实例**：
//   - history() / wysiwygField / tableRenderField / blockRangesField 都是
//     模块级 StateField，值随 state 走 → 每个标签一份撤销栈，天然隔离；
//   - 不必为每个标签重建一套扩展实例 → 避免 N 份插件定义漂移。
export function buildExtensions({ slashHost, onImageFile, onClipboardImage }) {
  return [
    highlightSpecialChars(),
    history(),
    slashCommandExtension(slashHost),
    listIndentExtension(),
    keymap.of([ /* …原样搬… */ ]),
    smartInputExtension(() => getPrefs()),
    EditorView.domEventHandlers(imageDropHandlers(onImageFile, onClipboardImage)),
    EditorView.domEventHandlers(taskToggleHandlers()),
    codeLinePlugin,
    codeCopyPlugin,
    markdown({ base: markdownLanguage, codeLanguages }),
    syntaxHighlighting(mdHighlight),
    search({ top: true }),
    EditorView.lineWrapping,
    EditorView.theme({ /* …原样搬… */ }),
    focusField,
    focusPlugin,
    wysiwygField,
    wysiwygPlugin,
    wysiwygAtomicRanges,
    tableRenderField,
    tableSelectionGuard,
    tableInputGate,
    tableScanKick(),
    blockRangesField,
    wysiwygBlocksField,
    blockScanKick(),
    zoomCompartment.of(EditorView.theme({ '&': { fontSize: 'calc(var(--text-base) * 1)' } })),
  ]
}

/** 造一份可独立存在的 EditorState（多标签页用） */
export function createEditorState({ doc, extensions, selection }) {
  return EditorState.create({ doc, extensions, selection })
}
```

`createEditor` 改为接受外部传入的 extensions：

```js
export function createEditor(parent, { doc = '', extensions, onScroll }) {
  // 两个 updateListener **不在这里**（见下方「2026-10-28 更正」）
  const state = EditorState.create({ doc, extensions })
  const view = new EditorView({ state, parent })
  // …scroll 监听原样…
  return view
}
```

**2026-10-28 更正：本节原写的「`updateListener` / `selectionListener` 留在 view 侧（不进 `buildExtensions`）」是错的，实装时已推翻。**

| 项 | 原（错误）判断 | 实际 |
|---|---|---|
| 两个监听器放哪 | 留在 `createEditor` 里，只装在 view 的**初始** state 上 | **必须进 `buildExtensions` 的扩展数组**，由每一份 state 自带 |
| 原判断的理由 | 「它们要回调**当前激活标签**，留在 view 侧更省」 | 该目标靠 `getActiveSession()` **闭包**达成，与「放不放进扩展数组」无关 —— 理由本身不成立 |

**为什么原写法是静默故障**：`activateSession` 用的是 `view.setState(target.state)`，而 `setState` **整体替换 state**，**扩展是 state 的一部分**（CM6 没有「view 级扩展」这层机制）。只装在初始 state 上的监听器，会在**第一次切标签后永久消失**：

- 切过去之后打字 → `onDocChange` 不再触发 → **不标脏、预览不更新、自动保存不启动**；
- **全程不报错**，测试若无专门判据也全绿。

**现在的形态**（`extensions.js:220-228` 创建、`:362` 进数组、`createEditor.js:86` 有注记）：`buildExtensions({ …, onDocChange, onUpdate })` 接这两个回调并建监听器放进数组，位置与搬家前的相对顺序一致（theme 之后、`focusField` 之前）。它们仍只回调「当前激活会话」（闭包 `getActiveSession()`），**不持有任何标签专属状态** —— 所以放进共享清单不会串档。

**守着它的判据**：`tab-activate.test.mjs` 的 `切标签 · 监听器必须活在每一份 state 里`。元测试已实做：把 `updateListener,` 从扩展数组移除（即模拟回退到旧写法）⇒ `not ok 2` 报红，sha256 还原一致。

> **这条更正的教训值得单独记**：**「扩展是不是 state 的一部分」这个事实决定了「监听器能不能只装在 view 上」。** 本仓此前所有换文档路径都是 `view.setState`（`replaceDocument`），也就是说 **P0 之后、P1 之前，单文档形态下这套「留在 view 侧」的写法是成立的**（没有第二次 `setState`）；一旦引入多标签，它立刻变成静默丢功能。**「当前成立」不等于「架构上成立」—— 一个只在单实例下成立的假设，会在第一个实例化的地方崩。**

**行数账**：`createEditor.js` 有效行从 257 降到约 105（157 行的 extensions 数组搬走），**豁免阈值 260 可以顺势下调**（棘轮只许降不许升，`contracts.test.mjs:903-918` 会守）。建议登记新阈值 **120**，并把 `extensions.js` 纳入常规 300 行门禁。

### 4.3 `frontend/src/composables/useEditorSession.js`（改）

**改什么**：从「持有单份文档状态」升级为「持有编辑器 + 会话注册表 + 由激活标签派生的界面状态」。

**新增/变更的 API**：

```js
export function useEditorSession({
  editorRef, onDocChange, onImageFile, onClipboardImage,
  typewriterOn, onOutlineRefresh, onEditorReady,
}) {
  // ---- 会话注册表 ----
  /** @type {import('vue').Ref<DocSession[]>} */
  const sessions = ref([])
  /** @type {import('vue').Ref<string|null>} */
  const activeId = ref(null)
  /** @type {import('vue').ComputedRef<DocSession|null>} */
  const activeSession = computed(() => sessions.value.find(s => s.id === activeId.value) || null)
  /** 供 useDocumentState 等下游按需取当前会话（不注入 reactive 对象本身，避免它们误写） */
  const getActiveSession = () => activeSession.value

  /** 按路径找会话；找不到返回 null（同路径幂等的判据） */
  function findByPath(path) {
    if (!path) return null
    return sessions.value.find(s => s.path === path) || null
  }

  /**
   * 新建一个会话（不激活）。
   * @param {{path: string, content: string, activate?: boolean}} opts
   * @returns {DocSession}
   */
  function createSession({ path, content }) {
    const id = nextSessionId()                  // "t1" / "t2" …，单调递增不复用
    const state = createEditorState({ doc: content, extensions })
    const s = {
      id,
      path,
      title: path ? baseName(path) : t('common.untitled'),
      state,
      scrollTop: 0,
      markdown: content,
      dirty: false,
      saveState: 'saved',
      saveTimer: null,
      lastSnapshotAt: Date.now(),
    }
    sessions.value = [...sessions.value, s]
    return s
  }

  /** 激活某个会话：把它的 EditorState 装进 view，并同步全部派生状态（见 §5.2） */
  async function activateSession(target) { /* …见 §5.2… */ }

  /** 移除一个会话（关闭标签用；调用方负责先做 dirty 确认） */
  function removeSession(id) { /* 从 sessions 里摘除；停掉其定时器由调用方负责 */ }

  /** 设置激活会话的路径（另存为 / 重命名） */
  function setActivePath(nextPath) { /* 同步 title；触发 filePath 变化 → applyDocPath */ }
```

**派生状态全部改为「由激活会话算出」**：

```js
  // 路径：激活会话的路径
  const filePath = computed(() => activeSession.value?.path ?? '')
  const title = computed(() => filePath.value ? baseName(filePath.value) : t('common.untitled'))
  // 正文：激活会话的防抖预览源
  const markdown = computed(() => activeSession.value?.markdown ?? '')
  const previewHtml = computed(() => render(renderer, markdown.value, { resolveAssets: true }))
  const exportHtml = computed(() => render(renderer, markdown.value, { mathOutput: 'mathml' }))
  const wordCount = computed(() => countWords(markdown.value))
```

**【不变量 · 唯一写入者】`filePath` 是只读派生值，任何路径变更只能走 `setActivePath(nextPath)`。**

- **为什么这条必须写成硬不变量**：多标签下 `filePath` 从「1 个写入点」变成「5 个触发场景」（打开 / 另存为 / 重命名 / 切 tab / 关 tab）。若各处直接赋值，就会出现「装饰已按新 tab 重算、路径还没翻」的错位 —— 图片地址指向错目录（QA 文档 R-9 / R-10 的同一根因）。
- 现实现有 **3 处**直接写 `filePath.value`（`useFileOps.js:93,166`、`useDocumentState.js:213`），全部收敛到 `setActivePath`。
- 切 tab / 关 tab **不直接写 `filePath`** —— 它们改 `activeId`，`filePath` 作为 computed 自动跟随（§5.2 步骤 6 的连锁）。
- 收敛后 `filePath` 只有一个**派生**来源（`activeSession.path`）与一个**写入**入口（`setActivePath`），不可能出现「两个写入者跳变」（同 `--zoom-scale` 的纪律，MEMORY 样式偏好第 6 条）。

**「关掉最后一个标签」的处理（MD-08）**：**保留一个空文档**，不进入「零标签」态。

- 因此 **`activeSession` 永不为 `null`**（注册表恒有 ≥1 条），上文所有 `?? ''` / `?? 0` 兜底**只是防御**，不是主路径 —— 这比「零标签 + 空状态组件」少一整条分支（无 `EmptyState.vue`、无 `enterEmptyState`、无「无激活会话」的派生状态表）。
- 关掉最后一个标签时，`closeTab` 把它替换成一个**未落盘、空内容**的 session（`path: ''`、`doc: ''`、`dirty: false` —— 与 MD-03 的口径一致），编辑器因此落到现状的空文档态。
- **代价（如实登记）**：用户看到的是「一个空白编辑器」，而不是带「新建 / 打开」两个按钮的引导页（PM 缺口 3 原本想要的形态，MD-08 裁掉了专用组件以保 App.vue 行数预算）。若将来要补这两个入口，作为独立小特性复用现状的 `file.new` / `file.open` 命令即可，**不得**为此挤占 App.vue 的行数预算（§4.11）。
    clearTableHint()
    onOutlineRefresh?.()
  }
```

- 兜底写法 `?? ''` / `?? 0` 保留（防御性，MD-08 下 `activeSession` 恒非空，但 `getActiveSession()` 在 `onMounted` 之前确实可能返回 `null` —— 见下）。
- **空文档态就是一个普通的未落盘 session**（`path: ''`、`doc: ''`），走完全相同的代码路径，不需要特殊分支。

**事务回写（不可省）**：扩展列表里的 `updateListener` 已经在每次 `docChanged` 时回调（`createEditor.js:232-234`），但 `selectionSet` 不触发它。多标签下**光标移动也必须回写 state**（否则切走再切回，光标回到旧位置）。因此在 `onEditorUpdate`（`useEditorSession.js:151-164`）里补一行：

```js
  function onEditorUpdate(u) {
    const s = getActiveSession()
    if (s) s.state = u.state          // ← 新增：光标/选区变化也要回写 state
    const pos = u.state.selection.main.head
    /* …原有 caret / checkTableHint / typewriter 逻辑不变… */
  }
```

`onDocChange` 回调（`useEditorSession.js:199`）也要回写：

```js
      onDocChange: (doc) => {
        const s = getActiveSession()
        if (s) s.state = editorRef.value.state   // ← 新增
        queuePreview(doc)
        onDocChange?.()
      },
```

**为什么必须回写**：`EditorState` 不可变。`view.state` 每次事务后都是新对象；注册表里若留着旧引用，切回标签时 `setState(旧 state)` 会让用户看到**旧内容**（静默回退，正是本仓最怕的形态）。

### 4.4 `frontend/src/composables/useDocumentState.js`（改）

**改什么**：把 `dirty` / `saveState` / `saveTimer` / `lastSnapshotAt` 四个全局量改为 per-session 字段；`switchFile()` 这个「破坏性边界」整体退役。

**签名变更**：

```js
/**
 * @param {Object}   deps
 * @param {Function} deps.getEditor       () => EditorView|null
 * @param {Function} deps.getActiveSession () => DocSession|null   ← 新增（替代 filePath / title 注入）
 * @param {import('vue').Ref<string>} deps.theme
 * @param {Function} deps.notify
 * @param {Function} deps.onDocReplaced   (content) => void
 */
export function useDocumentState({ getEditor, getActiveSession, theme, notify, onDocReplaced }) {
```

**对外暴露的 `dirty` / `saveState` 变为 computed**：

```js
  /** 激活标签的 dirty（ADR-005 §一，逐字沿用） */
  const dirty = computed(() => getActiveSession()?.dirty ?? false)
  /** 激活标签的保存态 */
  const saveState = computed(() => getActiveSession()?.saveState ?? 'saved')
```

**核心函数的改写**（语义逐条对应）：

| 现函数 | 改后 | 说明 |
|---|---|---|
| `markDirty()` | `markDirty()` | 改为写 `s.dirty = true; s.saveState = 'unsaved'`，定时器挂在 `s.saveTimer` 上；`s.path` 为空则不排定时器（无处可写，与现实现一致） |
| `autoSave()` | `autoSave(session)` | 落盘目标 = `session.path`；落盘后比对「是否仍是最新」时**必须按 session 比对**（现实现用全局 `filePath.value === path`，`useDocumentState.js:118`） |
| `writeSnapshot(force)` | `writeSnapshot(session, force)` | 快照路径 = `session.path`；内容 = `session.state.doc.toString()` |
| `maybeSnapshot()` | `maybeSnapshot()` | 用 `s.lastSnapshotAt` 判断节流 |
| `switchFile()` | **删除** | 多标签下「切走 = 丢弃」不再成立。取而代之的是 `beforeDiscard(session)`（写快照留底），只在**关闭标签**时调用 |
| `resetSession()` | **删除** | 职责并入 `createSession()`（新建会话时初始化 dirty/saveState/计时器） |
| `saveFile()` / `saveFileAs()` | 改为对激活会话操作 | `saveFileAs` 成功后调 `setActivePath(path)`（不再直接写 `filePath.value`） |
| `restoreSnapshot(s)` | 改为对激活会话操作 | `replaceDocument(getEditor(), content)` 后 `onDocReplaced?.(content)` 再 `markDirty()`（ADR-005 §三 的「恢复快照要标脏」不变） |
| `exportHtml()` / `exportPdf()` | 不变，但取的是激活会话的 title / renderedHtml | `renderedHtml` 注入源改成激活会话的 `exportHtml` |
| `loadSnapshots()` / `snapshotNow()` | 不变，路径取激活会话 | |

**自动保存的「内容是否仍是最新」判据（关键，不许简化）**：

```js
  async function writeAndSettle(session, path) {
    const written = session.state.doc.toString()
    await WriteFile(path, written)
    // 判据按 session 比对：写盘期间用户可能又改了**别的标签**，
    // 但只有「本标签的内容变了」才影响本标签的 dirty。
    if (session.path === path && session.state.doc.toString() !== written) {
      session.dirty = true
      session.saveState = 'unsaved'
    } else {
      session.dirty = false
      session.saveState = 'saved'
    }
    return true
  }
```

### 4.5 `frontend/src/composables/useTabLifecycle.js`（新）

**职责**：标签的生命周期编排 —— 关闭 / 关闭其他 / 关闭右侧 / 恢复已关闭标签 / 关闭后的落点选择。它是唯一持有「关闭一个标签要做什么」的完整序列的地方。

```js
/**
 * useTabLifecycle — 标签页生命周期（关闭 / 落点 / 恢复）
 * ---------------------------------------------------------------------------
 * 【为什么单独成模块】关闭一个标签要串四件事，缺一件就是一次静默丢稿：
 *   ① 该标签脏 → 先写快照留底（此刻内容还在内存里，错过就永远写不回去）
 *   ② 该标签脏 → 弹确认（保存 / 不保存 / 取消）
 *   ③ 停掉该标签的自动保存定时器
 *   ④ 决定关闭后激活谁（history 策略：上一个访问过的标签）
 * 这四件事横跨 useEditorSession（会话注册表）与 useDocumentState（持久化），
 * 放哪一边都会让另一边反向依赖。故独立成第三层，两边都只被它调用。
 */
export function useTabLifecycle({ session, docState, confirmDiscard, notify }) {
  /**
   * confirmDiscard 由装配层注入：打开 ConfirmDialog.vue 并 resolve 出
   * 'save' | 'discard' | 'cancel'。**不用 Go 的 runtime.MessageDialog** ——
   * 那是系统级对话框，用于「关窗口」；「关标签」是应用内操作（理由见 §5.4）。
   */
  /** 已关闭标签的栈（供「恢复已关闭标签」用）；
   *  元素 = { path, title, content, scrollTop, selection }
   *  【为什么连位置一起存】AC-62（PM/QA 均要求）：恢复出来的标签若回到文档开头，
   *  用户还得再滚回去 —— Sublime 社区的已知差评形态。DocSession 已经存了
   *  scrollTop（§3.2 的 I6），closedStack 复用同一份位置数据，成本极低。 */
  const closedStack = ref([])

  /**
   * 关闭一个标签。
   * @param {string} id 目标标签 id
   * @returns {Promise<boolean>} true = 已关闭；false = 用户取消
   */
  async function closeTab(id) {
    const s = session.sessions.value.find(x => x.id === id)
    if (!s) return false

    // ① 脏 → 先留底（与现有 switchFile 同一口径：宁多留一份，不静默丢稿）
    if (s.dirty) await docState.writeSnapshot(s, true)

    // ② 脏 → 问用户。三选一：保存 / 不保存 / 取消
    if (s.dirty) {
      const choice = await confirmDiscard(s)
      if (choice === 'cancel') return false
      if (choice === 'save') {
        const ok = await docState.saveSession(s)   // 未落盘则走另存为对话框
        if (!ok) return false                       // 保存失败 → 不关闭
      }
      if (choice === 'discard') closedStack.value = [...closedStack.value, snapshotOf(s)]
    }

    // ③ 停掉该标签的自动保存定时器
    clearTimeout(s.saveTimer)
    s.saveTimer = null

    // ④ 落点：history 策略 —— 激活「上一个访问过的标签」
    const next = pickLandingSession(id)
    if (session.activeId.value === id) {
      if (next) await session.activateSession(next)
      else await session.activateSession(session.createSession({ path: '', content: '' }))
    }
    session.removeSession(id)
    return true
  }
}
```

**落点策略（`activate_on_close = history`，MD-09）**：

```js
  /**
   * 关闭后激活谁 —— Zed 的 activate_on_close = history（MD-09）：
   * 回到「上一个访问过的标签」，而不是「左边那个」。
   * 实现：维护一条 MRU（最近访问顺序）栈，关闭时取栈里第一个「仍在注册表内且不是被关的那个」。
   *
   * 【MD-14 的回退规则】history 无候选时（只剩一个标签、或 MRU 里没有别的了）
   * → 回退到「显示序里的第一个剩余标签」。
   * 三档策略（history / neighbour / left_neighbour）**统一回退到 history** ——
   * 拒绝 neighbour 的两级回退（有右邻取右邻、否则取左邻）：它创造了一个
   * **等价变异** —— history 与 neighbour 在「切走顺序 == 排列顺序」时行为完全相同，
   * 落点判据会假绿（两种实现都过，测不出真实差异）。
   */
  function pickLandingSession(closedId) {
    for (const id of session.mru.value) {
      if (id === closedId) continue
      const s = session.sessions.value.find(x => x.id === id)
      if (s) return s
    }
    // MD-14 回退：history 无候选 → 显示序里的第一个剩余标签
    return session.sessions.value.find(s => s.id !== closedId) || null
  }
```

**MRU（最近访问顺序）**：`useEditorSession` 维护 `mru = ref([])`（标签 id 数组，最近在前）。每次激活把目标移到头部。`Tab Switcher` 浮层按这个顺序渲染，但**「按住循环」走的是按下瞬间的快照**（§4.10，MD-10）—— 两者不可混。

### 4.6 `frontend/src/composables/useFileOps.js`（改）

**改什么**：「打开文件」从「替换当前文档」改成「开一个标签」。

```js
  /**
   * 打开 / 切换文件的唯一落点（多标签版）：
   *   - 路径已在某个标签里 → **切到那个标签**（同路径幂等，不新建）
   *   - 否则 → 新建一个标签并激活
   * 【为什么幂等是架构约束而不是 UX 偏好】
   *   两个标签共享同一 docKey 就会共享 dirty 映射键，映射退化，
   *   ADR-005 的「dirty 单义不变量」被破坏（见 §3.3）。
   */
  async function openPath(path) {
    const existing = session.findByPath(path)
    if (existing) {
      await session.activateSession(existing)
      return existing
    }
    const seq = ++openSeq
    let content
    try {
      content = await ReadFile(path)
    } catch (err) {
      showToast(t('toast.openFailed', { error: err?.message || err }), true)
      return null
    }
    // 竞态守卫语义变了：多标签下**不丢弃**先发起的结果（那是另一个标签），
    // 只在「它不是最新一次请求」时**不抢焦点**（用户的最新意图是后一次）。
    const s = session.createSession({ path, content })
    if (seq === openSeq) await session.activateSession(s)
    return s
  }
```

**`openSeq` 语义变更（必须写清）**：现实现（`useFileOps.js:101,118`）在序号过期时**直接丢弃读取结果**——单文档下这是必须的（否则「点 A 再点 B，编辑器里是 A、标题却是 B」）。多标签下丢弃 = **用户点的 A 永远打不开**，是功能缺失。故改为：结果照常建标签，只是不抢焦点。

**其余改动**：

- `openFile()`：去掉 `await docState.switchFile()`（不再有破坏性边界），直接 `await openPath(path)`。
- `openTreeFile(path)`：改成「先按路径找已有标签 → 有则切、无则开」；**去掉** `if (path === filePath.value) return` 这条单文档判重（改由 `findByPath` 承担）。
- `newFile()`：改为「新建一个未落盘标签并激活」（`path: ''`）。`⌘N` 的语义从「新建并替换当前文档」变为「新建一个标签」——**这是用户可见的行为变化**，必须在 README 与目视清单里登记。
- `renameFile()`：`filePath.value = newPath` → `session.setActivePath(newPath)`；同时要把 Go 侧 dirty 键从旧路径迁到新路径（§6.2）。
- `loadDocument(content, path)`：这是「整份替换当前文档」的落点，多标签下**只用于「语法示例」这类明确要替换当前内容的场景**；`useCommands.js:202-206` 的 `loadSyntaxSample` 改为**在新标签里打开**（不破坏当前内容）。

### 4.7 `frontend/src/composables/useTableHint.js`（小改）

**改什么**：`checkTableHint(state)` 已经接受任意 state（`useTableHint.js:38`），**无需改签名**。需要改的是调用时机：

- 切标签时：`clearTableHint()` → `checkTableHint(view.state)`（先清后算，避免旧标签的提示闪一帧）。
- 原因：`setState` **不触发 updateListener**（`createEditor.js:206-209` 注释已写明），所以 `checkTableHint` 不会被自动调用；这与 `syncAfterDocReplace` 里手工补算（`useEditorSession.js:179`）是同一个道理。

**建议**：把「clear → 重算」抽成 `useTableHint.js` 的一个新导出，避免两处各写一遍：

```js
/** 切换文档时重置提示：先清空（避免旧文档提示闪一帧），再按新 state 重算 */
export function resetTableHint(state) {
  tableHint.value = null
  if (state) checkTableHint(state)
}
```

### 4.8 `frontend/src/composables/useOutline.js`（小改）

**改什么**：`ysCache` / `ysDirty` 是模块级单例（`useOutline.js:27-34`），缓存的是**当前文档**的标题 y 坐标。切标签必须让缓存失效。

- `invalidateMeasure()` 已存在且正是这个用途（`useOutline.js:32-34`），切标签时调用它即可，**无需改这个模块的 API**。
- 大纲数组本身（`App.vue:42`）由 `refreshOutline()`（`App.vue:87-91`）从 `editorRef.value.state.doc` 重算 → 切标签时调用一次即可。
- 结论：**本模块零改动**，只需在切换时序里正确调用两个既有函数。

### 4.9 `frontend/src/components/TabBar.vue`（新）

**位置**：`.main` 之上、`<TitleBar>` 之下，即自绘标题栏正下方一行（§0.3「自绘 TitleBar 下方一行」）。

**结构**：

```
┌──────────────────────────────────────────────────────────────┐
│  TitleBar（菜单 / 文件名 / 脏点 / 窗口按钮）                    │
├──────────────────────────────────────────────────────────────┤
│  [文档 A ●] [文档 B] [文档 C ×]              ← TabBar         │
├──────────────────────────────────────────────────────────────┤
│  侧栏 │        编辑区                                          │
```

**Props / Events**：

```js
const props = defineProps({
  sessions: { type: Array, required: true },   // DocSession[]（只读渲染用）
  activeId: { type: String, default: '' },
})
const emit = defineEmits(['select', 'close', 'reorder', 'context'])
```

**每个标签的视觉标记（MD-04 的裁决：两个维度 + 单一优先级，互斥、同一时刻只显示一个）**：

| 维度 | 取值 | 判据 | 形态 | 用的 token |
|---|---|---|---|---|
| 落盘状态 | **未落盘** | `path === ''` | `AppIcon name="circle-dot"` | `color: var(--warn)` |
| 保存健康度 | **error** | `saveState === 'error'` | `AppIcon name="circle-dot"` | `color: var(--danger)` |
| 保存健康度 | **dirty** | `dirty && saveState !== 'error'` | 5px 实心圆点，**低调、不抢焦点** | `background: var(--meta)` |
| — | 干净 | 以上都不满足 | 无标记 | — |

**优先级（MD-04）**：**error > 未落盘 > dirty**，**互斥 —— 同一时刻只显示一个**。

- 也就是说：一个**未落盘且保存失败**的标签只显示 `--danger`（error 优先），不再叠加 `--warn` 的图标。
- 每个标签根元素带 `data-state="clean|dirty|unsaved|error"`（**非颜色信道**，WCAG 1.4.1），标记元素带 `aria-label`（走 i18n）。**颜色不得是唯一信道**。

- `circle-dot` 是**既有图标**（`frontend/src/components/icons/paths.js`，白名单内，Lucide 几何），不是新图标、不是字符符号、不是 emoji（满足 P0-1 与 ADR-001）。
- **dirty 用 CSS 圆点而非图标**，是为了与 `StatusBar.vue` 的保存态三态（图标形状 + 文案 + 颜色，`StatusBar.vue:42-47`）区分开：标签栏只给「形状 + 颜色」两重表达，文案走 `title` / `aria-label`。
- **必须同时有非颜色信号**（WCAG 1.4.1「不能只靠颜色传达信息」）：每个标签根元素带 `data-state="clean|dirty|unsaved|error"`，标记元素带 `aria-label`（走 i18n）。理由：`--meta` 与 `--danger` 的**对比度倍数只有 1.6~1.8 倍**（QA 文档 §3.13 实算：浅色 3.11:1 vs 5.55:1、深色 3.66:1 vs 6.06:1）—— **「对比度差 N 倍」不能当判据**，故 AC-72 强制要求语义信号。
- **为什么 dirty 用 `--meta` 而不是 `--muted`**（MD-04 的裁决，实测依据见 MD 文件 §2）：`--muted` 是「弱化文字」token，要承载 12px 菜单文字；`--meta` 是「元数据 / 三级前景」。**实测对比度（各自对 `--surface`）**：`--meta` 三主题为 3.11:1 / 3.66:1 / 3.07:1，`--muted` 三主题为 4.78:1 / 5.70:1 / 4.83:1 —— **`--muted` 三主题均比 `--meta` 更强**，即「降级用 `--muted`」**不构成降级**（`--muted` ÷ `--danger` = 0.86~0.94×，几乎一样强）。`--meta` ÷ `--danger` = 0.55~0.60×，才是真正的「明显更弱」。零新增色值。
- **教训（写进本文以免复发）**：涉及视觉「强弱」的裁决，**先查 token 的实际对比度，不要凭 token 名字的字面意思**。本次裁决正是「降级反被降级」的形态 —— 由 PM 在一致性检查中用实算数据推翻，team-lead 复核后改判（MD 文件 §2 的留痕）。
- 三态用**不同形态 + 不同颜色 + 不同 `data-state`** 三重区分，灰度/色盲下仍可区分。
- `error` 与 `dirty` **不同时出现**（error 优先），避免一个标签上两个标记互相干扰。
- **标题栏现有的红点**（`TitleBar.vue:360-366`，`var(--danger)`）**须一并降为 `var(--meta)`** —— MD-04 同时约束标题栏与标签栏（两处 chrome 统一），异常态才用 `var(--danger)`。此项属**既有视觉契约变更**，须进目视验收。

**打印**：标签栏是 chrome，打印时必须隐藏。App.vue 的 `@media print` 块（`App.vue:146-149`）要加 `.tab-bar`；同时建议把 `'tab-bar'` 加进契约 3 的 chrome 清单（`contracts.test.mjs:552`，现为 `['statusbar', 'history-panel']`）——**门禁加强，必须按 §9.4 做元测试**。

**拖拽重排**（§0.3 必含）：

- 用原生 HTML5 拖放（`draggable="true"` + `dragstart` / `dragover` / `drop` / `dragend`），不引第三方依赖（ADR-001 的「零新增依赖」取向）。
- 拖动中只改**注册表的顺序数组**，不改 `id`、不改 `path`、不动 `state`。
- 顺序即显示顺序 → 落盘策略（§5.6）以它为准。

**右键菜单**（§0.3 必含）：新建 `frontend/src/components/TabContextMenu.vue`，条目：

| 条目 | 行为 |
|---|---|
| 关闭 | `closeTab(id)` |
| 关闭其他 | 关闭除该标签外的全部（逐个走 `closeTab`，各自弹确认） |
| 关闭右侧 | 关闭该标签右侧的全部 |

- 不含「拖出成新窗口」（§0.3 明确排除）。
- 菜单外观复用既有弹层口径：`--dialog-width-sm`、`--radius-md`、`--elev-raised`、`--surface`、`--border`（`design-tokens.css` 的 token，禁止硬编码颜色值）。

### 4.10 `frontend/src/components/TabSwitcher.vue`（新）

**形态**（Zed 式）：按住 `⌘⌥→` / `⌘⌥←` 时浮出，按 **MRU 顺序**列出标签，最近使用在上；松开即确认当前高亮项。

**【必须用「按下瞬间的 MRU 快照」——这是 PM 缺口 1 的裁决，2026-10-28】**

**为什么不能实时重排 MRU**：§4.5 规定「每次激活把目标移到 MRU 头部」，而 §4.10 若也按实时 MRU 循环，两者会互相打架。设 MRU = `[C, B, A]`（C 最近用），用户按住 `⌘⌥→`：

```
keydown 1 → 切到 B → 激活把 B 移到头部 → MRU 变成 [B, C, A]
keydown 2 → 按新 MRU 取下一个 → 切到 C → MRU 变成 [C, B, A]
keydown 3 → 又切回 B → MRU 变成 [B, C, A]
```

**A 永远轮不到，按住不放只在 B 和 C 之间来回抖** —— 「按住循环」退化成「在最近两个标签之间抖动」。

**正确语义（Sublime `Ctrl+Tab` / Zed Tab Switcher 的共同行为）**：

| 概念 | 取值时机 | 作用范围 |
|---|---|---|
| **MRU 快照** | **首次 keydown 的那一瞬间**冻结 | 这一次按住期间的所有 keydown **只在快照内**循环遍历 |
| **实时 MRU** | 每次**独立**的按下（新的 keydown→keyup 周期）重新取 | 决定「下一次按下的起点」 |

两次独立按住之间回到「上上个文件」是**正确的 MRU 语义**（Sublime 就是这样）；**一次按住之内**必须是完整遍历 —— 两者不可混。

**实现口径**：

```js
// TabSwitcher 侧持有
let snapshot = null      // 本次按住开始时的 MRU 快照（标签 id 数组）
let cursor = 0           // 快照内的游标

function beginCycle(direction) {
  if (snapshot === null) {
    // 【关键】快照取自「实时 MRU」的一次拷贝，之后不再随激活重排
    snapshot = [...session.mru.value]        // 浅拷贝；此后不读 mru.value
    cursor = direction > 0 ? 0 : snapshot.length - 1
  }
  cursor = (cursor + direction + snapshot.length) % snapshot.length
  const targetId = snapshot[cursor]
  activateSession(targetId)                  // 激活会重排实时 MRU，但快照不受影响
}
```

- **降级路径必须用同一份快照**：浮层渲染失败时，`beginCycle` 仍然在快照内循环 —— 否则「浮层坏了」会把「遍历」退化成「抖动」，降级反而更糟。
- **快照在 keyup 或下一次独立按下时释放**：`snapshot = null`。若 keyup 丢失（OS 吞掉 / 焦点离开），下一次**独立**按下应被识别为新周期 —— 判据是「距上次 keydown 超过一个阈值（如 400ms）或收到 keyup」；超时未收到 keyup 时按新周期处理（此时上次的落点已在实时 MRU 头部，取新快照即得到「上上个文件」，语义正确）。
- **落点策略不受影响**：`pickLandingSession`（§4.5）用的就是**实时 MRU** 栈本身，那条没问题 —— **只有「按住循环」这条路径需要快照**。

### 4.11 `frontend/src/App.vue`（改：行数预算）

**硬约束**：总行数 ≤ 150（`contracts.test.mjs:920-934`），**当前实测 150，余量为 0**。

**新增的行**：

| 新增 | 行数 |
|---|---|
| `import { useTabLifecycle } from './composables/useTabLifecycle'` | 1 |
| `import TabBar from './components/TabBar.vue'` | 1 |
| `import TabSwitcher from './components/TabSwitcher.vue'` | 1 |
| `const tabs = useTabLifecycle({ session, docState, confirmDiscard, notify: showToast })` | 1 |
| 模板 `<TabBar … />` + `<TabSwitcher … />` | 2 |
| **合计** | **6** |

**必须净腾出 ≥ 6 行**。可选来源（按推荐度排序）：

| 来源 | 省行数 | 代价 |
|---|---|---|
| (a) `if (import.meta.env.DEV) { window.__inkmarkOps = … }` 块（`App.vue:71-73`）下沉到 `composables/devHooks.js` | 2 | **需同步改 `tdz-order.test.mjs`**：其变异脚本 `moveDevBlockBeforeFileOps`（`tdz-order.test.mjs:59-83`）按「块内容含 openFile」定位 DEV 块，块移走后定位失败 → 变异自证用例报错。必须重写该脚本的锚点 |
| (b) `useEditorSession({...})` 调用点的两条行内注释（`App.vue:50,52`）上移到该模块头注 | 2 | 无行为影响（注释搬家） |
| (c) `useOutline({...})` 调用压成 1 行（`App.vue:43-45` → 1 行） | 2 | 无行为影响 |
| (d) `useFileOps({...})` 调用压成 2 行 | 2 | 无行为影响 |

**推荐组合**：(b) + (c) + (d) = **6 行，零门禁改动**。(a) 收益相同但要改门禁，留作后备。

**装配顺序契约**：`tdz-order.test.mjs:96-99` 点名了 11 个 composable 必须被解析到。新增 `useTabLifecycle` 后，**必须**把它加进那个名单，否则删掉调用该测试也不报红（假绿灯）。同时 `tdz-order.test.mjs:242-269` 的「第三类 TDZ」规则要求：传给 composable 的惰性 getter 捕获的变量，声明行必须早于调用行 → `useTabLifecycle` 必须放在 `session` 与 `docState` 之后。

### 4.12 `frontend/src/composables/useCommands.js` 与 `useShortcuts.js`（改）

**新增 5 条命令**（键位真源 = `useShortcuts.js` 的 `COMMANDS` 表，`main.go` 一行不动）：

| id | group | accel | 说明 | 与现有 50 项键位是否冲突 |
|---|---|---|---|---|
| `file.newTab` | file | `⌘T` | 新建一个空白标签页 | 不冲突（空闲；Chrome/Obsidian/VS Code/Sublime/Zed 惯例一致） |
| `file.reopenClosedTab` | file | `⌘⇧T` | 恢复刚关闭的标签页 | 不冲突（空闲；Chrome 惯例） |
| `file.closeTab` | file | `⌘⌥W` | 关闭当前标签页 | 不冲突（空闲；**不用 `⌘W`，见 §0.4-3**） |
| `view.nextTab` | view | `⌘⌥→` | 切到 MRU 顺序的下一个标签（按住 = Tab Switcher 循环） | 不冲突（空闲） |
| `view.prevTab` | view | `⌘⌥←` | 切到 MRU 顺序的上一个标签 | 不冲突（空闲） |

**核对方式**：`⌘1..⌘6` 已被 `format.h1..h6` 占用、`⌘⌥0` 是 `format.body`（`useShortcuts.js:84-91`），故**不做数字直跳**（§0.4-2）。`⌃⇥` 在 COMMANDS 表里虽空闲，但 macOS 系统占用它做「切换窗口」，不可用。

**登记到 `COMMANDS` 表的写法**（示例）：

```js
  // ---- 文件 ----
  { id: 'file.newTab', group: 'file', labelKey: 'menu.newTab', accel: '⌘T', descKey: 'shortcuts.newTab' },
  { id: 'file.reopenClosedTab', group: 'file', labelKey: 'menu.reopenTab', accel: '⌘⇧T', descKey: null },
  { id: 'file.closeTab', group: 'file', labelKey: 'menu.closeTab', accel: '⌘⌥W', descKey: 'shortcuts.closeTab' },
  // ---- 视图 ----
  { id: 'view.nextTab', group: 'view', labelKey: 'menu.nextTab', accel: '⌘⌥→', descKey: 'shortcuts.nextTab' },
  { id: 'view.prevTab', group: 'view', labelKey: 'menu.prevTab', accel: '⌘⌥←', descKey: null },
```

**连带要改的地方（门禁会查）**：

1. `useCommands.js` 的 `registerCommands()`（`useCommands.js:210-291`）必须注册这 5 条，否则契约 1 报红（`contracts.test.mjs:312-320`）。
2. `README.md` 的「快捷键」节必须加 5 行（`verify-shortcuts.mjs` 三方比对）。
3. `README.md:295` 的「**62 条命令 / 50 项键位**」→ 改「**67 条命令 / 55 项键位**」。
4. `README.md:199` 的「useCommands（62 条命令处理器…）」→ 67。
5. 三语 i18n 字典（`zh-CN.js` / `en-US.js` / `ja-JP.js`）必须补齐新增的 `menu.*` / `shortcuts.*` key —— i18n 契约要求三份 key 集合**完全一致**（`zh-CN.js:1-12` 的头注），漏补当场报红。
6. `scan-i18n-residue.mjs` 会扫新建的 `.vue` / `.js` 里的用户可见文案 → TabBar / TabSwitcher / TabContextMenu 的所有文案必须走 `t()`。

### 4.13 Go 侧（改）

#### `app.go`

```go
type App struct {
	ctx context.Context
	// dirty 升级为按文档键的映射（ADR-005 §四）：
	//   key = docKeyOf(absPath)          —— 已落盘文档，与 snapshot.go 同一派生
	//   key = "u:" + <tabId>             —— 未落盘文档，独立命名空间（与 hex docKey 不相交）
	// value = 该文档「内存内容 ≠ 磁盘内容」
	// 真源仍在前端；Go 只镜像、不推断、不读盘比对（ADR-005 §五 不变）。
	dirtyByDoc map[string]bool
	// closing 防止关闭流程中重复弹确认框（语义不变）
	closing bool
	// docDir 仍是单值：/doc-assets/ 只服务**激活**文档，切标签时由
	// 前端 assetContext.applyDocPath 同步（见 docassets.go 文件头）
	docDir atomic.Value
	...
}
```

```go
// SetDirty 镜像某文档的「内存内容 ≠ 磁盘内容」。
//
// 【键口径】docIdentity 是文档身份，前端给出、Go 派生映射键：
//   - 已落盘：绝对路径 → 键 = docKeyOf(docPath)（与 snapshot.go 同一函数，不新增第二份派生）
//   - 未落盘："untitled:<id>" → 键 = "u:" + <id>
// 前端不实现 sha1（绑定层只收身份串；两端各算一份会「写入目录 A、读取目录 B」，
// 见 snapshot.go:48-55 的既有裁决）。
func (a *App) SetDirty(docIdentity string, d bool) {
	if a.dirtyByDoc == nil {
		a.dirtyByDoc = make(map[string]bool)
	}
	a.dirtyByDoc[dirtyKeyOf(docIdentity)] = d
}

// dirtyKeyOf 是 dirty 映射的**唯一**键派生（两处调用：SetDirty / ForgetDoc）。
func dirtyKeyOf(docIdentity string) string {
	if strings.HasPrefix(docIdentity, untitledIdentityPrefix) {
		// 未落盘文档没有路径可派生；用独立命名空间，与 docKey（16 位 hex）不相交
		return "u:" + strings.TrimPrefix(docIdentity, untitledIdentityPrefix)
	}
	return docKeyOf(docIdentity)
}
```

> `untitledIdentityPrefix = "untitled:"` 是前后端共用的协议常量（前端在 `useEditorSession` 里生成身份时用它）。**协议常量只能有一份定义**（Go 侧定义，前端照抄并在注释里指向 Go 的常量行号），否则又是一处「两边各写一份」的沉默不一致。

```go
// ForgetDoc 在文档关闭时清掉它的映射条目（避免注册表无限增长）。
func (a *App) ForgetDoc(docIdentity string) {
	delete(a.dirtyByDoc, dirtyKeyOf(docIdentity))
}

// anyDirty 汇总：任一已打开文档脏则真（ADR-005 §四：OnBeforeClose 遍历所有已打开文档）
func (a *App) anyDirty() bool {
	for _, d := range a.dirtyByDoc {
		if d {
			return true
		}
	}
	return false
}
```

`OnBeforeClose` 与 `CloseWindow`：

```go
// OnBeforeClose 在窗口关闭前由 Wails 调用，返回 true 阻止关闭。
// 多标签版：读 dirty 映射的汇总（任一标签脏即拦），与 CloseWindow 共用 confirmClose。
func (a *App) OnBeforeClose(ctx context.Context) bool {
	return a.confirmClose(ctx, a.anyDirty(), a.localeSnapshot())
}

// CloseWindow(dirty bool, locale string)
// 【dirty 的含义（多标签版）】= 「**任一**已打开标签的内存内容 ≠ 磁盘内容」。
// 仍随关闭请求走同一条 IPC 携带、不读镜像（ADR-005 §五 不变）——
// 多标签下这反而更可靠：前端手里有全部标签，聚合值不需要等镜像同步。
func (a *App) CloseWindow(dirty bool, locale string) {
	/* …与现实现同构，confirmClose(ctx, dirty, locale) 不变… */
}
```

**`confirmClose` 判定本体一字不改**（`app.go:346-371`）——ADR-005 §五 要求两条路径的判定不得分叉。

#### `snapshot.go`

- `docKeyOf` 保持为**唯一**派生实现（`snapshot.go:55-58`），`app.go` 直接调用，**不新增第二份**。
- 无需改动。

#### `docassets.go`

- **零改动**。`docDir` 保持单值是对的：`/doc-assets/` 只服务激活文档，切标签时 `assetContext.applyDocPath` → `SetDocDir` 已经同步（`assetContext.js:52-66`）。
- 需要在文件头补一句说明：**「单值是有意的：/doc-assets/ 只服务激活文档，不服务后台标签」**，以免后人误改成 map。

#### `main.go`

- **零改动**（`OnBeforeClose: app.OnBeforeClose` 的接线不变）。

### 4.14 i18n（改）

三份字典（`frontend/src/i18n/zh-CN.js` / `en-US.js` / `ja-JP.js`）必须新增且**完全对齐**：

| key | 用途 |
|---|---|
| `menu.newTab` / `menu.reopenTab` / `menu.closeTab` | 菜单显示名 |
| `menu.nextTab` / `menu.prevTab` | 菜单显示名 |
| `shortcuts.newTab` / `shortcuts.closeTab` / `shortcuts.nextTab` | 应用内速查表说明（`descKey` 非 null 的才进速查表） |
| `tabs.untitled` | 未落盘标签的显示名（若不复用 `common.untitled`） |
| `tabs.close` | 标签关闭按钮的 `aria-label` |
| `tabs.dirty` / `tabs.unsaved` / `tabs.error` | 三种标记的 `title` / `aria-label` |
| `tabs.confirm.title` / `tabs.confirm.body` / `tabs.confirm.save` / `tabs.confirm.discard` / `tabs.confirm.cancel` | 关闭脏标签的确认弹层 |

占位符名三语必须一致（`zh-CN.js:15-17` 的硬约束），否则插值静默失效、露出 `{path}` 原文。

---

## 5. 切换时序

### 5.1 `openTab`：打开文件

```
openPath(path)
  │
  ├─ session.findByPath(path)
  │    ├─ 命中 → activateSession(existing)          ← 同路径幂等：不新建、不丢内容
  │    └─ 未命中 ↓
  │
  ├─ seq = ++openSeq
  ├─ content = await ReadFile(path)                 ← 失败：toast「打开失败」并返回（沿用现实现）
  ├─ s = session.createSession({ path, content })    ← 造 EditorState（共用 extensions）
  │    ├─ id = "t<n>"（单调递增，不复用）
  │    ├─ state = createEditorState({ doc: content, extensions })
  │    ├─ dirty = false（内存 := 磁盘，ADR-005 §三）
  │    ├─ saveState = 'saved'
  │    ├─ saveTimer = null
  │    ├─ lastSnapshotAt = Date.now()
  │    └─ markdown = content（立即同步，不走 120ms 防抖）
  │
  └─ if (seq === openSeq) activateSession(s)         ← 只有最新一次请求抢焦点
       else：标签已建好，但不激活（用户的最新意图是后一次）
```

**为什么「结果照常建标签、只是不抢焦点」**：现实现的 `if (seq !== openSeq) return`（`useFileOps.js:118`）在单文档下是必须的（防「点 A 再点 B，编辑器里是 A、标题却是 B」）。多标签下丢弃 = 用户点的 A 永远打不开，是功能缺失而非竞态防护。

**为什么不再有 `switchFile()`**：多标签下「打开文件」不丢弃任何内容，没有需要留底的旧稿。`switchFile()` 唯一剩下的用途是**关闭标签前留底**，已迁到 `useTabLifecycle.closeTab`（§4.5 步骤 ①）。

### 5.2 `activateSession(target)`：切换标签（核心时序）

> 顺序是契约。**任一步调换都会产生静默错误**，逐条理由见右侧。

| # | 动作 | 为什么必须在这个位置 |
|---|---|---|
| **0** | **IME 合成守卫（P0 · PM 缺口 2 的裁决）**：<br>若 `view.composing === true` → **不切换**，把切换请求挂起；等合成结束（`update.view.composing` 由 true 变 false 的那笔事务）后再执行步骤 1 | `EditorView.composing` 是公开 API（`@codemirror/view` 的 `index.d.ts:776`：`get composing(): boolean`）。合成中的预编辑文本**只存在于 DOM**，`setState` 会重建 `docView` → **未上屏的那几个字直接消失**。zh-CN / ja-JP 是本仓已发布的两个 locale，IME 是它们的主输入路径 → 这是主路径上的**数据丢失类缺陷**，不是边缘 locale 的体验问题 |
| 1 | **守卫**：`target.id === activeId` → 直接返回 | 重复激活会白白重建整棵 docView |
| 2 | **捕获当前标签**：<br>`cur = getActiveSession()`<br>`cur.state = view.state`（保险，事务回写之外的兜底）<br>`cur.scrollTop = view.scrollDOM.scrollTop`<br>**若 `cur.dirty` → `await writeSnapshot(cur, true)`**（**MD-07：切走时留底**） | 滚动位置不在 `EditorState` 里（view.js:8094-8124 的 `setState` 会归零），必须先存。快照留底同理：必须在**内容还在内存里**时写；与既有 `switchFile()` 语义一致（`useDocumentState.js:175-178`），既有快照回归集可零改动复用。Go 侧按内容哈希去重，来回切同一份未改内容不会产生快照膨胀 |
| 3 | **丢弃待渲染预览**：`cancelPendingPreview()` | 现实现 `syncAfterDocReplace` 的第一行就是它（`useEditorSession.js:174`）：旧文档的防抖预览若稍后落地，会覆盖新标签的 markdown |
| 4 | **清表格提示**：`clearTableHint()` | `tableHint` 是模块级单例（`useTableHint.js:30`），不清会残留上一个文档的提示（`syncAfterDocReplace` 手工补算的同一原因，`useEditorSession.js:177-179`） |
| 5 | **装入新 state**：`view.setState(target.state)` | 必须在 `activeId` 切换**之前**：`applyDocPath` 会 dispatch 一个事务，那个事务必须作用在新 state 上 |
| 6 | **切 activeId**：`activeId.value = target.id` | 这一步会触发 `watch(filePath)` → `applyDocPath(path, view)`（`useEditorSession.js:98-104`，`flush:'sync'`）→ 同步三件事：assetUrl 改写开关 / Go 侧 `SetDocDir` 镜像 / 图片装饰重建信号（`assetContext.js:52-66`）。**顺序反了会让装饰按旧口径重建** |
| 7 | **重放窗口级开关到新 state**：<br>`setEditorZoom(view, prefs.zoom / 100)`<br>`view.dispatch({ effects: setFocusMode.of(workspace.focusOn.value) })` | `zoomCompartment`（`createEditor.js:179`）与 `focusField`（`:132`）的值随 state 走 → 不重放就会「复活」上一个标签的档位。`setWysiwyg` **不需要重放**：`wysiwygField` 恒为 true（全仓无 dispatch 点，见 F30） |
| 8 | **回写 state**：`target.state = view.state` | 第 7 步的 dispatch 产生了新 state；不回写则下次切回时 zoom/专注的档位丢失 |
| 9 | **恢复滚动**：`requestAnimationFrame(() => { view.scrollDOM.scrollTop = target.scrollTop })` | `setState` 重建 `docView` 后几何要下一帧才准（与 `focus-mode-architecture.md:51-63` 同一处理法） |
| 10 | **同步预览源**：`target.markdown = target.state.doc.toString()` | 立即赋值，不走防抖（切标签是一次性边界，与 `syncAfterDocReplace` 同口径） |
| 11 | **重算表格提示**：`checkTableHint(view.state)` | `setState` 不触发 updateListener，必须手工补算 |
| 12 | **重算大纲**：`onOutlineRefresh()` → `extractOutline(view.state.doc)`；同时 `outlineSync.invalidateMeasure()` | 大纲数组与 `ysCache` 都是单文档缓存（`useOutline.js:27-34`），换文档必须失效 |
| 13 | **重算行列**：`caret = 从 target.state.selection.main.head 推出` | 行列是显示值，不是 state；切回来必须显示新标签的光标位置 |
| 14 | **推 MRU**：`mru.value = [target.id, ...mru.filter(id => id !== target.id)]` | 供 Tab Switcher 浮层与「关闭后落点 = history」使用 |
| 15 | **聚焦**：`view.focus()` | 切标签后应能直接打字 |

**第 6 步的连锁**：`filePath` 是 `computed(() => activeSession?.path)` → `activeId` 一变，`filePath` 变 → `watch(filePath, ..., { flush: 'sync' })` 同步触发 → `applyDocPath`。这意味着**第 5 步必须先于第 6 步**。

**Go 侧 dirty 镜像不需要在这里做**：它由 `useDocumentState` 的 per-session dirty watcher 承担（§6.1），与激活无关。

**IME 守卫的机制细节（步骤 0）**：

- **判定用 `view.composing`**（`index.d.ts:776`），不用 DOM 事件 —— DOM 事件在 WKWebView 上的时序不可靠（MEMORY 第十一轮的输入法教训）。
- **「合成结束」的信号**：CM6 的 `updateListener` 收到的 `update.view.composing` 在合成结束后会变回 `false`（那一笔事务即合成提交）。据此在 `onEditorUpdate` 里清掉挂起的切换请求并执行它。
- **为什么不选「阻断 + 提示」**：PM 已明确指出阻断式提示（「合成中不可切换」）会打断「我打完这个字就去看另一个文档」的自然流程，对 CJK 用户是较差解法。三个候选里选**「延迟切换」**：预编辑文本正常提交进**当前**标签（不丢字），提交后立刻执行切换。
- **为什么不选「先提交合成再切换」**：CM6 没有公开的「强制提交合成」API（`inputState` 是内部对象），要模拟 IME 的 commit 行为需要 hack 合成文本，风险高于收益。
- **挂起队列的上限**：同一时间只挂起**一个**切换请求（后来的覆盖先来的）—— 否则一串快速点击会产生一串延迟切换，顺序错乱。
- **兜底**：若合成迟迟不结束（例如用户切走了输入法焦点），挂起的请求在**下一次任何文档事务**时强制执行（此时合成态已解除）。

**为什么这条排在 §11 的最前面**：它是**会反过来改架构**的那一类验证 —— 结论会改写 `activateSession` 的调用时机、光标恢复与 `scrollTop` 恢复的先后顺序。拖拽手感、右键菜单、切换延迟观感那三项只影响体验；这一项影响时序本身。所以它必须抢在 §5.2 定稿前验（见 §11 的 P0b 闸门）。

### 5.3 `closeTab(id)`：关闭标签

```
closeTab(id)
  │
  ├─ s = 找会话；找不到 → 返回 false
  ├─ ① 若 s.dirty → await docState.writeSnapshot(s, true)     ← 留底：此刻内容还在内存里
  ├─ ② 若 s.dirty → confirmDiscard(s)
  │      ├─ 'cancel'  → return false（不关）
  │      ├─ 'save'    → await docState.saveSession(s)
  │      │                 ├─ s.path 为空 → 走另存为对话框（SaveFileDialog）
  │      │                 ├─ 成功 → s.dirty = false；s.path = 新路径
  │      │                 └─ 失败 → return false（不关）
  │      └─ 'discard' → 把 { path, title, content, scrollTop, selection } 压进 closedStack（供 ⌘⇧T 恢复）
  ├─ ③ clearTimeout(s.saveTimer)
  ├─ ④ 落点：next = pickLandingSession(id)   ← history 策略（MD-09）
  │      ├─ 若当前激活的就是 s：
  │      │    ├─ 有其他标签 → await activateSession(next)
  │      │    └─ **没有其他标签（关的是最后一个）** → 落到【空文档】态（MD-08，见下）
  │      └─ 否则**不动当前激活标签**（MD-15：关闭后台标签不应把用户从正在编辑的文档里拽走）
  ├─ ⑤ session.removeSession(id)
  └─ ⑥ Go 侧清映射条目：ForgetDoc(identity(s))
```

**【关掉最后一个标签 → 空文档态，应用保持运行】（MD-08 的裁决，2026-10-28）**

**裁决内容**：关闭最后一个标签后，**应用窗口保持运行**，编辑器落到**一个空文档**（沿用现状 `filePath === ''` 的空态），**不新增专用空状态组件**。

- **产品结论一致**：退出应用是窗口行为，与标签管理不是一回事 —— PM 缺口 3 与 MD-08 在这一点上完全一致（「关掉这个文档」≠「退出 Inkmark」）。
- **实现形态**：MD-08 明确**不新增 `EmptyState.vue`**，理由是保住 `App.vue` 的行数预算（§4.11：实测 150 / 上限 150，余量为 0）。故走「保留一个空文档」这条路：`closeTab` 关掉最后一个标签后，等价于「回到一个未落盘、空内容的文档」。
- **与 PM 缺口 3 提法的差异（如实登记）**：PM 提的是「显示空状态 + 「新建文档」「打开文件」两个入口」的**专用组件**；MD-08 裁掉了专用组件（行数预算），改用**现状的空文档态**。**功能差异**：用户看到的是一个空白编辑器，而不是带两个按钮的引导页。**若将来要补这两个入口**，应作为独立小特性（复用现状的 `file.new` / `file.open` 命令，不新增组件），不得为此挤占 App.vue 的行数预算。
- **退出链路不变**：`CloseWindow` / `OnBeforeClose` 完全不动；空文档态下点标题栏 × 仍走原守卫（此时无脏文档 → 直接退出）。
- **未落盘且有内容**：关闭时**必须**先走未保存拦截（§5.3 步骤 ②），不得静默丢弃。
- **未落盘且无内容**：直接关闭、不弹确认（与 MD-03 的口径一致）。

**为什么 ① 在 ② 之前**：和现实现 `switchFile()` 同一口径（`useDocumentState.js:175-178`）：脏文档先强行写一份快照留底，旧稿此刻还在编辑器里，错过就永远写不回去了。即使用户选了「不保存」，也留一份底 —— 代价是快照目录多一份文件，收益是「关错了还能救」。

**为什么 ④ 在 ⑤ 之前**：`activateSession` 需要目标会话仍在注册表内。

**为什么落点用 history 而不是「左边那个」**：`activate_on_close = history` 是产品锁定的策略（§0.3）。用户刚访问过的标签通常就是他还惦记着的那个；「左边那个」在标签多时是任意的。

### 5.4 关闭脏标签的确认弹层

- 新增 `frontend/src/components/ConfirmDialog.vue`（三选一：保存 / 不保存 / 取消）。
- **不复用** `useDialog` 的 `askInput`（`useDialog.js:25-29`）：那是**单输入框**对话框（跳转到行 / 重命名用），语义不同。
- 视觉口径复用既有弹层 token：`--dialog-width-sm`、`--dialog-min-height`、`--radius-md`、`--elev-raised`（禁止硬编码颜色值）。
- **必须自带 `@media print`**：弹层有遮罩，契约 3 的「每个带遮罩的 `.vue` 组件必须有自己的 scoped `@media print` + `display:none`」（`contracts.test.mjs:570-592`）会直接查它。`TabContextMenu.vue` 同理。
- 与 `useDialog` 的 Esc 层级的关系：`useCommands.js:311-321` 的 `onEscKeydown` 是分层路由（输入框 > 设置 > 速查 > 关于 > 专注 > 历史）。新弹层必须插在**最上层**（输入框之上），否则 Esc 会先关掉别的层。
- Go 侧的 `runtime.MessageDialog`（`app.go:351-358`）**不用**在这里：那是系统级对话框，用于「关窗口」，而「关标签」是应用内操作，用应用内弹层更连贯（且系统对话框在 Linux/GTK 上返回值的坑已在 `app.go:362-370` 登记过，不要再引入一条平台差异路径）。

### 5.5 标签切换：MRU + Tab Switcher

| 动作 | 键位 | 行为 |
|---|---|---|
| 下一个标签 | `⌘⌥→` | 在 **MRU 顺序**里往后移一个并激活 |
| 上一个标签 | `⌘⌥←` | 在 MRU 顺序里往前移一个并激活 |
| 按住 | 同上 | `keydown` 重复触发 → **在「按下瞬间的 MRU 快照」内**持续遍历（§4.10，PM 缺口 1）；`TabSwitcher` 浮层同步显示候选（Zed 式） |
| 松开 | — | 停在当前候选（`keyup` 丢失也不影响结果，因为每次 `keydown` 已经完成了切换） |
| 下一次独立按住 | 同上 | 重新取一次 MRU 快照 → 「回到上上个文件」（正确的 MRU 语义，Sublime 同款） |
| 精确选一个 | 鼠标点标签 | 兜底路径 |
| 数字直跳 | **不提供** | `⌘1..⌘6` 已被标题占用（§0.4-2） |

**MRU 顺序的定义**：最近访问的标签在最前。首次打开的标签按打开顺序入栈。

**为什么不按「标签栏从左到右」切换**：标签栏顺序是用户可拖拽重排的（§0.3 必含），用它做切换会让「下一个」在用户重排后含义突变。MRU 顺序是稳定的语义（Zed / VS Code 的 Ctrl+Tab 都用它）。

### 5.6 拖拽重排

```
dragstart(tabId)  → 记录被拖的 id；给容器加 .is-dragging
dragover(tabId)   → 在该位置显示插入指示线；preventDefault（否则 drop 不触发）
drop(tabId)       → 把被拖的 id 移到目标位置（在 sessions 数组里 splice 重排）
dragend            → 清理指示线
```

- 只改 `sessions` 数组的顺序，**不改** `id` / `path` / `state`。
- 重排后落盘策略（§4.5 之外另见 §11 阶段 P5）以数组顺序为准。

---

## 6. dirty 语义扩展（落地 ADR-005 §四）

### 6.1 前端：从单值到 per-session

**ADR-005 §一 的不变量逐字保留**：

> `dirty === true` ⟺ 编辑器当前内存中的文档内容 与 该文档在磁盘上的内容 不一致。

「该文档」在多标签下指**该标签对应的那个文档**，不是一个全局概念。

**落点**：

| 现实现 | 多标签版 |
|---|---|
| `useDocumentState.js:68` `const dirty = ref(false)` | `DocSession.dirty`（per-session 字段） |
| `useDocumentState.js:63` `const saveState = ref('unsaved')` | `DocSession.saveState` |
| `useDocumentState.js:80` `let saveTimer = null` | `DocSession.saveTimer` |
| `useDocumentState.js:86` `let lastSnapshotAt = Date.now()` | `DocSession.lastSnapshotAt` |
| `useDocumentState.js:76-78` `watch(dirty, d => SetDirty(d))` | 见 §6.2 的 diff 式镜像 |

**对外暴露**：`useDocumentState` 仍导出 `dirty` / `saveState`，但改为 **computed（取激活会话）**。这样 `App.vue:100`（`:is-dirty="dirty"`）与 `App.vue:123`（`:status="saveState"`）**一行都不用改**，语义自动变成「当前标签的」。

**镜像发送（diff 式，不逐个 watcher）**：

```js
  // 已发送的 dirty 快照：sessionId → 上次发送的值
  let sentDirty = new Map()

  /**
   * 把 dirty 变化镜像给 Go（ADR-005 §五）。
   * 用 diff 而不是「只看激活会话」：后台标签的自动保存也会把它从 dirty 变 clean，
   * 那条变化必须同步到 Go，否则 Go 侧会一直以为它脏（关窗口时多弹一次确认）。
   */
  function syncDirtyMirror(sessions) {
    const next = new Map()
    for (const s of sessions) {
      next.set(s.id, s.dirty)
      const prev = sentDirty.get(s.id)
      if (prev === undefined || prev !== s.dirty) {
        setDirty(s.identity, s.dirty)     // 具名 import 的 SetDirty
      }
    }
    // 已关闭的标签：清掉它的条目
    for (const id of sentDirty.keys()) {
      if (!next.has(id)) forgetDoc(identityOf(id))
    }
    sentDirty = next
  }
```

**为什么用 diff 而不是「每次都全量发」**：IPC 次数与标签数成正比，且全量发会把「没变」的也发一遍，噪音大。

### 6.2 Go 侧：`dirty bool` → `map[docKey]bool`

**映射键口径**（与 `snapshot.go` 的 `docKeyOf` 对齐）：

| 文档 | 身份（前端给） | 映射键（Go 派生） |
|---|---|---|
| 已落盘 | 绝对路径 | `docKeyOf(path)` = `hex(sha1(filepath.Clean(path)))[:16]`（`snapshot.go:55-58`，**同一函数，不新增第二份**） |
| 未落盘 | `untitled:<tabId>` | `"u:" + <tabId>` |

**为什么未落盘文档要有独立命名空间**（与 PM 的约束一致）：

1. 它没有路径，`docKeyOf` 无输入。
2. 它天然一对一（一个标签一份内容），用标签 id 唯一。
3. `"u:"` 前缀与 `docKeyOf` 的输出（恒为 16 位 hex）**不可能相交** → 不存在「未落盘标签的脏状态误命中某个真实文件」的可能。

**为什么已落盘文档按 docKey 而不是按标签 id**：ADR-005 §四 明文要求「docKey 沿用 `snapshot.go` 的 `SnapshotDocKey` 派生规则」。代价是同一路径不得开第二个标签 —— 这条已作为架构约束落地（§5.1 的同路径幂等）。

**路径变化时的键迁移**（另存为 / 重命名）：键从 `docKeyOf(旧路径)` 变成 `docKeyOf(新路径)`，必须**先删旧键、再写新键**，否则旧键会永远留在映射里（关窗口时被一个已不存在的文档挡住）：

```js
  function setActivePath(nextPath) {
    const s = getActiveSession()
    if (!s || s.path === nextPath) return
    // 键迁移：旧身份清零 → 新身份按当前 dirty 重新登记
    setDirty(s.identity, false)
    s.path = nextPath
    s.title = baseName(nextPath)
    setDirty(s.identity, s.dirty)
  }
```

### 6.3 两条关闭路径：语义不分叉，来源不同

| 路径 | 触发 | dirty 取值来源 | 判定本体 |
|---|---|---|---|
| `OnBeforeClose`（macOS 红绿灯） | Wails 钩子，**无参数通道** | Go 侧镜像的汇总：`a.anyDirty()` | `confirmClose(ctx, dirty, locale)` |
| `CloseWindow(dirty, locale)`（自绘 ×） | 前端调用，**dirty 随请求携带** | 前端计算的汇总：**任一标签脏** | 同上 |

**两者语义一致**：判定输入都是「**有未保存的内容吗**」这一命题，多标签下即「任一标签脏」。

**差异只在取值时机与来源**（ADR-005 §五 已把这一点定为刻意设计）：

- `CloseWindow` 不读镜像 —— 镜像滞后会导致**漏拦**（丢稿）；前端手里有全部标签，聚合值不需要等 IPC 同步。
- `OnBeforeClose` 只能读镜像 —— Wails 钩子没有参数通道。

**判定本体 `confirmClose` 一字不改**（`app.go:346-371`），这是 ADR-005 §五「语义不得分叉」的落点。

**前端必须把「任一标签脏」传给 `CloseWindow`**：

- `App.vue:100` 的 `:is-dirty="dirty"` 现在传的是**激活标签**的 dirty（标题栏红点，语义 = 当前文档脏）→ **保持不变**。
- 但 `TitleBar.vue:174` 的 `CloseWindow(props.isDirty, getLocale())` 必须传**聚合值** → `TitleBar` 需要新增一个 prop：

```js
const props = defineProps({
  filename: { type: String, default: '' },
  isDirty: { type: Boolean, default: false },   // 当前标签脏 → 标题栏红点
  anyDirty: { type: Boolean, default: false },  // 任一标签脏 → CloseWindow 的入参
})
// …
const close = async () => {
  try {
    await CloseWindow(props.anyDirty, getLocale())
  } catch { /* 浏览器预览或绑定未就绪 */ }
}
```

`App.vue` 相应改为 `:is-dirty="dirty" :any-dirty="tabs.anyDirty"`。

### 6.4 与 ADR-005 的一处差异（如实登记，待裁决）

ADR-005 §一 写：「文档在磁盘上**没有副本**（从未落盘的新文档、另存为被取消）时，视为「不一致」→ `dirty = true`」。

**现实现并非如此**：未落盘的新文档经 `newFile()` → `loadDocument('', '')` → `docState.resetSession()`（`useFileOps.js:146` → `useDocumentState.js:181-186`）后 `dirty = false`；只有用户输入后才由 `markDirty()` 置真。

**这个差异在今天是无害的**（空文档没有内容可丢，关窗口不弹框正好；一旦有输入，`onDocChange` → `markDirty` 立刻置真）。

**但多标签下必须显式定下来**，否则「新建一个空标签 → 关掉它 → 弹不弹确认」没有依据。本方案的口径：

> **未落盘标签在创建时 `dirty = false`（空文档无内容可丢）；一旦有任何输入即 `dirty = true`。**

**理由**：若按 ADR-005 §一 的字面表述，未落盘标签一创建就是脏的 → 用户每新建一个标签就弹一次「未保存」确认，是纯噪音；且 ADR-005 §二 自己列的「不是」清单里已经有「不是是否有未提交的编辑操作」这条，方向是「宁多问一次」但不是「无内容也问」。

**这是一个需要 team-lead 裁决的口径分歧**（登记为开放项 D3）。若裁决为「按 ADR-005 字面」，则 `createSession` 里 `dirty` 初值改为 `true`，且 `saveState` 初值改为 `'unsaved'`（标签上的「未落盘」标记仍按 `path === ''` 判定，不受影响）。

### 6.5 产品决策点：后台标签是否自动保存

**我的结论：(a) 后台标签同样自动保存。**

**理由**：

1. **与 ADR-005 §一 的不变量自洽**。`dirty` 的定义是「内存 ≠ 磁盘」。若后台标签不落盘，它的 dirty 会一直为真，直到用户切回来。用户在关窗口时看到「有未保存内容」的提示，指的是**后台那个他早就忘了的标签**——提示是对的，但用户无法判断该不该放心关。
2. **本仓的自动保存已经是「持续写盘」语义**（ADR-005 §三：800ms 防抖覆盖原文件，AC-13）。多标签只是在同一条链路上多了几个独立定时器，**不引入新的写入类别**。
3. **落盘目标不会串**。每个 session 有自己的 `path` 与自己的 `saveTimer`，后台标签的定时器写的是**它自己的文件**。
4. **反向的代价更小**。选 (b)（只保存激活标签）会引入一类新的「长期 dirty」状态：后台标签可能脏上几天（用户明天才切回来），这与「800ms 自动保存」的产品承诺相矛盾，且让标题栏红点 / 标签脏标记长期亮着。

**(a) 的代价（如实登记）**：

- 后台标签落盘会**覆盖磁盘文件**。若用户同时在外部编辑器改了同一文件，会被覆盖。这与单文档时的自动保存覆盖（AC-13 既有裁决）是**同一类风险**，不是新增类别；但多标签下「同时开两个标签写同一个文件」的场景更隐蔽 —— 已由「同路径幂等」（§5.1）挡掉：同一路径在注册表内最多一个标签，所以**不会出现两个标签写同一个文件**。
- 未落盘的后台标签无处可写 → 不自动保存，保持 `dirty = true` 并在标签上显示「未落盘」标记（§4.9）。

**若 team-lead 选 (b)**，需要额外落地三件事（本方案不预先实现，只登记）：① 切走时冻结该 session 的 `saveTimer`；② 激活时补一次自动保存；③ 接受后台标签的 `dirty` 长期为真，并相应调整标签标记的视觉（长期亮着的 dirty 点会变成常态噪音）。

**PM 对 (a) 的补充产品要求（已纳入 §11 的 P2 判据）**：**后台标签的保存状态必须对用户可见**。状态栏现在显示的是当前文档的 `saveState`，切到某个标签时必须显示**那个标签的**状态（保存中 / 已保存 / 失败）。

- 否则用户切到一个自己没动过的标签，看到「已保存」却心里没底 → 会诱发「我手动再存一次」这种重复操作。
- **失败态尤其要显眼**：标签上是 `var(--danger)` 标记（§4.9），状态栏也要同步（`StatusBar.vue:182-185` 的 `.is-err`）。
- 本方案的 `saveState` 是 per-session 字段、`StatusBar` 取的是**激活会话**的值（§7.2），**这条要求在架构上天然满足** —— 但必须写进 P2 的完成判据，否则实现轮容易图省事只做标签上的标记、忘了状态栏。

**登记为开放项 D1**（PM 已表态支持 (a)；PM 的补充要求不受裁决影响，两种选项下都要满足）。

---

## 7. 前端状态派生图

### 7.1 三类归属

| 类别 | 定义 | 成员 |
|---|---|---|
| **G（全局单值）** | 窗口级、与「哪一份文档」无关 | `folderPath`（文件树根）、`sidebarOpen` / `sidebarTab` / `focusOn` / `typewriterOn` / `alwaysOnTop`（`useWorkspace.js:39-50`）、`zoom` / `theme` / `prefs`（`usePrefs.js:53-64`）、`outline` 数组（`App.vue:42`）、`outlineActive`（`useOutline.js:25`）、`tableHint`（`useTableHint.js:30`）、`caret`（`useEditorSession.js:83`）、`markdown` / `previewHtml` / `exportHtml` / `wordCount`（由激活会话派生）、`filePath` / `title`（由激活会话派生）、`dirty` / `saveState`（由激活会话派生） |
| **P（per-session 字段）** | 属于某一份文档 | `id` / `path` / `title` / `state` / `scrollTop` / `markdown` / `dirty` / `saveState` / `saveTimer` / `lastSnapshotAt` |
| **R（注册表级）** | 关于「有哪些标签」 | `sessions`（有序数组 = 显示顺序）、`activeId`、`mru`（最近访问顺序）、`closedStack`（已关闭标签栈） |

### 7.2 逐项迁移表

| 现字段（位置） | 现类型 | 新归属 | 新形态 | 备注 |
|---|---|---|---|---|
| `filePath`（`useEditorSession.js:77`） | 可写 ref | G | **computed**（激活会话的 path） | 三个写入点改为 `setActivePath()` |
| `title`（`:82`） | computed | G | computed（读新的 `filePath`） | 不变 |
| `folderPath`（`:78`） | ref | G | ref | **不变**（文件树根与文档无关） |
| `markdown`（`:76`） | ref | G（派生） | computed（激活会话的 `markdown`） | 写入点从 `applyPreview` 改为写 `session.markdown` |
| `caret`（`:83`） | ref | G | ref（但每次激活重算） | 切标签时按新 state 的 selection 重算 |
| `wordCount`（`:109`） | computed | G | computed（读新的 `markdown`） | 不变 |
| `previewHtml` / `exportHtml`（`:88,91`） | computed | G | computed | 不变 |
| `dirty`（`useDocumentState.js:68`） | ref | G（派生） | **computed**（激活会话的 dirty） | 对外 API 不变，App.vue 零改动 |
| `saveState`（`:63`） | ref | G（派生） | **computed** | 同上 |
| `saveTimer`（`:80`） | 局部变量 | P | `session.saveTimer` | 后台标签的定时器继续跑（§6.5） |
| `lastSnapshotAt`（`:86`） | 局部变量 | P | `session.lastSnapshotAt` | 切标签**不重置** |
| `tableHint`（`useTableHint.js:30`） | 模块级 ref | G | 模块级 ref（**保持单例**） | 切换时 clear + 重算（§4.7） |
| `outline`（`App.vue:42`） | ref | G | ref（切换时重算） | 不变 |
| `outlineActive`（`useOutline.js:25`） | ref | G | ref（切换时重算） | 不变 |
| `ysCache` / `ysDirty`（`useOutline.js:27-28`） | 局部变量 | G | 局部变量（切换时 `invalidateMeasure()`） | 本模块零改动 |
| `zoom` / `theme`（`usePrefs.js:58,64`） | ref | G | ref（**不变**） | 但切标签后要重放到新 state（§5.2 步骤 7） |
| `focusOn`（`useWorkspace.js:39`） | ref | G | ref（**不变**） | 同上 |
| `sessions` | — | R | **新增** | 有序数组 = 显示顺序 |
| `activeId` | — | R | **新增** | |
| `mru` | — | R | **新增** | Tab Switcher 与关闭落点用 |
| `closedStack` | — | R | **新增** | ⌘⇧T 恢复用 |

### 7.3 派生关系图

```
sessions[]（注册表）
      │
      ├─ activeId ──► activeSession ──┬─► filePath ──► title
      │                                ├─► dirty ──► (TitleBar 红点)
      │                                ├─► saveState ──► (StatusBar 保存态)
      │                                ├─► markdown ──┬─► previewHtml ──► .export-preview（打印/导出）
      │                                │             ├─► exportHtml ──► buildHtmlDocument
      │                                │             └─► wordCount ──► StatusBar
      │                                ├─► state.selection ──► caret ──► StatusBar 行列
      │                                └─► state.doc ──┬─► extractOutline ──► outline ──► Sidebar 大纲
      │                                                 ├─► checkTableHint ──► tableHint ──► StatusBar
      │                                                 └─► (WYSIWYG / 表格 / 代码块装饰，由 CM 插件按 state 重建)
      └─ mru[] ──► TabSwitcher 浮层（**按住循环用按下瞬间的快照**，§4.10）/ 关闭后落点（activate_on_close = history）
```

**要点**：整张图只有**一个**「当前是谁」的判定点（`activeId`）。所有派生状态都从它出发 → 不存在「五处各判一次是不是激活的」这类不一致源（这正是方案 B 被否决的首要理由，§2.4）。

**关于「关掉最后一个标签」（MD-08）**：**不引入「零标签」态** —— 注册表恒有 ≥1 条（最后一个标签被替换成一个未落盘、空内容的 session）。因此这张图**不需要**额外的「无激活会话」分支：所有派生量都从 `activeSession` 算出，空文档态只是一个 `path === ''` 的普通 session。

唯一需要 `null` 兜底的是 `getActiveSession()` 在 **`onMounted` 之前**返回 `null` 的那一小段窗口（编辑器尚未创建）—— 这是本仓既有的形态（`useEditorSession.js:74-83` 的 `editorEl` / `filePath` 初值），不是新增分支。

---

## 8. 影响面清单

### 8.1 新增文件

| 文件 | 职责 | 预估有效行 |
|---|---|---|
| `frontend/src/editor/extensions.js` | 编辑器扩展清单的唯一真源（从 `createEditor.js` 抽出）+ `createEditorState()` | 约 170 |
| `frontend/src/composables/useTabLifecycle.js` | 标签生命周期编排：关闭 / 关闭其他 / 关闭右侧 / 恢复已关闭 / 落点选择 | 约 130 |
| `frontend/src/components/TabBar.vue` | 标签栏：渲染、dirty/error 标记、拖拽重排、右键菜单触发 | 约 200 |
| `frontend/src/components/TabSwitcher.vue` | Zed 式 Tab Switcher 浮层（MRU 排序） | 约 90 |
| `frontend/src/components/TabContextMenu.vue` | 标签右键菜单：关闭 / 关闭其他 / 关闭右侧 | 约 90 |
| `frontend/src/components/ConfirmDialog.vue` | 关闭脏标签的三选一确认弹层 | 约 80 |
| ~~`frontend/src/components/EmptyState.vue`~~ | **已取消** —— MD-08 裁定「关掉最后一个标签 → 保留一个空文档」，**不新增专用空状态组件**（保住 `App.vue` 的行数预算，§4.11） | — |
| `frontend/src/composables/devHooks.js` | （可选）把 `App.vue` 的 DEV 调试块下沉，用于腾行数 | 约 10 |

### 8.2 修改文件

| 文件 | 改什么 | 关键约束 |
|---|---|---|
| `frontend/src/App.vue` | 装配 `useTabLifecycle` + `TabBar` / `TabSwitcher`；`:any-dirty` 传参；**净腾出 ≥6 行** | 总行数 ≤150（`contracts.test.mjs:920-934`）；装配顺序契约（`tdz-order.test.mjs`） |
| `frontend/src/editor/createEditor.js` | 抽出 `extensions` 数组；`createEditor` 接受外部 extensions；有效行 257 → 约 105 | 豁免阈值 260 可下调（棘轮只许降不许升） |
| `frontend/src/composables/useEditorSession.js` | 持有会话注册表 / `activeId` / `mru`；派生状态改 computed；事务回写 `session.state`；`setActivePath` | 现有导出名尽量不变（`filePath` 等仍导出，只是变 computed） |
| `frontend/src/composables/useDocumentState.js` | 状态改 per-session；`switchFile` / `resetSession` 退役；`writeAndSettle` 按 session 比对；新增 dirty 镜像 diff | ADR-005 §一 / §三逐字不变 |
| `frontend/src/composables/useFileOps.js` | 「打开 = 开标签」；同路径幂等；`openSeq` 语义变更；`newFile` 改为新标签 | `shouldReloadTree` 纯函数**保持导出与位置不变**（`watcher-wiring.test.mjs:27` 直接 import 它） |
| `frontend/src/composables/useTableHint.js` | 新增 `resetTableHint(state)`（清 + 重算） | 现有 `checkTableHint` / `clearTableHint` 签名不变 |
| `frontend/src/composables/useOutline.js` | **零改动** | 只需在切换时序里调用既有的 `invalidateMeasure()` |
| `frontend/src/composables/useCommands.js` | 注册 5 条新命令；`loadSyntaxSample` 改为开新标签 | 契约 1（`contracts.test.mjs:276,312-330`） |
| `frontend/src/composables/useShortcuts.js` | `COMMANDS` 表加 5 条 | 键位唯一真源；`README.md:295` 的数字同步 |
| `frontend/src/components/TitleBar.vue` | 新增 `anyDirty` prop；`CloseWindow(props.anyDirty, …)` | `isDirty`（红点）语义改为「当前标签脏」 |
| `frontend/src/i18n/{zh-CN,en-US,ja-JP}.js` | 新增约 13 个 key | 三份 key 集合必须完全一致（`zh-CN.js:1-12`） |
| `app.go` | `dirty bool` → `dirtyByDoc map[string]bool`；`SetDirty(docIdentity, d)`；`ForgetDoc`；`anyDirty`；`dirtyKeyOf` | `confirmClose` 判定本体一字不改 |
| `snapshot.go` | **零改动**（`docKeyOf` 被 `app.go` 复用） | 不新增第二份派生 |
| `docassets.go` | **零改动**（仅补一条文件头说明：`docDir` 单值是有意的） | — |
| `main.go` | **零改动** | — |
| `README.md` | 快捷键节 +5 行；「62 条命令 / 50 项键位」→「67 / 55」；`useCommands（62 条…）`→67；测试条数随新增测试更新；`⌘N` 语义变化登记；目录结构节补新文件 | `verify-shortcuts.mjs` + `verify-readme-claims.mjs` + `verify-readme-paths.mjs` 三道门禁 |
| `docs/architecture/ADR-005-dirty-semantics.md` | §四 增补：多标签落地形态（映射键口径、未落盘命名空间、后台自动保存结论、§一 的口径分歧） | ADR 是活文档，落地后必须同步（`spec-as-contract.md` §5） |
| `docs/HANDOFF.md` | §7「零多标签页」条目更新；§6 目视清单加标签页相关项；§5 门禁表更新 | — |

### 8.3 删除文件

**无。** 本方案不删除任何现有文件；`useDocumentState` 里的 `switchFile` / `resetSession` 是**函数删除**，不是文件删除。

---

## 9. 门禁与测试计划

### 9.1 现有门禁的受影响点

| 门禁 | 受影响点 | 处置 |
|---|---|---|
| 契约 5 · 行数门禁（`contracts.test.mjs:834-990`） | `createEditor.js` 有效行从 257 降到约 105 → 豁免阈值 260 可下调 | 下调到 120（棘轮只许降不许升）；**下调阈值本身要按 §9.4 做元测试** |
| 契约 5 · App.vue ≤150（`contracts.test.mjs:920-934`） | App.vue 加 6 行 → 必须先腾出 6 行 | §4.11 的行数预算；净行数变化要用 `countTotalLines` 实测 |
| 契约 1 · 命令双向闭合（`contracts.test.mjs:278-365`） | 新增 5 条命令 → `useCommands.js` 必须同步注册 | 门禁自动覆盖，无需改判据 |
| 契约 3 · 打印样式（`contracts.test.mjs:504-616`） | ① App.vue 的 `@media print` 块要加 `.tab-bar`（现有判据只钉了 `statusbar` 与 `history-panel`，`contracts.test.mjs:552`）；② **`TabContextMenu.vue` / `ConfirmDialog.vue` 若用遮罩，必须各自带 scoped `@media print` + `display:none`**（`contracts.test.mjs:570-592` 的「每个带遮罩的 .vue 组件必须有自己的 @media print」） | ① 把 `.tab-bar` 加进 `contracts.test.mjs:552` 的 chrome 清单（**门禁加强 → 必须按 §9.4 做元测试**）；② 两个新弹层的 scoped 打印块按既有口径写 |
| `tdz-order.test.mjs:96-99` | composable 名单要加 `useTabLifecycle` | **必须加**，否则删掉该调用测试也不报红 |
| `tdz-order.test.mjs:59-83` | 若走 §4.11 的方案 (a)（DEV 块下沉）→ 变异锚点失效 | 改用方案 (b)(c)(d) 规避；若最终走 (a)，必须重写锚点并做元测试 |
| `verify-shortcuts.mjs` | 5 条新命令 → README 快捷键节 + i18n descKey | 三方比对自动覆盖 |
| `verify-readme-claims.mjs` | 测试条数 / suite 数 / App.vue 行数声明 | 收尾阶段统一更新并跑门禁 |
| `verify-readme-paths.mjs` | README 目录结构节要补新文件；**若新增根级 Go 文件则必须登记**（判据 B） | 本方案**不新增根级 Go 文件**（`dirtyKeyOf` 放 `app.go`）→ 无需登记；若实施时改为新增 `dirty.go`，必须同步 README |
| `scan-i18n-residue.mjs` | 5 个新组件的用户可见文案 | 全部走 `t()` |
| `p0-check-emoji.sh` | 扫 `frontend/src` + `main.go` + `app.go` | 新组件里不得出现 emoji；图标用 `AppIcon` 白名单内的既有语义名 |
| `go vet` / `go build` / `go test` | `app.go` 的 map 与新签名 | 新增 Go 测试（文件清单以 QA 文档 §6.1 为准） |
| **建议新增** `scripts/verify/verify-multitab-contract.mjs` | 跨文件逐字比对：Go 侧标签页绑定名 ↔ 前端 `wailsjs/go/main/App` 的具名 import；`SetDirty*` 的参数形态 ↔ 前端调用点实参（映射版 vs 聚合版不可混用）；标签栏组件存在；命令表里的标签页命令在 `useCommands.js` 有注册面 | 由 QA 文档 §6.2 提出。**与本方案直接相关**：它正是防「§6.3 的两条关闭路径用错形态」的门禁。每条判据须有**产出数量下限**，核对数骤降即**退出码 2**（防「一条都没核对到 → 报一致」的假绿灯，HANDOFF §5 第 7/8 次）；路径一律用 `ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')` |

### 9.2 测试文件清单：**以 QA 文档 §6.1 为唯一真源**（本文不另列）

> **合并口径（QA 文档 §10.2 已钉死，本文遵守）**：
> `frontend/tests/` 由 QA 独占（`frontend/tests/README.md:4`：「维护者：QA。`tests/` 与 `frontend/package.json` 由 QA 独占，其他角色请勿改动」）。
> 因此**「新增 / 修改哪些测试文件」的唯一清单 = `docs/plan/multi-tab-test-plan.md` §6.1**。
> 本文**不复制**该清单，只在下表给出**架构侧对每类测试的判据要求**（判据打在哪、不能用哪种断言）——
> 这部分是架构责任，测试文件的归属与命名不在本文。

| 测试类别 | 架构侧要求的判据（必须打在**该路径特有**的可观测差异上，HANDOFF §4 ⑱） |
|---|---|
| 会话注册表 | 断言「同路径第二次打开返回**同一个 id**」且 `sessions.length` **不变** —— 不是断言 toast 条数；断言 MRU 推进后的**顺序**（不是「有一个 MRU」） |
| **MRU 快照遍历** | 断言「一次按住内被访问过的标签**包含全部 N 个**」，**不要断言最终停在哪一个**（落点取决于最后一次 keydown 的时序）。判据形态：MRU = `[C,B,A]`，按住 `⌘⌥→` 至少触发 3 次 keydown → 三个**不同**的标签都被访问过。**这条能抓住「实时重排 MRU 导致只在最近两个标签间抖动」的实现缺陷**（PM 缺口 1） |
| 标签切换 | 驱动**真实 EditorView**（headless CM6），断言 `view.state.doc.toString()` 换成了目标文档的内容；断言 `scrollDOM.scrollTop` 被恢复为切走时的值；断言撤销栈**不跨标签互通**（在 A 里 `undo` 撤不到 B） |
| **派生状态不残留（带等待窗口）** | 切标签后**等 ≥150ms**（超过 `PREVIEW_DEBOUNCE_MS = 120`，`useEditorSession.js:29`）再断言预览 / 字数 / 表格提示 / 大纲 —— 因为漏掉 `cancelPendingPreview()` 的症状是**延迟 120ms 的静默失败**（旧文档的预览稍后落地覆盖新文档）。**只断言「切过去立刻」会漏掉这一类** |
| **IME 合成守卫** | 断言「合成中请求切换 → 不立即换 state（`view.state.doc` 仍是原文档）」+「合成结束后 → 切换发生且预编辑文本已提交进原文档」。判据必须打在**内容**上，不是「有没有弹提示」 |
| **空状态（零标签）** | 断言「关掉最后一个标签 → `sessions.length === 0`、应用不退出、编辑区是空文档、`filePath === ''`、两个入口可见」；断言「关掉最后一个**未落盘且有内容**的标签 → 先弹未保存拦截」；断言「关掉最后一个**未落盘且无内容**的标签 → 不弹确认，直接关」 |
| per-session dirty | 断言**具体哪个 session** 的 dirty 变了（session id + 值），不是断言「有一条 dirty」；落盘后断言**该 session** 归零、**别的 session** 不受影响 |
| 自动保存 / 写盘单元同源 | 断言「**每条** `(path, content)` 记录都满足 `content === 那个 path 对应 tab 的内容`」—— **不是**「写盘次数 == 1」。这是最危险的一类错写：后台 tab 的定时器拿激活 tab 的内容写进后台 tab 的文件，**数据损坏、零报错**（QA 文档 R-1）。另断言「写盘期间在别处编辑不得误判脏」 |
| 关闭标签 | 断言「用户选取消后 `sessions.length` 不变且该 session 的 `dirty` 仍为 true」；断言落点是 **MRU 里上一个访问过的**标签（不是左边那个）；**注意 history 与 left_neighbour 在某些场景结果相同，判据必须取能区分二者的场景**（否则等价变异，HANDOFF §4 ㉒） |
| 身份与映射键 | 前端侧断言**身份串形状**（`untitled:<id>`）；Go 侧断言 `dirtyKeyOf("untitled:t1")` 与 `dirtyKeyOf("/a/b.md")` **不相等**且前者以 `u:` 开头；断言前端**没有**自行实现 sha1 派生 |
| 脏标记视觉 | **绝对相等判据**（MD-04）：脏标记的计算色必须**精确等于** `--meta` 的解析值，异常标记精确等于 `--danger` 的解析值 —— **不用相对判据**（「≥3:1 且 < danger 的对比度」过弱：任何更浅的颜色都能混过去，将来有人把 `--meta` 换成 `--muted` 仍会通过，而那正是 MD-04 要排除的）。对比度须**对 `--surface` 算**且**三个主题都验**（纸感主题 `--meta` 对 `--surface` 仅 3.07:1，只比 WCAG AA 对非文本图形对象的 3:1 下限高 0.07）。另断言 **`data-state` 属性值**（`clean` / `dirty` / `unsaved` / `error`）与 `aria-label` 存在 —— 颜色不得是唯一信道（WCAG 1.4.1，AC-72） |
| 落点策略 | **区分性场景必须这样构造**（MD-14）：**用「按指定顺序点击标签」构造 MRU**，**不能**用「按顺序打开文件」（打开顺序天然等于 MRU 顺序，构造不出差异）。形态：**3 个标签，排列序 A–B–C，但按 C→A→B 的顺序点击过**（MRU = B, A, C）；然后关闭 C ⇒ 期望落点 **B**（MRU 里上一个访问过的），而**不是**排列上的邻居 A。按「排列相邻」实现的 ⇒ 落点 A ⇒ **报红**；按 MRU 实现的 ⇒ 落点 B ⇒ 通过。**该场景必须单列为一条测试**，不与通用用例混写（混写就会被「碰巧同过」淹没） |
| Go 侧（`app_dirty_test.go`） | 断言：置脏后 `anyDirty()` 为真；`ForgetDoc` 后为假；`dirtyKeyOf` 的两分支不相交；`anyDirty` 遍历的是**映射**而不是某个单值 |

### 9.3 现有测试的修改点：**以 QA 文档 §6.1 为准**（本文不另列）

> 同上：QA 文档 §6.1 已把「现有测试的修改点」并入同一张表（`contracts.test.mjs` 契约 3 与 5、`tdz-order.test.mjs` composable 名单、`table-hint.test.mjs`、`image-asset-context.test.mjs`），**以该表为准**。
> 本方案与该表一致的几处要点在此列出，供实现轮对照（**不构成第二份清单**）：

- `createEditor.js` 的行数豁免阈值需下调（有效行 257 → 约 105；新阈值建议 120）—— 棘轮只许降不许升。
- `tdz-order.test.mjs` 的 composable 名单要加 `useTabLifecycle` —— 否则删掉该调用测试也不报红（假绿灯）。
- 契约 3 的 chrome 清单（`contracts.test.mjs:552`，现为 `['statusbar', 'history-panel']`）要加 `.tab-bar` —— **门禁加强，必须做元测试**。
- `TabContextMenu.vue` / `ConfirmDialog.vue` 若带遮罩 → 契约 3 的「带遮罩组件必须有自己的 scoped `@media print` + `display:none`」（`contracts.test.mjs:570-592`）会直接查它们。
- `useFileOps` 的 `shouldReloadTree` 导出**保持不变**（位置与签名都不动，`watcher-wiring.test.mjs:27` 直接 import 它）→ 该测试无需改。

### 9.4 元测试要求（本仓铁律）

> **改了门禁必须做元测试**：造违规输入 → 确认能报红 → 确认退出码非 0（MEMORY.md「团队工作流」节；HANDOFF §5 末尾）。

本方案涉及的门禁改动及其元测试：

| 门禁改动 | 元测试（必须实做并记录退出码） |
|---|---|
| `createEditor.js` 豁免阈值下调 | ① 把该文件的有效行数人为推过新阈值 → 契约 5 必须报红；② 还原后必须转绿；③ `git diff --stat` 证明无残留 |
| `tdz-order.test.mjs` composable 名单加 `useTabLifecycle` | ① 从 App.vue 删掉 `useTabLifecycle` 调用 → 该用例必须报红（点名「没解析到 useTabLifecycle 调用」）；② 还原转绿 |
| 契约 3 打印隐藏清单加 `.tab-bar` | ① 从 App.vue 的 `@media print` 里删掉 `.tab-bar` → 契约 3 必须报红；② 从 `contracts.test.mjs:552` 的 chrome 清单里删掉 `'tab-bar'` → 该用例必须报红（守「判据本身没被削弱」）；③ 还原后必须转绿 |
| 新增 Go 测试 `app_dirty_test.go` | 变异自证：把 `anyDirty()` 改成恒 false → 必须报红；把 `dirtyKeyOf` 的 `u:` 前缀去掉 → 必须报红 |

**变异自证的方向清单**（每个方向都要实做，不许只做「测试全绿」的确认）：

1. `activateSession` 里去掉 `clearTableHint()` → 「切标签后旧提示不残留」用例必须报红。
2. `activateSession` 里把 `setState` 挪到 `activeId` 赋值**之后** → 「`applyDocPath` 作用在新 state 上」用例必须报红。
3. `activateSession` 里去掉滚动恢复 → 「滚动位置被恢复」用例必须报红。
4. `openPath` 去掉同路径幂等分支 → 「同路径第二次打开返回同一个 id」用例必须报红。
5. `writeAndSettle` 把「按 session 比对」改回「按全局 filePath 比对」→ 「后台标签落盘不影响别的标签 dirty」用例必须报红。
6. `closeTab` 把落点从 MRU 改成「左边那个」→ 「落点是上一个访问过的标签」用例必须报红。

### 9.5 负向回归用例（照 PM 转述的 MarkText 未决 issue）

**「编辑过但未保存的文档在关闭时被静默丢弃」** 是竞品已知的未决缺陷（PM 转述的 MarkText issue #5614）。本方案必须有一条**负向回归用例**守住：

- 用例：打开文件 → 输入 → 立刻关闭该标签 → 断言「弹了确认」且「用户选取消后文件内容没变」。
- 判据打在**确认弹层是否出现**与**取消后磁盘内容未变**这两个**该路径特有**的可观测差异上；**不得**只断言「toast 数量」（HANDOFF §4 ⑱ 的教训：错误路径的文案不同、条数同样是 1）。

---

## 10. 风险登记

> 每条 = 触发条件 + 后果 + 缓解措施 + **能否被自动化守住**。
> 「守不住」的一律标为**必须真机验**，并进 §6 目视清单。

| # | 风险 | 触发条件 | 后果 | 缓解措施 | 自动化守得住吗 |
|---|---|---|---|---|---|
| R1 | **切标签丢内容**（`session.state` 没回写） | 事务后未把 `view.state` 写回 `session.state` | 切走再切回，内容回退到旧版本（静默丢稿） | 每次 `docChanged` / `selectionSet` 都回写（§4.3）；`tab-activate.test.mjs` 断言切回后 `view.state.doc` 是最新内容 | **守得住**（真实 EditorView 驱动） |
| R2 | **`setState` 后滚动归零** | 切标签 | 用户切回来位置丢失，体感像「文档被重置」 | per-session `scrollTop` + rAF 恢复（§5.2 步骤 2/9） | **守得住**（断言 `scrollDOM.scrollTop`） |
| R3 | **表格提示残留** | 切标签未 clear | 状态栏显示上一个文档的「表格没渲染」 | `resetTableHint(state)`（§4.7） | **守得住** |
| R4 | **大纲 / 度量缓存串档** | 切标签未 `invalidateMeasure` | 大纲高亮指向错误的标题 | §5.2 步骤 12 | **守得住** |
| R5 | **图片资源指向旧目录**（`/doc-assets/` 仍指上一个文档） | `applyDocPath` 在 `setState` 之前调用 | 切过去的标签里图片 404 / 显示旧文档的图片 | 严格顺序：`setState` → 切 `activeId`（§5.2 步骤 5/6） | **部分守得住**：`applyDocPath` 的调用顺序可测；**真机的图片实际加载必须真机验**（WKWebView 的加载行为与 headless Chrome 不同构，HANDOFF §4 ㉑） |
| R6 | **Go 侧 dirty 映射漏清** | 标签关闭未 `ForgetDoc`；或路径变化未迁移键 | 关窗口时被一个已不存在的文档挡住（多弹确认）；或漏拦（丢稿） | §6.2 的键迁移 + `ForgetDoc`；Go 测试直接断言 `anyDirty()` | **守得住**（Go 单测） |
| R7 | **未落盘标签的键与真实文件撞车** | 未落盘身份未用 `u:` 命名空间 | 脏状态误命中某个真实文件 → 关窗口误拦 | `"u:"` 前缀与 16 位 hex 不相交（Go 测试断言不等） | **守得住** |
| R8 | **同一文件开两个标签** | 未做同路径幂等 | 两个标签共享 docKey → dirty 映射退化（ADR-005 单义被破坏） | §5.1 的 `findByPath` 幂等分支 + 测试断言 `sessions.length` 不变 | **守得住** |
| R9 | **`openSeq` 竞态语义改错** | 仍按「后一次取代前一次」丢弃结果 | 用户点的第一个文件永远打不开 | §5.1：结果照常建标签，只是不抢焦点 | **守得住** |
| R10 | **IME 合成中切标签**（**已升为 P0** —— PM 缺口 2 的裁决） | 拼音/日文组字过程中切标签 | 预编辑文本丢失（未上屏的那几个字消失）。zh-CN / ja-JP 是已发布的两个 locale，IME 是它们的主输入路径 → 这是**主路径上的数据丢失类缺陷** | §5.2 **步骤 0 的 IME 守卫**：检测 `view.composing`（`@codemirror/view` 的 `index.d.ts:776`）为真时**延迟切换**到合成结束（预编辑文本正常提交进当前标签，不丢字）。**不是**阻断式提示（会打断 CJK 用户的自然流程）、**不是** hack 强制提交（CM6 无公开 API，风险高于收益） | **部分守得住**：「合成中不立即换 state / 合成后切换发生且文本已提交」可测；**真机的 IME 行为必须真机验**（HANDOFF 第十一轮：用 `dispatchKeyEvent` 送半角**验不出**输入法问题）。**且这一项的结论会反过来改写 §5.2 的时序 → 必须抢在 §5.2 定稿前验（§11 的 P0b 闸门）** |
| R11 | **自动保存定时器跨标签串写** | `saveTimer` 仍是全局变量 | A 标签的防抖触发时写 B 标签的内容 | `saveTimer` 改 per-session（§4.4） | **守得住** |
| R12 | **落盘判定用了全局 filePath** | `writeAndSettle` 仍按全局比 | 后台标签落盘时把别的标签的 dirty 误清 / 误留 | §4.4 的按 session 比对 | **守得住** |
| R13 | **App.vue 破 150 行门禁** | 新增装配行未腾行数 | CI 红；或有人为了过门禁而删装配行 | §4.11 的行数预算 + 用 `countTotalLines` 实测 | **守得住**（契约 5 本身） |
| R14 | **改门禁引入假绿灯** | 豁免阈值下调 / 契约 3 判据改动后没做元测试 | 门禁形同虚设，给出虚假保证 | §9.4 的元测试清单 + 变异自证 6 个方向 | **需人工执行**（元测试是流程约束，无法被门禁自身守住） |
| R15 | **标签栏拖拽在 WKWebView 上的行为** | HTML5 拖放在 WebKit 上表现与 Chrome 不同 | 拖不动 / 拖出残影 / 顺序错乱 | 用 `pointerdown/move/up` 自实现拖拽（不依赖 HTML5 DnD），或先做 HTML5 版并在真机验 | **部分守得住**：拖拽顺序逻辑可测；**真机的拖拽手感必须真机验** |
| R16 | **标签栏右键菜单在 WKWebView 上的行为** | `contextmenu` 事件在 WKWebView 的默认行为 | 菜单不弹 / 与系统菜单打架 | 监听 `contextmenu` 并 `preventDefault()`；真机验 | **部分守得住**：事件处理可测；**真机必须验** |
| R17 | **⌘W 语义争议** | 用户按 ⌘W 期望关标签，Inkmark 无反应 | 体验割裂 | 本轮不绑 ⌘W（§0.4-3）；关闭标签用 `⌘⌥W` + 标签上的 × 按钮 + 右键菜单；是否改用 Zettlr 式 ⌘W 交 team-lead 裁决（D2） | **守不住**（属产品决策） |
| R18 | **Tab Switcher 的 keyup 丢失** | OS 吞掉 keyup / 焦点离开 | 停在错误的标签 | 每次 keydown 已完成切换，keyup 只影响「浮层是否还显示」；keyup 丢失 → 浮层残留直到下次切换 | **部分守得住**：切换结果可测；**浮层残留的观感必须真机验** |
| R19 | **后台标签自动保存覆盖磁盘文件** | 用户在外部编辑器改了同一文件 | 外部改动被覆盖 | 与 AC-13 既有裁决同类；「同路径幂等」保证不会出现两个标签写同一文件 | **守不住**（外部文件系统状态不可自动化）——需在目视清单里列为用户可见行为 |
| R20 | **标签状态持久化写坏了用户数据** | 重启恢复时用旧内容覆盖磁盘新内容 | 用户在外部改过的文件被旧标签内容覆盖 | 恢复时**只读不写**：恢复出来的标签 dirty 一律置 `false`（内存 := 磁盘，因为内容就是从磁盘读的）；自动保存只对「恢复后用户又编辑过」的标签生效 | **守得住**（恢复逻辑可测） |
| R21 | **「按住循环」退化成「在最近两个标签间抖动」**（PM 缺口 1） | 按住 `⌘⌥→` 时按**实时 MRU** 循环，而「每次激活把目标移到 MRU 头部」实时重排了 MRU | 第三个及以后的标签**永远轮不到**；「按住循环」这个功能等于没有 | **按住周期内使用「首次按下瞬间的 MRU 快照」**（§4.10）；降级路径（浮层坏了）**必须用同一份快照**，否则降级反而更糟 | **守得住**：判据 =「按住一次，被访问过的标签**包含全部 N 个**」，**不断言最终停在哪一个**（落点取决于最后一次 keydown 的时序） |
| R22 | **`filePath` 出现第二个写入者**（QA 的 R-9） | 多标签下 `filePath` 从 1 个写入点变成 5 个触发场景（打开 / 另存为 / 重命名 / 切 tab / 关 tab），某处直接赋值 | 「装饰已按新 tab 重算、路径还没翻」的错位 → 图片地址指向**错目录**（R5 的放大版） | **`filePath` 是只读派生值**，路径变更只能走 `setActivePath(nextPath)`（§4.3 的唯一写入者不变量）；现存的 3 处直接赋值（`useFileOps.js:93,166`、`useDocumentState.js:213`）全部收敛 | **守得住**（可加断言：`filePath` 的写入点只有 `setActivePath` 一处） |
| R23 | **「无激活会话」分支漏改**（PM 缺口 3 的连带） | 引入零标签空状态后，某处仍假设 `activeSession` 非空 | 空状态下抛异常 → **白屏**（本仓最严重的失败形态）；或 `title` / `wordCount` 等显示 `undefined` | §4.3 的 `enterEmptyState` + §7 的「空状态派生状态表」逐项列出兜底值；所有读 `activeSession` 处一律用 `?? ''` / `?? 0` / `?? false` | **部分守得住**：兜底值可测；**「是否还有漏读的读取点」只能靠 P1 实测确认**（本仓此前有「构造期读 getter 命中 TDZ → 白屏」的同类事故，HANDOFF §4 ⑥） |
| R24 | **`⌘⌥→` / `⌘⌥←` 被 macOS 系统占用** | 系统级快捷键抢占（`⌃⇥` 就是反例：COMMANDS 表里空闲，但 macOS 系统占用它做「切换窗口」） | 用户按了没反应，或与系统行为打架 | 列入 §13.3 第 2 项与 **P0b 闸门**，**必须在 macOS 真机上核实**（PM 明确要求：不能只在 Win/Linux 验） | **守不住**（系统级占用只能真机验）→ 故列为 P0b 闸门项，**未核实不得进 P1** |

---

## 11. 实施拆解与顺序

> 每阶段**可独立提交、独立验证**，回滚代价递增。

**【P0b 行为定稿闸门】—— PM 的顺序要求（2026-10-28）**

PM 指出：本方案新增的约 10 个真机依赖项里，有**四项的结论会反过来改写已写的代码**，若排在收尾验就可能推翻实现：

| 项 | 会反过来改什么 | 闸门要求 |
|---|---|---|
| **IME 合成中切标签**（R10，P0） | 改写 `activateSession` 的**步骤 0**、光标恢复与 `scrollTop` 恢复的先后顺序 → **改写 §5.2 时序本身** | **必须抢在 §5.2 定稿前**。产出：真机 IME 行为结论 + §5.2 步骤 0 的最终口径 |
| 标签栏拖拽实现机制（R15） | 决定用 HTML5 DnD 还是 Pointer Events 自实现 → 改写 `TabBar.vue` 的实现 | 拖拽**手感**（能否拖动、有无残影）必须早验；但**实现机制**可在 P4 前定 |
| 右键菜单（R16） | 决定是否需要 `preventDefault()`、菜单定位实现方式 → 改写 `TabContextMenu.vue` | 真机验「菜单能否弹出、是否与系统菜单打架」 |
| `⌘⌥→` / `⌘⌥←` 是否被 macOS 占用 | 若被占用 → 键位要换（影响 §4.12 与 README 速查节） | **必须在 macOS 真机上核实**（PM 明确要求：不能只在 Win/Linux 验） |
| 切换延迟观感 | 只影响体验，不改架构 | 可排在 P4 之后 |

**闸门口径**：这四项**在 P1 开工前完成取证**，产出写进本方案（更新 §5.2 / §4.12 / §4.9），再开始写实现代码。**理由**：它们属于「会反过来改架构」的验证，与「只影响体验」的验证不同类，混在收尾验就等于把架构押在一堆未完成的真机债上。

| 阶段 | 内容 | 完成判据 | 回滚代价 |
|---|---|---|---|
| **P0 地基** | ① `createEditor.js` 抽出 `editor/extensions.js`（`buildExtensions` + `createEditorState`）；② `createEditor` 接受外部 extensions；③ `createEditor.js` 豁免阈值下调（257 → 约 105）；④ App.vue 腾出 6 行（方案 b+c+d） | `npm test` 全绿 + `npm run build` 通过 + 契约 5 绿（`createEditor.js` 与 `App.vue` 行数均达标）+ **阈值下调的元测试已实做**（推过阈值 → 报红 → 还原转绿） | **低**。纯搬迁，无行为变化。`git revert` 一个提交即回 |
| **P0b 行为定稿闸门** | **不写实现代码**，只做 3 项真机取证并回写本方案：① `⌘⌥→`/`⌘⌥←` 在 macOS 上是否被系统占用（占用则要换键位 → 影响 §4.12 与 README 速查节）；② 标签栏拖拽在 WKWebView 的行为（能否拖动 / 有无残影 / 需不需要改用 Pointer Events）；③ 右键菜单在 WKWebView 的行为（能否弹出 / 要不要 `preventDefault`） | 三项都有**书面结论**（结论 + 依据），并已回写 §4.12 / §4.9。**未完成不得进 P1** | **零**（不产生代码）。但三项里两项会推翻已写的实现 |
| **P1 会话注册表 + 标签栏骨架** | ① `useEditorSession` 持有 `sessions` / `activeId` / `mru`；② `createSession` / `findByPath` / `activateSession` / `removeSession` / `setActivePath`；③ 派生状态改 computed + `filePath` 唯一写入者不变量；④ **IME 守卫（§5.2 步骤 0）**；⑤ **空文档态**（MD-08：关掉最后一个标签 → 保留一个未落盘、空内容的 session，**不新增组件**）；⑥ `TabBar.vue`（渲染 + 关闭按钮 + `data-state` 标记，拖拽与右键菜单留 P4）；⑦ 装配进 App.vue | ① 能开两个标签并来回切换，**内容与光标各自独立**；② 同路径幂等；③ 表格提示 / 大纲 / 预览 / 行列全部随标签正确切换（**等 ≥150ms 再断言**，防漏掉 120ms 延迟失败）；④ IME 守卫：合成中请求切换**不立即换 state**，合成结束后切换发生且预编辑文本已提交；⑤ 关掉最后一个标签 → **应用不退出**、编辑器落到空文档态（MD-08）；⑥ App.vue ≤150；⑦ 变异自证方向 1/2/3/4 全部报红 | **中**。已改动 `useEditorSession` 的对外导出形态（`filePath` 从 ref 变 computed），回滚需连带回滚 `useFileOps` / `useDocumentState` 的跟随改动。**建议单独一个提交，不与 P2 混** |
| **P1b IME 真机闸门（MD-11）** | **P1 之后立刻**做 IME 合成中切标签的真机验证（**不等 P2/P3**）。产出：真机 IME 行为结论 + 必要时修订 §5.2 步骤 0 的实现细节 | ① 真机上「合成中点另一个标签 → 预编辑文本**一个字不少**地提交进原文档」；② 结论回写本文 §5.2；③ 若机制不成立 → 修订 §5.2 步骤 0 并重跑 P1 的相关用例 | **低**（不改架构主体）。但**这一项是 P0 级风险**（MD-11 定为「P1 之后立刻」）；§5.2 的机制（延迟切换）已在 P1 之前定稿，故 P1 不是建在未知之上 |

| **P1 会话注册表 + 标签栏骨架** | ① `useEditorSession` 持有 `sessions` / `activeId` / `mru`；② `createSession` / `findByPath` / `activateSession` / `removeSession` / `setActivePath`；③ 派生状态改 computed + `filePath` 唯一写入者不变量；④ **IME 守卫（§5.2 步骤 0）**；⑤ **空状态**（`enterEmptyState` + `EmptyState.vue`，PM 缺口 3）；⑥ `TabBar.vue`（仅渲染 + 关闭按钮 + `data-state` 标记，拖拽与右键菜单留 P4）；⑦ 装配进 App.vue | ① 能开两个标签并来回切换，**内容与光标各自独立**（`tab-activate.test.mjs` 绿）；② 同路径幂等（`tab-session.test.mjs` 绿）；③ 表格提示 / 大纲 / 预览 / 行列全部随标签正确切换（**等 ≥150ms 再断言**，防漏掉 120ms 延迟失败）；④ IME 守卫：合成中请求切换**不立即换 state**，合成结束后切换发生且预编辑文本已提交；⑤ 空状态：关掉最后一个标签 → `sessions.length === 0`、应用不退出、两个入口可见；⑥ App.vue ≤150；⑦ 变异自证方向 1/2/3/4 全部报红 | **中**。已改动 `useEditorSession` 的对外导出形态（`filePath` 从 ref 变 computed），回滚需连带回滚 `useFileOps` / `useDocumentState` 的跟随改动。**建议单独一个提交，不与 P2 混** |
| **P2 per-session 持久化** | ① `useDocumentState` 状态改 per-session；② `switchFile` / `resetSession` 退役；③ `writeAndSettle` 按 session 取 path 与 content（**写盘单元同源**）；④ `useFileOps` 改为「打开 = 开标签」，`openSeq` 语义变更；⑤ `newFile` 改为新标签；⑥ `useTabLifecycle` 落地（关闭 / 落点 / 快照留底 / 确认弹层 / closedStack 存位置） | ① 每个标签的 dirty / saveState 互相独立（`tab-dirty.test.mjs` 绿）；② 后台标签的自动保存写到**它自己的文件**（判据：每条 `(path, content)` 记录都满足 `content === 那个 path 对应 tab 的内容`，**不是**「写盘次数 == 1」）；③ **状态栏显示的是「当前标签」的保存态**（PM 对 D1 的补充要求 —— 切到某个标签时必须显示**那个标签**的保存中/已保存/失败，否则用户看到「自己没动过的文档显示已保存」会困惑并诱发重复手动保存）；④ 关闭脏标签会弹确认，取消后内容不变（§9.5 负向用例绿）；⑤ 落点是 MRU 里上一个访问过的标签（`tab-close.test.mjs` 绿）；⑥ 变异自证方向 5/6 报红 | **中高**。`useDocumentState` 的语义面改动大，回滚需连带回滚 P1 的部分 |
| **P3 Go 侧 dirty 映射（ADR-005 §四）** | ① `app.go`：`dirtyByDoc` / `SetDirty(docIdentity, d)` / `ForgetDoc` / `anyDirty` / `dirtyKeyOf`；② 前端 per-session dirty 镜像 diff；③ `TitleBar` 新增 `anyDirty` prop，`CloseWindow(props.anyDirty, …)`；④ `OnBeforeClose` 读 `anyDirty()` | ① Go 单测 `app_dirty_test.go` 绿 + 变异自证报红；② 「编辑 A → 切到 B → 关窗口」弹确认（真机验）；③ 「编辑 A → 保存 → 关窗口」不弹；④ `confirmClose` 判定本体**逐字未改**（`git diff` 可查） | **中**。Go 侧与前端镜像成对回滚；单独回滚 Go 侧会让前端调用旧签名 → 编译失败（这是好事：不会静默不一致） |
| **P4 交互完善** | ① `TabBar` 拖拽重排（实现机制按 P0b 结论）；② `TabContextMenu`（关闭 / 关闭其他 / 关闭右侧）；③ `TabSwitcher` 浮层（**MRU 快照语义**，§4.10）；④ 5 条新命令 + `COMMANDS` 表 + `useCommands` 注册；⑤ README 快捷键节 +5 行 + 「67 条命令 / 55 项键位」；⑥ 三语 i18n 补 key；⑦ 标题栏脏点按 D4 结论统一视觉档位 | ① `verify-shortcuts.mjs` 绿（三方一致）；② 契约 1 绿（5 条命令都有处理器）；③ **按住 `⌘⌥→` 一次，被访问过的标签包含全部 N 个**（不是「只抖最近两个」，PM 缺口 1）；④ 拖拽重排后顺序持久（重启仍在）；⑤ 右键菜单三条都生效；⑥ 脏标记的 `data-state` 四态齐全（AC-72）；⑦ 变异自证：`COMMANDS` 加一条不注册 → 契约 1 报红 | **低**。纯增量，可整块回滚而不影响 P1–P3 |
| **P5 标签状态持久化** | ① localStorage key `inkmark-tabs`：**已落盘**标签的路径 + 顺序 + 激活项 + 每标签 scrollTop；② 启动时恢复（逐个 `ReadFile`，失败的跳过）；③ **未落盘标签的内容持久化**（PM 对 D6 的补充要求 —— 见下） | ① 重启后标签列表 / 顺序 / 激活项 / 滚动位置都回来；② 恢复出来的标签 `dirty = false`（内存 := 磁盘）；③ 磁盘上已被删除的文件被跳过且不报错；④ 恢复过程不覆盖磁盘文件（只读）；⑤ 未落盘内容：重启后能恢复，**恢复时提示「已恢复上次未保存的文档」** | **低**。独立开关，失败时清掉该 key 即可退回单标签 |
| **P5b 未落盘内容持久化**（**可延后，但必须显式登记**） | ③ 的实现：把未落盘文档的**内容**也写进 localStorage（PM 的产品立场：VS Code Hot Exit / Zed `session.restore_unsaved_buffers` 都做这件事；「新建一个文档写了几段，误关了应用，稿子没了」对写作工具是不能接受的） | 若本轮窗口不够，**本项延后**，但必须在 `HANDOFF` §7「已知未做」里**显式登记为已知缺口**（写明：未落盘文档的内容不跨重启保留），**不得默默不做** | **低** |
| **P6 收尾与登记** | ① `ADR-005` §四 增补（PM 对 D3 的要求：ADR 必须在同一批次修订，否则文档与 ADR 长期表述不一致）；② `HANDOFF` §6 目视清单加标签页相关项（≥8 项）、§7「零多标签页」条目更新 + **P5b 未延后则登记缺口**；③ `README` 数字声明（测试条数 / suite 数 / App.vue 行数）；④ `verify-readme-claims.mjs` 绿 | ① 全部 9 项门禁绿；② `verify-readme-claims.mjs` 绿；③ 目视清单副本 `docs/qa/visual-checklist.html` 同步（`verify-visual-checklist.mjs` 绿） | **极低**。纯文档 |

**依赖关系**：P0 → **P0b** → P1 → P2 → P3 → P4 → P5 → P5b → P6。P4 与 P5 可并行（不同文件），但**不建议并行提交**（本仓的并发纪律：一时刻只允许一个人写仓库，见 `contracts.test.mjs:43-123` 的并发守卫）。**P0b 是闸门不是阶段**：它不产出代码，但未过闸不得进 P1。

**总工作量估计**：按本仓既有节奏（参考 `docs/plan/focus-mode-architecture.md` 的 6 步拆解），P0–P3 约 5–6 天、P4 约 2 天、P5 约 1 天、P5b 约 0.5 天、P6 约 0.5 天，合计 **9–11 个工作日**（单人）。**P0b 闸门另需 0.5–1 天真机取证**（不写代码，但 IME 一项就可能改写 §5.2 的时序）。开发成本模型（`references/cost-models/development-costs.md`「桌面端 MVP · 文档处理 4–8 周 / 2–4 人月」）显示本轮属该区间的**小增量**（约 0.35 人月），因为复用既有编辑器与持久化基建，不新建渲染栈。

---

## 12. 决策：已全部裁决，本文只引用不定义

> **本节不再是「待裁决清单」。** 2026-10-28 的 Phase 1 一致性检查发现：决策被摊在三份文档的三个编号体系里（架构 `D1–D8`、测试计划 `D-1–D-10`、team-lead 首轮 `D1–D13`），**多数同号不同事** —— 会上说的「D5 定了」在两份文档里指两件完全不同的事（一致性复查 C-3）。
>
> ⇒ **决策的唯一真源 = `docs/decisions/MD-2026-10-28-multi-tab.md`（MD-01…MD-15）**。本文**引用** `MD-xx`，**不得定义**决策（该文件 §6 变更纪律）。
> ⇒ **本文原先的 D1–D8 编号作废**，一律改用 `MD-xx` 引用（避免同号不同事再次发生）。

| 议题 | 决策（引用） | 本文对应章节 |
|---|---|---|
| 后台标签是否自动保存 | **MD-01**：也自动保存（选项 a） | §6.5、§11 的 P2 判据 |
| 关闭标签的键位 | **MD-02**：`⌘⌥W`，**不绑定 `⌘W`** | §4.12 |
| 未落盘新文档的 dirty 初值 | **MD-03**：`false` | §6.4 |
| 脏 / 异常标记的 token 与互斥规则 | **MD-04**：dirty=`--meta` / error=`--danger` / 未落盘=`--warn`；**优先级 error > 未落盘 > dirty，互斥、同一时刻只显示一个** | §4.9、§9.2 |
| `⌘1..9` 数字直跳 | **MD-05**：不提供 | §4.12、§5.5 |
| 标签状态持久化 | **MD-06**：localStorage，**且必须存未落盘标签的内容**（最近 10 个，超出丢最旧）；**恢复过程只读不写** | §11 的 P5 |
| 切走时脏标签是否留底快照 | **MD-07**：**留底** | §5.2 步骤 2、§5.3 步骤 ① |
| 关到只剩一个标签 / 关闭最后一个标签 | **MD-08**：**保留一个空文档**（沿用现状 `filePath === ''` 空态），应用不退出；**不新增专用空状态组件** | §5.3 步骤 ④、§4.11 |
| 关闭后的落点策略 | **MD-09**：history（MRU 里上一个访问过的） | §4.5、§5.3 步骤 ④ |
| Tab Switcher「按住循环」的语义 | **MD-10**：用「**按下瞬间的 MRU 快照**」 | §4.10、§5.5 |
| IME 合成期间切标签 | **MD-11**：**P0 级风险，P1 之后立刻真机验证**（不等 P2/P3） | §5.2 步骤 0、§10 的 R10、§11 |
| 规格即契约 | **MD-12**：Spec 是唯一真源，AC 编号以 Spec 为准 | §9.2、§9.3 |
| ADR-005 §一 的修订 | **MD-13**：**本轮即改**（不拖到 P6），状态改 `Accepted (Amended 2026-10-28)` | §6.4、§8.2、§11 的 P2/P3 |
| 落点策略的**回退规则** | **MD-14**：三档统一回退 history；**history 无候选时回退到「显示序里的第一个剩余标签」**；**拒绝** neighbour 的两级回退（等价变异） | §4.5、§9.2 |
| 关闭**非激活**标签是否改变当前激活标签 | **MD-15**：**不得改变** | §5.3 步骤 ④ |

**已并入本文的裁决细节（不改历史行，只在本文引用）**：

- **MD-04 的判据形态**：用**绝对相等**判据 —— 脏标记的计算色必须**精确等于** `--meta` 的解析值，异常标记精确等于 `--danger` 的解析值；**不用相对判据**（如「≥3:1 且 < danger 的对比度」过弱：任何更浅的颜色都能混过去，将来有人把 `--meta` 换成 `--muted` 仍会通过，而那正是 MD-04 要排除的）。且必须**对 `--surface` 算**、**三个主题都要验**（纸感主题 `--meta` 对 `--surface` 仅 3.07:1，只比 WCAG AA 对非文本图形对象的 3:1 下限高 0.07）。
- **MD-04 同时约束标题栏与标签栏**（两处 chrome 统一）：`TitleBar.vue` 的 `.tb-dirty` 须一并降为 `var(--meta)`；异常态用 `var(--danger)`。属**既有视觉契约变更**，须进目视验收。
- **MD-08 覆盖了 PM 缺口 3 中「新增专用空状态组件」的部分**：产品结论（应用不退出）一致，但实现形态按 MD-08 走 —— **保留一个空文档**、**不新增 `EmptyState.vue`**，理由是保住 `App.vue` 的行数预算（§4.11）。本文 §4.3 / §5.3 / §7 / §8.1 已按此改写。
- **MD-13 使 ADR-005 的修订从 P6 前移到 P2/P3**（与 dirty 语义落地同批），不留口径分歧。

**未决与外部条件**（不在 MD 文件裁决，见 `docs/decisions/OPEN-DECISIONS.md`）：macOS 签名与公证（外部条件）；29 项目视清单 + 标签页新增项的真机验收（需人工在真实窗口操作）；Typora 官方快捷键页内容（**未逐字核实**，不得进入任何 AC）。

---

## 13. 端到端验证步骤

> 按 `references/01-standards/spec-as-contract.md` §4「规格的收尾即验收」：可执行、覆盖核心成功流 + 关键错误/边界流。

### 13.1 自动化部分

```bash
cd frontend && npm test && npm run build          # 测试网 + 构建
cd .. && PATH=/usr/local/opt/go/bin:$HOME/go/bin:$PATH go vet ./...
CGO_ENABLED=1 /usr/local/opt/go/bin/go test ./...  # 含新增 app_dirty_test.go
node scripts/verify/verify-shortcuts.mjs          # 键位三方一致
node scripts/verify/verify-readme-claims.mjs      # README 数字 ↔ 实测
node scripts/verify/verify-readme-paths.mjs       # README 路径存在性 + 根 Go 文件登记
node scripts/verify/scan-i18n-residue.mjs         # i18n 残留
./scripts/p0-check-emoji.sh frontend/src main.go app.go
node scripts/smoke/render-check.mjs               # 真渲染冒烟（dev + dist 双路径）
```

### 13.2 交互探针（验「静默失败」类缺陷）

新增 `scripts/probe/probe-tabs.mjs`（CDP + 无头 Chrome，与既有 `scripts/probe/*` 同构），覆盖：

| # | 场景 | 断言（打在该路径**特有**的可观测差异上） |
|---|---|---|
| 1 | 开两个文件 → 切来切去 | 每次切换后 `view.state.doc.toString()` 等于目标文件内容；**不是**断言 toast 条数 |
| 2 | A 标签输入 → 切到 B → 切回 A | A 的内容仍是最新（含未自动保存的那几个字）；光标位置恢复 |
| 3 | 切标签后表格提示 | 状态栏不再显示上一个文档的表格提示 |
| 4 | 切标签后大纲 | 侧栏大纲条目与当前文档一致 |
| 5 | 切标签后图片 | 预览面图片 src 指向**新**文档的 `/doc-assets/` 路径 |
| 6 | 脏标签关闭 | 弹出确认弹层；选「取消」后标签仍在、磁盘内容未变 |
| 7 | 后台标签自动保存 | 切到 B 后 1 秒内 A 的文件在磁盘上已更新（读盘验证） |
| 8 | 关闭后落点 | 关闭当前标签后激活的是**MRU 里上一个访问过的**标签（不是左边那个） |
| 9 | **按住循环的 MRU 快照**（PM 缺口 1） | 开 A/B/C 三个标签 → 按住 `⌘⌥→` 不松开、至少触发 3 次 keydown → 断言**被访问过的标签包含 A、B、C 三个不同的标签**（**不断言最终停在哪一个** —— 落点取决于最后一次 keydown 的时序）。这条能抓住「实时重排 MRU → 只在最近两个标签间抖动」的实现缺陷 |
| 10 | **IME 合成守卫**（R10，P0） | 合成中请求切换 → 断言 `view.state.doc` **仍是原文档**（没立即换）；合成结束后 → 断言切换发生且**预编辑文本已提交进原文档**（一个字都不能少） |
| 11 | **空状态**（PM 缺口 3） | 关掉最后一个标签 → 断言应用**未退出**、`sessions.length === 0`、编辑区是空文档、两个入口（新建/打开）可见；关掉最后一个**未落盘且有内容**的标签 → 断言先弹未保存拦截 |
| 12 | **派生状态不残留的等待窗口** | 切标签后**等 ≥150ms**（超过 `PREVIEW_DEBOUNCE_MS = 120`）再断言预览 / 字数 —— 只断言「切过去立刻」会漏掉 120ms 延迟失败 |

### 13.3 真机验收（自动化守不住的部分）

按 HANDOFF §6 的清单格式追加，每项写明「平台 / 验证人 / 日期 / 结论」：

| # | 项 | 为什么必须真机 | 闸门 |
|---|---|---|---|
| 1 | **IME 合成中切标签**（**P0**，R10） | 半角模拟验不出输入法问题（HANDOFF 第十一轮教训）；**且这一项的结论会反过来改写 §5.2 的时序** | **P0b 闸门**（必须在 §5.2 定稿前） |
| 2 | **`⌘⌥→` / `⌘⌥←` 是否被 macOS 系统占用** | COMMANDS 表里空闲 ≠ 系统未占用（`⌃⇥` 就是反例：表里空闲但 macOS 系统占用）。**PM 明确要求：必须在 macOS 真机清单里，不能只在 Win/Linux 验**；WKWebView + 中文输入法下修饰键被系统/输入法截走有先例 | **P0b 闸门**（占用则要换键位 → 影响 §4.12 与 README 速查节） |
| 3 | 标签栏的拖拽重排手感 | HTML5 / Pointer 拖放在 WKWebView 上的行为与 headless Chrome 不同构（HANDOFF §4 ㉑）；结论决定用 HTML5 DnD 还是 Pointer Events 自实现 | **P0b 闸门**（实现机制） |
| 4 | 标签右键菜单 | `contextmenu` 在 WKWebView 的默认行为需实测；结论决定要不要 `preventDefault()` | **P0b 闸门**（实现机制） |
| 5 | 切换标签的延迟观感 | `setState` 整棵重绘的实际耗时只能真机感知 | P4 之后（只影响体验） |
| 6 | 标签栏与标题栏的视觉一致性 | 像素级判断 | P4 之后 |
| 7 | 关窗口时的未保存确认（多标签） | Go 系统对话框在真机上的表现 | P3 之后 |
| 8 | 后台标签自动保存对外部编辑器的覆盖 | 涉及外部文件系统状态 | P2 之后 |
| 9 | 半透明窗口下的标签栏观感 | darwin 的 chrome 层不透明度低于 88% 会透出壁纸（MEMORY.md 实测 78% 即出问题） | P4 之后 |
| 10 | **空状态的观感**（PM 缺口 3） | 空状态是「零标签」这个新形态的首屏，用户第一次看到它时的可自解释程度只能目视 | P1 之后 |

---

## 14. 未验证项与已知分歧登记（如实登记）

| 项 | 状态 |
|---|---|
| `setState` 的实际重绘耗时 | **未实测**。本文所有关于「切标签 = 整棵重绘」的判断来自 `view.js:8094-8124` 的源码（`docView.destroy()` + `new DocView(this)`），**不是实测数据**。真机耗时见 §13.3 第 4 项 |
| `setState` 后 `scrollTop` 归零 | **基于源码推断**（`new ViewState` 不携带 scroll），**未实测**。P1 阶段必须实测确认并据此调整恢复策略（若 CM6 实际保留了 scrollTop，恢复代码就是无害的冗余） |
| `EditorState.create` 与 `history()` 的多实例隔离 | **基于 CM6 语义推断**（StateField 的值随 state 走），**未实测**。P1 的第一条验收就是「两个标签各有独立撤销栈」——**必须实测**，不能只看代码 |
| Tab Switcher 浮层的 keyup 丢失行为 | **未实测**。R18 的降级设计是按「每次 keydown 已完成切换」推出的，需真机确认观感 |
| 后台标签自动保存对磁盘文件的覆盖 | **未实测**（§13.3 第 7 项） |
| `⌘⌥→` / `⌘⌥←` 在 macOS 上是否被系统占用 | **未核实**。COMMANDS 表里空闲 ≠ 系统未占用（`⌃⇥` 就是反例：表里空闲但 macOS 系统占用）。已列入 §13.3 第 2 项与 P0b 闸门，**必须在 macOS 真机上核实**（PM 明确要求） |
| **IME 合成守卫的具体行为** | **未实测**。§5.2 步骤 0 选的是「延迟切换」，但「合成结束后如何可靠地收到信号」「挂起的切换请求何时释放」这两处机制**未实测**（`update.view.composing` 由 true 变 false 的那笔事务是否总存在，未验证）。**这一项会反过来改写 §5.2 的时序** → 已列为 P0b 闸门的第一项 |
| **按住循环的 MRU 快照在 keyup 丢失时的表现** | **未实测**。§4.10 的「超时未收到 keyup 则按新周期处理」是按「实时 MRU 头部已是上次落点」推出的，未在真机验证时序 |
| **空状态（零标签）的完整派生状态** | **基于源码推断**（`activeSession === null` → 各 computed 走 `?? ''` / `?? 0` 兜底），**未实测**。「无激活会话」分支在本仓是**全新形态**（此前 `filePath` 恒有值），需在 P1 实测确认没有遗漏的读取点 |
| 未落盘文档 dirty 初值与 ADR-005 §一 的分歧 | **待裁决**（D3）。本文按 (i) 写，若裁决为 (ii)，§4.3 的 `createSession` 初值与 §4.9 的标记判定需同步改。**PM 支持 (i)**，但要求 ADR-005 在同一批次修订（已列入 P6） |
| `ADR-005` 本身尚未按多标签形态修订 | 本文 §6 给出了落地形态，但 **ADR 修订属 P6**，在修订落地前，本文的 §6 与 ADR-005 §四 存在**表述层面的不一致**（§四 只说「docKey → dirty 映射」，未提未落盘命名空间与后台自动保存结论） |
| `docs/architecture/ADR-004-keybinding-map.md` 已过时 | 状态仍是「Proposed（2026-10-01）—— 待 team-lead 终审」，全文基于已删除的 `main.go buildMenu()`，其「⌘1/⌘2/⌘3 = 视图三态」假设已不成立（实测 `⌘1..⌘6` 现属 `format.h1..h6`）。**本方案未依据 ADR-004 设计任何键位**，但该 ADR 的过时状态本身应在 P6 一并处理（升为 Superseded 或重写） |
