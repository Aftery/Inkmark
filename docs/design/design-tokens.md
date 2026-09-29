# Inkmark 设计说明 · Design Tokens v1.0.0

> 设计师：颜好看 | 生成日期：2026-09-29
> 交付配套：`design-tokens.json`（机器可读源）/ `design-tokens.css`（前端 import）
> 三轴刻度：**Variance = 3 / Motion = 2 / Density = 3**

---

## 0. 一页速览

| 维度 | 结论 |
|------|------|
| 寄存器 | **Product**（工具型界面，设计服务产品，文字即主角） |
| 对标气质 | Typora（克制）+ Bear（单一暖调强调）+ Obsidian（系统字体宣言） |
| 主色 | `--accent #B45309`（亮）/ `#D98B4A`（暗）——「赭石墨」 |
| 字体 | `-apple-system / PingFang SC` 系统原生栈；**编辑区放弃等宽**，改正文 15px |
| 图标 | **内联 SVG（零新增依赖）**：`AppIcon.vue` 唯一渲染入口 + `paths.js` 几何/白名单（stroke 1.75，16/20px） |
| 核心策略 | 中性色 90% + 单一强调色 ≤5% + 语义色 ≤5%，无渐变、无重阴影、无边框装饰 |

---

## 1. 对标分析：写作类工具「简洁」的共性规律

调研对象：**Typora**（默认 / GitHub / Night / Pixyll 主题）、**Bear**、**iA Writer**、**Obsidian**（默认主题 + 官方 CSS 变量）。

### 1.1 逐家拆解

**Typora** — 「无干扰」的极简范式
- 默认主题：纯白画布 + 深灰文字 + **柔和蓝链接**；正文字体走系统栈（Open Sans / Clear Sans / Helvetica Neue）。
- 官方 Night 主题 CSS 变量：`--bg-color: #363B40`、`--text-color: #b8bfc6` —— **暗色用「柔灰」而非纯黑**。
- Pixyll 主题被官方仓库列为旗舰：浅灰白底 + Merriweather/Lato，**无边框、无阴影、无装饰**，只靠字体、行高、段距构建层级。
- 反面教材：GitHub 主题给 `h1/h2` 加了 `1px solid #eee` 下边框 —— 这正是本项目预览区要**删掉**的「老式 README 味」。

**Bear** — 单一暖色强调
- 品牌只有**一个彩色**：暖红 `#DD4C4F`；其余全为无彩色（Graphite `#444444` 文字 / 白画布 / 灰阶边框）。
- 数据佐证：「A single warm red acts as the only voice that matters. Almost everything is achromatic.」
- 正文 16px / 400 / **+0.031em 字距**（微空气感）；标题仅用 400 字重（安静的自信，而非加粗呐喊）。
- 圆角克制：按钮 8px、卡片 16px；**发丝边框、无填充按钮、极浅阴影**。

**iA Writer** — 专注即功能
- 极端最小化：一个字体、一个字号、固定行距、非两端对齐、**浅灰背景（非纯白）**、签名式**蓝色光标**。
- 去除一切工具栏与选项，「没有任何东西与你的文字争夺注意力」。

**Obsidian** — 系统字体即设计宣言
- **零 web 字体**：`ui-sans-serif, system-ui, -apple-system, ...`，「平台原生字体已足够好，即时渲染比字体品牌化更重要」。
- 中性基础色阶 `--color-base-00 → --color-base-100`（`#ffffff → #1c1c1c`），一套色阶贯通明暗。
- **单一调色板主权**：同一套强调色 token 同时驱动 UI 元素**与**代码语法高亮 —— 界面与其内的代码视觉统一。

### 1.2 提炼：写作工具「简洁」的六条共性规律

| # | 规律 | 对 Inkmark 的落地 |
|---|------|-------------------|
| 1 | **无彩色主导，单一强调色** | 中性色占 ~90%，只保留一个强调色（赭石墨），每屏可见 ≤2 处 |
| 2 | **画布退后，文字向前** | 文档画布 `--bg` 是最亮/最净的面；工具栏与侧栏沉入 `--surface` 次级灰 |
| 3 | **系统原生字体，零品牌字体** | 采用 `-apple-system / PingFang SC` 栈，无网络字体、无首屏抖动（Obsidian 立场） |
| 4 | **柔黑 / 暖白，拒绝纯黑白** | 暗色 `#1F1F1E`（柔黑）、亮色文字 `#1E1D1B`（暖墨黑），降低长时间注视疲劳 |
| 5 | **发丝边框 + 留白分层，不用阴影与装饰** | 层级用 1px 边框环（`--elev-ring`）与留白表达；**删除 h1/h2 下边框、blockquote 彩条** |
| 6 | **等宽字体只服务代码** | 编辑正文改比例字体；`--font-mono` 严格限定在代码块 / 行内代码 |

### 1.3 反面清单（本项目明确不做）

- 不做：GitHub 式 `h1/h2` 下边框 + `blockquote` 3px 蓝色竖线（老式 README 味，用户点名要删）
- 不做：后台管理系统蓝 `#3370ff`（Ant/Tencent 蓝，与写作气质不符）
- 不做：紫色→粉色渐变、毛玻璃、发光边框（AI 模板套路）
- 不做：装饰性阴影叠加在内容卡片上（写作工具的内容容器应「零阴影」）

---

## 2. 设计语言：「赭石墨」

一句话：**纸为白、壳沉灰、字如墨、一笔赭石**。

- **中性为骨**：整个界面 90% 由 `--bg / --surface / --fg / --muted / --border` 构成的无彩色体系撑起，保证长时间书写不疲劳。
- **单色为魂**：`--accent #B45309`（赭石 / sepia-ink）是全站唯一的暖色 voice，用于链接、光标、选中、激活。它取自「手写墨迹 / 旧稿纸边」的意象，既区别于后台蓝，也区别于 Bear 的红、Obsidian 的紫、Typora 的蓝 —— 是写作工具的「墨」。
- **暖意来自强调色与排版，而非背景**：背景保持中性（不用奶油 / 米色铺底），暖感由赭石色与墨黑文字传达，避免落入「AI 奶油风」。
- **对比度**：亮色下 `#B45309` 对白底 ≈ **5.0:1**，满足正文 AA；暗色下 `#D98B4A` 对 `#1F1F1E` ≈ **6.0:1**。

---

## 3. 核心色卡

### 3.1 亮色（纸面）

| 角色 | Token | 值 | 用途 |
|------|-------|-----|------|
| 画布 | `--bg` | `#FFFFFF` | 文档区背景（纸） |
| 外壳 | `--surface` | `#F7F7F6` | 工具栏 / 侧栏 |
| 外壳悬停 | `--surface-2` | `#EFEEEC` | hover / active 底色 |
| 主文字 | `--fg` | `#1E1D1B` | 正文 |
| 次文字 | `--fg-2` | `#4A4844` | 编辑源码 / 标签 |
| 弱化 | `--muted` | `#8B877F` | 说明 / 占位 |
| 元数据 | `--meta` | `#A8A49C` | 行号 / 时间 |
| 边框 | `--border` | `#E6E4E0` | 分割线 |
| 强调 | `--accent` | `#B45309` | 链接 / 光标 / 选中 |
| 强调浅底 | `--accent-soft` | `#FAF0E4` | 选区背景 |

### 3.2 暗色（柔黑）

| 角色 | Token | 值 |
|------|-------|-----|
| 画布 | `--bg` | `#1F1F1E` |
| 外壳 | `--surface` | `#191918` |
| 主文字 | `--fg` | `#E7E4DF` |
| 次文字 | `--fg-2` | `#B3AFA8` |
| 弱化 | `--muted` | `#857F76` |
| 边框 | `--border` | `#35332F` |
| 强调 | `--accent` | `#D98B4A` |
| 强调浅底 | `--accent-soft` | `#33261A` |

### 3.3 语义色（低饱和，避免与强调色抢戏）

| 语义 | 亮色 | 暗色 |
|------|------|------|
| success | `#3E7D55` | `#5FAE7E` |
| warn | `#AD7B15` | `#D3A94E` |
| danger | `#B23B31` | `#DF7268` |
| info | `#35699B` | `#7BA8D6` |

### 3.4 代码高亮六 token（UI 与代码共用同一套暖调）

| Token | 亮色 | 暗色 | 语义 |
|-------|------|------|------|
| `--hl-keyword` | `#A6392A` | `#E08C7C` | 关键字 |
| `--hl-string` | `#4C7A44` | `#A8C68C` | 字符串 |
| `--hl-number` | `#23608F` | `#84B4DB` | 数字 / 字面量 |
| `--hl-title` | `#8A5A24` | `#D8B173` | 函数 / 标题 |
| `--hl-comment` | `#8E8A82` | `#8A857C` | 注释（斜体） |
| `--hl-attr` | `#6E5A1E` | `#C7A86A` | 属性 / 变量 |

> 沿用 Obsidian 的「单一调色板主权」思路：代码配色与 UI 强调色同属暖调家族，界面与其内的代码在视觉上是一体的。

---

## 4. 字号与排版

- **基准（左右统一）**：编辑区与预览区正文均为 **15px**（`--text-base` / `--text-md`）、行高 **1.7**（`--leading-body` / `--leading-reading`）。两栏同字号同行高，同步滚动时文字位置不再错位 —— 这是本次改造的核心 KPI。
- **编辑区字体改动**：从 `SF Mono / Menlo`（等宽）→ 正文字体栈（`-apple-system / PingFang SC`）。等宽仅在代码块与行内代码中保留。
- **预览标题**：h1–h6 统一 `font-weight 600`，**仅靠字号 + 留白分层**（30 / 24 / 20 / 17 / 16 / 15px），**移除 border-bottom**；h6 用 `--muted` 弱化。
- **字重三级**：400 读 / 510 强调 / 590 宣布。
- **字距**：正文 `0`；≤13px 小字 `+0.01em`；标题 `-0.01em`。
- **阅读行宽**：预览区 `max-width: var(--preview-measure)` = `46rem` ≈ 736px（长文舒适行宽）。

---

## 5. 图标方案（锁定一套 · 终版）

**锁定决策：项目内联 SVG，零新增依赖 —— `AppIcon.vue` + `paths.js`。**

- **唯一渲染入口**：`frontend/src/components/icons/AppIcon.vue` —— 全项目只有它渲染 `<svg>`；业务组件禁止直接引 `paths.js`、禁止内联裸 `<svg>`。
- **唯一锁定点**：`frontend/src/components/icons/paths.js` —— 几何数据 `ICONS` + 语义白名单 `SEMANTICS`；白名单外的名字不渲染。
- **数据模型（关键）**：`paths.js` 的 value 是**完整内层 SVG 标记**（可含 `circle` / `path` / `rect` 多元素），**不是单条 path 的 `d` 值**。13 个几何中 **8 个是多元素结构**（`sun` = circle + 8×path，`file-text` = 5×path，`printer` = 2×path + rect…），单路径模型渲染会残缺。
- **几何来源（硬约束）**：逐字摘录自官方 **`lucide-static@1.48.0`** 的 `icons/*.svg`（经 `unpkg.com/lucide-static@1.48.0/icons/<name>.svg` 拉取），**未做任何重绘或凭记忆重构**；`paths.js` 头部已注明来源仓库 + 版本。
- **许可**：Lucide 为 **ISC**（其中 `chevron-down / chevron-right / download / moon / x` 衍生自 Feather，为 MIT）。全文见 `frontend/src/components/icons/LICENSE`，项目根 `README.md` 已标注。
- **统一规范**：`stroke="currentColor"`、`stroke-width="1.75"`、`stroke-linecap/linejoin="round"`（均由 AppIcon 注入，不写在几何数据里）；尺寸 **16px（行内/树）** 与 **20px（按钮内）**。
- **无障碍**：图标按钮必带 `aria-label`（AppIcon 的 `label` prop）；纯装饰图标自动 `aria-hidden="true"`。**禁止 emoji 作为功能图标**（含 `DEFAULT_DOC` 示例文档内的列表符号）。

### 图标语义清单（15 个语义 / 13 个唯一几何 · 即 `paths.js` 登记表）

| # | 语义名 | 用途位置 | 几何（Lucide） | 元素数 |
|---|--------|----------|----------------|--------|
| 1 | `open-file` | 顶栏左 | `file-text` | 5 |
| 2 | `open-folder` | 顶栏左 | `folder-open` | 1 |
| 3 | `save` | 顶栏左 | `save` | 3 |
| 4 | `export-html` | 顶栏右 | `download` | 3 |
| 5 | `export-pdf` | 顶栏右 | `printer` | 3 |
| 6 | `theme-light` | 顶栏右（切换） | `sun` | 9 |
| 7 | `theme-dark` | 顶栏右（切换） | `moon` | 1 |
| 8 | `sidebar-collapse` | 顶栏 / 侧栏 | `panel-left-close` | 3 |
| 9 | `sidebar-expand` | 顶栏 / 侧栏 | `panel-left-open` | 3 |
| 10 | `file` | 文件树叶子 | `file-text` | 5 |
| 11 | `folder` | 文件树收起 | `folder` | 1 |
| 12 | `folder-open` | 文件树展开 | `folder-open` | 1 |
| 13 | `chevron-right` | 目录收起 | `chevron-right` | 1 |
| 14 | `chevron-down` | 目录展开 | `chevron-down` | 1 |
| 15 | `close` | 浮层 / 对话框 | `x` | 2 |

> `chevron` 按方向拆成两个语义（一个语义对应两种图形会引入歧义）。`file-text` / `folder-open` 被复用，故 15 语义对应 13 个唯一几何。
> 预留：`settings`（设置）、`search`（搜索）后续按需扩展，仍走同一套 `paths.js`。

### 核验结论（验收项）

- **几何来源核验**：13 个几何与官方 `lucide-static@1.48.0` **逐字节一致**（脚本比对通过，无差异、无多余键）。
- **双尺寸目视核验**：16px 与 20px 两个尺寸逐一核验 —— 描边粗细一致、形状**完整无残缺**（`sun` 8 条光芒齐全、`printer` 托盘完整、`file-text` 三条文本线 + 折角齐全）、无裁切、视觉重心一致。
- **核验物**：`docs/design/icon-verification.html`（亮/暗两套 × 16/20 双尺寸对照表）。

---

## 6. 存量 P0 修复清单（映射到具体文件）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 1 | `src/App.vue` 顶栏 | 6 个按钮使用 emoji 表情符作图标 | 换为 `<AppIcon>`：`open-file / open-folder / save / export-html / export-pdf / theme-light·theme-dark` |
| 2 | `src/components/TreeNode.vue` | 树图标使用 emoji 表情符 | 换为 `<AppIcon>`：`folder / folder-open / file`（16px） |
| 3 | `src/App.vue` `DEFAULT_DOC` | 列表项使用 emoji 表情符 | 改为纯 Markdown 文本（见 §7） |
| 4 | `src/themes/preview.css` | `h1/h2` 的 `border-bottom` | 删除，改字号 + `margin` 分层 |
| 5 | `src/themes/preview.css` | `blockquote` 的 `3px solid var(--accent)` 竖线 | 改为 `--surface-warm` 浅底 + `--fg-2` 文字，去彩条 |
| 6 | `src/themes/base.css` | `--accent: #3370ff` 后台蓝 | 旧变量块移除，改由 `themes/tokens/design-tokens.css` 提供，强调色 `#B45309` |
| 7 | `src/editor/createEditor.js` | `.cm-content` 用等宽字体、`fontSize: 14px` | 改正文栈 + `var(--text-base)`（15px）+ `--leading-body`；行号用 `--meta` |
| 8 | `src/themes/base.css` | `body font-size: 14px` | 改 `var(--text-base)`（15px）+ `--leading-body`；入口改 `themes/index.css` |

---

## 7. `DEFAULT_DOC` 示例文档重写（去 emoji）

````markdown
# 欢迎使用 Inkmark

左侧编辑，右侧实时预览。

## 支持的能力

- Markdown 语法高亮（CodeMirror 6）
- 预览代码块高亮（highlight.js）
- 明暗主题切换，跟随系统偏好
- 导出 HTML 与 PDF
- 打开本地文件夹，直接管理 Markdown 文件

```js
function hello(name) {
  console.log(`你好, ${name}!`)
}
hello('Inkmark')
```

> 编辑器与预览区的滚动是联动的。
````

---

## 8. 前端迁移指引（运行时文件已落到 `frontend/src/themes/`）

**运行时文件布局**（本次已建立，`docs/design/design-tokens.css` 降级为设计快照）：

```
frontend/src/themes/
├── index.css                    # 唯一样式入口：@import tokens → base → preview
├── tokens/
│   └── design-tokens.css        # 单文件：A1/A2/B/C 四层 + 兼容别名层（注释分节）
├── base.css                     # 全局重置 + body 基础排版（已移除旧颜色变量块）
└── preview.css                  # 预览排版 + highlight.js token 配色
```

**接入步骤**：
1. `App.vue` 顶部 `import './themes/index.css'`（**唯一样式入口**）；`App.vue` 原 `import './themes/preview.css'` 已删除；`main.js` 不再单独 `import './themes/base.css'`（已移除该行，避免重复加载）。
2. `base.css` 的旧 `:root` 颜色变量块**已删除**——原因是加载顺序上 base 在 tokens 之后，若保留旧值会覆盖新 Token。旧变量名**由 `tokens/design-tokens.css` 末尾的兼容别名层统一提供**（`--bg-primary / --bg-secondary / --bg-tertiary / --text-primary / --text-secondary / --shadow / --editor-bg / --editor-text`），**组件零改动即可生效**。
3. **渐进迁移**：组件逐文件把旧名换成新语义 Token（`--bg-primary` → `--bg` 等）；新写的组件一律直接用新 Token。
4. **迁移全部完成后**，再删除别名层。
5. 暗色切换仍走 `document.documentElement.dataset.theme = 'dark'`，编辑器无需重建。

---

## 9. Token 使用场景速查

| 场景 | 应使用 |
|------|--------|
| 文档区 / 预览区背景 | `--bg` |
| 工具栏 / 侧栏背景 | `--surface`；悬停 `--surface-2` |
| 正文 | `--fg`；次要 `--fg-2`；说明 `--muted`；行号/元数据 `--meta` |
| 分割线 | `--border`；内部行分隔 `--border-soft`；输入聚焦前 `--border-strong` |
| 链接 / 光标 / 选中 / 激活项 | `--accent`（≤2 处/屏） |
| 选区背景 | `--accent-soft` |
| 代码块 | `background: --code-bg`；`border: 1px --code-border`；文字 `--font-mono` |
| 行内代码 | `background: --code-inline-bg` |
| 语法高亮 | `--hl-keyword/string/number/title/comment/attr` |
| 键盘焦点 | `box-shadow: var(--focus-ring)`（仅 `:focus-visible`） |
| 浮层 | `box-shadow: --elev-raised`（暗色自动减弱） |

---

## 10. 合规自检（P0）

- [x] **无 emoji 作功能图标** —— 图标统一走 `lucide-vue-next` + `AppIcon` 白名单；示例文档已去 emoji。
- [x] **无紫色→粉色渐变** —— 全站无渐变，无 `#7C3AED/#A855F7/#EC4899` 组合。
- [x] **无硬编码色值** —— 组件层只引用 token（`#fff/#000` 例外，仅出现在 token 定义内）。
- [x] **无空洞占位文案** —— 空状态与示例文档均为具体中文内容。
- [x] **无千篇一律 Hero** —— 本产品为工具型界面，无营销 Hero。
- [x] 完整 Design Token（颜色 40+ / 间距 / 圆角 / 阴影 / 动效 6 项 / 字距）。
- [x] 图标系统已锁定一套并给出尺寸与描边规范。
- [x] 对比度：正文 ≥4.5:1；焦点环 / 键盘可达 / `prefers-reduced-motion` 均覆盖。
