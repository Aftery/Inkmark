# Inkmark Phase C 视觉规格（三主题 · 工具条 · 状态栏 · 阅读模式 · WYSIWYG · PDF 页眉页脚）

> 设计师：颜好看 (UI/UX Designer) · 2026-10-01 · v1.0
> 依据：`docs/spec/DECISIONS-phaseC-v1.md`（D-1~D-4 已拍板）+ ADR-001（图标）+ ADR-002（Token）
> 寄存器：**Product**（设计服务产品）｜三轴刻度：**Variance=3 / Motion=2 / Density=3**（沿既有）
> 配套落盘：`frontend/src/themes/tokens/design-tokens.css`（本轮已增量增补，v1.1.0）
> 参考（仅参考不照抄）：`docs/plan/wysiwyg-interaction.md`

---

## 0. 范围与纪律

- 本轮产出**设计规格 + Token 增补**；不改 `frontend/src/` 下除 token 文件外的任何源码。
- 全篇无一 emoji 作为功能图标；所有图标以 **lucide 图标名**标注，统一走 `AppIcon.vue` / `paths.js`（ADR-001），**不引入第二套图标库**。
- 无紫色→粉色渐变；无硬编码颜色（唯一例外 `#fff` / `#000`，仅出现在 token 定义文件内）；无弹跳缓动。

---

## 1. 三主题 Token 规格（D-1）

### 1.1 主题清单与基调

| 主题 | `data-theme` | 强调色 | 字体 | 气质 |
|------|--------------|--------|------|------|
| 浅 Indigo | `light`（默认回退） | `#4F46E5` | 系统无衬线栈 | 冷静、克制、工具感（对标 Linear / Notion） |
| 深 Indigo | `dark` | `#6E76F0` | 系统无衬线栈 | 暗房写作、低疲劳（对标 Raycast / Vercel 暗色） |
| 纸感赭石 | `paper` | `#9D5A2F` | **系统衬线栈** | 纸面书写、文学感（对标 Typora Pixyll / iA Writer） |

- 三主题共用**一套语义 Token 名**，仅值不同；切换只改 `<html data-theme>`，**不重建编辑器**（与 ADR-002 一致）。
- 深色不是「浅色反转」：亮暗各自独立取色（在各自背景上重新校对比度），不做 `filter: invert` 之类的机械反转。

### 1.2 每主题完整语义 Token（值即 `design-tokens.css` 落盘值）

#### 浅 Indigo（`light`）

| 角色 | Token | 值 |
|------|-------|-----|
| 画布 | `--bg` | `#FFFFFF` |
| 外壳 | `--surface` | `#F7F8FA` |
| 外壳悬停 | `--surface-2` | `#EEF0F4` |
| 主文字 | `--fg` | `#16171D` |
| 次级文字 | `--fg-2` | `#40434E` |
| 弱化 | `--muted` | `#6B6E7A` |
| 元数据 | `--meta` | `#8A8D99` |
| 边框 | `--border` | `#E5E6EC` |
| 内部行隔 | `--border-soft` | `#EEEFF4` |
| 强边框 | `--border-strong` | `#D3D5DE` |
| 强调 | `--accent` | `#4F46E5` |
| 强调 hover/active | `--accent-hover` / `--accent-active` | `#4338CA` / `#3730A3` |
| 强调浅底 | `--accent-soft` | `#EEEDFB` |
| 强调前景 | `--accent-on` | `#FFFFFF` |
| 次级容器 | `--surface-warm` | `#F3F4F8` |
| 状态 | `--success/--warn/--danger/--info` | `#3E7D55` / `#AD7B15` / `#B23B31` / `#35699B` |
| 代码 | `--code-bg/--code-inline-bg/--code-border` | `#F7F8FA` / `#F1F2F6` / `#E5E6EC` |
| 光标 | `--caret` | `var(--accent)` |
| 选区 | `--selection-bg` | `color-mix(in srgb, var(--accent) 20%, transparent)` |
| 滚动条 | `--scrollbar-thumb` / `-hover` / `-track` | `var(--border-strong)` / `var(--muted)` / `transparent` |

#### 深 Indigo（`dark`）

| 角色 | Token | 值 |
|------|-------|-----|
| 画布 | `--bg` | `#14151A` |
| 外壳 | `--surface` | `#101116` |
| 外壳悬停 | `--surface-2` | `#21232B` |
| 主文字 | `--fg` | `#E7E8ED` |
| 次级文字 | `--fg-2` | `#B4B7C2` |
| 弱化 | `--muted` | `#8A8D99` |
| 元数据 | `--meta` | `#6A6D78` |
| 边框 | `--border` | `#2A2C34` |
| 内部行隔 | `--border-soft` | `#20222A` |
| 强边框 | `--border-strong` | `#3A3D47` |
| 强调 | `--accent` | `#6E76F0` |
| 强调 hover/active | `--accent-hover` / `--accent-active` | `#8A91F5` / `#9AA0F7` |
| 强调浅底 | `--accent-soft` | `#1E2040` |
| **强调前景** | `--accent-on` | **`#0B0C10`**（近黑墨字，**非白字**） |
| 次级容器 | `--surface-warm` | `#1C1E25` |
| 状态 | `--success/--warn/--danger/--info` | `#5FAE7E` / `#D3A94E` / `#DF7268` / `#7BA8D6` |
| 代码 | `--code-bg/--code-inline-bg/--code-border` | `#1C1E25` / `#21232B` / `#2A2C34` |
| 光标 | `--caret` | `var(--accent)` |
| 选区 | `--selection-bg` | `color-mix(in srgb, var(--accent) 30%, transparent)` |
| 滚动条 | `--scrollbar-thumb` / `-hover` / `-track` | `var(--border-strong)` / `var(--muted)` / `transparent` |

> **深色强调色关键结论**：`#6E76F0` 作为**链接/文字/光标的着色**在 `--bg`（`#14151A`）上实测 **4.79:1**，达标 AA 正文。但**白字压在该色上仅 3.81:1 不达标**，故深色主题的 `--accent-on` 反向取近黑墨字 `#0B0C10`（5.13:1）。这是深色主题**唯一一处与浅/纸主题不同的强调语义**，前端实现 CTA/主按钮时**必须引用 `--accent-on`，不得写死白色**。

#### 纸感赭石（`paper`）

| 角色 | Token | 值 |
|------|-------|-----|
| 画布（纸张） | `--bg` | `#FAF7F1` |
| 外壳（封皮） | `--surface` | `#F3EEE5` |
| 外壳悬停 | `--surface-2` | `#EFE8DC` |
| 主文字 | `--fg` | `#2A2620` |
| 次级文字 | `--fg-2` | `#4E4941` |
| 弱化 | `--muted` | `#6F675A` |
| 元数据 | `--meta` | `#908776` |
| 边框 | `--border` | `#E5DED0` |
| 内部行隔 | `--border-soft` | `#EDE7DB` |
| 强边框 | `--border-strong` | `#DAD2C2` |
| 强调 | `--accent` | `#9D5A2F` |
| 强调 hover/active | `--accent-hover` / `--accent-active` | `#8A4D26` / `#7C431F` |
| 强调浅底 | `--accent-soft` | `#F4E7D8` |
| 强调前景 | `--accent-on` | `#FFFFFF` |
| 次级容器 | `--surface-warm` | `#F1EADF` |
| 状态 | `--success/--warn/--danger/--info` | `#3E6B3C` / `#8A6210` / `#A5392F` / `#33608F` |
| 代码 | `--code-bg/--code-inline-bg/--code-border` | `#F3EEE5` / `#EFE9DD` / `#E5DED0` |
| 光标 / 选区 / 滚动条 | 同浅主题语义 | `var(--accent)` / `20%` 混色 / `var(--border-strong)` |
| **衬线字体** | `--font-display` / `--font-body` | `Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", SimSun, serif` |
| 行距 | `--leading-body` / `--leading-reading` | `1.8` / `1.85` |
| 阅读行宽 | `--reading-measure` | `48rem` |

- **衬线只作用于正文/标题**：外壳（顶栏、工具条、状态栏、侧栏、按钮）统一用 `--font-ui`（无衬线），避免 13px 衬线控件难读。新增 `--font-ui` Token 已落盘。
- **中文衬线落到可用系统字体**：`Songti SC`（macOS）→ `Noto Serif SC` / `Source Han Serif SC`（跨平台）→ `STSong` / `SimSun`（Windows）；拉丁优先 `Georgia`。均为**系统字体，零网络字体**（与 Obsidian 立场一致，无首屏抖动）。
- **纸张底的克制说明（合规）**：背景 `#FAF7F1` 刻意保持**接近白**（高亮度、低彩度），"纸感"主要靠**衬线 + 更宽行距（1.8）+ 留白**传达，**不靠饱和米色铺底** —— 这正是回避「AI 奶油风」（warm-neutral 铺底反模式）的做法，不是踩线。

### 1.3 对比度实测（WCAG 2.1 · 本机脚本核算，非估计）

> 阈值：正文/普通文字 **≥4.5:1**（AA）；大字号（≥18.66px 粗体或 ≥24px）与图形/组件边界 **≥3:1**。

| # | 前景 | 背景 | 实测 | 判定 |
|---|------|------|------|------|
| 1 | `--accent` `#4F46E5`（浅，链接/文字） | `#FFFFFF` | **6.29:1** | 通过 AA 正文 |
| 2 | `--accent-on` `#FFFFFF` | `--accent` `#4F46E5` | **6.29:1** | 通过 AA 正文 |
| 3 | `--accent-hover` 白字 | `#4338CA` | **7.90:1** | 通过 |
| 4 | `--accent` `#6E76F0`（深，链接/文字） | `--bg` `#14151A` | **4.79:1** | 通过 AA 正文 |
| 5 | `--accent` `#6E76F0`（深） | `--surface` `#101116` | **4.95:1** | 通过 AA 正文 |
| 6 | `--accent-on` `#FFFFFF`（**原方案，作废**） | `--accent` `#6E76F0` | **3.81:1** | 未通过 **不达标 → 已改** |
| 7 | `--accent-on` `#0B0C10`（**调整后**） | `--accent` `#6E76F0` | **5.13:1** | 通过 AA 正文 |
| 8 | `--accent-hover` `#8A91F5`（深）墨字 | — | **6.93:1** | 通过 |
| 9 | `--accent-active` `#9AA0F7`（深）墨字 | — | **8.14:1** | 通过 |
| 10 | `--fg` `#E7E8ED` | `--bg` `#14151A`（深正文） | **14.90:1** | 通过 |
| 11 | `--muted` `#8A8D99` | `--bg` `#14151A`（深） | **5.51:1** | 通过 |
| 12 | `--muted` `#6B6E7A` | `#FFFFFF`（浅） | **5.08:1** | 通过 |
| 13 | `--accent` `#9D5A2F`（纸，链接/文字） | `--bg` `#FAF7F1` | **4.99:1** | 通过 AA 正文 |
| 14 | `--accent-on` `#FFFFFF` | `--accent` `#9D5A2F` | **5.33:1** | 通过 |
| 15 | `--muted` `#6F675A`（**调整后**） | `#FAF7F1` | **5.22:1** | 通过 |
| 16 | `--muted` `#7C7466`（**原方案，作废**） | `#FAF7F1` | **4.32:1** | 未通过 **不达标 → 已改** |
| 17 | `--meta` `#8A8D99`（浅，**调整后**） | `#FFFFFF` | **3.31:1** | 通过 图形/三级 ≥3 |
| 18 | `--meta` `#908776`（纸，**调整后**） | `#FAF7F1` | **3.32:1** | 通过 |
| 19 | `--meta` `#6A6D78`（深） | `#14151A` | **3.53:1** | 通过 |
| 20 | danger `#A5392F`（纸） | `#FAF7F1` | **6.09:1** | 通过 |

**本轮据此调整的 3 处**：① 深色 `--accent-on` 白→墨 `#0B0C10`（3.81→5.13）；② 纸感 `--muted` `#7C7466`→`#6F675A`（4.32→5.22）；③ 三主题 `--meta` 均提暗至 ≥3:1（浅 2.70→3.31 / 纸 2.48→3.32）。浅色强调、纸感强调作为文字均 ≥4.5，**延用**。

### 1.4 代码高亮 `--hl-*`（独立代码色板 · 三主题共用亮/暗两套）

代码色板是**独立于 UI 强调色**的一族，不随主题强调色变化（一套暖调代码色在靛蓝 UI 里同样成立，且避免三套代码色失配）：

| Token | 亮（`light` + `paper`） | 暗（`dark`） |
|-------|------------------------|--------------|
| `--hl-keyword` | `#A6392A` | `#E08C7C` |
| `--hl-string` | `#4C7A44` | `#A8C68C` |
| `--hl-number` | `#23608F` | `#84B4DB` |
| `--hl-title` | `#8A5A24` | `#D8B173` |
| `--hl-comment` | `#8E8A82` | `#8A857C` |
| `--hl-attr` | `#6E5A1E` | `#C7A86A` |

- 亮板在 `#FFFFFF` 与纸面 `#FAF7F1` 上均 ≥4.5:1（注释项 ≥3:1，斜体非关键信息）。
- 暗板在 `#14151A` 上 4.97–9.65:1。

### 1.5 选区 / 光标 / 滚动条（本轮**新增** Token 覆盖）

现状这些颜色**散落在 `createEditor.js` 里写死**（`color-mix(...accent 22%...)`、`--border-strong`）。本轮收敛为 Token，消灭组件内硬编码：

| Token | 浅/纸 | 深 | 用途 |
|-------|-------|----|------|
| `--caret` | `var(--accent)` | `var(--accent)` | 光标（改为引用 Token，不再写死） |
| `--selection-bg` | `accent 20%` 混色 | `accent 30%` 混色 | 选区底（深色提高不透明度以在暗底可见） |
| `--scrollbar-thumb` | `var(--border-strong)` | `var(--border-strong)` | 滚动条滑块 |
| `--scrollbar-thumb-hover` | `var(--muted)` | `var(--muted)` | 滑块悬停 |
| `--scrollbar-track` | `transparent` | `transparent` | 轨道 |

### 1.6 「跟随系统」实现约定（`prefers-color-scheme` ↔ 手动覆盖优先级）

**核心约定：`<html data-theme>` 永远存"已解析的具体主题"（`light|dark|paper`），绝不存 `system`。CSS 侧不写 `prefers-color-scheme` 分支（避免把三套值复制两遍）。** 解析由 JS 在绘制前完成。

| 项 | 约定 |
|----|------|
| 持久化 key | `inkmark-theme`（沿用现有 key，不新增） |
| 存什么 | **用户偏好**：`'system' \| 'light' \| 'dark' \| 'paper'`（可与 `data-theme` 不同） |
| 缺省值 | key 不存在 → 视为 `'system'`（D-1「跟随系统」为默认） |
| 解析规则 | 偏好∈{light,dark,paper} → 直接落到 `data-theme`；偏好=system → `matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`（**纸感永不自动选中**） |
| 优先级 | **手动覆盖 > 跟随系统**：一旦用户选过具体主题，`matchMedia` 变化不再影响它 |
| 系统变化响应 | 仅当偏好=system 时，监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change`，实时重解析并更新 `data-theme` |
| 防首帧闪烁 | 在 `index.html` 内联一段**同步**脚本（`<head>` 中、样式表之前）读取 localStorage 并写 `data-theme`，避免先亮后暗闪一下 |
| CSS 兜底 | `:root` 即浅主题；若 JS 未执行且 `data-theme` 缺失/为 `system`，页面安全回退到浅主题（白屏安全） |
| 导出联动 | `theme.value`（`App.vue` 导出 HTML 用）须取**已解析**值；`paper` 需并入导出模板（见 §6 交付提醒） |

伪代码（实现契约，细节归架构师）：

```js
const pref = localStorage.getItem('inkmark-theme') || 'system'
const resolve = p => (p === 'system'
  ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : p)
document.documentElement.dataset.theme = resolve(pref)
// 手动选择：localStorage.setItem('inkmark-theme', chosen) 后自行重解析
// 偏好=system 时：matchMedia(...).addEventListener('change', () => 重解析并写 dataset)
```

---

## 2. 工具条视觉规格（编辑区顶部 · ~38px）

### 2.1 定位与尺寸

| 项 | 规格 | Token |
|----|------|-------|
| 高度 | **38px** | `--editor-toolbar-height` |
| 位置 | 编辑区（WYSIWYG 主区）**顶部固定**，随编辑区滚动**不动**（与标题栏 44px 分离） | — |
| 底色 | `--surface`（与画布 `--bg` 分层，外壳次级） | — |
| 分隔 | 底边 1px `--border-soft`（发丝线，**无阴影**） | — |
| 内边距 | 水平 `var(--space-3)`(12px)；按钮纵向居中 | — |
| 滚动 | 内容溢出时**不横向滚动**（见 §2.6） | — |

### 2.2 按钮顺序与分组

左对齐，四组，组间用**竖直发丝分隔符**（1px `--border`、高 16px、两侧各 `var(--space-1)`(4px) 外边距）：

```
[撤销][重做] │ [加粗][斜体][删除线][行内码] │ [标题▾][引用][无序][有序][任务] │ [链接][图片][代码块][表格][分隔线]        …… [更多]
   G1 历史          G2 行内                        G3 块级 & 列表                        G4 插入                        G5 溢出
```

| 组 | 语义名（建议登记） | lucide 图标名 | 说明 |
|----|--------------------|---------------|------|
| G1 | `format-undo` / `format-redo` | `undo-2` / `redo-2` | 历史（与 Word/Docs 一致置于最左） |
| G2 | `format-bold` / `format-italic` / `format-strike` / `format-code` | `bold` / `italic` / `strikethrough` / `code` | 行内标记；**加粗 = ⌘⇧B（D-4）** |
| G3 | `format-heading` / `format-quote` / `format-ul` / `format-ol` / `format-task` | `heading` / `quote` / `list` / `list-ordered` / `list-todo` | 标题为**下拉**（标题 1/2/3/正文，文本菜单项）；其余为开关 |
| G4 | `format-link` / `format-image` / `format-codeblock` / `format-table` / `format-hr` | `link` / `image` / `square-code` / `table` / `minus` | 行内码用 `code`、围栏代码块用 `square-code`，**两者不可混用同一图标** |
| G5 | `more` | `ellipsis` | 溢出「更多」菜单触发（右端，`--fg-2`） |

- 每组按钮数 ≤5（符合工作记忆 ≤4~5 的分块上限）。
- **不新增图标以外的任何图形**；按钮内为纯图标，语义靠 `aria-label` + `title` 提示。

### 2.3 图标尺寸规范（全项目一致）

| 场景 | 尺寸 | Token |
|------|------|-------|
| 行内文本旁 / 文件树 | **16px** | `--icon-size-inline` |
| 按钮内（工具条 / 状态栏按钮 / 顶栏） | **20px** | `--icon-size-button` |
| 独立图标位（空状态插画级、菜单引导） | **24px** | `--icon-size-standalone`（本轮新增） |

描边统一 `stroke-width: 1.75`（`--icon-stroke`）、`currentColor`、圆角端点 —— 由 `AppIcon.vue` 注入，**数据里不写**。

### 2.4 按钮四态 + 选中态（视觉表）

按钮视觉盒 **28×28px**、图标 20px、圆角 `--radius-sm`(6px)。**选中态刻意不使用 `--accent`** —— 工具条属外壳，最静，把 `--accent` 预算留给内容画布（链接/光标）。

| 状态 | 背景 | 图标色 | 其他 |
|------|------|--------|------|
| Default | `transparent` | `--muted` | — |
| Hover | `--surface-2` | `--fg` | 过渡 `--motion-fast`(120ms) `--ease-standard` |
| Active（按下） | `--surface-2`（再深一档用 `--border` 内描边） | `--fg` | 无位移、无缩放 |
| Focus-visible | `transparent` | `--fg` | `box-shadow: var(--focus-ring)`（仅键盘焦点） |
| Disabled | `transparent` | `--meta`，`opacity .5` | `cursor: not-allowed`，`aria-disabled` |
| **Selected（如加粗生效）** | `--surface-2` | `--fg` | 叠加 1px `--border` 内描边（`box-shadow: inset 0 0 0 1px var(--border)`）—— 与 Hover 的区别是**常驻内描边** + 图标满对比 |

- 选中态**不靠颜色单独传达**：图标满对比（`--muted`→`--fg`）**加**常驻内描边，色觉障碍下亦可辨（满足"不许只靠颜色"）。
- **触控目标说明**：本产品为桌面指针应用，28×28 ≥ WCAG 2.5.8 的 24×24。**窄屏 / 触控（`@media (pointer: coarse)` 或宽度 <1024px）下按钮放大到 40×40**，满足 44px 邻近的可点性（这条是本项目对"44×44"的唯一有据偏离，已在 DESIGN.md 待补充）。

### 2.5 顶栏（44px 标题栏）三处图标映射（占位符落地）

需求界面示意顶栏的三个符号占位**必须映射为 lucide 图标，不得落地为符号**（DECISIONS §四）：

| 示意位置 | 占位含义 | 落地 lucide 图标名 | 交互 | 状态 |
|----------|----------|--------------------|------|------|
| 左 | 品牌笔迹 | `pen-line`（**新增**） | 非交互品牌标记（`aria-hidden`） | — |
| 右 | 主题切换 | `sun-moon`（**新增**） | 按钮 → 下拉菜单（浅色/深色/纸感/跟随系统），当前项打勾；菜单项图标 `sun`/`moon`/`newspaper`/`monitor` | 20px |
| 右 | 侧栏/大纲开关 | `panel-left-close` / `panel-left-open`（**已存在**） | 沿用现有 `sidebar-collapse`/`sidebar-expand` 语义（⌘B 大纲） | 20px |

> 采纳说明：DECISIONS 建议 `panel-left`；因项目已有 `panel-left-close/open` 一对，**复用既有语义更符合"不引入第二套"**，故用既有图标，不新增 `panel-left`。

### 2.6 窄窗口溢出策略

- **不横向滚动**（38px 条内出现滚动条是反模式）。
- 编辑区宽度变窄时按**优先级从右往左折叠**进「更多」菜单（`ellipsis` 触发，`dropdown` 层 z-index 1000）：

| 阈值（编辑区可用宽） | 行为 |
|----------------------|------|
| ≥ 720px | 全展开（17 按钮） |
| < 720px | 折叠 G4 插入组的右边 3 项（`format-hr` / `format-table` / `format-codeblock`） |
| < 600px | 再折叠 G4 剩余（`format-link` / `format-image`）+ G3 右端（`format-task` / `format-ol`） |
| < 460px | G3 仅留 `heading` / `quote`；G2 保留（最高频） |

- 折叠顺序（先折叠 → 后折叠）：`minus → table → square-code → image → link → list-todo → list-ordered → list → quote → heading`。**`undo/redo` 与 `bold/italic` 最后折叠**（最高频）。
- 「更多」菜单项为「图标 + 文本标签」（菜单不是纯图标位，文本降低记忆负担）；菜单项同样是 20px 图标 + 左对齐文本。

---

## 3. 状态栏视觉规格（底部 · ~26px）

### 3.1 定位与尺寸

| 项 | 规格 | Token |
|----|------|-------|
| 高度 | **26px** | `--statusbar-height` |
| 位置 | 窗口底部整宽；阅读/专注模式**整体隐藏** | — |
| 底色 | `--surface`；顶边 1px `--border-soft` | — |
| 字体 | `--font-ui`，`--text-xs`(12px)，字距 `--tracking-small`(+0.01em)，行高 `--leading-ui` | — |
| 内边距 | 水平 `var(--space-3)`(12px) | — |

### 3.2 三段排布与对齐

```
[保存态]                                                      [行列]  ·  [字数]  ·  [缩放]
 左对齐                                                              右对齐
```

| 段 | 内容 | 色 | 说明 |
|----|------|----|------|
| 左 | **保存态**（图标 + 文案） | 见 §3.3 | 三态，**颜色 + 图标 + 文案三重表达** |
| 右·1 | 行列 `Ln 12, Col 8` | `--meta` | 等宽数字用 `--font-mono`（避免跳动） |
| 右·2 | 字数 `1,024 字` | `--muted` | 数字等宽 |
| 右·3 | 缩放 `100%`（可点，弹 90/100/110/125%） | `--muted`，hover `--fg` | 可交互项，>100% 时着 `--fg` 加粗提示 |

- 项间分隔用 `--meta` 色的 **中点 `·`**（间隔 `var(--space-2)`），**不用竖线**（降低噪声）。
- 数字一律 `font-variant-numeric: tabular-nums`，避免数值变化时宽度抖动。

### 3.3 保存态三态（不许只靠颜色）

| 态 | 图标（lucide） | 图标语义 | 色 | 文案 |
|----|----------------|----------|----|------|
| 已保存 | `circle-check`（**新增**） | 对勾圆 | `--success` | `已保存` |
| 保存中 | `loader`（**新增**，CSS 旋转） | 放射线 | `--muted` | `保存中…` |
| 未保存 | `circle-dot`（**新增**） | 圆点 | `--warn` | `未保存` |

- 三重表达：**图标形状不同**（对勾/转/点）+ **文案不同** + 颜色不同 —— 色盲/灰度下仍可区分。
- `loader` 旋转：`animation: spin 1s linear infinite`，**尊重 `prefers-reduced-motion: reduce`（改为静态图标）**。
- 保存态从左到右**不占满**：仅占其内容宽度，右段整体靠右（`margin-left: auto`）。

---

## 4. 阅读模式排版规格（P0）

### 4.1 正文行宽（是否延用 46rem）

| 模式 | Token | 值 | 理由 |
|------|-------|----|------|
| 常规（编辑 / WYSIWYG / 预览） | `--preview-measure` | **`46rem`（≈736px）—— 延用** | 已在实际排版中验证；与编辑区正文 15px / 行高 1.7 基线对齐（左右两栏同步滚动不错位的前提）。**不改**。 |
| **阅读模式** | `--reading-measure` | **`50rem`（≈800px）—— 新增** | 隐藏 chrome 后视口变宽，正文相应加宽约 +9%，配合字号 15→17px、行高 1.7→1.8，长文更舒展。CJK 约 47 字/行，**已顶到可读上限**，不再更宽。 |
| 纸感主题阅读 | `--reading-measure` | `48rem`（纸感覆写） | 衬线 + 纸面偏窄，进一步减少长行疲劳。 |

> 结论：**常规行宽 46rem 延用；阅读模式独立新增 `--reading-measure`（默认 50rem / 纸感 48rem）**，不与常规混用。

### 4.2 隐藏 / 保留清单

| 元素 | 阅读模式 | 备注 |
|------|----------|------|
| 顶栏（44px 标题栏） | **隐藏** | 让位给内容 |
| 编辑区工具条（38px） | **隐藏** | — |
| 侧栏（文件 / 大纲） | **隐藏** | — |
| 状态栏（26px） | **隐藏** | — |
| 分栏分割条 | **隐藏** | 阅读模式为单栏 |
| 正文内容 | **保留**，加宽 + 放大字号 | `--reading-measure` / `--reading-font-size` / `--reading-leading` |
| **视图态切换控件** | **不属 chrome（永不隐藏）** | 阅读态与「编辑 / 预览 / 分屏」是**同一个视图态族**的 Radio 选项，经由同一个视图切换控件 / 系统菜单栏「视图」组切换；**不为第 4 态单独造退出按钮、悬浮条等 affordance** |
| Esc 退出 | **键盘出口** | 回到**进入前的视图态**（与专注模式 `⌘⇧F` 的退出行为一致）；阅读态自身不新增任何 on-canvas 退出控件 |

### 4.3 进入 / 退出与过渡

| 项 | 规格 |
|----|------|
| 进入方式 | 菜单项「阅读模式」+ 快捷键 **`⌘4`**（team-lead 裁决 2026-10-01；与 `⌘1/2/3` 同族的**视图态 Radio**） |
| 退出方式 | **Esc**（回到进入前视图态）/ 经同一视图切换控件或 `⌘1/2/3` 切回其它视图态。**无独立退出 affordance**（见 §4.2） |
| chrome 出/隐 | opacity 200ms `--ease-standard`（`--motion-base` 180ms 同量级），**仅透明度**，不改布局 |
| 正文字号/行宽/行距变化 | 220ms `--ease-standard`，`max-width` / `font-size` / `line-height` 平滑过渡 |
| 缓动 | **仅用 `--ease-standard` / `--ease-out`**；**禁止弹跳缓动** `cubic-bezier(0.68,-0.55,0.265,1.55)` |
| reduced-motion | `@media (prefers-reduced-motion: reduce)` 下所有时长归 1ms（直接切换） |

> **快捷键归属裁决（team-lead 2026-10-01）**：采用 **`⌘4`**，废弃早前草案的 `⌘⇧R`。理由：① `⌘1/2/3` 已确立"视图态"族（编辑 / 预览 / 分屏），阅读态属同一语义层（"切换看什么"），应同族收敛；② `⌘⇧` 前缀在本项目已被占用为"叠加态"语义（`⌘⇧F` 专注、`⌘⇧L` 主题），阅读态是视图态而非叠加态，混用会造成语义污染；③ `⌘⇧R` 在浏览器 / Web 语境惯例为"强制刷新"，易误触。

---

## 5. WYSIWYG 即时模式交互规格（D-2 默认态 · 细化）

> 本节只补**视觉**与**过渡**细节；块判定、显隐规则沿用 `wysiwyg-interaction.md` §1（按块 reveal），**不重复造轮子**。

### 5.1 标记显隐的触发时机与过渡

| 场景 | 行为 | 过渡 |
|------|------|------|
| 光标移入块 | 该块源码标记**立即浮现**（无延迟） | **无动画**（瞬时） |
| 光标移出块 | 该块标记**立即隐藏** | **无动画**（瞬时） |
| 选区跨块 | 触及的所有块按活动块处理（标记全部浮现） | 瞬时 |
| IME 组合中（composing） | **冻结显隐**，组合结束后统一重算 | 瞬时 |
| 滚动（不动光标） | 活动块不因滚出视口改变显隐 | 瞬时 |

**为何不加过渡（关键工艺决策）**：隐藏 `##` / `**` 会改变**行内文本流位置**（文字左移），这是**布局变化**，`opacity/transform` 无法平滑表达，强加动画只会产生滑动噪感；且切换频率与光标移动同频，120ms 过渡会变成永久闪烁。Typora 即无过渡。**结论：标记显隐一律瞬时，不做补间。**

**唯二允许的过渡（均为既有 `opacity`，不改布局）**：
- 专注模式非活动块淡化 `opacity: .4` → 160ms `--ease-standard`（既有）。
- 空标记弱提示色淡入 ≤120ms `--ease-standard`。

### 5.2 光标进入隐藏区时的表现

**结论：恢复标记符（源码可见可编辑），而非保持渲染态。**
- 光标/选区落入某块 → 该块的**全部源码标记原样浮现**（`##`、`**`、`-`、`>`、`` ` ``、`[](url)` 等），用户看到并编辑的是真实 Markdown。
- 成对标记（`**x**`）**必须整体显隐**，禁止只显示半边。
- 边缘情况（沿用 wysiwyg-interaction §6.1）：空标记 `****`、`[]()`、未闭合 `**abc` **永不隐藏**（无"渲染结果"可显示）；空标记在非活动块着 `--meta` 弱提示。
- 转义符 `\[` **永不隐藏**（隐藏会让用户误以为字面量丢失）。

### 5.3 元素在即时模式下的实际视觉（"五源对齐"）

> **"五源对齐"定义**：同一段 Markdown 在①即时模式非活动块 ②即时模式活动块（标记浮现，但**渲染属性不变**）③预览态 ④导出 HTML ⑤PDF 打印层 —— 五处渲染结果**视觉一致**。落地靠 `content.css` 单一来源 + Token（架构口径见 wysiwyg-interaction §3 与 ADR-002）。

**行内文字属性（标/色/重）以 `mdHighlight` 为准**（CM 原生管线）；**块级盒模型（margin/背景/边框/缩进/圆角）以 `content.css` 为准**；**同一属性禁止两处声明**（防隐性分叉）。

| 元素 | 即时模式视觉（非活动块） | 块级盒模型 | 与预览一致性 |
|------|--------------------------|-----------|--------------|
| **H1** | 字号 `1.875rem`(30px) / 字重 590 / 行高 1.3 / 字距 -0.01em / `--fg` | margin `40px 0 16px`，**无 border-bottom** | 通过 与预览 h1 同值 |
| **H2** | `1.5rem`(24px) / 590 / 1.3 / `--fg` | margin `32px 0 12px` | 通过 |
| **H3** | `1.25rem`(20px) / 510 / 1.3 / `--fg` | margin `24px 0 8px` | 通过 |
| **H4** | `1.0625rem`(17px) / 510 / 1.3 / `--fg` | margin `20px 0 8px` | 通过 |
| **H5** | `1rem`(16px) / 510 / 1.3 / `--fg` | margin `16px 0 8px` | 通过 |
| **H6** | `0.9375rem`(15px) / 510 / 1.3 / **`--muted`** | margin `16px 0 8px` | 通过 |
| **粗体 `**x**`** | 字重 510（`--weight-emphasize`）/ `--fg` | 行内 | 通过 |
| **斜体 `*x*`** | `font-style: italic` | 行内 | 通过 |
| **行内码 `` `x` ``** | `--font-mono`，`0.875em`，底 `--code-inline-bg`，边 1px `--code-border`，圆角 `--radius-sm`，padding `.1em .35em` | 行内 | 通过 与 `.preview-body code` 同 |
| **链接** | 文字 `--accent`，无下划线（hover 加下划线 + offset 2px）；隐藏 `[` `]` `(url)` 只留 text | 行内 | 通过 |
| **围栏代码块** | 块底 `--code-bg`，边 1px `--code-border`，圆角 `--radius-md`，padding `12px 16px`，行高 1.4，横向可滚；语言名（`js` 等）非活动时淡化为 `--meta` 弱显示于块首；高亮走 `--hl-*`（与预览同板） | margin `16px 0` | 通过 |
| **引用块** | **无彩色竖线**：底 `--surface-warm`，字 `--fg-2`，圆角 `--radius-sm`，padding `8px 16px`；隐藏每行行首 `> ` | margin `16px 0`，嵌套逐级缩进 | 通过 |
| **无序列表** | 隐藏 `-`/`*`/`+`，渲染 bullet（`::marker` 色 `--muted`） | `padding-left: 1.5em`，项间 `4px` | 通过 |
| **有序列表** | 隐藏源码数字，按 **CommonMark 实际序号**渲染 | 同上 | 通过 |
| **任务列表** | 替换为真实 checkbox widget（`accent-color: var(--accent)`）；勾选态整项 `--muted` + line-through | 同上 | 通过 |
| **图片** | widget 渲染 `<img>`（max-width 100%，`--radius-sm`）；alt 空时占位框（`--border` 边 + `--surface-2` 底）+ 文件名弱文本 | 块级居中 | 通过 |
| **水平线** | 1px `--border` 分隔线 | margin `32px 0` | 通过 |
| **表格** | **v1 保持源码常显**（不做表格 WYSIWYG），仅套预览同款发丝边框与表头底 | — | 与 wysiwyg §10 一致 |

- 强调色预算复核：即时模式下内容画布的 `--accent` 出现在**链接**与**光标**（=2 处，达标）；工具条选中态**已改为不上强调色**（§2.4），不争预算。若同屏链接很多 + 光标并存 → 链接可退为 `--fg` + 下划线（记录为实现验收项，wysiwyg §8.3 同口径）。

### 5.4 中文排版细节

| 项 | 结论 | 成本 |
|----|------|------|
| 中英混排间距（"盘古之白"） | **v1 不做自动加空格**。理由：① 需在**渲染文本**层插入装饰（CM Decoration 或 md-it 插件），会与"标记显隐 + 五源对齐"耦合，三处（编辑/预览/导出）都要同步插空格，否则五源不平；② 自动加空格在**光标行源码态**会与隐藏态打架（空格属于渲染还是源码？）；③ 成本/收益不划算。**先用字体本身的中英字体度量差异天然留白。** | 高（不建议本轮做） |
| 标点挤压 / 行尾禁则 | **v1 不引入**。可低成本加 `line-break: strict`（中文行首禁则，如行首不出现 `，。」`）与 `overflow-wrap: break-word`。真正的标点挤压（相邻标点半角化）需 `text-spacing`/`text-autospace`，**WKWebView 支持不稳，不做**。 | 低（`line-break: strict` 可做）/ 高（挤压不做） |
| 换行与溢出 | `overflow-wrap: break-word` + `word-break: normal`（避免 CJK 粗暴断词）；长 URL/行内码不撑破容器 | 低（必做） |
| 数字与西文 | 状态栏/行内数值用 `tabular-nums`；正文数字不强制等宽（保持排版自然） | 低 |

### 5.5 与既有功能的叠加（复核，不新增规则）

- **专注模式**：`opacity 0.4` 淡化非活动块 × 标记隐藏作用于**同一批块**（活动块 = 标记浮现块 = 不淡化块），观感协调，无冲突（wysiwyg §4.2）。
- **大纲 / ⌘B**：不改；加粗改 ⌘⇧B（D-4），⌘B 仍为大纲。
- **源码态**：标记全显、无渲染（`view-mode` 的镜像态），复用同一份 `content.css`。

---

## 6. 需新增采集的 lucide 图标清单（不引入第二套）

**全部来自 `lucide-static@1.48.0`**（`https://unpkg.com/lucide-static@1.48.0/icons/<name>.svg`），逐字摘录内层标记登记进 `paths.js`（ADR-001 采集流程）。以下 24 个名称**已逐一 HTTP 200 核实存在**：

| # | lucide 名 | 用途 | 位置 |
|---|-----------|------|------|
| 1 | `pen-line` | 品牌标记 | 顶栏左 |
| 2 | `sun-moon` | 主题切换触发 | 顶栏右 |
| 3 | `monitor` | 「跟随系统」菜单项 | 主题菜单 |
| 4 | `newspaper` | 「纸感」菜单项 | 主题菜单 |
| 5 | `bold` | 加粗（⌘⇧B） | 工具条 G2 |
| 6 | `italic` | 斜体 | 工具条 G2 |
| 7 | `strikethrough` | 删除线 | 工具条 G2 |
| 8 | `code` | 行内码 | 工具条 G2 |
| 9 | `heading` | 标题（下拉） | 工具条 G3 |
| 10 | `quote` | 引用 | 工具条 G3 |
| 11 | `list` | 无序列表 | 工具条 G3 |
| 12 | `list-ordered` | 有序列表 | 工具条 G3 |
| 13 | `list-todo` | 任务列表 | 工具条 G3 |
| 14 | `link` | 链接 | 工具条 G4 |
| 15 | `image` | 图片 | 工具条 G4 |
| 16 | `square-code` | 围栏代码块 | 工具条 G4 |
| 17 | `table` | 表格 | 工具条 G4 |
| 18 | `minus` | 分隔线 | 工具条 G4 |
| 19 | `undo-2` | 撤销 | 工具条 G1 |
| 20 | `redo-2` | 重做 | 工具条 G1 |
| 21 | `ellipsis` | 更多（溢出） | 工具条 G5 |
| 22 | `circle-check` | 已保存 | 状态栏 |
| 23 | `loader` | 保存中 | 状态栏 |
| 24 | `circle-dot` | 未保存 | 状态栏 |

**复用既有（无需新增）**：`sun` / `moon`（主题菜单项）、`panel-left-close` / `panel-left-open`（侧栏开关）、`x`（浮层 / 对话框关闭）。

**备选（仅当标题下拉项要求图标时）**：`heading-1` / `heading-2` / `heading-3`（本次默认不采集，用文本菜单项）。

---

## 7. 合规自检（P0）

- [x] **无 emoji 作功能图标** —— 全篇图标以 lucide 名标注，24 个新增名全部核实存在；顶栏符号占位已映射为 `pen-line` / `sun-moon` / `panel-left-*`。
- [x] **无紫色→粉色渐变** —— 三主题强调色为 `#4F46E5` / `#6E76F0` / `#9D5A2F` 纯色单色；无 Indigo→Violet→Pink 任意渐变组合，无发光边框/毛玻璃。
- [x] **无硬编码色（组件层）** —— 新增 `--caret` / `--selection-bg` / `--scrollbar-*` 把原先散写在 `createEditor.js` 的颜色收敛为 Token。
- [x] **无空洞占位文案** —— 状态栏/空状态文案均为具体中文。
- [x] **对比度** —— 三主题正文/链接/按钮文字均 ≥4.5:1，`--meta`/图形 ≥3:1（§1.3 逐项实测）。
- [x] **无弹跳缓动** —— 明令禁用 `cubic-bezier(0.68,-0.55,0.265,1.55)`；仅用 `--ease-standard` / `--ease-out`。
- [x] **reduced-motion** —— 阅读模式过渡、`loader` 旋转、淡化过渡均尊重 `prefers-reduced-motion`。
- [x] **图标系统单一来源** —— 全部走 `AppIcon` + `paths.js`，尺寸 16/20/24 三档，stroke 1.75。

---

## 8. PDF 页眉页脚视觉规格（P0 · D-3 应用内一键直出）

> D-3 要求应用内一次点击直出 `.pdf`，支持分页 + 页眉页脚（目录为 P1）。**技术路线**（Go 侧离屏 WKWebView 逐 A4 页渲染 + PDFKit 合并，页眉页脚由 PDFKit 逐页叠加绘制）归架构师；**本节只定视觉参数**，供实施者照做。

### 8.1 内容与对齐

| 区 | 位置 | 内容 | 对齐 |
|----|------|------|------|
| 页眉 | 左 | 文档名（**去扩展名**，如 `写作笔记`） | 左对齐 |
| 页眉 | 中 | 留空（保留锚点，未来可放章节名 / 副标题） | 居中 |
| 页眉 | 右 | 日期 `YYYY-MM-DD`（导出当日，如 `2026-10-01`） | 右对齐 |
| 页脚 | 左 / 中 | 留空 | — |
| 页脚 | 右 | `第 X / N 页`（`X`=当前页、`N`=总页数；斜杠两侧各一空格） | 右对齐 |

- **不加分隔线**：页眉页脚与正文之间**不用横线**，仅靠留白 + 字号/字色层级区分（延续"无装饰线"设计语言）。
- 页眉页脚**每页都出现**（本文档无封面页；若后续加封面，封面豁免两者）。
- `X` / `N` 为**已分页后**的真实页码（先完成分页，再逐页叠加）。

### 8.2 字号与字色（引语义 Token，不给死值）

| 元素 | 字号 | 字重 | 字色 Token |
|------|------|------|-----------|
| 页眉 · 文档名 | 9pt | `--weight-read`(400) | `--muted` |
| 页眉 · 日期 | 9pt | `--weight-read`(400) | `--meta` |
| 页脚 · 当前页 `X` | 9pt | `--weight-emphasize`(510) | `--fg-2` |
| 页脚 · `/ N 页` | 9pt | `--weight-read`(400) | `--muted` |

- **字号结论：恒为 9pt（绝对值），不引入比例换算。** 依据：架构师探针证实 WebKit `createPDFWithConfiguration` 的映射是 **1 CSS px = 1 pt**（内容高 11844px 切出 15 页 A4：11844 ÷ 842 = 14.07 → 15；若按早前误用的 0.75 换算得 8883pt，只会切出 11 页）。导出 HTML 正文 `font-size:15px`（`exporters.js` 的 body 规则）→ PDF 里即 **15pt**，故 **9pt = 正文 0.6×**。导出正文字号是**固定 15px（非变量）**，规则化比例只会引入这类换算错误，**钉死绝对值更稳**。
- **字色结论：引语义 Token，不用死值。** 层级 = 文档名（`--muted`）与当前页码（`--fg-2`）为"主体信息"，日期（`--meta`）最弱 —— "哪一页"比"哪一天"更重要。
- 三主题解析值（供实现核对，值取自 `design-tokens.css`）：

| 元素 | light | dark | paper |
|------|-------|------|-------|
| 页眉 · 文档名 `--muted` | `#6B6E7A` | `#8A8D99` | `#6F675A` |
| 页眉 · 日期 `--meta` | `#8A8D99` | `#6A6D78` | `#908776` |
| 页脚 · 当前页 `--fg-2` | `#40434E` | `#B4B7C2` | `#4E4941` |

> 注：按 §8.7 裁决三，PDF 的 `dark` 会被**映射为 `light`**，故 **dark 列在 PDF 场景不可达**（上表列出仅为完整记录三主题解析值）。实际 PDF 页眉页脚**只取 light 列或 paper 列**。

### 8.3 字体（跟随主题 —— 用 `--font-body`）

**结论：跟随当前主题，用 `--font-body`。** 浅 / 深主题 = 系统无衬线栈；纸感主题 = 系统衬线栈（Georgia / Songti SC / Noto Serif SC …）。

- **理由**：页眉页脚属**文档本体**（非 App chrome），`--font-body` 让其随主题自动一致；若正文衬线而页眉用无衬线，会露出"模板接缝"。
- 9pt 小号下衬线仍可读（Georgia / 宋体系均为印刷用**文本**衬线，非展示衬线）。
- 反注：App chrome（工具条 / 状态栏）用 `--font-ui`，**不用于 PDF 页眉页脚**。

### 8.4 页面几何与边距（A4）

**模型（读法 B —— 页眉 / 页脚住在 64pt 页边距之内，正文占满版心）**：页眉区 / 页脚区是"边距内可供其使用的带宽上限"，**不参与几何相加**。这与排版惯例一致（Word / LaTeX / InDesign 的页眉页脚都住在页边距里）。

| 项 | 值 |
|----|----|
| 页面 | A4 竖版 **595 × 842 pt** |
| 页边距 | 上 / 下 / 左 / 右 各 **64pt**（≈22.6mm） |
| **正文可用高度（版心高）** | 842 − 64×2 = **714pt**（= 252mm，常规版心） |
| 正文可用宽度 | 595 − 64×2 = **467pt** |
| 正文上沿 / 下沿 | 距页顶 **64pt** / **778pt** |
| 页眉基线 | 距页顶 **58pt**（= 正文上沿上方 6pt，落在上边距内） |
| 页脚基线 | 距页顶 **786pt**（= 正文下沿下方 8pt，落在下边距内） |
| 页眉带 / 页脚带 | 距页顶 **40–64pt** / **778–802pt**，各 **≤ 24pt**（边距内可用带宽上限，**不参与相加**） |
| 页眉 / 页脚水平对齐 | 与正文块**同左右边距**（64pt），三段在 467pt 宽内做左 / 中 / 右对齐 |

- **公式（供实现）**：`正文可用高度 = 页高 − 上边距 − 下边距 = 842 − 64 − 64 = 714pt`。页眉页脚**住在边距内部，不叠加**（早前 `842 − 64×2 − 24×2 = 666pt` 的读法 A 已作废）。
- **互相印证的两条基线（同一条线的两种读法，非两个数）**：页眉基线 = 距正文上沿 6pt ⟺ 距页顶 58pt（64 − 6）；页脚基线 = 距正文下沿 8pt ⟺ 距页顶 786pt（778 + 8）。
- **硬约束**：正文**不得超出**版心纵向区间 **64..778pt**；分页引擎以此版心为分页边界（避让是硬约束，非视觉建议）。
- **正文容器宽度参数化**：见 §8.8 —— PDF 用 **467px** 覆盖模板的 `max-width:46rem`。
- **排版密度提示（映射为 1 px = 1 pt，见 §8.2）**：可用宽 467pt 在正文 15pt 下约 **31 个中文字 / 行** —— 这不是错误，是 A4 上的**合理排版密度**（中文书籍常见 28–40 字 / 行）。**实施者见到"15pt"勿误判为异常而擅改字号**；若要调整密度，改的是**页边距**（64pt），不是正文字号。

### 8.5 「不显示页眉页脚」开关 —— MVP 不做，留 v1.1

**结论：同意 team-lead 基线，MVP 不做开关。** 理由：
1. MVP 目标是"不丢稿、能交付"，页眉页脚是**交付质量**的一部分，**默认开启即最优**；
2. 开关需要设置项 + 状态持久化 + 导出参数透传，成本与"三件保命设施"的优先级不符；
3. 确有"无页眉页脚"需求时，**已有降级路径**兜底：系统打印对话框产出的 PDF 由用户自行控制页眉页脚（见 §8.6）。

### 8.6 降级路径边界（明确"不一致即接受"）

- 本节规格**只约束应用内一键 PDF**（D-3 主路径）。
- 系统打印对话框降级路径（现有 `window.print()` 链路）的页眉页脚由系统 / 用户控制，**不受本节约束**，**也不保证**与本规格一致 —— 这是已知且可接受的降级差异。

### 8.7 PDF 产物的主题映射规则（裁决三 · 2026-10-01 · 映射而非跟随）

**规则（钉死）：`light → light` 原样；`paper → paper` 原样；`dark → 强制映射为 light`。**

| 当前主题 | PDF 产物主题 | 说明 |
|----------|--------------|------|
| `light` | `light`（原样） | 白纸黑字，直接输出 |
| `paper` | `paper`（原样） | 纸感前提即"纸面近白 + 衬线 + 宽行距"，本就为纸质输出而生；强制浅色会**废掉该主题在导出场景的全部价值** |
| `dark` | **`light`（强制映射）** | 深色是**唯一需拦截者**：底色 `#14151A` 是为屏幕对比度服务的，挪到纸上即纯缺陷（耗墨、反白区难读） |

- **这是"映射"而非"跟随"**：PDF **不**无条件跟随当前主题，而是按上表映射 —— 深色被拦截、纸感原样保留、浅色原样。
- **不可一律强制浅色**：纸感主题的设计前提就是"为纸质输出而生"，一律强制浅色等于废掉它。
- **对用户可见但符合直觉**：深色模式下导出的 PDF **不是黑的**（白纸黑字）。这是可预期的（"导出 = 交付到纸 / 存档"），**无需额外提示 UI**。
- **与 §8.2 的衔接**：`dark` 被映射为 `light` 后，页眉页脚字色取 §8.2 表的 **light 列**；`paper` 取 paper 列；`light` 取 light 列。
- **残留风险（记录，不阻塞）**：此规则不提供"刻意导出深色 PDF"的出口；如未来有需求，可在导出对话框加"按当前主题导出"高级选项（v1.1，不在 MVP）。

### 8.8 正文容器宽度参数化（硬约束 · ADR-003 已知坑 19）

**冲突**：`exporters.js` 的导出模板含 `max-width:46rem`（= 736px）。PDF 渲染时正文会被拉成 736px 宽，**超出 §8.4 的 467pt 版心**，导致每行字数与分页全错。

**规则（必须参数化，禁止用缩放凑）**：同一份模板、**两种版式宽** ——

| 出口 | 正文容器宽度 | 说明 |
|------|--------------|------|
| **PDF 导出** | **`467px`（精确覆盖 `max-width:46rem`）** | 与 §8.4 版心宽 467pt 一致（1 px = 1 pt）；分页以此为准 |
| **HTML 导出** | **`46rem`（736px）不变** | 屏幕阅读舒适行宽，维持现状 |

- **这是"同一份模板 + 版式宽参数"，不是两套样式**：模板只暴露**一个宽度变量**（建议名 `--export-measure`），由出口场景注入值（PDF → `467px`；HTML → `46rem`），其余排版规则完全共用。
- **禁止用整体缩放（`transform: scale` / `zoom`）凑宽度**：缩放会破坏 `1 px = 1 pt` 的分页假设（见 §8.2），导致页数与页眉页脚错位。
- **验收口径**：PDF 每行中文字数与 §8.4 的 467pt 版心一致（15pt 正文 ≈ 31 字 / 行），且分页边界等于版心纵向区间（**64..778pt**）。

---

## 附录 A：新增图标 verbatim 内层标记（采集参考 · 来源 lucide-static@1.48.0）

> 已剥离 `svg` 外壳与本项目统一注入的属性（`stroke` / `stroke-width` / `linecap` / `linejoin`），仅留内层元素标记，可直接登记进 `paths.js`。**这是设计侧代采集，落地时以 ADR-001 采集流程复核为准。**

```js
// 顶栏
'pen-line':   '<path d="M13 21h8" /> <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />',
'sun-moon':   '<path d="M12 2v2" /> <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715" /> <path d="M16 12a4 4 0 0 0-4-4" /> <path d="m19 5-1.256 1.256" /> <path d="M20 12h2" />',
'monitor':    '<rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" />',
'newspaper':  '<path d="M15 18h-5" /> <path d="M18 14h-8" /> <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" /> <rect width="8" height="4" x="10" y="6" rx="1" />',

// 工具条 G1 历史
'undo-2':     '<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
'redo-2':     '<path d="m15 14 5-5-5-5" /> <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',

// 工具条 G2 行内
'bold':          '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />',
'italic':        '<line x1="19" x2="10" y1="4" y2="4" /> <line x1="14" x2="5" y1="20" y2="20" /> <line x1="15" x2="9" y1="4" y2="20" />',
'strikethrough': '<path d="M16 4H9a3 3 0 0 0-2.83 4" /> <path d="M14 12a4 4 0 0 1 0 8H6" /> <line x1="4" x2="20" y1="12" y2="12" />',
'code':          '<path d="m16 18 6-6-6-6" /> <path d="m8 6-6 6 6 6" />',

// 工具条 G3 块级 / 列表
'heading':      '<path d="M6 12h12" /> <path d="M6 20V4" /> <path d="M18 20V4" />',
'quote':        '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /> <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />',
'list':         '<path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" />',
'list-ordered': '<path d="M11 5h10" /> <path d="M11 12h10" /> <path d="M11 19h10" /> <path d="M4 4h1v5" /> <path d="M4 9h2" /> <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />',
'list-todo':    '<path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <rect x="3" y="4" width="6" height="6" rx="1" />',

// 工具条 G4 插入
'link':        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
'image':       '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
'square-code': '<path d="m10 9-3 3 3 3" /> <path d="m14 15 3-3-3-3" /> <rect x="3" y="3" width="18" height="18" rx="2" />',
'table':       '<path d="M12 3v18" /> <rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M3 9h18" /> <path d="M3 15h18" />',
'minus':       '<path d="M5 12h14" />',

// 工具条 G5 溢出
'ellipsis':    '<circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" />',

// 状态栏
'circle-check': '<circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" />',
'loader':       '<path d="M12 2v4" /> <path d="m16.2 7.8 2.9-2.9" /> <path d="M18 12h4" /> <path d="m16.2 16.2 2.9 2.9" /> <path d="M12 18v4" /> <path d="m4.9 19.1 2.9-2.9" /> <path d="M2 12h4" /> <path d="m4.9 4.9 2.9 2.9" />',
'circle-dot':   '<circle cx="12" cy="12" r="1" /> <circle cx="12" cy="12" r="10" />',
```

---

## 附录 B：`design-tokens.json` 同步增量（供架构师/前端同步 DTCG 快照）

> ADR-002 规定「改 token 先改 json」。本轮运行时 CSS 已改（`frontend/src/themes/tokens/design-tokens.css` v1.1.0），下列 delta 需同步进 `docs/design/design-tokens.json` 与 `docs/design/design-tokens.css` 快照。**这是本轮唯一未落的同步项**（见回传 advisory）。

- 主题维度：`light` / `dark` 全部颜色值替换（见 §1.2 表）；新增 `paper` 主题组。
- 新增 token：`caret` / `selection-bg` / `scrollbar-thumb` / `scrollbar-thumb-hover` / `scrollbar-track`（三主题各一组）。
- 新增结构 token：`font-ui` / `editor-toolbar-height`(38px) / `statusbar-height`(26px) / `icon-size-standalone`(24px)。
- 新增阅读 token：`reading-measure`(50rem) / `reading-font-size`(1.0625rem) / `reading-leading`(1.8)。
- 纸感覆写：`leading-body`(1.8) / `leading-reading`(1.85) / `reading-measure`(48rem)。

## 附录 C：下游实现提醒（非本设计产出，但影响验收）

1. **`export/exporters.js` 的内联导出模板仍是旧赭石/旧中性色**（第 38/46/47 行含 `#B45309` / `#1F1F1E` / `#D98B4A` 等）。该文件虽享"自包含模板豁免硬编码"（ADR-002），但**必须随三主题同步**，否则**导出的 HTML 配色与编辑器不一致**（破坏"五源对齐"）。建议按 `light/dark/paper` 三套 + `theme.value` 分支出对应内联变量。
2. **`createEditor.js` 的选区/光标/滚动条写死值**应改为引用新 Token `--selection-bg` / `--caret` / `--scrollbar-*`。
3. **chrome 字体**：顶栏/工具条/状态栏用 `--font-ui`，正文用 `--font-body`（纸感主题下二者才会分叉）。
4. **对比度验收**：实现后需在 `dark` 主题下目检 `--accent-on` 取的是**深色墨字**而非白字（CTA/主按钮最易漏）。
