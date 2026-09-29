# Inkmark DESIGN.md

> 生成日期：2026-09-29 | 设计师：颜好看 | 基于：方案 A「视觉重构」+ 用户拍板方向
> 三轴刻度：**Variance = 3 / Motion = 2 / Density = 3**
> 配套文件：`design-tokens.json` · `design-tokens.css` · `design-tokens.md`

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

- **视觉主题关键词**：克制 · 纸感 · 文字优先 · 安静
- **氛围描述**：一张干净的纸，一支墨色的笔。界面外壳沉入背景，只有文字与光标占据视野；唯一的暖色（赭石）用于链接与焦点，像手写留下的墨迹。
- **对标品牌**：Typora（无干扰极简）/ Bear（单一暖色强调）/ Obsidian（系统字体宣言）
- **寄存器**：Product（设计服务产品，非营销页）

---

## 2. Color Palette & Roles（色彩与角色）

- **A1-identity**：`--bg #FFFFFF` · `--surface #F7F7F6` · `--fg #1E1D1B` · `--muted #8B877F` · `--accent #B45309` · `--border #E6E4E0`
- **A2-semantic**：`--success #3E7D55` · `--warn #AD7B15` · `--danger #B23B31` · `--info #35699B`
- **B-slot 别名**：`--fg-2 #4A4844` · `--surface-warm #F6F5F3` · `--meta #A8A49C` · `--border-soft #F0EEEB` · `--accent-hover #98450A`
- **C-extension**：`--code-bg` · `--code-inline-bg` · `--hl-*`（关键字/字符串/数字/标题/注释/属性）
- **每屏强调色使用 ≤ 2 处**：链接、光标/选中/激活 —— 三者仅取必要项。
- **配色来源**：自研「赭石墨」调色板，借鉴 `color-palettes.md` 第 22 套「知识库/文档中性」的中性策略 + 第 14 套「生产力」的低饱和语义色；强调色为品牌自定义（区别于 Bear 红 / Obsidian 紫 / 后台蓝）。
- **暗色策略**：柔黑画布 `#1F1F1E`（非纯黑）+ 暖白文字 `#E7E4DF`（非纯白），强调色提亮到 `#D98B4A` 以保 ≥4.5:1。

---

## 3. Typography（排版）

- **字体栈**（系统原生，零网络字体）：
  - `--font-display` / `--font-body`：`-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`
  - `--font-mono`：`"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace`（**仅代码**）
- **字号阶梯**：xs 12 / sm 13 / base 15 / md 15 / lg 18 / xl 20 / 2xl 24 / 3xl 30（px）。**编辑区与预览区正文统一 15px**（`--text-base` = `--text-md`），保证两栏同步滚动时文字位置对齐。
- **预览标题**：h1 30 · h2 24 · h3 20 · h4 17 · h5 16 · h6 15（px），统一 600 字重，**无 border-bottom**
- **字重**：3 级 —— 400 正文 / 510 次标题 / 590 主标题
- **行高**：正文 1.7（编辑与预览统一）/ 标题 1.3 / 控件 1.4
- **字距**：正文 0 / ≤13px 小字 +0.01em / 标题 -0.01em / 全大写 +0.06em
- **配对来源**：`typography-pairings.md` 第 5 套「Minimal Swiss」的单字族策略（层级靠字号/字重，非字体差异）+ 第 22 套中文简体 fallback 策略。

---

## 4. Components（组件规范）

- **按钮**
  - Ghost（工具栏默认）：透明底、无边框、`--fg` 图标+文字、hover `--surface-2`、active 再深一档、圆角 `--radius-sm`
  - Primary（弹窗确认）：`--accent` 底 / `--accent-on` 字 / hover `--accent-hover` / active `--accent-active`
  - 状态：default / hover / focus-visible（`--focus-ring`）/ active / disabled（opacity 0.5，禁用指针）/ loading（spinner）
- **输入框**：`--bg` 底 / `--border-strong` 边 / focus 时 `--accent` 边 + `--focus-ring`；错误态 `--danger` 边 + 近字段错误文案
- **卡片 / 容器**：`--bg` 底 + 1px `--border` + `--radius-md` + **零阴影**；hover 仅边框变 `--border-strong`
- **导航**：桌面顶栏 44px（macOS 隐藏式标题栏，左留 78px 给红绿灯）+ 可选左侧栏 232px；移动端预留底部 TabBar
- **模态框 / Toast / Badge / Avatar**：模态 `--radius-lg` + `--elev-raised`；Toast 用 `--surface` + 语义色左点；Badge 用 `--radius-pill` + 语义 `-soft` 底
- **图标**：内联 SVG（零新增依赖）—— `components/icons/AppIcon.vue`（唯一渲染入口）+ `components/icons/paths.js`（几何 + 语义白名单）；16px 行内 / 20px 按钮内，stroke 1.75，`currentColor`。禁止绕过 AppIcon 引图标、禁止业务组件内联裸 `<svg>`

---

## 5. Layout & Spacing（布局与间距）

- **间距基准**：4px 网格 —— 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64
- **圆角阶梯**：sm 6 / md 8 / lg 12 / pill 9999（**上限 12px**，避免过度圆滑）
- **容器**：`--toolbar-height 44px` · `--sidebar-width 232px` · `--preview-measure 46rem`（阅读行宽）
- **布局**：顶栏 + `flex` 双栏（编辑 / 预览），侧栏可选；编辑区与预览区分隔用 1px `--border`，**不用阴影**
- **响应式断点**：sm 640 / md 768 / lg 1024 / xl 1280
- **网格**：本产品为工具界面，采用 flex 分栏，非营销 12 列栅格

---

## 6. Depth & Elevation（深度与层级）

- **三级层级**：`--elev-flat`（内容默认，无阴影）/ `--elev-ring`（1px 边框环）/ `--elev-raised`（浮层）
- **原则**：写作工具的内容容器**永不加阴影**；层级优先用留白与发丝边框表达
- **暗色**：`--elev-raised` 自动减弱强度，改用亮度递进表达层级
- **z-index**：base 0 / dropdown 1000 / sticky 1100 / modal 1200 / toast 1300

---

## 7. Do's & Don'ts（设计守则）

**应当做**
1. 画布最净（`--bg`），外壳次级（`--surface`），文字最重（`--fg`）
2. 每屏强调色 ≤2 处，仅用于链接 / 光标 / 选中 / 激活
3. 标题靠字号与留白分层，而非边框或装饰线
4. 间距一律落在 4px 网格；圆角 ≤12px
5. 图标统一走 `AppIcon`（内联 SVG + `paths.js` 白名单），尺寸 16 / 20px，stroke 1.75
6. 暗色用柔黑 `#1F1F1E`、亮色文字用暖墨 `#1E1D1B`
7. 代码块用 `--font-mono` + `--code-bg`，与 UI 同一暖调家族
8. 过渡 120–240ms，且尊重 `prefers-reduced-motion`

**禁止做**
1. 不用 emoji 作功能图标（含示例文档）
2. 不用 `#3370ff` 类后台管理蓝作强调色
3. 不用紫色→粉色渐变、发光边框、毛玻璃
4. 不给 `h1/h2` 加 GitHub 式下边框
5. 不给 `blockquote` 加 3px 彩色竖线
6. 不在内容容器叠加装饰性阴影
7. 不用奶油 / 米色铺底（暖意交由强调色与排版传达）
8. 不在组件内写裸 hex（`#fff/#000` 例外）

---

## 8. Responsive & Accessibility（响应式与无障碍）

- **响应式**：桌面为完整双栏；≤1024px 侧栏默认收起；≤768px 双栏回退为标签切换的单栏
- **无障碍**：
  - 正文对比度 ≥4.5:1（亮色强调 5.0:1 / 暗色 6.0:1）
  - 键盘可达：所有操作可 Tab 到达；焦点用 `:focus-visible` + `--focus-ring`
  - 图标按钮必带 `aria-label`；纯装饰图标 `aria-hidden`
  - 动效支持 `prefers-reduced-motion: reduce`（时长归零）
- **触摸目标**：≥44×44px；按钮间距 ≥8px
- **5 态覆盖**：Loading（骨架/ spinner）/ Empty（引导文案 + CTA）/ Error（具体信息 + 重试）/ Populated / Edge（超长文本截断）

---

## 9. Agent Implementation Guide（实现指南）

- **引入方式**：`App.vue` 顶部 `import './themes/index.css'`（唯一样式入口），index.css 内部 `@import` 顺序固定为 `./tokens/design-tokens.css` → `./base.css` → `./preview.css`；`main.js` 不再单独引 `base.css`，`App.vue` 原 `import './themes/preview.css'` 已删除。运行时 Token 为**单文件** `frontend/src/themes/tokens/design-tokens.css`（A1/A2/B/C 四层 + 别名层，用注释分节），`docs/design/design-tokens.css` 仅作设计快照。
- **旧变量名与渐进迁移**：`themes/base.css` 的原 `:root` 颜色变量块**已移除**（base 加载在 tokens 之后，保留旧值会覆盖新 Token）；旧变量名（`--bg-primary / --bg-secondary / --bg-tertiary / --text-primary / --text-secondary / --shadow / --editor-bg / --editor-text`）由 `tokens/design-tokens.css` 末尾的**兼容别名层统一提供**，组件零改动即生效；随后按文件渐进迁移到新语义 Token，全部迁移完成后再删除别名层。
- **主题切换**：`document.documentElement.dataset.theme = 'light' | 'dark'`，编辑器无需重建。
- **编辑器**（`createEditor.js`）：`.cm-content` 改 `var(--font-body)` + `font-size: var(--text-base)` + `line-height: var(--leading-body)`；光标 `--accent`；行号 `--meta`；活动行 `--surface`（暗色下用轻微提亮）。
- **预览区**（`preview.css`）：删除 h1/h2 `border-bottom` 与 blockquote 彩条；标题走 `--preview-h*-size`；`--hl-*` 六色映射 highlight.js token。
- **图标**：`components/icons/AppIcon.vue`（唯一渲染入口）+ `components/icons/paths.js`（几何数据 + 语义白名单，15 个语义 / 13 个几何，见 `design-tokens.md §5`）。`paths.js` 的 value 是**完整内层 SVG 标记**（可含 circle/path/rect 多元素），几何逐字摘录自 `lucide-static@1.48.0`，许可全文见 `components/icons/LICENSE`。
- **已知坑**：macOS 顶栏需保留左侧 78px 交通灯安全区；`user-select: none` 需在输入区（`.cm-content / input`）恢复为 `text`。
- **Tailwind（若后续引入）**：`colors` 直接映射上述 CSS 变量（`bg: var(--bg)` 等），`borderRadius` 用 `--radius-*`，不引入新色。
