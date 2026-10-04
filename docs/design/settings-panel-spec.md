# Spec - Inkmark 设置面板与打印菜单 v1.0

> 生成日期：2026-10-04
> 状态：已确认（用户「开始执行」= 确认三文档）
> 路径：轻量级（纯前端 + Go 菜单接线，无 API/DB）
> 契约：本 Spec 是设计师与前端的唯一依据，越界需求走变更流程

---

## 1. 目标

1. 新增「设置…」面板：排版偏好（字体/字号/行距/行宽）+ 主题 + 编辑器行为
2. 修正 macOS 惯例冲突：`⌘P` = 打印…，`⇧⌘P` = 导出 PDF
3. 复用现有 CSS Token 体系，**不破坏「编辑区 ↔ 预览区基线对齐」不变量**

## 2. 现状事实（已由总监核实，成员可直接采信，不需重复调研）

| 事实 | 位置 |
|------|------|
| 编辑器字体全走 CSS 变量 | `frontend/src/editor/createEditor.js:256-267`（`--font-body` / `--text-base` / `--leading-body`） |
| 预览区同源 | `frontend/src/themes/preview.css:14-16`（`--text-md` / `--leading-reading`） |
| Token 唯一真源（单文件） | `frontend/src/themes/tokens/design-tokens.css` |
| 三主题 + 跟随系统，API 已就绪 | `frontend/src/themes/theme.js`（`getPreference` / `setPreference` / `resolveTheme`，支持 `system/light/dark/paper` **4 档**） |
| 主题偏好持久化 key | `inkmark-theme`（`theme.js:23`） |
| **paper 主题覆写排版变量** | `design-tokens.css:203-206`（`--leading-body:1.8` / `--leading-reading:1.85` / `--reading-measure:48rem`），靠属性选择器特异性取胜 |
| 可复用的弹层样式 | `App.vue` 的 `.dialog-mask` / `.dialog`（上一轮为输入对话框新建） |
| 可复用的弹层组件范式 | `frontend/src/components/HistoryPanel.vue`（fixed 定位 + Token 化样式） |
| 图标唯一入口（白名单） | `frontend/src/components/AppIcon.vue` + `paths.js`（Lucide 静态包，**37+ 几何白名单**，业务代码禁止内联裸 `<svg>`） |
| Go 菜单构建 | `main.go` 的 `buildMenu()`，事件名与前端 `safeEventsOn` 严格对应 |
| 打印样式已就绪 | `App.vue` 的 `@media print`（已隐藏 chrome、只输出预览区） |
| 自动保存间隔 | 800ms 固定，`composables/useDocumentPersistence.js:79` |
| 快照间隔 | 3 分钟固定，同文件 `:63` `SNAPSHOT_INTERVAL` |

## 3. P0 绝对规则（违反 = 退回重做）

1. **禁止 emoji 作功能图标** → 只能用 `AppIcon.vue` + `paths.js` 白名单内的 Lucide 几何
2. **禁止紫粉渐变**
3. **禁止 AI 模板味文案 / 硬编码颜色** → 颜色一律 `var(--token)`，尺寸用 rem
4. **禁止新增第二套 Token 文件** → 运行时偏好通过 `document.documentElement.style.setProperty` 写内联变量

## 4. 关键技术约束（血泪级，必须遵守）

### C1 用户偏好必须写在 `html` 内联 style 上
`paper` 主题用 `[data-theme="paper"]` 覆写了 `--font-body` / `--leading-body`，
属性选择器特异性高于 `:root`。若把用户偏好写进样式表，**会被 paper 主题静默压掉**。
✅ 唯一正确做法：`document.documentElement.style.setProperty('--font-body', v)`
（内联样式优先级高于任何选择器）

### C2 基线对齐不变量
`--text-base`（编辑区）与 `--text-md`（预览区）**必须始终相等**（当前均 0.9375rem）。
改字号时必须两者同改，否则左右两栏文字错位——这是项目多处注释反复强调的不变量。

### C3 缩放正交
编辑器字号 = `calc(var(--text-base) * var(--zoom-scale))`（`createEditor.js` zoomCompartment）。
用户改基础字号与视图缩放（80~150%）**必须正交叠加**，不能互相覆盖。

### C4 主题 API 已支持 4 档
菜单里只循环 3 档（light/dark/paper），设置面板要暴露完整的 **跟随系统/浅色/深色/纸感** 4 档，复用 `theme.js` 的 `setPreference()`，**不要另建主题状态**。

## 5. 范围锁定

### P0（本期做）
| 功能 | 验收摘要 |
|------|---------|
| 设置面板 | 三分类，项见 §6；改动实时生效、刷新后保持、可恢复默认 |
| 排版偏好 | 正文字体（3 选）+ 字号（12~20px）+ 行距（3 档）+ 行宽（3 档） |
| 主题选择 | 4 档（含跟随系统），复用 theme.js |
| 编辑器行为 | 自动保存间隔、快照间隔可配 |
| 打印菜单 | `文件 → 打印… ⌘P` 走 `window.print()`；导出 PDF 降为 `⇧⌘P` |

### 明确不做（Out-of-Scope，防范围蔓延）
| 不做 | 原因 |
|------|------|
| 拼写检查 | CM 的 lint 对 CJK 基本无效（按词典切词），中文场景是伪需求 |
| 新建窗口 | Wails v2 单窗口，不支持 |
| 快捷键自定义 | 需重建原生菜单 + 冲突检测，本期 ROI 低 |
| 设置项搜索 | 设置项总数 <15，搜索是过度设计 |
| 表格增删行列 | 与本次设置面板正交，另开一期 |

## 6. 页面/组件清单

| 组件 | 职责 |
|------|------|
| `frontend/src/themes/prefs.js`（新建） | 用户偏好唯一真源：读写 localStorage、写 html 内联变量、变更订阅、降级兜底 |
| `frontend/src/components/SettingsPanel.vue`（新建） | 纯展示 + 事件抛发，样式全走 Token |
| `frontend/src/App.vue`（改） | 接线 `menu:open-settings`、挂载时应用偏好 |
| `main.go`（改） | 「设置… ⌘,」入菜单；打印项与导出 PDF 换键位 |

## 7. 菜单变更（锁定）

```
文件
  新建文件 ⌘N
  ─────
  打开文件… ⌘O          打开文件夹… ⌘⇧O
  最近打开 ▸
  ─────
  保存 ⌘S              另存为… ⌘⇧S
  重命名…
  ─────
  历史快照…
  ─────
  打印… ⌘P        ← 新增，走 window.print()（@media print 已就绪）
  导出 HTML… ⌘⇧H
  导出 PDF… ⇧⌘P    ← 从 ⌘P 降级
  ─────
  设置… ⌘,          ← 新增（AppMenu Role 硬编码塞不进，参照「窗口置顶」的先例放文件菜单末尾）
```

> 注：Apple HIG 要求「设置…」在应用菜单。Wails 的 `menu.AppMenu()` 是硬编码 Role
> （已在上一轮实测确认），无法追加自定义项，故按项目先例放文件菜单末尾。**这是已知折中，
> 不接受"挪到应用菜单"的方案，因为那需要放弃 About/Quit 等系统项。**

## 8. 验收标准（EARS 格式，QA/总监用）

| 编号 | EARS 验收标准 |
|------|--------------|
| AC-01 | While 设置面板打开，When 用户改字号，Then 编辑区与预览区正文**必须**同步变化且左右仍对齐 |
| AC-02 | When 用户选择 `paper` 主题后修改正文字体，Then 修改**必须**仍然生效（不得被主题块压掉） |
| AC-03 | When 用户改基础字号后按 `⌘=` 缩放，Then 缩放**必须**在新的基础字号上叠加生效 |
| AC-04 | When 用户关闭并重新打开应用，Then 所有偏好**必须**恢复为上次设置 |
| AC-05 | When 用户点击「恢复默认」，Then 所有排版项**必须**回到出厂值并实时生效 |
| AC-06 | When 用户点「打印… ⌘P」，Then **必须**打开系统打印对话框且只输出正文（不打印工具条/侧栏/状态栏） |
| AC-07 | While 设置面板打开，When 用户按 Esc，Then 面板**必须**关闭且焦点回到编辑器 |
| AC-08 | When 用户选「跟随系统」主题且系统切换深浅，Then 界面**必须**自动跟随（复用 theme.js 既有能力） |
| AC-09 | 所有设置面板图标 **必须**来自 `paths.js` 白名单（emoji 零容忍） |
| AC-10 | When 快照间隔设为「关」，Then **必须**不再自动生成快照（手动「立即快照」仍可用） |

## 9. 已知坑（血泪教训，务必规避）

| 坑 | 根因 | 规避 |
|----|------|------|
| paper 主题静默吞掉用户排版设置 | `[data-theme=paper]` 属性选择器特异性 > `:root` | 设置一律写 `documentElement.style.setProperty`（C1） |
| 改字号后左右两栏错位 | `--text-base` 与 `--text-md` 是两个独立变量 | 必须成对同改（C2） |
| 用户字号被视图缩放覆盖 | 二者都作用在同一处 CSS | 缩放走独立 `--zoom-scale`，别去乘进 base（C3） |
| 图标空白 | 用了 `paths.js` 未登记的几何名 | 先查白名单再用；DEV 下有 console 告警兜底 |
| Vue scoped 样式拍平 | `:global(body.x) .y` 会被拍平成 `body.x` | 全局样式写独立非 scoped `<style>` 块 |

## 10. 交付物

| 角色 | 产物 |
|------|------|
| 设计师 | `docs/design/settings-panel-spec.md`（面板布局 + 逐项控件↔Token 映射表 + 恢复默认策略） |
| 前端 | 代码实现 + `vite build` 通过的机械证据 |
| 总监 | `go vet` + `wails build` 通过 + 启动截图自检 |

---

# 裁决记录（项目总监 · 2026-10-04）

> ⚠️ **阅读须知**：本章之后是设计师颜好看提交的《设计细化 D1~D11》，它是一份**备选方案存档（未采纳）**，
> 不是已交付实现的基线。已实现的基线以本文件 §1–§10 + 本章裁决为准。
> 保留其全文是为了记录设计推演过程与可复用的细节（如 D1.2 三段式骨架、D5 主题与偏好的关系论证）。

## R1. 范围调整（已生效）

| 项 | 原 Spec | 裁决后 | 原因 |
|----|---------|--------|------|
| 分类数 | 三分类（外观 / 编辑器 / Markdown） | **两分类（外观 / 编辑器）** | Markdown 分类里的「图片目录策略」需改 Go 侧 `SaveImage`，属独立交付 |
| 设置项数 | 未明示 | **7 项**（外观 5 + 编辑器 2） | HIG：「Minimize the number of settings you offer」 |

## R2. 语义裁决：「标准档 = 跟随主题」（已生效）

`fontFamily='system'`、`lineHeight='standard'`、`measure='standard'` 一律走
`documentElement.style.removeProperty()`，**交还主题决定**；只有显式选择非标准档才内联覆盖。

依据：`[data-theme="paper"]` 刻意调校了 `--leading-body:1.8` / `--leading-reading:1.85` /
`--reading-measure:48rem`（token 文件注释：「纸感专属：留白/行距差异化（衬线需更大行距）」）。
若「标准」档也内联写入通用值，paper 的主题身份会被永久压掉。

## R3. 设计师 D1~D11 裁决

| 冲突点 | 设计稿方案 | 裁决 |
|--------|-----------|------|
| prefs 字段数 | 8 个（+`zoomEnabled` +`restoreZoom`） | **驳回**：属新增范围（缩放偏好），不在本期 Spec |
| fontFamily 取值 | `sans` 默认 + 显式内联完整无衬线栈 | **驳回**：内联栈会压掉 paper 的衬线正文字体，与 R2 自相矛盾。且需改为「文档作用域」（见 R4） |
| fontSize 键名/形态 | `fontSizePx` + slider 12–20 步进 1 | **驳回**：6 个离散档位用 segmented 更易发现、更契合项目扁平语言，且 slider 需额外无障碍成本 |
| lineHeight 取值 | 数值 1.5/1.7/1.9 | **驳回**：保持枚举字符串（可读、可校验、便于降级兜底） |
| measure 取值 | 字符串 `"40rem"/"46rem"/"54rem"` | **驳回**：同上，保持 `narrow/standard/wide` 枚举 |
| autosave 档位 | 0/500/800/1500/3000 | **驳回**：沿用 0/800/2000/5000（更少的档位 = 更少的决策负担） |
| snapshot 档位 | 0/1/3/5/10 分 | **驳回**：沿用 0/3/10/30 分 |
| 控件：字号 | slider | **驳回**：见上，用 segmented |
| API 名 | `resetAll()` | **驳回**：已实现的 `resetPrefs()` 更准确（只重置偏好，不重置文档） |
| 面板骨架 | 52px 标题栏 + 右上 ⓧ + 分类 icon + 主题 4 段内 icon | **部分驳回**：维持「零 icon、纯文字分段、底部按钮」；标题栏可留可不留，本项目采用极简（省垂直预算） |
| 尺寸 | nav 148px / min(78vh, 620px) | **驳回**：沿用 120px / ≤72vh（更克制的占屏） |
| 恢复默认确认 | 内联确认条 + danger 字色 | **驳回**：沿用「按钮就地二次点击」；不引入 danger 语义色（该项目 danger 保留给错误状态） |
| **D8 打印隐藏面板** | `@media print` 隐藏面板与遮罩 | ✅ **采纳**（AC-06 缺口，已修 commit `8cef7b7`） |
| **正文偏好不污染界面 chrome** | 面板 chrome 恒用 `--font-ui`，偏好只作用于文档正文 | ✅ **采纳**（见 R4） |

## R4. 采纳项：正文字体偏好只作用于文档正文（防污染 chrome）

**问题**：`base.css` 的 `body { font-family: var(--font-body) }` 让整个应用外壳（工具条/侧栏/状态栏/弹层）
都继承 `--font-body`。用户若在设置里选「等宽」，菜单条与状态栏也会变成等宽 —— 这不是「正文字体」该有的作用域。
（参照 Obsidian / Typora：界面字体与正文字体是两个独立设置。）

**方案**（文档作用域覆盖，不新增 Token、不改主题行为）：
1. `prefs.js` 写 **`--font-body-user`**（不再写 `--font-body`）；`system` 档 → `removeProperty('--font-body-user')`
2. 两处文档正文消费点改为带回退的读取：
   - `editor/createEditor.js` 的 CM theme `fontFamily: 'var(--font-body-user, var(--font-body))'`
   - `themes/preview.css` 的 `.preview-body { font-family: var(...) }`
3. `base.css` **不动** —— 于是 paper 主题下界面外壳仍是衬线（保留既有外观），
   而用户偏好只改变编辑器与预览区的正文

**收益**：默认行为零变化（`system` 档等价于今天）；显式选衬线/等宽时不再影响 chrome。

---



> 依据：`docs/design/settings-panel-spec.md` §1–§10（唯一契约）
> Token 唯一真源：`frontend/src/themes/tokens/design-tokens.css`（**不发明新变量名**）
> 图标唯一入口：`components/icons/AppIcon.vue` + `icons/paths.js`（**零 emoji，禁内联裸 `<svg>`**）
> 本章只出设计规格，不含实现代码；数值单位除「字号档位」外一律 rem / 无单位。
> 面板 chrome 字体恒为 `--font-ui`（不受用户「正文字体」偏好影响 —— 偏好只作用于文档正文）。

---

## D1. 面板布局

### D1.1 定位与容器

| 项 | 规格 | Token |
|------|------|-------|
| 遮罩 | `position: fixed; inset: 0`，底色 `color-mix(in srgb, var(--fg) 18%, transparent)`，居中 flex | **直接复用 `App.vue` 的 `.dialog-mask`**（不新建第二套遮罩） |
| 容器宽度 | `min(560px, 92vw)` | — |
| 容器底色 | `var(--surface)` | `--surface` |
| 边框 / 圆角 / 阴影 | `1px solid var(--border)` / `var(--radius-lg)`（12px，上限值）/ `var(--elev-raised)` | 与 `.dialog` 完全一致 |
| 容器 padding | `0`（**覆写 `.dialog` 的 `padding: var(--space-6)`**）—— 面板自带头/体/尾三段式内边距，不叠加 | — |
| 最大高度 | `min(78vh, 620px)`；`display: flex; flex-direction: column` | — |
| z-index | `1400`（遮罩与容器同层，与 `.dialog-mask` 齐平 —— 面板内**无**更高层浮层，见 D1.4） | 阶梯 base 0 / dropdown 1000 / sticky 1100 / modal 1200 / toast 1300 / dialog 1400 |
| 进场动效 | `opacity 0→1` + `translateY(4px)→0`，`var(--motion-base)`（180ms）/ `var(--ease-standard)`；**禁止 scale 回弹** | reduced-motion 下 Token 已归 1ms，自动退化为瞬时 |

> 遮罩点击（`@click.self`）与 Esc 均关闭面板；关闭后焦点回编辑器（AC-07）。
> 打印时面板与遮罩一并隐藏（`@media print` 需追加 `.settings-panel, .dialog-mask { display: none !important; }`，
> 与既有 `.history-panel` 同一处理，见 `App.vue:1323-1332`）。

### D1.2 三段式骨架

```
┌──────────────────────────────────────────────────────────┐
│ 标题栏  h=52px   「设置」 16px/510  ················· ⓧ │  ← flex-shrink:0
├────────────┬─────────────────────────────────────────────┤
│ 分类栏      │ 内容区                                        │
│ w=148px    │ flex:1 · overflow-y:auto                    │
│ 竖排 3 项  │ 每项 = 一行「标签+说明 / 控件」                │
│            │ 行高 44px（控件）/ 56px（多行说明项）          │
├────────────┴─────────────────────────────────────────────┤
│ 页脚 h=52px   恢复默认（次要·左）        存储不可用提示（右）│  ← flex-shrink:0
└──────────────────────────────────────────────────────────┘
```

- **标题栏**：`padding: 0 var(--space-5)`；`border-bottom: 1px solid var(--border-soft)`；
  标题 `var(--text-md)` / `var(--weight-emphasize)` / `var(--fg)`；**不放副标题**（省一行的垂直预算给内容）。
- **关闭按钮**：沿用 `HistoryPanel` 的 `.history-close` 规格 —— 24×24、`--radius-sm`、透明底、
  `color: var(--muted)`、hover `background: var(--surface-2); color: var(--fg)`、
  `:focus-visible { outline: none; box-shadow: var(--focus-ring) }`；图标 `<AppIcon name="close" size="inline" />`（16px，几何 `x`）。
- **页脚**：`border-top: 1px solid var(--border-soft)`；`padding: 0 var(--space-5)`；
  「存储不可用」提示**默认不占位**（`v-if`，出现时才会把页脚内容挤一下，属可接受的偶发状态）。

### D1.3 内容区滚动策略

- `overflow-y: auto`；`padding: var(--space-2) var(--space-5) var(--space-4)`。
- 滚动条走全局既有约定（`--scrollbar-thumb` / `--scrollbar-thumb-hover`，见 base.css）。
- **分类切换不重置滚动位置**：每个分类各自独立容器（`v-show` 而非 `v-if`），切回来时滚动位置仍在原处 —— 这是「频繁对照改设置 ↔ 看文档效果」的关键动作。
- 分组标题（分类名只在左栏出现一次，右栏**不重复**大标题，避免与左栏形成双标题）。

### D1.4 层叠约束

面板内**不允许**出现 select 的原生下拉浮层之外的自定义浮层：字号/行距/行宽全部用 segmented 与 slider 表达（无 select 弹层），
因此 z-index 1400 足够，**不新增 1500 层**。`prefs.js` 的存储异常提示走页脚内联，不弹 toast。

---

## D2. 分类导航形态决策

### 结论：**左侧分类栏（sidebar）+ 右侧内容区**，非顶部 tab。

| 判据 | 左侧分类栏 | 顶部 tab |
|------|-----------|---------|
| 3 个分类、每类 2~5 项（合计 9 项） | [是] 9 项在 560px 宽度下单屏可全览，切换不丢上下文 | [注意] 3 段 tab 挤 560px，每段仅 ~180px，放不下「正文字体」这类长标签 |
| 标签长度 | [是] 左栏 148px 足够放「编辑器行为」不换行 | [否] 需强制两行或缩写 |
| Apple HIG 对齐 | [是] HIG §Navigation：≥3 组 / 每组≥3 项 用 **sidebar (pane)** | — |
| 单窗口应用适配 | [是] Wails 单窗口，sidebar 与既有 `--sidebar-width: 232px`（大纲）视觉语言一致，不冲突 | — |
| 新增分类的成本 | [是] 加一行即可，不动右栏布局 | [注意] 需重算 tab 宽度 |
| 认知负荷（≤4 顶级项） | [是] 3 项，远低于上限 | [是] |

**权衡说明**：HIG 另有「toolbar segmented」建议用于 2~3 组短标签。本项目 3 组标签字数不均（外观 / 编辑器行为），
且每组控件形态异构（segmented / slider / select 混排），tab 会让 tab 条本身抢走一行垂直预算却换不来横向空间 —— **sidebar 胜出**。

### 分类栏规格

| 项 | 规格 |
|------|------|
| 宽度 | 148px；`border-right: 1px solid var(--border-soft)`；底色 `--surface`（与内容区同色，靠右细分隔，不做色块） |
| 内边距 | `padding: var(--space-4) var(--space-3)` |
| 分类项 | 高 32px；`--text-sm`；`--radius-sm`；`padding: 0 var(--space-3)`；左对齐 |
| 默认态 | `color: var(--muted)`；hover `background: var(--surface-2); color: var(--fg)` |
| **选中态** | `background: var(--surface-2)` + `color: var(--fg)` + `font-weight: var(--weight-emphasize)` + `box-shadow: inset 0 0 0 1px var(--border)`（**常驻内描边**，与 `phaseC` 工具条选中态同一表达：色觉障碍下不靠颜色单独传达） |
| 选中指示 | 左侧 2px `--accent` 竖条（`::before`，`border-radius: 1px`）—— 全屏 accent 计数 1/2（见 D7.3） |
| 语义 | `nav > ul > li > button`；`aria-current="page"` 表示当前分类；`.sidebar-nav` 复用 `aria-label="设置分类"` |
| 键盘 | ↑/↓ 在分类间移动并**即时切换**（roving tabindex，tabindex=0 落在选中项）；Home/End 跳首尾 |

### 分类图标映射（全部在 paths.js 白名单内）

| 分类 | 语义名 | 几何 | 尺寸 |
|------|--------|------|------|
| 外观 | `theme-toggle` | `sun-moon` | 16px inline |
| 编辑器行为 | `file-text` | `file-text` | 16px inline |

> 无需新增几何（AC-09）。`newspaper`/`monitor`/`sun`/`moon` 已在 `paths.js` 中作为 `theme-paper/theme-system/theme-light/theme-dark` 登记，
> 本面板的**主题 segmented 选中项**正好复用这 4 个语义名作为可见图标（见 D3.1）。

---

## D3. 逐项控件规格表（核心交付）

> **写入方式铁律（C1）**：下表所有「写入位置 = html 内联」的行，统一由 `prefs.js` 调
> `document.documentElement.style.setProperty(name, value)`；
> 「—」表示该项不写 CSS 变量（纯 JS 行为项或走 theme.js）。
> **禁止**把用户值写进任何样式表 —— `[data-theme='paper']` 特异性 (0,2,0) > `:root` (0,1,0) 会静默压掉（§9 坑 1）。

### D3.1 分类一：外观（5 项）

| # | 显示名 | 一句话说明 | 控件 | CSS 变量映射 | 可选值 | 默认 | C1 受影响 | 写入位置 |
|---|--------|-----------|------|--------------|--------|------|-----------|---------|
| 1 | **主题** | 跟随系统会随 macOS 深浅自动切换 | **segmented（4 段，段内带图标）** | 无（走 `theme.js` 的 `data-theme` 属性） | 跟随系统 `system` / 浅色 `light` / 深色 `dark` / 纸感 `paper` | `system` | [否] 否 | localStorage `inkmark-theme`（**复用 theme.js，不另建状态**，C4） |
| 2 | **正文字体** | 换字体不会影响界面与工具条的字体 | **segmented（3 段）** | `--font-body` | `sans`（无衬线栈）/ `serif`（衬线栈）/ `mono`（等宽栈） | `sans` | [是] 是 | **html 内联**（paper 会覆写 `--font-body`，AC-02） |
| 3 | **正文字号** | 12–20px，缩放是另一个独立动作 | **slider + 数值回显** | `--text-base` **与** `--text-md` **成对同改** | 12–20px，步进 1px | 15px（`0.9375rem`） | [是] 是 | **html 内联**（C2 成对） |
| 4 | **行距** | 数值越大行与行之间越松 | **segmented（3 段）** | `--leading-body` **与** `--leading-reading` **成对同改** | 紧凑 `1.5` / 适中 `1.7` / 宽松 `1.9` | `1.7` | [是] 是 | **html 内联**（paper 覆写 1.8/1.85） |
| 5 | **行宽** | 只影响预览区与阅读模式，编辑区不收窄 | **segmented（3 段）** | `--preview-measure`（预览）**与** `--reading-measure`（阅读态）**成对同改** | 窄 `40rem` / 适中 `46rem` / 宽 `54rem` | `46rem` | [是] 是 | **html 内联**（paper 覆写 `--reading-measure: 48rem`） |

> **项 1 的 4 个段内图标**（paths.js 已登记，零新增）：
> 跟随系统 `theme-system`(monitor) / 浅色 `theme-light`(sun) / 深色 `theme-dark`(moon) / 纸感 `theme-paper`(newspaper)，
> 尺寸统一 16px inline，`aria-hidden`（段位文字本身已是标签）。

### D3.2 分类二：编辑器行为（4 项）

| # | 显示名 | 一句话说明 | 控件 | CSS 变量映射 | 可选值 | 默认 | C1 受影响 | 写入位置 |
|---|--------|-----------|------|--------------|--------|------|-----------|---------|
| 6 | **自动保存** | 停止输入后多久写一次磁盘 | **segmented（4 段）** | 无 | 关闭 / `500ms` / `800ms` / `1500ms` / `3000ms` | `800ms`（现状不变） | [否] 否 | localStorage `inkmark-prefs` |
| 7 | **历史快照间隔** | 关掉后仍可用侧栏的「立即快照」 | **segmented（4 段）** | 无 | 关闭 / `1min` / `3min` / `5min` / `10min` | `3min`（现状不变） | [否] 否 | localStorage `inkmark-prefs` |
| 8 | **缩放** | 视图缩放与正文字号相互独立 | **switch** | 无（只改 `zoom` ref） | 开 / 关（关 = 锁定 100%） | 开（= 不干预） | [否] 否 | localStorage `inkmark-prefs` |
| 9 | **启动时恢复上次缩放** | 关掉则每次启动回到 100% | **switch** | 无 | 开 / 关 | 关 | [否] 否 | localStorage `inkmark-prefs` |

> **范围说明（§5 Out-of-Scope 已移出）**：Markdown 分类与「图片目录策略」本期**不做**
> （需改 Go 侧 `SaveImage`，属独立交付）。故分类只有 2 个、合计 9 项 —— 与 §5「设置项总数 <15，故不做搜索」自洽。
>
> **项 8/9 为何拆成两个 switch 而非一个**：AC-03 要求「基础字号与视图缩放正交叠加」。
> 「缩放 = 开」是**当前会话**是否允许 ⌘+/⌘− 改变缩放；「启动恢复」是**跨会话**是否持久化。
> 两者语义正交，合并会让用户无法表达「我想手动调但不想被记住」。若前端认为超范围，**优先砍项 9，保留项 8**。
>
> **项 6「关闭」的语义**：`useDocumentPersistence.js:79` 的 `setTimeout(autoSave, 800)` 改为不挂定时器；
> `⌘S` 手动保存（`saveFile`）路径不受影响 —— 与项 7「关闭」同构（AC-10）。

### D3.3 键名与存储约定（供 `prefs.js` 直接落地）

localStorage 单 key `inkmark-prefs`（JSON），**与 `inkmark-theme` 分开**：主题归 theme.js 管，
`prefs.js` 不碰 theme.js 的 key（避免双真源）。

```jsonc
{
  "fontFamily": "sans",        // sans | serif | mono
  "fontSizePx": 15,            // 12–20 整数
  "lineHeight": 1.7,           // 1.5 | 1.7 | 1.9
  "measure": "46rem",          // 40rem | 46rem | 54rem
  "autosaveMs": 800,           // 0 = 关闭；500 | 800 | 1500 | 3000
  "snapshotMin": 3,            // 0 = 关闭；1 | 3 | 5 | 10
  "zoomEnabled": true,         // boolean
  "restoreZoom": false         // boolean
}
```

**字体栈的单一真源在 `prefs.js`**，不在 token 文件（新增 token 变量会与 `[data-theme='paper']` 打架）：

| 键 | `--font-body` 写入值 | 来源 |
|------|--------------------|------|
| `sans` | `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif` | 逐字复制 `design-tokens.css:42` |
| `serif` | `Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", SimSun, serif` | 逐字复制 `design-tokens.css:161` |
| `mono` | `"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, "Courier New", monospace` | 逐字复制 `design-tokens.css:43` |

> 选 `serif` / `mono` 时，**chrome 仍是 `--font-ui`** —— 面板与工具条不跟着变 serif，这是写作工具的正确行为。

---

## D4. 字号联动规则（C2 落地）

**铁律：`--text-base` 与 `--text-md` 永远成对写入、永远相等。** 编辑区读 `--text-base`
（`createEditor.js:286`），预览区读 `--text-md`（`preview.css:15`），两者不等即左右两栏基线错位。

换算表（root = 16px；`rem = px / 16`，**只允许 1/16 的整数倍小数为有效值**）：

| 档位 | px | 写入值（`--text-base` = `--text-md`） | 与 token 阶梯的关系 |
|------|----|--------------------------------|-------------------|
| 最小 | 12 | `0.75rem` | = `--text-xs` |
| | 13 | `0.8125rem` | = `--text-sm` |
| | 14 | `0.875rem` | （阶梯外） |
| **默认** | **15** | **`0.9375rem`** | = 现状值（`design-tokens.css:214-215`） |
| | 16 | `1rem` | （阶梯外，= root） |
| | 17 | `1.0625rem` | （阶梯外） |
| | 18 | `1.125rem` | = `--text-lg` |
| | 19 | `1.1875rem` | （阶梯外） |
| 最大 | 20 | `1.25rem` | = `--text-xl` |

实现要求：
1. 单一写入函数 `applyFontSize(px)`，内部**连续两次** `setProperty`；**禁止**任何只写一个的分支。
2. 值以 **px 整数**存 localStorage（用户认知单位），**以 rem 字符串**写内联（缩放正交，见 C3）。
3. **不得**把 zoom 乘进 base（`zoom` 只走 `--zoom-scale`，`App.vue:886` + `createEditor.js:153` 的
   `calc(var(--text-base) * scale)` 已经正交）。AC-03 的实现方式就在这两行既有代码里，**本期不改**。
4. 预览标题阶梯（`--preview-h1-size` … `--preview-h6-size`）**不随正文联动** —— 保持「标题靠固定阶梯分层」的设计约定；
   仅 `--preview-h6-size`（0.9375rem）与正文 15px 同值，18px 档位下 h6 会比正文小 3px，属可接受的既有偏差，**本期不改、不新增 token**。
5. 阅读模式的 `--reading-font-size`（17px）**不随正文联动**（它是「阅读态放大」的独立设计决策，见 `App.vue:1310`）。

---

## D5. 行距 / 行宽档位与 paper 主题的关系

### D5.1 行距（3 档）

| 档位标签 | 写入值 | 视觉基线（15px 正文下） |
|---------|--------|---------------------|
| 紧凑 | `1.5` | 22.5px/行 |
| **适中**（默认） | `1.7` | 25.5px/行 —— 与现状一致（`design-tokens.css:227-228`） |
| 宽松 | `1.9` | 28.5px/行 |

**与 paper 覆写值的关系（必须让用户看懂，而不是被静默吞掉）**：

| 主题 | 样式表默认 | 用户未动过时生效值 | 用户选「紧凑/宽松」后 |
|------|-----------|------------------|--------------------|
| light / dark | 1.7 / 1.7 | 1.7 / 1.7 | 内联 1.5 或 1.9 覆盖两栏 |
| paper | **1.8 / 1.85** | 1.8 / 1.85（衬线需更大行距） | 内联 1.5 / 1.9 覆盖两栏（衬线 1.5 偏紧但可用，属用户明示选择） |

- 成对写入：`--leading-body`（编辑区）**与** `--leading-reading`（预览区）**必须同改**，
  与字号同一条铁律（否则左右两栏行高不同 → 行与行错位）。
- **paper 下 1.8 落在「适中 1.7」与「宽松 1.9」之间** —— 面板**不做四档**（三档是 Spec 锁定的范围），
  也不做「就近吸附」。未改动时 segmented 选中「适中」，页脚**不**提示差异（因为用户没做任何选择）；
  一旦用户动它，内联值立即生效，与样式表默认脱钩。
- `--leading-ui`（1.4）**不联动** —— 它服务于界面文本，面板与工具条行距恒定。

### D5.2 行宽（3 档）

| 档位标签 | `--preview-measure` | `--reading-measure` | 15px CJK 每行约 |
|---------|-------------------|--------------------|---------------|
| 窄 | `40rem`（640px） | `44rem` | ≈26 字 |
| **适中**（默认） | `46rem`（736px） | `50rem` | ≈30 字（= 现状值） |
| 宽 | `54rem`（864px） | `58rem` | ≈35 字 |

- 成对写入规则同上：`--preview-measure`（`preview.css:11` 消费）与 `--reading-measure`（`App.vue:1309` 消费）**同改**。
- **与 paper 覆写值的关系**：paper 把 `--reading-measure` 单独覆写成 `48rem`（`design-tokens.css:206`），
  而 `--preview-measure` 不受 paper 影响。默认值下两主题的实际阅读行宽分别是
  light/dark `50rem`、paper `48rem` —— **这是既有设计（纸面偏窄减疲劳），本期保留**。
  用户一旦选任一档位，内联值同时压过两个值，档位在所有主题下一致生效。
- **编辑区不受行宽影响**（编辑区无 `max-width`，整栏铺满），因此本项的说明文案必须写明「只影响预览与阅读」，
  否则用户会以为编辑器也被收窄了。
- 「宽 54rem」超过 token 注释里 `50rem ≈ 可读上限` 的判断，故选它时**不加任何视觉提示**（避免过度设计），
  但由项名「宽」自带语义。

---

## D6. 恢复默认策略

### D6.1 按钮位置与视觉

- 位置：**页脚左侧**（`.settings-foot` 内），次要按钮 —— 复用 `App.vue` 的 `.dialog-btn` 规格
  （`min-height: 32px` / `padding: 0 var(--space-4)` / `1px solid var(--border)` / `--radius-md` /
  `background: var(--surface-2)` / `color: var(--fg)` / `--text-sm` / `:focus-visible` 用 `--focus-ring`）。
- 文案：**「恢复默认」**（4 字，不加「设置」二字 —— 按钮已在页脚，语境明确）。
- **不做主按钮、不放顶部** —— 破坏性动作不放视觉主位。
- **不做一键静默重置**（AC-05 明确要求走完流程可见）。

### D6.2 二次确认（**必须**）

用**面板内联确认条**（不是嵌套弹窗 —— 避免 z-index 1500 层与焦点陷阱二次嵌套）：

- 触发后，页脚左侧原按钮位置**就地替换**为：`恢复默认排版与编辑器设置？`（`--text-sm` / `color: var(--fg-2)`）
  + 「取消」+「恢复」两个按钮（取消 = `.dialog-btn`；恢复 = `.dialog-btn` 加 `color: var(--danger)`）。
  **注意「恢复」用 `--danger` 字色而非 `--accent` 底** —— 破坏性动作不该穿主色，也就不占 accent 名额（D7.3）。
- 出现动效：`--motion-fast`（120ms）淡入，不做位移。
- 焦点：确认条出现后，焦点移到「取消」（安全默认，`autofocus` 由 Vue 的 ref 实现）。
- Esc 行为**分级**：确认条可见 → 第一次 Esc 只取消确认条，面板不关；确认条不可见 → Esc 关面板（AC-07）。
- 焦点环：确认条内按钮同样 `:focus-visible { box-shadow: var(--focus-ring) }`。

### D6.3 执行序列（`prefs.resetAll()` 的 5 步，顺序不可换）

1. `localStorage.removeItem('inkmark-prefs')` —— 清**单 key**，不做逐字段删。
2. **不碰** `inkmark-theme` —— 主题归 theme.js（C4），「恢复默认」**不重置主题**（避免用户丢主题选择且越界改 theme.js 状态）。
3. 逐个 `document.documentElement.style.removeProperty(name)`，name 遍历：
   `--font-body` / `--text-base` / `--text-md` / `--leading-body` / `--leading-reading` /
   `--preview-measure` / `--reading-measure` —— **共 7 个，缺一即残留（会读 D9 的反例）**。
4. 重新读一次 `getComputedStyle(document.documentElement).getPropertyValue('--text-base')`
   作为面板回显值（**验证回退成功**，而不是假设成功）。
5. 快照间隔回落 3min 后，**主动调一次 `writeSnapshot(true)`**？—— **不调**。恢复默认只改配置，
   下一个保存周期自然生效；手动「立即快照」是用户显式动作（AC-10）。

> **removeProperty 为何是「回退」的正确姿势**：内联样式移除后，`[data-theme='paper']`（0,2,0）
> 与 `:root`（0,1,0）按各自声明重新生效 → paper 用户自动回到 1.8/1.85/48rem，light/dark 用户回到 1.7/1.7/50rem。
> 这正是「恢复默认」该有的主题感知行为，而 `setProperty(token默认值)` 会把 paper 锁死在 1.7（错）。

---

## D7. 控件视觉规范

### D7.1 行（Row）骨架

```
[ 标签 --text-sm --fg ]                    [ 控件 ]
[ 说明 --text-xs --muted（仅需要时）]
```

| 项 | 规格 |
|------|------|
| 行容器 | `display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); min-height: 44px; padding: var(--space-2) 0;` |
| 行分隔 | **不用卡片**；相邻行之间 `border-top: 1px solid var(--border-soft)`（最后一行无）—— 用 1px 线分组，不用盒子 |
| 标签 | `var(--text-sm)` / `var(--fg)` / `font-weight: var(--weight-emphasize)`（510） |
| 说明 | `var(--text-xs)` / `var(--muted)` / `line-height: var(--leading-ui)`；仅在标签不足以说清时出现（如行宽、快照关） |
| 控件区 | `flex-shrink: 0`；`display: flex; align-items: center; gap: var(--space-2)` |
| 触摸目标 | 控件本体 min-height ≥ 28px（桌面指针应用，沿用 `phaseC §2.4` 对 44px 的**有据偏离**：44 是移动触控下限，桌面鼠标无此约束）；`@media (pointer: coarse)` 或宽度 < 1024px 时升到 40×40（复用 `Toolbar.vue:274-277` 既有规则） |

### D7.2 segmented

| 状态 | 背景 | 文字 | 边框 / 附加 |
|------|------|------|------------|
| 轨道（容器） | `var(--surface-2)` | — | `1px solid var(--border)` / `--radius-md`(8px) / `padding: 2px` / `display: inline-flex` |
| 段（未选中） | `transparent` | `var(--muted)` | 无边 |
| 段 hover | `var(--bg)` | `var(--fg)` | 无边（**不用 accent 底**） |
| **段（选中）** | `var(--bg)` | `var(--fg)` + `font-weight: var(--weight-emphasize)` | `box-shadow: inset 0 0 0 1px var(--border-strong)` + `border-radius: var(--radius-sm)` |
| 段 `:focus-visible` | — | — | `outline: none; box-shadow: var(--focus-ring)`（**焦点环优先于选中内描边**，用 `var(--focus-ring)` 覆盖） |
| 段 disabled | `transparent` | `var(--meta)` | `opacity: .5` + `cursor: not-allowed`（本期无 disabled 项） |

- 段内边距：`0 var(--space-3)`；`font-size: var(--text-sm)`；`font-family: var(--font-ui)`。
- 主题项的 4 段额外带 16px 图标（`gap: var(--space-1)`），其余项无图标 —— 图标只在**能显著提升辨识度**时出现。
- **选中态不靠颜色单独传达**：内描边（形状）+ 字重（重量）双通道，色觉障碍下可辨（沿用 `phaseC §2.4` 同一判断）。
- 动效：`background-color` / `color` / `box-shadow` 走 `var(--motion-fast)`(120ms) / `var(--ease-standard)`。
- **禁止**：渐变底、发光边框、彩色左边框（绝对禁令 1 / 2 / 5）。

### D7.3 slider（仅「正文字号」一项使用）

| 元素 | 规格 |
|------|------|
| 元素 | 原生 `<input type="range">`（**不手搓 div 滑块** —— 免费获得键盘 / 触摸 / AT 全套行为） |
| 宽度 | 200px（`flex-shrink: 0`） |
| 轨道 | `height: 4px` / `background: var(--surface-2)` / `border-radius: var(--radius-pill)` |
| 已填充段 | `accent-color: var(--accent)`（原生属性，**不手绘填充层**） |
| 滑块 thumb | `width: 14px; height: 14px` / `background: var(--bg)` / `border: 1px solid var(--border-strong)` / `box-shadow: var(--elev-raised)` |
| 数值回显 | thumb 右侧 `min-width: 44px` / `text-align: right` / `font-family: var(--font-mono)` / `font-size: var(--text-xs)` / `font-variant-numeric: tabular-nums` / `color: var(--fg-2)`；显示 `15px` |
| 步进 | `min=12 max=20 step=1` |
| 标签关联 | `<label for>` 指向滑块；回显值放 `aria-valuetext="15 像素"`（屏读器读中文，不读裸数字） |

### D7.4 switch

- 视觉：`28×16` 轨道 + `12px` 圆钮 + `1px solid var(--border)`；开态轨道 `--accent` 底 / 关态 `--surface-2` 底。
- 钮位移 `var(--motion-fast)`(120ms) / `var(--ease-standard)`；**无回弹**。
- 语义：`<button role="switch" :aria-checked="...">`，**不是** checkbox 伪装。
- 文字状态**不额外显示「开/关」** —— 位置即状态（switch 的通用认知），右侧若要补只写 `--text-xs` / `--meta`。

### D7.5 accent 名额核算（每屏 accent ≤ 2 处）

| 位置 | 是否用 accent | 说明 |
|------|------------|------|
| 分类栏选中指示条 | [是] 1 | 2px 竖条 |
| slider `accent-color` | [是] 2 | 字号滑轨 |
| segmented 选中 | [否] | 用 `--bg` + 内描边 |
| 恢复/危险 | [否] | 用 `--danger` 字色 |
| 其余全部 | [否] | 中性色 |

**满额但零溢出** —— 面板内不再有任何第三处 `--accent`（含 hover 态与 focus 态；focus 环是 `color-mix(accent 32%)` 半透明，**不计入**可见 accent 计数，与 `design-tokens.css:21` 的口径一致）。

---

## D8. 无障碍要求

| 项 | 要求 |
|------|------|
| 语义 | 容器 `role="dialog" aria-modal="true" aria-labelledby="settings-title"`（`aria-label` 亦可，**二选一，不同时给**） |
| 初始焦点 | 打开时焦点落在**分类栏选中项**（让「Tab 到控件」只需按一次方向键），**不是**关闭按钮、更不是正文第一行 |
| 焦点陷阱 | Tab / Shift+Tab 在面板内循环；焦点环用 `var(--focus-ring)`，**禁止** `outline: none` 不给替代 |
| 焦点归还 | 关闭后焦点回编辑器（AC-07）—— 记录 `document.activeElement` 再还原 |
| Tab 序（严格） | ① 分类栏（roving tabindex，整体**占 1 个 Tab 位**）→ ② 内容区第 1 项控件 → ③ 依次向右 → ④ 页脚按钮。**Tab 不逐项穿过分类栏**（用 ↑↓ 走分类，这是 roving tabindex 的标准行为） |
| segmented 键盘 | `role="radiogroup"` + `aria-label`；每段 `role="radio" aria-checked`；**←/→（及 ↑↓）移动并即时选中**；Home/End 跳首尾；roving tabindex（选中项 tabindex=0，其余 -1） |
| slider 键盘 | 原生 `←/→` 步进 1px、`Home/End` 到 12/20；`aria-valuemin/max/now` 由原生提供，额外给 `aria-valuetext="15 像素"` |
| switch 键盘 | 原生 button，`Space` / `Enter` 均触发；`aria-checked` 必须随状态同步 |
| 图标 | 装饰性（分类图标、段内图标）传 `label` 为空 → `AppIcon` 自动 `aria-hidden="true"`；关闭按钮**必传** `label="关闭设置面板"` |
| 对比度 | 全部走 Token 已标注的对比度：正文 `--fg` ≥ 4.5:1、说明 `--muted` ≥ 4.5:1（`design-tokens.css:97` 5.51:1）、回显 `--fg-2` ≥ 4.5:1 |
| 动效 | 全走 Token 动效层；`prefers-reduced-motion: reduce` 下 Token 归 1ms（`design-tokens.css:316-322`），**不额外写 media 查询** |
| 打印 | `@media print` 必须加 `.settings-panel, .dialog-mask { display: none !important; }`（AC-06：只输出正文） |

---

## D9. 空态 / 边界与降级

### D9.1 存储不可用（隐私模式 / 磁盘满 / WebView 限制）

| 情形 | 行为 |
|------|------|
| `localStorage.setItem` 抛异常 | ① `catch` 静默（照抄 `theme.js:97-99` 的处理范式：存储不可用**仍应用本次选择**，不抛错阻断 UI）；② 页脚右侧显示 `var(--warn)` / `--text-xs` 提示「偏好无法保存，重启后会恢复默认」；③ 面板**不**关闭、控件**不**回滚 |
| `localStorage.getItem` 抛异常 | 全部回落出厂值，面板正常可改（只是不持久） |
| 首次启动（无 key） | 全部出厂值，**不写 key**（读到默认值不触发写入，避免首启就留垃圾 key） |

### D9.2 非法存储值兜底（**逐字段校验，不整体丢弃**）

| 字段 | 非法示例 | 兜底 |
|------|---------|------|
| `fontFamily` | `"comic sans"` / `""` / `null` | 回落 `sans` |
| `fontSizePx` | `"abc"` / `0` / `99` / `14.5` | 数值化失败 → `15`；成功但超界 → **clamp 到 12–20**（不丢弃，用户意图保留） |
| `lineHeight` | `1.72` / `"1.7"` | 数值化后**吸附到最近档**（1.5 / 1.7 / 1.9），无最近档则落 `1.7` |
| `measure` | `"46rem "`（带空格）/ `"800px"` | 只接受精确三档之一，否则落 `46rem` |
| `autosaveMs` | `-1` / `99999` | 落 `800`（不 clamp 到 3000，因为 99999 明显是脏数据不是意图） |
| `snapshotMin` | `0.5` | 落 `3` |
| `zoomEnabled` / `restoreZoom` | 非 boolean | 落各自默认（`true` / `false`） |
| 整个 JSON 解析失败 | 非法 JSON 字符串 | 全部落出厂值 + `console.warn('[prefs] 解析失败，已回落默认')`（DEV 可见，不弹窗打扰） |

### D9.3 反例（写给实现方的负向清单）

| 反例 | 后果 |
|------|------|
| 只 `removeProperty('--text-base')` 漏了 `--text-md` | 恢复默认后左右两栏字号不一致（C2 破） |
| 只 `removeProperty('--preview-measure')` 漏了 `--reading-measure` | 预览与阅读模式行宽不一致 |
| 用 `setProperty` 写 token 默认值代替 `removeProperty` | paper 用户被锁死在 1.7 / 50rem，主题感知丢失（D6.3） |
| 把用户偏好写进样式表 / 新建 token 文件 | 被 `[data-theme='paper']` 静默压掉（§9 坑 1 + §3 规则 4） |
| 把 zoom 乘进 `--text-base` | 破坏 C3 正交，⌘= 与字号互相覆盖 |
| 面板里内联裸 `<svg>` 或用 emoji 当图标 | 违反 AC-09 与 §3 规则 1 |
| 恢复默认时重置 `inkmark-theme` | 越界改 theme.js 状态，且用户丢主题选择 |

---

## D10. 验收对照（补 §8 的设计侧细则）

| 编号 | 设计侧保证 |
|------|-----------|
| AC-01 | D4 的 `applyFontSize` 单入口 + 成对写入 |
| AC-02 | D3.1 项 2 明确标「C1 受影响 = 是 → html 内联」 |
| AC-03 | D4.3 第 3 条：不改既有 `--zoom-scale` 正交路径 |
| AC-04 | D3.3 单 key JSON + D9.1 存储异常不阻断 |
| AC-05 | D6.2 二次确认 + D6.3 五步序列（7 个 removeProperty + 回读校验） |
| AC-06 | D1.1 打印隐藏规则；D8 打印行 |
| AC-07 | D6.2 Esc 分级 + D8 焦点归还编辑器 |
| AC-08 | C4：复用 `setPreference('system')`，D3.1 项 1 标「C1 受影响 = 否」 |
| AC-09 | D2 分类图标 + D3.1 项 1 的 4 个图标**全部来自 paths.js 既有登记**，零新增、零 emoji |
| AC-10 | D3.2 项 7 语义（`0` = 不挂定时器；手动「立即快照」不受影响） |

---

## D11. 自检清单（交付前逐条打勾）

- [ ] 无任何 emoji；图标全部走 `<AppIcon>` + paths.js 白名单语义名
- [ ] 无紫粉渐变、无发光边框、无毛玻璃
- [ ] 无硬编码颜色值 —— 面板内所有颜色均为 `var(--token)`
- [ ] 无硬编码 px 尺寸（唯一例外：字号档位与 1px/2px 细线，已在 D4/D7 明确换算依据）
- [ ] 无空洞文案（无「自定义你的体验」类表述；所有说明句给出具体动作或具体后果）
- [ ] 无大标题 Hero、无千篇一律卡片网格（行间用 1px 线分组，无盒子）
- [ ] 7 个内联变量成对/成套写入与成套移除，无遗漏
- [ ] `--preview-measure` 与 `--reading-measure` 的纸感 48rem 既有行为被保留（D5.2）
- [ ] 未发明新 token 变量名，未新增第二套 token 文件
