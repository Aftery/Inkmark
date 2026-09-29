# Inkmark 视觉重构落地方案（方案 A：保留双栏，只重做视觉与排版）

- 状态：Accepted（2026-09-29，v2.2 —— 已并入设计师「颜好看」交付的 Design Token 与图标规范；图标组件名统一 `AppIcon.vue`，Token 以落盘代码为准 = **单文件** `tokens/design-tokens.css`）
- 版本锚定（`frontend/package.json` 实际安装版本）：
  - Vue `^3.5.13`、Vite `^6.3.5`、`@vitejs/plugin-vue` `^5.2.1`
  - CodeMirror：`@codemirror/view` `^6.38.0`、`@codemirror/state` `^6.5.2`、`@codemirror/language` `^6.11.0`、`@codemirror/lang-markdown` `^6.3.2`、`@lezer/highlight` `^1.2.1`
  - 预览：`markdown-it` `^14.1.0`、`highlight.js` `^11.11.1`
  - **本次不新增任何运行时依赖（图标改内联 SVG，见 §2）**
- 关联决策：`ADR-001-icon-strategy.md`（v2.1 内联 SVG）、`ADR-002-token-layering.md`（v2.3 以设计产物为 Token 源、单文件）
- 设计输入（已交付）：`docs/design/design-tokens.json`（DTCG 源）· `src/themes/tokens/design-tokens.css`（A1/A2/B/C 四层 + 内置旧名兼容别名层）· `design-tokens.md` · `DESIGN.md`

> 本文遵循「规格即契约」（`references/01-standards/spec-as-contract.md`）：点名要改的文件与接口、显式列出**本次不做**、钉死版本、把已知坑写进硬约束、以端到端验证收尾。
> 本方案只定义**规则与落地机制**，色值/字号/间距等具体值以设计师 `design-tokens.json` 为单一事实源。

---

## 0. 现状与目标

- 现状：`themes/base.css` 两层结构（同名变量两套值）；编辑器 `mdHighlight`（`@lezer/highlight` tag，仅覆盖 Markdown 结构，围栏内代码走 CM 默认 fallback 色板）与预览 `highlight.js`（`--hl-*`）**两套色板**；编辑区等宽字体 + 行号 + 整行高亮；工具栏与文件树用 emoji 作图标。
- 目标：保留双栏与全部能力，只重做视觉与排版；编辑区**放弃等宽、改正文栈（`--font-body`）15px**；消除双色板；去 emoji 功能图标与行号，恢复「纸感·文字优先」气质。

---

## 1. Token 接入（以设计产物为单一源）

> 完整决策见 `ADR-002`。要点：**不重命名、不另造 token**，以单文件 `src/themes/tokens/design-tokens.css` 为运行时源（以落盘代码为准），现有变量名经其**内置别名层**继续工作 → 组件零改动。

### 1.1 分层与依赖铁律

采用设计师的**四层角色**（文件内）：A1 identity / A2 structure / B slot / C extension；架构层附加**单向依赖铁律**：
- 组件（`.vue` / 组件 CSS）**只引用语义 token**；**禁止在组件文件写裸 hex**（唯一例外 `#fff`/`#000` 及其 alpha）；裸 hex 只允许出现在 **token 定义文件**内。
- token 之间可互相引用；组件不得反向定义 token。

### 1.2 语义 token 与现有变量名的对照（由设计师内置别名层承接，无需前端手建）

| 现有变量名（当前代码在用） | 新语义 token | 说明 |
|---|---|---|
| `--bg-primary` | `--bg` | 画布 |
| `--bg-secondary` | `--surface` | 外壳（工具栏/侧栏） |
| `--bg-tertiary` | `--surface-2` | 外壳悬停/激活 |
| `--text-primary` | `--fg` | 主文字 |
| `--text-secondary` | `--fg-2` | 次级文字 |
| `--shadow` | `--elev-raised` | 浮层阴影 |
| `--editor-bg` | `--bg` | 编辑画布 |
| `--editor-text` | `--fg` | 编辑文字 |
| `--accent` / `--border` / `--code-bg` / `--hl-*` | 同名保留 | 无需别名 |

> 别名层已写在 `design-tokens.css` 末尾（`:root { --bg-primary: var(--bg); ... }`），**逐文件渐进迁移**：先用后改，改完一处删一处依赖。

### 1.3 文件组织与加载顺序（**确定版**）

```
frontend/src/themes/
├── index.css               # 【新】唯一样式入口：按序 @import（顺序即依赖顺序）
├── tokens/
│   └── design-tokens.css   # 【新】运行时 Token 源（单文件：A1/A2/B/C 用注释分节 + 别名层）
├── base.css                # 【改】只留 reset + body/input 基础；删除旧变量块
├── preview.css             # 【改】预览排版；保留 --hl-* 映射
└── editor.css              # 【可选新增】编辑器排版（承接 EditorView.theme 外的需 CSS 化部分）
```

`themes/index.css`（**唯一样式入口**；CSS `@import` 必须置于文件顶部，Vite 构建期内联，顺序即依赖顺序；**与落盘一致**）：
```css
/* themes/index.css —— 顺序即依赖顺序，不得调整 */
@import './tokens/design-tokens.css';  /* 1 token（A1/A2/B/C + 别名层，必须最先） */
@import './base.css';                  /* 2 reset + body/input 基础 */
@import './preview.css';               /* 3 预览排版 + --hl-* 映射 */
@import './editor.css';                /* 4（若启用）编辑器排版 */
```

- `main.js`：`import './themes/base.css'` → **`import './themes/index.css'`**（单一入口，符合「入口只装配」）。
- `App.vue`：**删除** `import './themes/preview.css'`（改由 `index.css` 统一加载，避免入口分散破坏层序）。

> **已知坑（必须修正）**：设计师曾指引 `import '@/docs/design/design-tokens.css'`——**在本项目无法解析**（`vite.config.js` 未配置 `@` 别名，当前仅 `plugins: [vue()]`），构建会失败。故运行时 token 置于 `src/themes/tokens/design-tokens.css`、经 `themes/index.css` 相对路径引入；`docs/design/` 仅作设计交付/记录，不作构建依赖。
> **文件数收敛留痕**：team-lead 2026-09-29 经历「单文件 → 两文件 → 单文件」两次反转，**最终以落盘代码为唯一依据定为单文件**（设计师实测：快照 vs 运行时 107 个变量定义、0 差异）。详见 ADR-002 Status。

### 1.4 迁移路径（3 步，全部由别名层兜底）

| 步 | 动作 | 可见变化 |
|----|------|----------|
| M1 接入 | 建 `themes/index.css`（按序 @import）；token 落到 `src/themes/tokens/design-tokens.css`（单文件）；`base.css` 删旧变量块；`main.js` 改引 `index.css` | 全局换新配色（赭石墨）；组件零改动 |
| M2 逐组件改写 | 组件把旧名改新名（`--bg-primary`→`--bg` 等），**逐文件推进** | 无（值等价） |
| M3 收尾 | 删 `design-tokens.css` 末尾别名层 | 无 |

- 同步契约：`docs/design/design-tokens.json` 为源 → 更新 `tokens/design-tokens.css` → 同步到 `src/themes/tokens/`（token 源↔运行时漂移风险见 §10 风险 1）。

---

## 2. 图标方案（内联 SVG，锁定 14 个）

> 决策与对比矩阵见 `ADR-001`（v2.1）。**锁定：项目内联 SVG 组件集（Lucide 几何）**，零新增依赖。

```
src/components/icons/
├── AppIcon.vue     # 统一渲染：viewBox 24 / fill none / stroke currentColor / stroke-width 1.75
├── paths.js     # 语义名 → 完整内层 SVG 标记（可含多元素：path/circle/line/rect/polyline…，唯一锁定点/白名单/唯一注入点）
└── LICENSE      # 【必须】注明图标几何衍生自 Lucide（ISC）
```

- 规范：`viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`stroke-width="1.75"`、`stroke-linecap/linejoin="round"`；尺寸 **16px（行内/树）** / **20px（按钮内）**（token `--icon-size-inline` / `--icon-size-button`）。
- **数据模型（v2.1 修正）**：`paths.js` 的值是**完整内层 SVG 标记字符串**（非单条 `d`），`AppIcon.vue` 用 `<svg v-html="markup">` 渲染。原因：Lucide 14 个里约 10 个是多元素图标（`sun`、`printer`、`file-text`、`save`、`download`、`x`、`folder-open`、`panel-left-*` 等），单 path 会渲染残缺/空白。`v-html` 可控前提：值为构建期静态白名单常量、无用户输入、`paths.js` 为唯一注入点（详见 ADR-001）。
- 14 个语义：`file-text`(打开文件/文件叶子)、`folder-open`(打开文件夹/展开)、`save`、`download`(HTML)、`printer`(PDF)、`sun`/`moon`(主题)、`panel-left-close`/`panel-left-open`(侧栏)、`folder`(收起)、`chevron-right`/`chevron-down`(展开)、`x`(关闭)。清单见 `design-tokens.md §5`。
- 硬约束：仅 `currentColor`（随主题联动）；仅图标按钮必带 `aria-label`；**禁止**绕过 `AppIcon.vue` 内联裸 `<svg>`；**禁止** emoji 作功能图标；**禁止**混用其他图标集。
- **许可（设计师文档未覆盖，须补）**：Lucide 为 **ISC 许可**，内联其几何须保留版权/许可声明 → 在 `icons/LICENSE` 与根 `README` 标注。

---

## 3. 统一双色板（编辑器 ↔ 预览）

### 3.1 问题与结论

两引擎挂载点机制不同（CM 用 `@lezer/highlight` 的 **JS tag 对象**；highlight.js 用 **CSS class `hljs-*`**），无法用单一选择器文件统一 → **在变量层统一**。规范色板即设计师的 **`--hl-*` 六色**（`--hl-keyword/string/number/title/comment/attr`，亮/暗两套，暖调家族）。**撤回 v1 自创的 `--syntax-*`**——`--hl-*` 正是 `preview.css` 现用名，统一几乎零改动。

- 预览侧：`preview.css` **保留现有 `--hl-*` 映射不变**（已符合）。
- 编辑器侧：把 `mdHighlight` 升级为**同时覆盖 Markdown 结构 + 代码 token**的单一 `HighlightStyle`，颜色改引 `--hl-*`。

### 3.2 编辑器适配器（`src/editor/highlight.js`【新】）

CM `HighlightStyle` 的 `color` 接受任意 CSS 值，`var()` 有效——**现有代码 `createEditor.js:20` `{ tag: t.link, color: 'var(--accent)' }` 已实证**。

```js
// src/editor/highlight.js（示例，非指定实现）
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const editorHighlight = HighlightStyle.define([
  /* —— Markdown 结构（沿现有效果）—— */
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '600' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '600' },
  { tag: t.heading3, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },   // 代码仍等宽
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.quote, color: 'var(--fg-2)' },
  /* —— 代码 token（与预览共用 --hl-* 单一色板）—— */
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.tagName, t.angleBracket], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hl-number)' },
  { tag: [t.function(t.variableName), t.definition(t.variableName), t.className, t.typeName, t.namespace, t.labelName], color: 'var(--hl-title)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.processingInstruction], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.propertyName, t.attributeName, t.escape], color: 'var(--hl-attr)' },
])

export const highlightExtension = syntaxHighlighting(editorHighlight, { fallback: true })
```

`createEditor.js` 删除内联 `mdHighlight` 与其 import，改 `import { highlightExtension } from './highlight'`。

### 3.3 预览侧映射（`preview.css`，保持现名不变）

| highlight.js class | token | 对照 CM tag |
|---|---|---|
| `hljs-comment`, `hljs-quote` | `--hl-comment` | `t.comment` |
| `hljs-keyword`, `hljs-selector-tag`, `hljs-tag`, `hljs-doctag`, `hljs-deletion` | `--hl-keyword` | `t.keyword`/`t.tagName` |
| `hljs-string`, `hljs-regexp`, `hljs-addition` | `--hl-string` | `t.string`/`t.regexp` |
| `hljs-number`, `hljs-literal` | `--hl-number` | `t.number` |
| `hljs-title`, `hljs-title.function_`, `hljs-name` | `--hl-title` | `t.function(...)` |
| `hljs-built_in`, `hljs-type`, `hljs-class .hljs-title` | `--hl-title` | `t.typeName`/`t.className` |
| `hljs-attr`, `hljs-attribute`, `hljs-variable`, `hljs-template-variable` | `--hl-attr` | `t.propertyName` |

> **已知坑**：CM 围栏内代码高亮依赖 `codeLanguages`（`src/editor/markdownHighlight.js`）注册的语言；**未注册语言静默不着色**（不报错），会造成「同段代码编辑区无色、预览区有色」的假性不一致。验收须用**已注册**（js/ts/html/css/json/py）与**未注册**语言各验一遍。

---

## 4. 去掉行号后的可用性设计

### 4.1 变更点
`createEditor.js` 移除 `lineNumbers()` 与 `highlightActiveLine()`（连带移除 `@codemirror/view` 的这两个 import）。

### 4.2 保留「当前行」轻量提示的方案
**默认：不保留整行高亮，以光标为唯一位置提示。** 编辑区已转为正文书写器，行号/整行高亮属**代码**定位心智，对比例字体散文是噪音（Typora 源码模式同样不显示行号）；光标已用 `--accent` 着色。

**降级方案（**本次不启用**；仅当日后用户反馈长文档丧失位置感再评估）**：直接复用设计师 token `--surface` 作极弱活动行底（这与当前 `.cm-activeLine` 用 `--bg-secondary`＝`--surface` 的取值一致）。实施二选一：
- A：重加 `highlightActiveLine()`，但 `.cm-activeLine { background: var(--surface) }`；**不再保留** `.cm-activeLineGutter`。
- B（更克制，推荐）：自写极薄 `ViewPlugin` 给当前行画**左缘 2px 竖条**（`border-left: 2px solid var(--accent)`），不横贯文本。

取舍：若需提示，**左缘竖条优于整行色带**（色带在浅色下横切阅读宽度、抢注意力）。

### 4.3 连带清理（防死代码残留）
- `createEditor.js` 的 `.cm-gutters` / `.cm-activeLineGutter` 规则**删除**（无行号后为死 CSS）。
- 编辑器主题：`fontFamily` 由等宽改为 `var(--font-body)`；`fontSize` 硬编码 `14px` 改 `var(--text-base)`（15px）；`lineHeight` 用 `var(--leading-body)`。
- `--meta` token 用途改为**元数据/时间戳**（原注释里的「行号」不再适用）。
- `App.vue` `DEFAULT_DOC` 去 emoji（见 `design-tokens.md §7` 的重写稿）。

> **跨队友不一致（已裁定，2026-09-29）**：`DESIGN.md §9` 曾写「行号 `--meta`；活动行 `--surface`」。team-lead 已裁定：**以用户决定为准，`lineNumbers()` 与 `highlightActiveLine()` 两者全部移除**，本次不启用任何活动行提示；`--surface` 仅作将来「可选极弱当前行提示」的备用 token 保留（本次不落地）。`--meta` 用途改为元数据/时间戳。

---

## 5. 本次不做（out-of-scope）

1. 不改布局：保留「左编辑 / 右预览」双栏，不做单栏 / WYSIWYG。
2. 不换内核：不替换 CodeMirror 6、markdown-it、highlight.js。
3. 不合并高亮引擎（不删 highlight.js），仅做变量层统一。
4. 不改滚动同步算法（比例映射→锚点不做）。
5. 不加新功能（防抖、未保存确认、图片粘贴、大纲、fsnotify 等）。
6. 不动 Go 端与 IPC 契约（`app.go` / `wailsjs`）。
7. 不引入 UI 组件库；**不新增任何图标 npm 依赖**（图标内联）。
8. 不迁移样式方案（不用 Tailwind / CSS-in-JS）。
9. 不引入 token 生成工具链（手维护，json 为源）。
10. 不内嵌字体文件（走系统字体栈）。
11. **不做 token 变量重命名工程**（用别名层渐进迁移，不一次性改名）。
12. 不改 `export/exporters.js` 的导出内联 CSS（导出物为静态 HTML，与运行时变量解耦；如后续同步新视觉，另开改动）。

---

## 6. 逐文件改动清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `frontend/src/themes/index.css` | **新增** | 唯一样式入口：按序 `@import`（design-tokens → base → preview → editor） |
| `frontend/src/themes/tokens/design-tokens.css` | **新增** | 运行时 Token 源（单文件：A1/A2/B/C 用注释分节 + 兼容别名层；以落盘代码为准） |
| `frontend/src/themes/base.css` | **改** | 只留 `*` reset + `html/body/#app` + `body`/`input` 基础；**删除旧变量块**；`body` 字号 14→用 token |
| `frontend/src/themes/preview.css` | **改** | 删 h1/h2 `border-bottom`；`blockquote` 去 3px 彩条改 `--surface-warm` 底 + `--fg-2` 字；标题走 `--preview-h*-size`；`--hl-*` 映射保留 |
| `frontend/src/themes/editor.css` | **新增（可选）** | 编辑器留白/内容宽度等需 CSS 化的部分 |
| `frontend/src/editor/highlight.js` | **新增** | 单一 `HighlightStyle`（Markdown + 代码 token → `--hl-*`） |
| `frontend/src/editor/createEditor.js` | **改** | 移除 `lineNumbers()/highlightActiveLine()`；字体/字号/行高 token 化；删 `.cm-gutters`/`.cm-activeLine*`；引入 `highlightExtension` |
| `frontend/src/components/icons/AppIcon.vue` | **新增** | 内联 SVG 统一渲染（16/20，stroke 1.75，currentColor，`<svg v-html="markup">` 渲染多元素内层标记） |
| `frontend/src/components/icons/paths.js` | **新增** | 14 图标的**完整内层 SVG 标记**白名单（可含多元素；唯一锁定点 + 唯一注入点；**取自官方 lucide-static 的 icons/*.svg，禁止凭记忆重构**） |
| `frontend/src/components/icons/LICENSE` | **新增** | Lucide（ISC）许可与版权声明 |
| `frontend/src/components/TreeNode.vue` | **改** | emoji（📂📁📄）→ `<AppIcon name="folder-open/folder/file-text">`（16px） |
| `frontend/src/App.vue` | **改** | 工具栏 emoji → `<AppIcon>`（20px）；删除 `import './themes/preview.css'`（改由 `index.css` 统一）；`DEFAULT_DOC` 去 emoji |
| `frontend/src/main.js` | **改** | `import './themes/base.css'` → `import './themes/index.css'`（单一入口） |
| `frontend/package.json` | **不改依赖** | 本期不新增运行时依赖 |
| `frontend/vite.config.js` | **不改（除非选择直引 docs）** | 若坚持从 `docs/` 直引 token 才需加 `resolve.alias`；**推荐不改**（token 置于 src） |

---

## 7. 设计约束（来自 DESIGN.md，纳入 Spec）

- 组件层**禁止写裸 hex**（`#fff`/`#000` 例外，仅出现在 token 定义内）。
- 每屏可见 `--accent` 使用 **≤ 2 处**（链接 / 光标 / 选中 / 激活只挑必要项）。
- 圆角 **≤ 12px**；内容容器**零阴影**，用 1px 边框环（`--elev-ring`）与留白分层。
- 标题靠字号 + 留白分层，**不加 h1/h2 下边框**；`blockquote` **不加彩色竖线**。
- 动效 120–240ms、无弹跳，尊重 `prefers-reduced-motion`。
- 焦点仅 `:focus-visible` + `--focus-ring`；触碰目标 ≥44×44px。

---

## 8. 知识库依据（引用自）

- `references/01-standards/spec-as-contract.md`：点名文件/接口、钉死版本、写 out-of-scope、内嵌已知坑、以端到端验证收尾。
- `references/01-standards/generated-code-failure-modes.md`：防死代码残留（§4.3）、防幻觉/未核验依赖（§2 许可与内联几何）、防沉默逻辑错误（§3.3 未注册语言假性不一致）。
- `references/01-standards/context-engineering.md`：指令在恰当高度——只定机制与验收、分步可回滚（§1.4）。
- `references/architecture/mvp-stack.md`：MVP 不过度设计（§1 零重命名、§5 不引工具链/不引 UI 库）。
- `references/cost-models/development-costs.md`：工作量量级（§10）。
- `references/01-standards/code-organization.md`：单文件 ≤300 行、单一职责、入口只装配（§6 与 §9 门禁）。

---

## 9. 端到端验证步骤（收尾即验收）

1. **构建门**：`cd frontend && npm run build` —— Vite 零 error（未解析 import / 错误的 `@/docs` 路径在此变红）。
2. **启动走查**：`~/go/bin/wails dev`（或 `wails build` 运行产物）。
3. **双色板一致性（核心）**：打开含 `js/ts/html/css/json/py` 六语言围栏 + 一段**未注册语言**围栏，**编辑区与预览区并排**核对：关键字/字符串/数字/函数名/类型/注释/属性颜色一致。
4. **主题联动**：切明暗。两区语法色与正文/背景/边框/链接同步变化，无残留上一主题颜色。
5. **图标**：工具栏与文件树无 emoji；图标为线性 SVG（16/20px、stroke 1.75）随主题变色；仅图标按钮有 `aria-label`。**并核验四条图标硬性验收条件**（见 ADR-001 v2.1）：① `paths.js` 取自官方 `lucide-static` 的 `icons/*.svg`（禁凭记忆重构）；② `components/icons/LICENSE` 存在且载有 Lucide(ISC) 版权/许可声明；③ 14 图标在 **16px 与 20px** 两尺寸逐一目视核验（描边粗细、端点、视觉重心、无变形）；④ **形状完整性**——多元素图标（`sun`/`printer`/`file-text`/`save`/`download`/`x`/`folder-open`/`panel-left-*`）元素齐全、无残缺或空白。
6. **编辑器形态**：无行号、无整行高亮带；正文为比例字体（`--font-body` 15px）；行内/围栏代码仍等宽；代码块/表格因删边框而靠留白分层。
7. **门禁命令**
   ```bash
   # 裸 hex（应仅命中 tokens/ 下的 token 定义文件与合法 #fff/#000）
   grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(' frontend/src \
     --include=*.vue --include=*.css --include=*.js | grep -v 'themes/tokens/'
   # 绕过 AppIcon 的内联裸 svg
   grep -rn '<svg' frontend/src --include=*.vue | grep -v 'components/icons/'
   # emoji 作功能图标
   grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' frontend/src/App.vue frontend/src/components/*.vue
   # 图标许可声明存在
   test -f frontend/src/components/icons/LICENSE && echo OK||echo MISSING
   # 图标多元素标记齐备（形状完整性，视图标而定）
   grep -nE '<(circle|line|rect|polyline)' frontend/src/components/icons/paths.js
   # 死 CSS 残留
   grep -rnE 'cm-gutters|cm-activeLineGutter' frontend/src
   # 单文件 ≤300 行
   find frontend/src \( -name '*.js' -o -name '*.vue' -o -name '*.css' \) | xargs wc -l \
     | sort -rn | awk '$1>300 && $2!="total"{print "OVER:",$0}'
   ```
8. **边界/错误流**：空文件夹（树空态）；无语言标记围栏；暗色下重载（`localStorage` 恢复、无闪白）；均不得报错或错色。

**完成定义**：构建通过 + 步骤 3–8 全绿 + 门禁无违规 = 交付完成。新坑回写本文件与对应 ADR。

---

## 10. 工作量与风险

**工作量**：Token 接入（M1）0.5 人日；图标（AppIcon.vue + 14 paths + 替换）1–1.5 人日（几何由设计师提供则取低值）；双色板统一 0.5 人日；编辑器形态与清理 0.5 人日；预览排版调整 0.5 人日；验证回归 0.5 人日。合计 **约 3.5–4 人日**。

**最大三个风险**：
1. **Token 源↔运行时漂移（中）**——`docs/design/` 快照与 `src/themes/tokens/design-tokens.css` 可能失同步。防线：以 `design-tokens.json` 为源、同步契约纳入 review、M3 删别名层、亮暗逐组件比对。（实测基线：设计师校验 107 个变量定义 0 差异。）
2. **编辑器/预览高亮适配器覆盖不全（低-中）**——两引擎现已共用 `--hl-*` 名，缺的仅是编辑器侧 tag 映射；漏映射会局部回退默认色。防线：完整 tag→`--hl-*` 映射表 + 六语言并排比对 + 未注册语言降级验证。
3. **比例字体 + 去行号的可读性/定位退化（中）**——`--font-body` 已含全平台回退栈；须保证代码块仍等宽、默认无整行高亮、必要时用 `--surface` 做极弱提示。
