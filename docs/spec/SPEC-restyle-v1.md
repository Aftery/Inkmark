# Spec — Inkmark 视觉重构 v1.0（方案 A · Typora 化）

> 生成日期：2026-09-29
> 基于：用户拍板方向（方案 A 视觉重构 + 编辑区改正文字体）+ `docs/design/`（v2）+ `docs/architecture/`（ADR-001 v2.1 / ADR-002 v2 / restyle-plan v2）
> 状态：**待用户确认**
> 说明：本项目为既有产品的视觉重构，非新产品立项。Spec 按实际需要裁剪，不设 API / 数据库章节（本次无接口与数据层改动）。

---

## 1. 产品定义

- **一句话描述**：把 Inkmark 从「VSCode 式源码编辑器」改造成「Typora 式写作工具」的观感。
- **目标用户**：本机使用者（单用户桌面场景）。
- **核心问题**：现有 UI 是**编辑器基因**——等宽字体 + 常驻行号 + 整行灰色高亮 + 语法彩色高亮；而预览区是 markdown-it 的正文排版。两套视觉语言塞进同一窗口，且左右两栏字体/字号/行高互不相同，同一条文本在两栏中位置错位。这是「难看」的根因，换配色治不了。

---

## 2. 范围锁定（做）

| 编号 | 项 | 验收摘要 |
|---|---|---|
| S-01 | 顶栏去工具感 | 6 个按钮改无边框 ghost 图标按钮，图标全部换 SVG，移除全部 emoji |
| S-02 | 编辑区去代码感 | 移除行号与整行高亮；字体由等宽改正文栈；正文 15px / 行高 1.7 |
| S-03 | 左右对齐 | 编辑区与预览区正文**字号、行高完全一致**（15px / 1.7） |
| S-04 | 预览区排版 | 正文列限宽 `46rem` 居中；标题去下划线；引用块去彩色竖线 |
| S-05 | 配色重构 | 全面切换「赭石墨」token，强调色由 `#3370ff` 换为 `#B45309`（亮）/ `#D98B4A`（暗） |
| S-06 | 文件树去 emoji | 树图标换 SVG（16px），行高提升 |
| S-07 | 双色板统一 | 编辑器与预览区代码高亮由两套色板统一为一套（`--hl-*`） |
| S-08 | 欢迎文档去 emoji | `DEFAULT_DOC` 重写为无 emoji 的纯 Markdown |

---

## 3. 明确不做（Out of Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|---|---|---|
| 单栏 / 专注模式（方案 B） | 本次只做视觉重构，不动交互模型 | 方案 A 验收通过后 |
| 所见即所得合一（方案 C） | 需重写编辑器内核，工程量 2-3 周 | 路线图终点 |
| 更换编辑器内核（CodeMirror → 其他） | ROI 不足 | 无计划 |
| 合并高亮引擎（删掉 highlight.js） | 架构级改动，与视觉重构无关 | v2 |
| 引入 Tailwind / UI 组件库 | 与「零新增依赖」原则冲突 | 无计划 |
| 引入 token 构建工具链 | 14 个量级手维护足够 | token 数量膨胀后 |
| 内嵌字体 | 用系统原生栈，避免首屏抖动 | 无计划 |
| Go 端 / IPC 改动 | 本次是纯前端改造 | 无计划 |
| Design Token 变量改名工程 | 旧名经别名层继续可用，改名是纯风险无收益 | 别名层删除后再评估 |
| 预览渲染防抖、图片插入、fsnotify 监听 | README 既有待办，非本次范围 | 各自独立立项 |

---

## 4. 技术架构与文件组织（锁定）

**技术栈不变**：Wails v2 (Go) + Vue 3 + CodeMirror 6 + markdown-it + highlight.js。
**新增 npm 依赖：0 个**（图标采用内联 SVG，未经由任何图标库）。

### 4.1 样式文件组织（唯一入口，顺序即依赖顺序）

```
frontend/src/themes/
├── index.css                    # 唯一样式入口：按序 @import
├── tokens/
│   └── design-tokens.css        # 单文件：A1 identity + A2 semantic + B slot
│                                #        + C extension + 旧名兼容别名层（注释分节）
├── base.css                     # 全局 reset + body 基础排版
└── preview.css                  # 预览区排版 + --hl-* 映射
```

```css
/* themes/index.css —— 顺序不得调整 */
@import './tokens/design-tokens.css';  /* 1 Token，必须最先 */
@import './base.css';                  /* 2 reset + 基础 */
@import './preview.css';               /* 3 预览排版 */
```

> Token 采用**单文件**（四层用注释分节），不做 `semantic.css` / `component.css` 物理拆分。
> `docs/design/design-tokens.css` 仅为设计交付**快照**，文件头已注明「运行时以 `frontend/src/themes/tokens/` 为准」。
> 漂移防线：快照与运行时变量集合比对（已实测 **107 个变量定义，0 差异**）。

入口收敛：`App.vue` 引 `./themes/index.css`（单一入口），`main.js` 不再单独引 `base.css`。

### 4.2 图标模块

```
frontend/src/components/icons/
├── AppIcon.vue   # 全项目唯一渲染 <svg> 的组件
├── paths.js      # 语义名 → 完整内层 SVG 标记（唯一锁定点）
└── LICENSE       # Lucide (ISC) 许可声明
```

- 来源：`lucide-static@1.48.0`（官方，ISC）
- 数据模型：value 为**完整内层 SVG 标记**（多元素），**不是**单条 `d`
- 全项目禁止绕过 `AppIcon` 直接引图标、禁止内联裸 `<svg>`

### 4.3 Token 分层

`semantic`（语义）→ `component`（组件级）两层 + **迁移期别名层**。
不引入 `primitive` 层：当前仅一套色相族 + 明暗两套值，primitive 层无第二消费者，属过度设计。

---

## 5. 组件清单（锁定）

| 组件/文件 | 改动 | 对应验收 |
|---|---|---|
| `App.vue` 顶栏 | 6 按钮改 ghost 图标按钮；emoji → `AppIcon`；导出/主题归入右侧图标区 | S-01 |
| `App.vue` `DEFAULT_DOC` | 重写为无 emoji 纯 Markdown | S-08 |
| `components/TreeNode.vue` | 树图标 → `AppIcon`（16px）；行高提升；去圆角 hover 块 | S-06 |
| `components/icons/*` | **新增**（已交付并验收） | S-01/S-06 |
| `editor/createEditor.js` | 移除 `lineNumbers()` / `highlightActiveLine()`；正文栈 15px/1.7；删死 CSS（`.cm-gutters` / `.cm-activeLine*`） | S-02 |
| `editor/highlight.js` | **新增**：统一语法色板（合并 Markdown 结构 + 代码 token） | S-07 |
| `themes/preview.css` | 正文列限宽居中；h1/h2 去下划线；blockquote 去彩条；`--hl-*` 映射 | S-04/S-07 |
| `themes/tokens/*` | **新增**（已落盘） | S-05 |
| `main.js` | 移除 `base.css` 引用 | — |

---

## 6. 设计 Token（锁定）

**核心色卡**

| 语义 | 亮色 | 暗色 |
|---|---|---|
| 画布 `bg` | `#FFFFFF` | `#1F1F1E` |
| 面 `surface` | `#F7F7F6` | `#191918` |
| 主文字 `fg` | `#1E1D1B` | `#E7E4DF` |
| 次文字 `fg-2` | `#4A4844` | `#B3AFA8` |
| 弱文字 `muted` | `#8B877F` | `#857F76` |
| 边框 `border` | `#E6E4E0` | `#35332F` |
| **强调 `accent`** | **`#B45309`** | **`#D98B4A`** |

**代码高亮（统一色板，编辑器与预览共用）**

| token | 亮色 | 暗色 |
|---|---|---|
| keyword | `#A6392A` | `#E08C7C` |
| string | `#4C7A44` | `#A8C68C` |
| number | `#23608F` | `#84B4DB` |
| title | `#8A5A24` | `#D8B173` |
| comment | `#8E8A82` | `#8A857C` |
| attr | `#6E5A1E` | `#C7A86A` |

**排版**

- 字体栈：`-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`
- 等宽（**仅代码**）：`"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace`
- 字号阶梯：12 / 13 / **15（编辑与预览正文基准）** / 16 / 18 / 20 / 24 / 30
- 预览标题：h1 30 · h2 24 · h3 20 · h4 17 · h5 16 · h6 15
- 行高：正文 **1.7**（编辑与预览一致）· 标题 1.3
- 间距栅格：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64
- 圆角：6 / 8 / 12（上限 12）
- 阅读列宽：`--preview-measure: 46rem`
- 顶栏 44px · 侧栏 232px

**图标**：15 语义 / 13 几何 · 16px（行内/树）· 20px（按钮）· stroke 1.75 · `currentColor`

---

## 7. 验收标准（EARS 格式）

| 编号 | 功能 | 验收标准 | 优先级 |
|---|---|---|---|
| AC-01 | 顶栏 | UI 层**必须**不含任何 emoji 字符作功能图标 | P0 |
| AC-02 | 图标 | 所有图标**必须**经 `AppIcon` 渲染；`components/icons/` 外**不得**出现裸 `<svg>` | P0 |
| AC-03 | 左右对齐 | While 同一 Markdown 文本在左右两栏渲染，两栏正文字号与行高**必须**完全一致 | P0 |
| AC-04 | 编辑区 | 编辑器**必须**不显示行号；**必须**无整行高亮带 | P0 |
| AC-05 | 配色 | 组件 CSS 中**不得**出现裸 hex（唯一例外 `#fff` / `#000`）；`#3370ff` **必须**完全消失 | P0 |
| AC-06 | 预览排版 | 预览正文列**必须**限宽并居中；h1/h2 **不得**有 `border-bottom`；blockquote **不得**有彩色竖线 | P1 |
| AC-07 | 高亮统一 | 编辑器与预览的同一语法 token **必须**取自同一色板 | P0 |
| AC-08 | 明暗主题 | 切换主题时，编辑区/预览区/图标**必须**同步联动，无残留旧色 | P0 |
| AC-09 | 构建 | `npm run build` **必须**零 error | P0 |
| AC-10 | 既有能力 | 文件树、滚动联动、导出 HTML/PDF、Cmd+S 保存**必须**全部保持可用 | P0 |

---

## 8. 边界与约束

- 不支持 IE；目标为 Wails 内嵌 WebKit（macOS 12+）
- 比例字体下 Markdown 源码的表格/列表对齐语义失效 —— **这是用户已接受的取舍**，代码块仍保留等宽
- 圆角上限 12px；内容容器不加阴影
- 动效 120–240ms，尊重 `prefers-reduced-motion`

---

## 9. 内嵌已知坑（防重蹈覆辙）

| 坑 | 触发条件 | 根因 | 修法 |
|---|---|---|---|
| 图标渲染残缺 | 用 `<path :d>` 单路径模型渲染 Lucide | Lucide 24×24 中多数图标是多元素（`sun` 9 个、`file-text` 5 个） | 数据存完整内层标记，`AppIcon` 用 `v-html` 渲染 |
| 构建解析失败 | `import '@/docs/design/xxx.css'` | `vite.config.js` 未配 `@` 别名，且 `docs/` 在 Vite root 之外 | 运行时 CSS 必须落在 `src/` 内，用相对路径 |
| CSS 变量覆盖 | `base.css` 保留旧 `:root` 变量块 | base 在 tokens 之后加载，旧值覆盖新 Token | 已移除 base.css 的颜色变量块 |
| bash `grep` 假阴性 | `grep "A\|B"` 查文本 | 本机 `\|` 交替匹配不可靠；叠 `&&` 会被退出码 1 短路 | 一律用 ripgrep；命令间用 `;` |
| npm 装包失败 | 直接 `npm i` | 本机需镜像且代理变量会干扰 | `unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy` 后用 `--registry=https://registry.npmmirror.com` |

---

## 10. 端到端验证步骤

```bash
cd /Users/aftery/Desktop/myapp/inkmark/frontend

# 1) 构建必须零 error
npm run build

# 2) P0 门禁：emoji 作功能图标（UI 层）
node -e "const fs=require('fs');const p=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;['src/App.vue','src/components/TreeNode.vue','src/components/FileTree.vue'].forEach(f=>{const s=fs.readFileSync(f,'utf8');console.log(f, p.test(s)?'EMOJI-FOUND':'clean')})"

# 3) P0 门禁：绕过 AppIcon 的裸 <svg>
grep -rn '<svg' src --include=*.vue | grep -v 'components/icons/'

# 4) P0 门禁：旧强调色必须消失
grep -rniE '3370ff' src && echo 'STILL-PRESENT' || echo 'clean'

# 5) 图标验收：13 几何与官方源逐元素一致（已通过）
#    见验收记录：13/13 OK，0 失败

# 6) 运行时：wails dev（本机需先 unset 代理）
~/go/bin/wails dev
#   人工核验：明暗切换联动 / 左右文字基线对齐 / 文件树图标 16px / 代码块高亮左右一致
```

---

## 11. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|---|---|---|---|
| 2026-09-29 | 初版生成 | 用户拍板方案 A + 编辑区正文字体 | 全量 |
| 2026-09-29 | 图标方案由 npm 库改判为内联 SVG | 设计师已产出几何，内联原最大缺点（手工维护）消解 | 图标模块 |
| 2026-09-29 | 图标数据模型由单 path 改为多元素标记 | 核验发现 14 个中约 10 个为多元素，单 path 会残缺 | 图标模块 |
| 2026-09-29 | Token 运行时文件定为**单文件** `tokens/design-tokens.css` | 收敛：架构文档与落盘代码均已为单文件，避免第四次反转产生新的不一致。原「双份漂移」风险位于 docs 快照 ↔ 运行时 **之间**，不由运行时内部拆分产生 | themes/tokens/ |
| 2026-09-29 | 编辑区与预览区正文统一 15px / 1.7 | 消灭「左右对不齐」，本次改造核心 KPI | 编辑区 + 预览区 |
| 2026-09-29 | **S-01~S-08 实施完成**：顶栏换 AppIcon ghost 按钮、编辑区去行号/活动行并改正文栈、预览区限宽居中并去装饰线、文件树换 SVG 图标、编辑器与预览统一 `--hl-*` 色板、DEFAULT_DOC 重写、**HTML 导出模板同步新设计语言（补 `--hl-*` 语法色）** | 按本 Spec 落地 | `App.vue` `TreeNode.vue` `FileTree.vue` `createEditor.js` `preview.css` `exporters.js` `base.css` |
| 2026-09-29 | 门禁实测：emoji 0 命中 / 裸 `<svg>` 0 处 / `#3370ff` 0 处 / 组件裸 hex 0 处 / 行号与活动行代码 0 残留 / `npm run build` 零 error（322 模块） | AC-01~AC-09 全部通过 | 全量 |

> **实施备注**：`export/exporters.js` 保留裸 hex 属**架构豁免**——它是自包含 HTML 生成器，
> 产物必须脱离编辑器独立可看，需把 Token 值内联为静态值（与「token 定义文件」同类）。
> 另：迁移期别名层目前已无组件消费者（全部改用新 Token 名），可按 ADR-002 的 M3 步骤择机删除。

---

## 附：已完成的验收记录

| 项 | 方法 | 结果 |
|---|---|---|
| 13 个图标几何与官方源一致性 | 拉取 `lucide-static@1.48.0` 源 SVG，逐元素比对 | **13/13 OK，0 失败** |
| 版本号真实性 | HTTP 请求 unpkg | **200，文件头确认 v1.48.0** |
| 语义白名单完整性 | 程序化解析 15 个语义 | **0 解析失败，0 孤儿几何** |
| 许可声明 | 检查 `icons/LICENSE` | **完备**（仓库/版本/URL/采集方式/ISC） |
| 旧变量别名层覆盖 | 逐个核 17 个旧变量名 | **17/17 全覆盖** |
| 设计文档 emoji 扫描 | 正则扫描 `docs/design/` | **0 命中** |
