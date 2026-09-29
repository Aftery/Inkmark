# ADR-001: 图标方案——项目内联 SVG 组件集（Lucide 几何）+ 内层封装

## Status
Accepted (**v2.1, 2026-09-29**) —— 取代 v1 的「引入 npm 图标库（lucide-vue-next）」决策（v1 已 **Superseded**）。
修订原因：设计师「颜好看」在 `docs/design/design-tokens.md §5` / `DESIGN.md §4` 交付了**内联 SVG 图标规范与 14 个语义清单**，并承诺提供几何路径初稿。v1 对比矩阵中对内联方案的最大扣分项（手工维护成本）因设计师提供几何而消解；同时内联可**零新增依赖、永久离线、无版本漂移**，更契合 Wails 桌面应用的打包与供应链面。故采纳内联方案，并保留 v1 的**核心机制**（统一封装 + 显式白名单）不变。

**v2.1（2026-09-29，team-lead 授权修订）**：修正图标**数据模型**——v2 的「单条 `d` + `<path>`」模型经核验不成立（Lucide 14 个中约 10 个为多元素图标，单 path 会渲染残缺），改为「完整内层 SVG 标记字符串 + `v-html`」（见 Decision 与验收条件）。

**终版，已冻结**（team-lead 裁定 2026-09-29）：内联 SVG 为终版方案，不再反转；如需变更须报 team-lead 裁决，不得自行改本 ADR。

## Background

Inkmark 当前把 emoji 当功能图标用：
- `App.vue` 工具栏：`📂 🗂 💾 ⬇ 🖨 🌙/☀️`；`components/TreeNode.vue`：`📂/📁/📄`。

约束：P0 禁止 emoji 作功能图标；须锁定**一套** SVG 方案、全项目统一不混用；Wails 桌面应用离线运行、无 CDN；图标须随 `data-theme` 明暗联动。

v1 曾决策「引入 ESM 图标库 + 封装」。本 v2 依据设计师交付物改为「内联 SVG 组件集 + 封装」。两者**只在图标来源上不同，封装机制完全一致**，因此 v1 已写成的 `AppIcon` 白名单机制得以整体沿用（改动收敛在「叶子来源」一处），这也验证了 v1 把「库」隔离在单文件的设计价值。

## Decision

**锁定：项目内联 SVG 组件集（Lucide 几何，stroke-based），经统一封装 + 显式白名单使用。**

### 形态与规范（与设计师产物一致）

| 项 | 规定 |
|---|---|
| 文件 | `src/components/icons/AppIcon.vue`（统一渲染组件）+ `src/components/icons/paths.js`（语义名 → **完整内层 SVG 标记**，可含多元素；**显式白名单 = 唯一锁定点**） |
| 几何 | Lucide（`viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`stroke-linecap="round"`、`stroke-linejoin="round"`） |
| 描边 | `stroke-width="1.75"`（统一，不得混入实心/彩色图标） |
| 尺寸 | **16px**（行内 / 文件树）· **20px**（按钮内）——对应 token `--icon-size-inline` / `--icon-size-button` |
| 颜色 | **只允许 `currentColor`**（继承文本色，随主题联动）——满足 P0「禁止硬编码颜色」 |
| 图标集 | **14 个语义**（见下表），全项目只用这一套 |
| 禁止 | 禁止 emoji 作功能图标；禁止混用 heroicons / 图标字体 / 其他图标集；禁止在业务组件里内联写裸 `<svg>` |

### 图标语义清单（锁定 14 个，来自 `design-tokens.md §5`）

| # | 语义 | 位置 | Lucide 几何 |
|---|------|------|-------------|
| 1 | 打开文件 | 顶栏左 | `file-text` |
| 2 | 打开文件夹 | 顶栏左 | `folder-open` |
| 3 | 保存 | 顶栏左 | `save` |
| 4 | 导出 HTML | 顶栏右 | `download` |
| 5 | 导出 PDF | 顶栏右 | `printer` |
| 6 | 明亮主题 | 顶栏右（切换） | `sun` |
| 7 | 暗色主题 | 顶栏右（切换） | `moon` |
| 8 | 侧栏折叠 | 顶栏 / 侧栏 | `panel-left-close` |
| 9 | 侧栏展开 | 顶栏 / 侧栏 | `panel-left-open` |
| 10 | 文件（叶子） | 文件树 | `file-text` |
| 11 | 文件夹（收起） | 文件树 | `folder` |
| 12 | 文件夹（展开） | 文件树 | `folder-open` |
| 13 | 目录展开/收起 | 文件树 | `chevron-right` / `chevron-down` |
| 14 | 关闭 | 浮层 / 对话框 | `x` |

预留（后续按需扩展，仍走同一套）：`settings`、`search`。

### 组件 API（示例，非指定实现）

```vue
<!-- src/components/icons/AppIcon.vue -->
<script setup>
import { computed } from 'vue'
import { icons } from './paths'   // 值为「内层 SVG 标记字符串」（可含多个元素）

const props = defineProps({
  name: { type: String, required: true },          // 白名单键，如 'folder-open'
  size: { type: [Number, String], default: 16 },   // 16=行内/树，20=按钮
  label: { type: String, default: '' },            // 有值→role=img+aria-label；无值→aria-hidden
})
// 白名单常量查表：未登记 → null → 不渲染（静默失败，故新增图标必须登记）
const markup = computed(() => icons[props.name] ?? null)
</script>

<template>
  <!-- v-html 注入内层元素：数据为构建期静态白名单常量（见 paths.js 安全前提），非用户输入 -->
  <svg
    v-if="markup" class="icon"
    :width="size" :height="size" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.75"
    stroke-linecap="round" stroke-linejoin="round"
    :role="label ? 'img' : undefined" :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    v-html="markup"
  />
</template>

<style scoped>
.icon { display: inline-block; vertical-align: -0.15em; flex-shrink: 0; }
</style>
```

```js
// src/components/icons/paths.js —— 唯一锁定点 & 唯一图标注入点
// ⚠️ 值 = 图标的「完整内层 SVG 标记」（一个或多个元素：path / circle / line / rect / polyline …）。
//    单 path 模型不成立：Lucide 24×24 多数图标由多元素构成（sun = circle + 8 条 line/path；
//    printer = 2 path + rect；file-text = 5 path；save/download 含 polyline/line；x = 2 path）。
//    存单条 d 会渲染成残缺或空白，且不报错（静默错误）。
//    来源：官方 lucide-static 仓库 icons/*.svg（文件头注明仓库 + commit/tag），禁止凭记忆重构。
//    安全前提：本文件所有值均为构建期静态字面量常量，不含用户输入、不做字符串插值；
//    它是全项目唯一的图标注入点，故 AppIcon.vue 的 v-html 在此可控。
export const icons = {
  'folder':           '<path d="…"/>',                                   // 单元素
  'moon':             '<path d="…"/>',                                   // 单元素
  'chevron-right':    '<path d="m9 18 6-6-6-6"/>',                       // 单元素
  'chevron-down':     '<path d="m6 9 6 6 6-6"/>',                        // 单元素
  'folder-open':      '<path d="…"/><path d="…"/>',
  'file-text':        '<path d="…"/><path d="…"/><path d="…"/><path d="…"/><path d="…"/>',
  'save':             '<path d="…"/><path d="…"/><line …/>',
  'download':         '<path d="…"/><polyline points="…"/><line …/>',
  'printer':          '<path d="…"/><path d="…"/><rect …/>',
  'sun':              '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/>…（共 9 个元素）',
  'panel-left-close': '<rect …/><path d="…"/>',
  'panel-left-open':  '<rect …/><path d="…"/>',
  'x':                '<path d="…"/><path d="…"/>',
}
```

> **数据模型选型（v2.1 修订）**：v2 初稿用「单条 `d` + `<path :d="d"/>`」模型，经核验**不成立**（14 个里约 10 个是多元素图标，会渲染残缺）。本版改为 **A 方案：`paths.js` 存完整内层 SVG 标记字符串，`AppIcon.vue` 用 `v-html` 渲染**。`v-html` 可接受的前提已写入 `paths.js` 文件头：值为构建期静态白名单常量、无用户输入、`paths.js` 为唯一注入点。**B 方案**（存元素描述数组 `[{tag,attrs}]` + `<component :is>`/渲染函数遍历）更严格、无 `v-html`，但更重且对本项目无实质收益，故不采用；若日后安全基线要求禁用 `v-html`，可平滑迁移到 B（`AppIcon.vue` 单点改动，`paths.js` 数据结构随之调整）。**team-lead 2026-09-29 裁决：采纳 A（保真度优先——从 `lucide-static` 逐字拷贝标记比转写为元素数组的转录环节更少，更契合验收条件第 1 条「逐元素与源 SVG 一致」）；B 不实现，仅作备选记录。**

### 对比矩阵（v1 保留，作为选型依据；v2 结论已更新）

| 维度 | 内联 SVG 组件（**v2 选定**） | npm 图标库（lucide-vue-next） | 图标字体 |
|---|---|---|---|
| 包体积 | 最小（≈3–5 KB，仅 14 图标 path） | ≈8–12 KB（tree-shaking 后） | 30–100 KB+，无法 tree-shake |
| 新增依赖 | **0** | 1（含版本漂移与供应链面） | 1（字体资源） |
| 离线可用 | 完全离线 | 完全离线 | 需内嵌字体 |
| 主题联动 | `currentColor` 原生 | `currentColor` 原生 | 依赖 `color` |
| 维护成本 | **低**（几何由设计师提供；新增=加一行 path） | 低（加 import） | 中 |
| 与设计一致性 | **完全可控**（精确到 path） | 受库几何约束 | 差 |
| Vue3 集成 | 一个 `AppIcon.vue` 通用 | 官方组件 | 需自定义包裹 |
| 评分（5 分制，加权） | **4.5** | 4.0 | 1.5 |

> v1 中内联得 3.5（手工维护扣分）；v2 因设计师提供几何、且图标集稳定（14 个）+ 无依赖收益，内联升至 4.5，反超库。决策的绑定对象是**「统一封装 + 白名单」机制**，换图标来源只需改 `paths.js` / `AppIcon.vue` 一处。

## Consequences

**正面**
- 满足 P0：锁定一套线性 SVG，全项目统一、无 emoji、无图标集混用。
- **零新增依赖** → 无版本漂移、无供应链面、Wails 打包体积最小、永久离线。
- `currentColor` 随明暗主题与强调色自动联动，零适配。
- 封装隔离：图标来源（内联 / 换库 / 换集）被收敛在 `AppIcon.vue` + `paths.js` 两文件。
- 无障碍入口统一：`aria-label` 处理仅在 `AppIcon.vue` 一处。

**负面 / 硬约束**
- **许可合规（重要）**：Lucide 采用 **ISC 许可证**，允许复制/修改，但**须保留版权与许可声明**。内联其几何时，必须在 `src/components/icons/` 放置 `LICENSE`（或 `NOTICE`）注明「图标几何衍生自 Lucide（ISC）」，并在项目根 `README` 标注。**设计师文档未提及此点，必须补齐**（呼应 `generated-code-failure-modes.md §3` 的依赖存在性/合规核验）。
- `paths.js` 是唯一锁定点，**新增图标必须登记**，否则 `AppIcon.vue` 的 `v-if="markup"` 会**静默不渲染**（不报错）。须在 review 清单强制「新图标必登记」，并可选加一条单测断言清单与白名单一致。
- 几何数据体积随图标数增长；14 个量级无虞，超过数十个再评估。
- 需保证内层标记格式规范（元素齐全、属性完整），避免手抄残缺导致形状错乱——**这是 v2 单 path 模型翻车的同类风险**，须以验收条件 4（形状完整性）+ 目视核验兜底。

### 验收条件（硬性 —— 未满足则本方案不成立）

> 本方案的成立**预设**「14 个图标的 Lucide 几何会正确落地」。该前提目前**尚未交付**（`paths.js` 不存在）。以下四条为**验收条件**（非 advisory），任一条未满足则内联方案失效、须回退重评；由 team-lead 于 2026-09-29 裁定下发（第 4 条于 v2.1 追加）：

1. **几何来源必须可核验**：`paths.js` 的值必须取自官方 `lucide-static` 仓库的 `icons/*.svg`，**禁止凭记忆重构 path 数据**（防幻觉几何 / 走形）。落地时在 `paths.js` 头部注明来源仓库与 commit/tag。
2. **许可声明必须补齐**：`src/components/icons/LICENSE`（或 `NOTICE`）必须存在，载明「图标几何衍生自 Lucide（ISC）」的版权与许可文本，并在根 `README` 标注。
3. **双尺寸目视核验**：14 个图标必须在 **16px 与 20px** 两个尺寸逐一目视核验（端点圆角、描边粗细 1.75、视觉重心一致、无变形）。
4. **形状完整性核验（v2.1 新增，防单 path 残缺）**：14 个图标必须在两个尺寸下逐一确认**元素齐全**——多元素图标（`sun`=circle+8 line、`printer`=2 path+rect、`file-text`=5 path、`save`/`download` 含 polyline/line、`x`=2 path、`folder-open`、`panel-left-close/open` 等）不得缺元素、不得被截断或渲染为空白；`paths.js` 每个值必须与其 `lucide-static` 源 SVG 的内层标记逐元素一致。

**门禁命令**
```bash
# 禁止绕过封装内联裸 <svg>（icons 目录外不应出现 svg 绘制）
grep -rn '<svg' frontend/src --include=*.vue | grep -v 'components/icons/'
# 禁止 emoji 作功能图标（UI 层）
grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' frontend/src/App.vue frontend/src/components/*.vue
# 验收条件：许可声明存在
test -f frontend/src/components/icons/LICENSE && echo OK || echo MISSING
# 验收条件：几何来源标注（人审 paths.js 头部需含 lucide-static + commit/tag）
grep -n 'lucide-static' frontend/src/components/icons/paths.js
# 验收条件：多元素标记齐备（值中应出现 <circle/<line/<rect/<polyline 等，视图标而定）
grep -nE '<(circle|line|rect|polyline)' frontend/src/components/icons/paths.js
```

## Related ADRs
- ADR-002（Design Token 分层）：图标颜色只允许 `currentColor`，与语义 token（`--fg`/`--accent` 等）联动，受「组件层禁止裸 hex、唯一例外 #fff/#000」约束。
- restyle-plan.md §2（图标落地）、§6（文件清单）、§9（端到端验证第 5 步）。
