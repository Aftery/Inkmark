# 方案 C「所见即所得」技术架构方案

- Status: Proposed（待评审，本轮只出文档不动代码）
- Date: 2026-09-30
- Owner: architect
- 范围（用户已拍板，不可更改）：CM6 Decoration 隐藏光标外行的 `#` / `**` 等源码标记，编辑区即预览区，取消分栏
- 事实源：`frontend/src/editor/createEditor.js`、`frontend/src/App.vue`、`frontend/src/preview/markdown.js`、`frontend/src/export/exporters.js`、`frontend/src/themes/preview.css`、`frontend/src/editor/outline.js`
- API 实证源码：`frontend/node_modules/@codemirror/view/dist/index.js`（下称 view.js）、`frontend/node_modules/@codemirror/language/dist/index.js`（下称 language.js）、`frontend/node_modules/@lezer/markdown/dist/index.js`（下称 lezer-md.js）、`frontend/node_modules/@codemirror/view/dist/index.d.ts`（下称 view.d.ts）

---

## 0. API 实证清单（本文所有断言的出处）

| API | 出处（文件:行） | 关键事实 |
|---|---|---|
| `Decoration.replace(spec)` | view.js:268-280 | 「replaces the given range with a widget, **or simply hides it**」（265-267 注释原文）；`spec.widget || null`（279）说明 widget 可省略 = 纯隐藏 |
| `Decoration.mark(spec)` | view.js:250-252 | 同 range 影响样式；嵌套按 facet 优先级决定内外层（242-248 注释） |
| `Decoration.line(spec)` | view.js:285-287 | 方案 B 专注模式在用（createEditor.js:106） |
| `WidgetType` | view.js:117-183 | `eq()` 127（避免重绘）、`updateDOM()` 135、`ignoreEvent()` 161（默认忽略全部事件）、`lineBreaks` 155、`coordsAt()` 169 |
| `EditorView.atomicRanges` | view.js:1545（Facet 定义）、8962（挂到 EditorView） | facet 输入签名 `(view) => RangeSet` |
| 光标跳过 atomic 范围 | view.js:3765（`skipAtomicRanges` 定义）、3809（selectionSet 应用）、4337/4382（其他选区更新路径） | 光标/选区自动越过被 replace 的范围 |
| 拖选跳过 atomic 范围 | view.js:4775（`MouseSelection` 构造时收集 `atoms`） | 鼠标拖选同样越过隐藏范围 |
| `syntaxTree(state)` | language.js:186-189 | 返回「current (**possibly incomplete**) parse tree」（180-184 注释原文）——树可能不完整 |
| `ensureSyntaxTree(state, upto, timeout)` | language.js:195-205 | 强制解析到指定位置，默认 50ms 预算 |
| markdown 节点名 | lezer-md.js:40-84（Type 枚举） | `ATXHeading1..6`=9-14、`SetextHeading1/2`=15/16、`Emphasis`=25、`StrongEmphasis`=26、`Link`=27、`Image`=28、`InlineCode`=29、`HeaderMark`=34、`QuoteMark`=35、`ListMark`=36、`LinkMark`=37、`EmphasisMark`=38、`CodeMark`=39、`FencedCode`=3、`Blockquote`=4、`BulletList`=6、`OrderedList`=7 |
| 标记 token 的现有着色 | lezer-md.js:1976 | `HeaderMark HardBreak QuoteMark ListMark LinkMark EmphasisMark CodeMark` 映射到 `tags.processingInstruction` → 现编辑器里这些标记呈 muted 色（createEditor.js:50） |
| IME 组合态（内部） | view.js:4547（`inputState.composing = -1` 初始，组合期间 >= 0）、5297/5303（compositionstart/end 翻转）、7716/7721 | |
| IME 组合态（公开） | view.d.ts:772-776 | `get composing(): boolean`——「the user is currently composing text via IME」 |
| 组合期间 DOM 保护 | view.js:2968-2981（DOM 更新前先 `findCompositionRange` 并把它并入 changedRanges）、2998-3004 | CM6 自身 DOM 同步对组合区有专门处理 |
| 组合与 widget 光标 | view.js:3148-3154（`suppressWidgetCursorChange`：「If a zero-length widget is inserted next to the cursor during composition, avoid moving it across it and disrupting the composition」） | 官方明示：widget + 组合输入相邻 = 已知干扰源 |
| 组合漂移检测 | view.js:7778-7782（`composing.drifted`） | CM6 检测组合期间 DOM/文档位置漂移并强制重建——重建代价直接表现为输入卡顿 |

---

## 1. 核心机制：标记隐藏的 Decoration 组合

### 1.1 总策略

**replace decoration 纯隐藏（不带 widget）为主 + 现有 syntaxHighlighting 承担渲染样式 + atomicRanges 让光标越过隐藏范围**。不新造一套「编辑器内 markdown-it」。

三个理由：

1. **渲染样式零新增成本**：行内元素的视觉呈现（粗体、斜体、行内代码、链接色、标题字号阶梯）在现栈里已经存在——`mdHighlight` 的 `t.strong` / `t.emphasis` / `t.monospace` / `t.link` / `t.heading1..6`（createEditor.js:19-29）就是按预览区阶梯写的。隐藏标记后剩下的就是「渲染后文本」，无需把 markdown-it 的 DOM 结构搬进 CM6。
2. **Decoration.mark 不需要用**：样式已由 HighlightStyle 覆盖，若再加 mark decoration 会产生双层 span，徒增 DOM 与优先级复杂度。mark 只在本文 §3 的块级底色场景以 `Decoration.line` 形式出现（已有先例：focusPlugin）。
3. **replace 不带 widget = 纯隐藏**（view.js:265-267 注释明示），DOM 里没有多余节点；带 widget 仅在图片（§1.2 图片行）一处。

### 1.2 逐元素装饰策略

扫描方式：一个 ViewPlugin 遍历 `view.visibleRanges`，对视口内每个 top-level 块用 `syntaxTree(view.state)` 的 cursor 做子树遍历，按下表挂 Decoration。所有 replace decoration 的挂载条件统一为：**该范围不与「活动块」（光标所在块，见 §2）相交**。

| 元素 | 语法树节点（出处见 §0 表） | 装饰 | 说明 |
|---|---|---|---|
| ATX 标记 `#{1,6}` + 空格 | `ATXHeading1..6` 的 `HeaderMark` 子节点 | `Decoration.replace()`（无 widget，纯隐藏） | 行号空格一起藏；标题字号/字重已有 `t.heading1..6`（createEditor.js:19-24），无需任何样式工作。setext 下划线（`===`）属 `SetextHeading` 的 `HeaderMark`，同一处理顺带覆盖 |
| 强调 `*` / `_` | `Emphasis` / `StrongEmphasis` 内的 `EmphasisMark` | `Decoration.replace()` 纯隐藏 | 斜体/粗体样式已有 `t.emphasis` / `t.strong`（createEditor.js:25-26） |
| 行内代码反引号 | `InlineCode` 的两个 `CodeMark` | `Decoration.replace()` 纯隐藏 | 等宽样式已有 `t.monospace`（createEditor.js:28） |
| 链接 `[text](url)` | `Link` 的 `LinkMark`（`[`、`]`、`(`、`)`）+ `URL` | 四个 `LinkMark` 纯隐藏；`URL` 也纯隐藏 | 光标在链接内（活动块命中）时整段原始形态 reveal；链接文字样式已有 `t.link`（createEditor.js:29）。参考式链接（`LinkReference`）第一版不处理，维持原样显示 |
| 图片 `![alt](url)` | `Image` | 光标外：整节点 `Decoration.replace({ widget })`，widget 渲染为行内 chip（alt 文本 + 小图标风格），CSS `max-height` 钳到 1.2em 防**行高变化**（见 §5 锚点与风险 R6）；光标内：原始形态 | 唯一必须带 widget 的元素。WidgetType 子类需实现 `eq()`（view.js:127）比较 alt+url，避免无谓重绘；`ignoreEvent()` 保持默认 true（view.js:161），点击不进 URL，第一版不支持点击打开（记入 §8 开放问题） |
| 列表 `-` / `1.` | `ListMark` | **第一版不隐藏**，改用 `Decoration.mark({ class: 'cm-md-mark' })` 弱化着色 | `-` 本身就是渲染态的 bullet 符号，藏掉后列表层级与缩进视觉全失；保留 + muted 色等价于预览区 `li::marker`（preview.css:89）的观感。此为设计决策，需 designer 确认（§8） |
| 引用 `>` | `QuoteMark` | 同列表：`Decoration.mark({ class: 'cm-md-mark' })` 保留弱化 | `>` 藏掉后引用块的「层」只剩底色；第一版加 `Decoration.line({ class: 'cm-md-quote' })` 给 Blockquote 各行上底色（复用 token `--surface-warm`），`>` 保留弱化。需 designer 确认（§8） |
| 围栏代码围栏行 | `FencedCode` 的首尾行（`CodeMark` 即 ``` 行本身） | 光标在块外：两行 `Decoration.replace()` 纯隐藏 + 全块各行 `Decoration.line({ class: 'cm-md-codeblock' })`（底色/边框，token 取 `--code-bg` / `--code-border`，对齐 preview.css:58-66）；光标进块：原始形态 | 语言标注行（`CodeInfo`）随围栏行一起隐藏。块内语法高亮已由 `markdown({ codeLanguages })` 混合解析承担（createEditor.js:132），且围栏行隐藏后 `t.monospace` 高亮不变 |

表格里「纯隐藏」全部注册进 `atomicRanges` facet（view.js:1545）：插件暴露 `(view) => this.decorations` 中 replace 部分的 RangeSet。这样光标左右移动、点选、拖选都会自动越过隐藏 token（view.js:3809、4775），不会出现「光标消失在墙里」。

**IME 兼容（必须实现的守卫）**：CM6 官方源码明示 widget/装饰与组合输入互斥（view.js:3148-3154 注释原文见 §0 表）。守卫写法：

```js
update(update) {
  if (update.view.composing) return          // 组合期间冻结装饰集（公开 getter，view.d.ts:776）
  this.wasComposing = false
  if (update.docChanged || update.selectionSet || update.viewportChanged)
    this.decorations = this.build(update.view)
}
```

- 组合期间返回旧装饰集：位置可能短暂过期（用户在打字，文本在变），但组合是亚秒级瞬态，且旧装饰只是「少藏了/多藏了一处」的视觉差，不会破坏输入。CM6 对自身 DOM 同步在组合期间有专门保护路径（view.js:2968-2981），我们的插件不动 DOM 就不与之冲突。
- 组合结束的下一帧：`compositionend` 会触发一次 docChanged（输入落地），且此时 `view.composing` 已翻回 false（view.js:5303），自然重建。为防极端时序，update 里补一条：`if (update.startState.view 不可得时)` 用插件自记的 `wasComposing` 兜底——上一帧在组合中、本帧不在，也强制重建（约 3 行）。
- **禁用时机**：活动块计算（§2）若在组合期间失效，reveal 范围冻结为组合开始时的块——中文用户在标题行打字时标题标记保持隐藏，行为正确。

### 1.3 为什么不用「mark + CSS 隐藏」方案

`Decoration.mark` + `font-size: 0` / `display: none` 看似更省事，但：`display:none` 的 span 会让浏览器光标定位（`posAtCoords`/`coordsAtPos`）在该点失真；`font-size:0` 留下不可见但可点的选区空洞，且不进 atomicRanges，光标会停进零宽字符间。replace + atomicRanges 是 CM6 一等公民路径（view.js:265-280、1545），选它。

---

## 2. 光标行 reveal

### 2.1 活动块边界算法

不复用 `paragraphRange`（createEditor.js:62-70），改用语法树块边界，理由：

- `paragraphRange` 以「空行」分块，对围栏代码块（内部可含空行）与列表项（连续非空行但属不同 ListItem）会切错块。WYSIWYG 的 reveal 粒度必须与 Markdown 块结构一致，否则「光标进代码块内空行 → 围栏行突然全显示」这类闪跳。
- 语法树现成可用：`syntaxTree(view.state)`（language.js:186）。实现：从光标 `head` 处 `tree.resolveInner(head, -1)` 向上爬到最近的可 reveal 块节点（`ATXHeading*` / `SetextHeading*` / `Paragraph` / `FencedCode` / `Blockquote` / `ListItem`），返回 `node.from / node.to` 作为活动块 `[bFrom, bTo]`。
- **树不完整的兜底**：`syntaxTree` 可能返回不完整树（language.js:180-184 注释明示「possibly incomplete」）。若 `resolveInner` 在光标处返回空树/未解析区间，退回 `paragraphRange`（已有实现，行为保守正确）。也可对视口范围调 `ensureSyntaxTree(state, to, 20)`（language.js:195，20ms 预算）预解析，视口级成本可忽略——二选一在实施步骤 2 实测定。

### 2.2 触发条件

与 focusPlugin 完全同构（createEditor.js:85-94 已验证过这套触发面）：

```
docChanged || selectionSet || viewportChanged
```

外加 §1.2 的组合态守卫。viewportChanged 必须有：滚到新区域要为新视口行建装饰；selectionSet 必须有：光标上下键只触发 selectionSet 不触发 docChanged。

### 2.3 与 focusPlugin 的共存

两个 ViewPlugin 各持独立 decorations、经各自 facet 输入叠加（`EditorView.decorations` 是多输入 facet，方案 B 已验证 focusPlugin 与语法高亮、updateListener 并列无冲突，createEditor.js:173-175）。合并策略：

| 场景 | focusPlugin（line: opacity） | wysiwygPlugin（replace/line: 隐藏与底色） | 冲突 |
|---|---|---|---|
| 专注开 + C 开 | 光标块 `cm-focus-active`，其余 `cm-focus-dim`（0.4 透明度） | 光标块原始形态，其余块标记隐藏 | **无冲突**：作用属性不同（opacity vs 替换 DOM），语义互补——光标块全亮且显示源码，外围淡化且显示渲染态。视觉审查留给 designer |
| 专注开 + C 开 + 引用块 | 引用行透明度 0.4 | 引用行 `cm-md-quote` 底色 | 底色也随 opacity 淡化，正确 |
| 扩展顺序 | 先 | 后（追加在 focusPlugin 之后） | line class 共存：CM6 支持同范围多个 line decoration（不同插件输入天然叠加），class 合并到同一 `.cm-line` |

唯一注意：两个插件都在每次 selectionSet 全量重建视口装饰，性能按两次算而非两次独立成本——见 R2，量级仍安全。

---

## 3. 渲染样式来源

### 3.1 原则：共享 Token，不共享选择器

方案 A 的教训是「导出模板是样式拷贝」（exporters.js:35-101 裸值内联是导出自包含的**必要**拷贝，属豁免；但编辑器内渲染若再拷一份 preview.css 就是第三份活字模）。C 的做法：

- **行内样式**（标题阶梯、粗斜体、行内代码、链接）：零新增 CSS，全部复用 `mdHighlight` 现有条目（createEditor.js:19-29）。这是 C 方案最大的红利。
- **块级样式**（引用底色、代码块底色/边框、列表缩进）：新增 `EditorView.theme` 条目挂在 createEditor.js 的 theme 里（现有 theme 块 134-172 处追加），值全部引用 CSS 变量（`var(--surface-warm)`、`var(--code-bg)`、`var(--code-border)`、`var(--font-mono)`），与 preview.css 同源 token（themes/tokens/design-tokens.css）。**不 import preview.css**：它的选择器全是 `.preview-body xxx` 后代选择器，而 CM 内容是扁平 `.cm-line` + span 结构，选择器对不上；引了也只会带进一堆死规则和特异性隐患。
- **类名对齐**：不追求与 markdown-it 输出类名对齐（对齐的前提是编辑器里真有那些 DOM 结构，而 CM6 里没有）。对齐点是 **token 层**：`.cm-md-quote` 用 `--surface-warm`，`.cm-md-codeblock` 用 `--code-bg/--code-border`，换主题/改色一处生效。
- **字号单源化（顺手修正，约 4 行）**：`mdHighlight` 的标题字号是硬编码 `2em/1.6em/...`（createEditor.js:19-23），与 token `--preview-h1-size` 等是两份值。C 实施时把这几个 `fontSize` 换成 `var(--preview-h*-size)`（HighlightStyle 的属性值最终落为 inline style，可用 var()），标题阶梯彻底单源。

### 3.2 空间度量对齐

`.cm-content` 的 padding 已与预览一致（createEditor.js:151 注释），正文 15px/1.7 一致（README 设计要点 4 的结论仍然成立）。围栏代码块底色引入后，代码行行高需与预览 `--leading-ui`（preview.css:65）核对，实施时在 theme 里给 `.cm-md-codeblock` 显式 `line-height`。

---

## 4. 三态 / 预览侧退役

### 4.1 决策：markdown-it 管线退役为「导出专用渲染器」，UI 分栏整体移除

- **`createRenderer` / `render`（preview/markdown.js）保留**，但从「常驻 computed」（App.vue:24 `previewHtml = computed(...)`）改为**按需调用**：仅 `exportHtml`（App.vue:444-449）与 `exportPdf`（App.vue:452-454）触发。理由见 4.3 与 R1。
- **UI 三态收敛为两态**：`viewMode: 'edit' | 'preview'`。`edit` = WYSIWYG 单栏（唯一写作态）；`preview` = 只读阅读态，仍用现有 preview DOM（保留它可白得「阅读模式」，且大纲预览侧跳转逻辑不用动）。`split` 态删除：分割条、`onDividerMove/onDividerUp/onDividerKeydown/resetSplit`、`editorWidth`、localStorage `inkmark-split` 全部退役（App.vue:486-539、605-626）。
- **此节含一个开放问题**：`preview` 态是否保留（§8 Q3）。若用户拍板彻底删除，`previewHtml`/`previewEl` 的 UI 部分也可退场，仅存导出渲染。

### 4.2 滚动联动退役路径

以下成员整体删除（App.vue 行号）：

- `collectPreviewAnchors`（131-141）、`getAnchors` 的双栏守卫与 `mapByAnchors`（144-168）
- `lastSyncWrite` / `isSyncEcho` / `onPreviewScroll`（177-220）
- `onEditorScroll` 中的联动段（保留 `scheduleOutlineSync()` 调用，删掉 189-202 的映射写入）
- `HEADING_SEL`（101）在保留 preview 态时仍被大纲跳转使用（384-399），**不删**；仅当 preview 态退役才删
- `setViewMode`（253-265）简化：去掉 split 分支；CM6 隐藏测量三道防线（onMounted 延后应用、恢复可见 requestMeasure）**原样保留**——preview 态隐藏编辑器的场景依然存在

### 4.3 @media print 硬验收（编辑态导 PDF 不空白）在 C 下的路径

现状依赖「预览 DOM 始终渲染」（App.vue:628-638 注释）。C 改为按需渲染后，`exportPdf` 改为：

```js
async function exportPdf() {
  previewHtml.value = render(renderer, markdown.value)   // 同步渲染一份
  await nextTick()                                        // 等 v-html 落 DOM
  window.print()
}
```

`@media print` 规则（App.vue:810-818）原样保留：`.preview-pane` 的 `display: block !important` 覆盖的是 v-show 的内联 display:none，机制不变。导出 HTML（App.vue:444-449）改为直接 `render(renderer, markdown.value)` 传给 `buildHtmlDocument`，不再依赖 computed。验收路径明确、无新增机制。

### 4.4 锚点缓存瘦身

`anchorsCache` / `anchorsDirty` 双侧锚点机制（App.vue:99-168）随联动退役；`outlineYsCache`（316-336）保留但只走编辑器侧 `collectEditorAnchors`（110-128，去掉 `viewMode === 'split'` 守卫改为 `!== 'preview'`）。`collectEditorAnchors` 依赖 `coordsAtPos`，WYSIWYG 下标题行行首仍然可度量（`#` 隐藏是行内替换，行首文档坐标不变；但**行折叠会改变 y**，见 §5）。

---

## 5. 滚动联动 / 锚点 / 大纲的影响

### 5.1 滚动联动

单栏化后联动对象不存在，整体退役（§4.2 已列清单）。这是纯删除，无回归面。

### 5.2 锚点序列的语义变化（实证后结论）

任务问「隐藏标记会改变行宽不改变行高？」——**实证结论：通常只改行宽不改行高，但存在行折变场景会改块高**：

- replace 无 widget 的纯隐藏 = 行内内容宽度缩短。行高由该行最高的 inline 盒决定，被藏的文本字符与剩余字符同字号同行高，**不换行的行行高严格不变**。
- **例外 1（行折）**：长标题/长段落若原本因标记字符折行，藏掉标记后可能少折一行 → 块高变化。标题行通常远短于限宽（`--preview-measure`），概率极低但非零。
- **例外 2（图片 widget）**：§1.2 图片 chip 若 CSS 未钳高，widget 高于文本行会撑高该行（WidgetType 默认 `estimatedHeight: -1`，view.js:148，CM6 对未知高度用估算）。缓解：chip 钳 `max-height: 1.2em; vertical-align: baseline`，保证不高于文本行。
- **例外 3（reveal 切换）**：光标移入/移出块 → 标记显隐切换 → 上述两例外叠加瞬时改高。

对 `collectEditorAnchors`（App.vue:110-128）的影响：标题 `line.from` 的 `coordsAtPos` 始终有效（行首文档坐标与装饰无关），序列**仍可收集**；但 y 值在 reveal 切换后会漂移。缓解：大纲高亮的 `outlineYsDirty` 失效点追加「selectionSet 且 head 跨块」（在 App.vue 层用 updateListener 的 `update.selectionSet && 块号变化` 置脏，约 5 行）。滚动联动已退役，锚点只剩大纲高亮一个消费者，漂移影响被限制在一次 rAF 重建内。

### 5.3 大纲：extractOutline 与 jumpToHeading 不受影响的论证

- `extractOutline`（outline.js:6-25）是 `doc.line(i)` 纯文本扫描，不读 DOM 不读装饰，WYSIWYG 装饰层对它完全透明。`#{1,6}\s` 仍在文档文本里（装饰只改视觉不改文档），提取结果不变。**零改动**。
- `jumpToHeading` 编辑侧分支（App.vue:394-398）：`dispatch({ selection: { anchor: item.pos }, scrollIntoView: true })`。跳到标题行行首 = 跳进活动块 → 该块 reveal，`#` 显示，光标可见，`scrollIntoView` 由 CM6 保证行进视口。行为正确，**零改动**。有一个交互细节：跳转后标题行显示源码形态（因为光标在上面），这是 reveal 语义的正确表现，designer 若想「跳转后立即隐藏」反而违背 C 的核心机制，不建议。
- `jumpToHeading` 预览侧分支（384-392）仅在保留 preview 态时存在，不受 C 影响。

---

## 6. 风险清单

### R1 markdown-it 常驻渲染的性能债（中）—— 已由 §4.1 按需化消除

现状 `previewHtml` computed 每键全量渲染（README 待办第一条）。C 退役常驻预览后此债顺带清掉：渲染只在导出时发生一次。残余：preview 态（若保留）进入瞬间做一次全量渲染，2000 行文档 markdown-it 渲染量级数十 ms，可接受；若卡，加 300ms debounce（已有既定预案）。

### R2 装饰重建性能（低-中）

每次 selectionSet/docChanged/viewportChanged 重建整个视口装饰集（含 focusPlugin 一份）。缓解：只遍历 `visibleRanges`（视口内行，通常 < 100）；`RangeSetBuilder` 有序构建（focusPlugin 同款，createEditor.js:98-111 已验证量级）；语法树由增量解析维护，`resolveInner` 是 O(树深)。残余风险：视口内嵌套密集（长列表嵌套）时子树遍历常数增大，实测超 2ms 再做「只扫视口 ± 一屏」收缩。

### R3 IME 组合输入（高，已有守卫）

最高优先级。源码证据链：CM6 官方注释明示组合期间零长 widget 会「disrupting the composition」（view.js:3148-3154）；组合期间 DOM 漂移会触发强制重建（view.js:7778-782），若我们的插件在组合中途增删装饰，等于主动制造漂移 → 中文输入丢字/候选框闪烁。缓解：§1.2 的 `view.composing` 冻结守卫 + `wasComposing` 兜底重建。**验收必须含**：搜狗/系统拼音在标题行、加粗词中间、行内代码中间连续输入，观察候选框与已上屏文字；这是 C 的 go/no-go 项。

### R4 atomicRanges 与拖选/双击行为变化（中，接受并文档化）

拖选会整体跳过隐藏范围（view.js:4775 实证）：用户无法用鼠标直接选中 `**` 字符。这不是 bug 是机制——要编辑标记就把光标移进块（reveal 后正常选）。需文档化 + designer 验收：双击选词、shift+方向键扩展选区在隐藏标记边界的行为（键盘选区路径 `skipAtomicRanges` 同样生效，view.js:3786-3792，行为一致性有保障）。

### R5 与 focusPlugin 的叠加闪烁（低）

两插件同帧重建，理论上存在「focusPlugin 先落 opacity、wysiwyg 后落 replace」的单帧中间态。CM6 的 decorations facet 多输入在同一次绘制事务里消费（view.js:4775 等处 facet 读取都在绘制前），实测若见闪烁，后备方案是把两插件合一（一个 ViewPlugin 双份 RangeSet 输出），成本 +30 行。步骤 6 回归专项验证专注模式 + WYSIWYG 同开。

### R6 图片 widget 行高漂移（低-中）

见 §5.2 例外 2。未钳高时：锚点 y 漂移、滚动高度估计抖动（CM6 高度缓存对 widget 高度不敏感，靠实测修正，拖底回弹老问题可能复现——方案 B 曾在联动上踩过同类坑）。缓解已定：CSS 钳 1.2em + WidgetType 重写 `estimatedHeight` 返回行高像素值（view.js:148）。

### R7 长文档语法树不完整（低）

`syntaxTree` 可能返回不完整树（language.js:180-184）。视口范围内解析优先级高，实际大概率完整；兜底 `paragraphRange` 回退 + 可选 `ensureSyntaxTree(state, viewport.to, 20)`（language.js:195）。步骤 2 用 5000 行文档实测决定是否启用 ensureSyntaxTree。

### R8 撤销/历史兼容（极低）

Decoration 是视图层，不进 `history()` 的事务栈：撤销只还原文档文本，装饰随 `docChanged` 自动重建（触发面含 docChanged），不存在「撤销后装饰错位」路径。纯文本粘贴：粘贴的是源码标记文本 → 语法树重解析 → 装饰按新树重建，**无装饰间隙**；「粘贴后标记闪现一帧」可能发生（重建在 update 同步完成，实际不可见）。无需额外处理。

### R9 退役改动面（中，流程性风险）

§4.2/4.4 是一次约 -200 行的删除，触及方案 A/B 的既有机制（联动、回声识别、双栏锚点）。缓解：删除步骤独立成实施步骤 5，删除前先在步骤 1-4 保持三态共存跑通（wysiwyg 扩展先在 edit 态内落地，不碰 App.vue），删除后按方案 B 文档 §5 三态矩阵的口径重写两态行为矩阵做回归。

---

## 7. 实施步骤拆解（每步 `npm run build` + `wails build` 可验证）

前置原则：步骤 1-4 全部发生在 `createEditor.js` / 新文件 `editor/wysiwyg.js` 内，**不碰 App.vue**——扩展先在现有编辑态内自洽，退役改动独立在后。

| # | 步骤 | 验证标准 | 预估行数 |
|---|---|---|---|
| 1 | 最小竖切：`editor/wysiwyg.js` 骨架（ViewPlugin + visibleRanges 扫描 + syntaxTree 找 `HeaderMark` + `Decoration.replace` 纯隐藏 + atomicRanges 注册）+ createEditor.js 挂载（暂无 reveal，全隐藏）+ 开关 StateEffect（仿 setFocusMode 模式） | build 通过；标题 `#` 全部隐藏、字号阶梯正确；光标可越过隐藏区；中文输入法在标题行输入无异常 | wysiwyg.js 约 110、createEditor.js 约 6 |
| 2 | reveal：活动块算法（resolveInner 上爬 + paragraphRange 兜底 + 组合态冻结守卫 + wasComposing 兜底） | 光标进块显示源码、出块恢复渲染态；中文 IME 全场景（标题/粗体内/行内码内）回归通过——本步是 go/no-go 门 | wysiwyg.js 约 55 |
| 3 | 行内元素：EmphasisMark / CodeMark / LinkMark+URL 纯隐藏 | 粗斜体行内码链接三类标记隐藏、样式正确；双击/拖选行为符合 R4 预期 | wysiwyg.js 约 45 |
| 4 | 块级与图片：图片 chip WidgetType（eq/estimatedHeight/CSS 钳高）、围栏行隐藏 + `cm-md-codeblock` 底色 line 装饰、ListMark/QuoteMark 弱化 mark + `cm-md-quote` 底色、theme 追加 token 引用样式、mdHighlight 字号换 var()（§3.1） | 图片/围栏/引用/列表观感对齐预览区；明暗主题切换即时生效；长代码块滚动正常 | wysiwyg.js 约 90、createEditor.js 约 25 |
| 5 | App.vue 退役：viewMode 两态化、分割条/联动/回声/双锚点删除、exportPdf/exportHtml 按需渲染、outlineYs 失效点追加、菜单事件（main.go `menu:view-split` 移除） | build 通过；编辑态导 PDF 不空白（硬验收）；大纲高亮/跳转三场景正常；README 设计要点同步更新 | App.vue 净删约 200 净增约 40、main.go 约 -2 |
| 6 | 回归收尾：专注模式 + WYSIWYG 同开（R5）、5000 行文档滚动与锚点（R2/R7）、@media print 全流程、localStorage 旧 key（`inkmark-split`/`inkmark-view-mode=split`）兼容清理 | 手工回归清单全过；专注+wysiwyg 无闪烁 | 文档改动 |

依赖：1 → 2 → 3 → 4 → 5 → 6 严格线性（每步叠在前一步的装饰分类之上）。总计约 370 行净增 + 200 行净删。

构建纪律：`npm run build` 删 `frontend/dist/.gitkeep` 需还原（README 既有坑）；本轮不实施。

---

## 8. 需要用户拍板的开放问题

- **Q1 列表与引用标记**：`-` / `1.` / `>` 第一版保留 + 弱化（本文 §1.2 推荐理由：藏掉即失去 bullet/层级视觉），还是彻底隐藏（彻底 WYSIWYG，引用块只剩底色）？涉及 designer 的视觉 Spec。
- **Q2 链接与图片交互**：链接只显文字（点击不可开）？图片 chip 是否显示真实缩略图（`<img src>`，需处理相对路径与 Go 侧资源协议）还是仅 alt 文本 chip？第一版推荐：纯文本 + alt chip，交互后置。
- **Q3 preview 阅读态去留**：两态方案保留「preview = 只读阅读模式」（本文推荐，大纲跳转/锚点复用现有逻辑），还是连它一起退役（单态纯 WYSIWYG + 导出渲染器）？影响 §4 的删除范围约 60 行。
- **Q4 WYSIWYG 开关形态**：做成可开关（菜单项 + StateEffect，仿专注模式，可随时回到源码形态）还是无开关不可逆替换？推荐可开关（R3 IME 若在个别场景翻车，开关是逃生门），默认开。

---

## 附：新增 localStorage / 菜单事件变化一览

| 项 | 变化 |
|---|---|
| `inkmark-view-mode` | 值域收缩为 edit / preview；读到 `split` 时归一为 `edit` |
| `inkmark-split` | 退役，读到即删 |
| `menu:view-split` | main.go 移除 |
| wysiwyg 开关 effect | 若 Q4 拍板可开关，新增 `menu:toggle-wysiwyg`（main.go +3 行） |
