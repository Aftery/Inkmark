# ADR-002: 以设计师产物为单一 Token 源 + 分层与迁移机制

## Status
Accepted (**v2.3, 2026-09-29**) —— 修订 v1。v1 提出自建 `primitive → semantic → component` 三层并把现有变量名定为规范名、另创 `--syntax-*`；v2 依据设计师「颜好看」交付的 `docs/design/design-tokens.{json,css,md}`（四层 A1/A2/B/C + 内置旧名兼容别名层）**改为以设计师产物为单一 Token 源**，规范名以设计产物为准，语法色板沿用其 `--hl-*`。v1 的**核心原则**（组件零改动迁移、组件层禁止裸 hex、依赖单向向下）保留。

**文件数收敛过程（决策留痕，如实记录）：**
- v2：token 运行时**单文件** `src/themes/tokens/design-tokens.css`（A1/A2/B/C 用注释分节 + 别名层）。
- v2.2：一度改为**两文件** `tokens/semantic.css` + `tokens/component.css`。
- **v2.3（最终）：改回单文件**。**唯一依据 = 以落盘代码为事实源**——经核对磁盘实际状态：运行时 token 为**单文件** `frontend/src/themes/tokens/design-tokens.css`，`semantic.css` / `component.css` **已被删除**；`themes/index.css` 实际 `@import` 为 `'./tokens/design-tokens.css'` → `'./base.css'` → `'./preview.css'`。
- **收敛依据（设计师实测）**：快照 vs 运行时 **107 个变量定义，0 差异、0 多出、0 缺失** —— 单文件即以事实证据证明无漂移。
- team-lead 于 2026-09-29 就此子决策与我各反转一次，责任在 team-lead 的互斥指令恰好卡在完成时刻送达；现停止反转，**以代码为准**。

**终版，已冻结**（team-lead 裁定 2026-09-29，不再反转）：不重命名、不另造 token、`--syntax-*` 撤回、统一用 `--hl-*`；文件数**以落盘代码为准 = 单文件**；如需变更须报 team-lead 裁决，不得自行改本 ADR。

## Background

现状：`frontend/src/themes/base.css` 两层结构（`:root` 亮 / `:root[data-theme='dark']` 暗，同名变量两套值），12 个变量名被 `App.vue`、`preview.css`、`createEditor.js`、`TreeNode.vue`、`exporter.js` 多处引用。

设计师已交付：
- `design-tokens.json`：DTCG 格式（`$schema: design-tokens community group format`），**机器可读单一事实源**，亮/暗各 34 色 + font/space/radius/shadow/focus/motion/layout/icon。
- `src/themes/tokens/design-tokens.css`：**实际落盘的单文件**，可直接 import；四层架构 **A1 identity / A2 structure / B slot / C extension**（用注释分节），**末尾内置旧变量名兼容别名层**。
- `design-tokens.md` / `DESIGN.md`：设计契约、使用速查、图标清单、迁移指引。

因此 v1「自建三层 + 自造命名」已无必要——设计师产物**已内建旧名别名**，直接满足「组件零改动迁移」这一核心诉求。

## Decision

**以单文件 `src/themes/tokens/design-tokens.css` 为运行时 Token 源（以落盘代码为准）；规范名以设计产物为准；现有变量名经其内置别名层继续可用；重构期不重命名、不另造 token。**

### 分层模型（采用设计师的 A1/A2/B/C，附加架构层的依赖铁律）

```
（文件内角色，来自 `design-tokens.css` 单文件）
A1 identity   品牌核心：--bg/--surface/--fg/--muted/--accent/--border/--font-*
A2 structure  结构项：--surface-2/--overlay/--border-strong/--accent-{hover,active,soft,on}/语义色/字号/间距/圆角/阴影/动效/布局
B  slot       组件别名：--fg-2/--surface-warm/--meta/--border-soft
C  extension  项目专属：--code-{bg,inline-bg,border}/--hl-*（6 色）
```

**架构层依赖铁律（补在设计分层之上，二者正交）**：
- 组件（`.vue` / 组件 CSS）**只引用语义 token**，禁止跨层直引原始 hex。
- **组件文件禁止写裸 hex**（唯一例外 `#fff` / `#000` 及其 alpha 形式）；裸 hex 只允许出现在 **token 定义文件**（`tokens/design-tokens.css`）内。
- token 内部引用可互相指向（`--elev-ring: 0 0 0 1px var(--border)` 等），但不允许组件反向定义 token。

> 与 v1 的差异：v1 把「硬编码值圣所」定为独立的 `primitive.css`。v2 认定**该圣所即 token 定义文件本身**（非组件文件）。关于文件数：team-lead 于 2026-09-29 经历「单文件 → 两文件 → 单文件」两次反转，**最终以落盘代码为唯一依据定为单文件** `src/themes/tokens/design-tokens.css`——设计师实测「快照 vs 运行时 107 个变量定义、0 差异、0 多出、0 缺失」，证明单文件无漂移。过程留痕见 Status。

### 语法高亮色板：沿用 `--hl-*`（撤回 v1 的 `--syntax-*`）

- 规范语法 token = 设计师的 **`--hl-keyword / --hl-string / --hl-number / --hl-title / --hl-comment / --hl-attr`**（6 色，亮/暗两套，均落暖调家族）。
- **撤回 v1 自创的 `--syntax-*` 命名**——避免与设计产物分叉；且 `--hl-*` 正是 `preview.css` 现用名，**零改动**即达成「单一色板」（编辑器适配器见 restyle-plan §3）。
- 链接色用 `--accent`；引用块用 `--fg-2`；标点/无名 token 回退 `--fg`；`built_in/type` 复用 `--hl-title`（与现有 `preview.css` 一致）。

### 文件组织与加载顺序

| 文件 | 角色 |
|---|---|
| `frontend/src/themes/index.css` | **唯一样式入口**：按序 `@import`（顺序即依赖顺序） |
| `frontend/src/themes/tokens/design-tokens.css` | **运行时 Token 源**（单文件：A1/A2/B/C 四层用注释分节 + 别名层；以落盘代码为准） |
| `frontend/src/themes/base.css` | 只留 reset + `body`/`input` 基础；**移除旧变量块** |
| `frontend/src/themes/preview.css` | 预览排版 + `--hl-*` 映射（保留现名） |
| `frontend/src/themes/editor.css` | 编辑器排版（可选，承接 `EditorView.theme` 之外需 CSS 化的部分） |
| `docs/design/design-tokens.{json,css,md}` | **设计交付/记录**（DTCG json 为单一事实源） |

- `themes/index.css`（**唯一样式入口**，`@import` 顺序即依赖顺序，**与落盘一致**）：`./tokens/design-tokens.css` → `./base.css` → `./preview.css`。
- `main.js`：`import './themes/base.css'` → **`import './themes/index.css'`**（单一入口）。`App.vue` 删除 `import './themes/preview.css'`。
- **导入路径缺陷修正（重要）**：设计师曾建议 `import '@/docs/design/design-tokens.css'`，但**本项目 `vite.config.js` 未配置 `@` 别名**（仅 `plugins: [vue()]`），该路径**无法解析、构建会失败**。故运行时 token 文件应置于 `src/themes/tokens/` 下并用相对路径引入（如上）；如需从 `docs/` 直引，则必须先在 `vite.config.js` 加 `resolve.alias`。**推荐前者**（`docs/` 不应作为构建依赖）。

### 迁移路径（3 步，全部由别名层兜底，可逐文件渐进）

| 步 | 动作 | 可见变化 |
|----|------|----------|
| M1 接入 | 建 `themes/index.css`（按序 @import）；token 落到 `src/themes/tokens/design-tokens.css`（单文件）；`base.css` 删旧变量块；`main.js` 改引 `index.css` | 全局换新配色（赭石墨），**组件代码零改动**（旧名经别名层解析） |
| M2 逐组件改写 | 组件按新语义 token 改写（`--bg-primary`→`--bg` 等），**逐文件推进**，写完一处删一处依赖 | 无（值等价） |
| M3 收尾 | 组件全部迁完 → 删除 `design-tokens.css` 末尾别名层 | 无 |

- 同步契约：token 变更以 `docs/design/design-tokens.json` 为源 → 更新 `tokens/design-tokens.css` → 同步到 `src/themes/tokens/`。为避免漂移，后续可引入生成脚本（见「后续」）。

### 后续（非本次）
- 若手维护开始漂移：引入 `scripts/build-tokens.mjs`，由 DTCG json 生成 CSS（输出单一 `tokens/design-tokens.css`）。
- **维持单文件** `tokens/design-tokens.css`（以落盘代码为准，team-lead 2026-09-29 终裁）。

## Consequences

**正面**
- **零重命名、零大爆炸**：设计师产物自带旧名别名层，M1 即可全局生效，组件零改动 → 迁移风险大幅下降。
- 单一事实源（DTCG json）+ 单一运行时定义文件 → 明暗一致性与对比度由设计侧系统性保证（正文 ≥4.5:1）。
- 语法色板 `--hl-*` 与 `preview.css` 现名一致 → 双色板统一**几乎零改动**（仅新增编辑器侧映射）。
- 组件层「禁止裸 hex」可被一条 grep 门禁客观检查；圣所收敛到 token 定义文件。

**负面 / 风险（含与 v1 的差异）**
1. **`docs/` 作为运行时依赖的隐患（已规避）**：设计师的 `@/docs/...` 路径在本项目不可解析（无 `@` 别名）。缓解：运行时置 `src/`，已写入上文；若坚持直引 `docs/` 必须先配别名。
2. **token 源 ↔ 运行时漂移（中）**：`docs/design/` 快照与 `src/themes/tokens/design-tokens.css` 可能失同步。缓解：以 json 为源、约定「改 token 先改 json」、纳入 review；超阈值上生成脚本（属后续）。**实测基线**：设计师已校验 107 个变量定义 0 差异。
3. **别名层技术债（中）**：别名只增不减会掩盖真实依赖。缓解：M3 强制删除别名层；M2 逐文件推进并同步删依赖。
4. **依赖设计师产物的稳定性（低-中）**：命名/分层后续若变更，需同步本 Spec。缓解：本 ADR 记录契约；变更走 MADR。

### 三个最大风险（相对 v1 重新评估）
1. **Token 源↔运行时漂移（中）**（v1 的「明暗错位」风险因设计师已给亮/暗成对值 + 别名层兜底而降级）。防线：json 为源 + 同步契约 + M3 删别名 + 亮暗逐组件比对。
2. **编辑器/预览高亮仍两套适配器**（**降为低**）：两引擎共用 `--hl-*` 现名，缺的只是编辑器侧 tag 映射。防线：完整 tag→`--hl-*` 映射表 + 六语言并排比对 + 未注册语言降级验证（CM 未注册语言静默无高亮）。
3. **比例字体 + 去行号的可读性/定位退化（中）**：`--font-body` 已给全平台栈（含 PingFang SC/Noto Sans SC/Microsoft YaHei）；`--font-mono` 仅限代码。防线：默认无整行高亮，必要时用 `--surface` 做极弱提示。

## Related ADRs
- ADR-001（图标方案 v2.1）：图标 `currentColor` 与语义 token 联动，同受「组件层禁止裸 hex」约束。
- restyle-plan.md §1（token 接入）、§3（双色板统一，改用 `--hl-*`）、§6（文件清单）、§8（门禁与验证）。
