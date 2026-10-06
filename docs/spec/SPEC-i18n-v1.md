# SPEC · 国际化（i18n）v1

> 本轮契约。来源：用户需求「设置里面想加国际化，支持中文/英语/日文的切换」。
> 与 2026-10-06 的 Edit 菜单中文化同批落地——**中文化是国际化的一部分**，
> 做完本轮后全仓（含 Go 菜单）不再有硬编码的单一语言标签。

---

## 1. 范围

| 纳入 | 排除 |
|------|------|
| 设置面板新增「语言」选项（zh-CN / en-US / ja-JP） | 文档内容本身的翻译（用户写的 Markdown 不译） |
| 全部 UI 文案：8 个组件 + App.vue + 设置/关于/速查三个弹层 | 导出模板的文案（`exporters.js` 的 HTML 模板）——留待后续 |
| Go 菜单标签（文件/编辑/格式/视图/窗口/帮助 + Inkmark） | 代码标识符、注释、commit message（不译） |
| 状态栏、工具栏、文件树、大纲、历史面板、Toast | 插件系统（现在不做） |
| 快捷键速查表的描述列 | |
| 设置项的名称与说明文字 | |

## 2. 技术选型（零新增依赖）

**不引入 vue-i18n / intl-msgs 等库。** 理由：
1. 文案总量约 150~200 条，一个 `t(key, params)` + 三份字典足够；
2. 本仓纪律是**零新增依赖**（`node:test` 选型时已确立，见 `docs/spec/SPEC-engineering-baseline-v1.md` §3.1）；
3. 引入库会与「design-tokens 是样式唯一真源」形成另一种真源分裂。

### 2.1 文件布局
```
frontend/src/i18n/
  index.js       入口：locale 真源（ref）+ t() + useI18n() + 订阅
  zh-CN.js       简体中文（**基准语言，key 最全**）
  en-US.js       English
  ja-JP.js       日本語
```
仿照现有 `themes/prefs.js` 的模式：模块级状态 + localStorage 持久化 + 订阅回调 + 失败兜底。

### 2.2 API 契约
```js
// 基准语言必须存在全部 key；缺失即测试失败（见 §6）
initI18n()                      // 在 main.js 中 initTheme() 之后调用，首帧前落定
getLocale()                     // 'zh-CN' | 'en-US' | 'ja-JP'
setLocale(locale)               // 写 localStorage + 更新 ref + 通知订阅者
t(key, params?)                 // 翻译；缺 key 时【返回 key 本身并 console.warn】（不抛错）
useI18n()                       // Vue composable：返回 { t, locale }，组件内响应式
onLocaleChange(cb)              // 订阅（SettingsPanel 切语言后要重建 Go 菜单）
LOCALE_OPTIONS                  // 三档的显示名（**用各自语言写自己的名字**，如「简体中文」）
```

**缺 key 的行为**：返回 key 字符串 + `console.warn`，**绝不抛错、绝不返回空串**。
理由：抛错会让整个应用白屏（有过 TDZ 白屏的前车之鉴）；返回空串会让界面出现无文字的空洞，更难排查。

### 2.3 与既有设施的关系
- **语言偏好存哪**：存 `themes/prefs.js`（已有 6 项偏好、localStorage 持久化、订阅），
  新增第 7 项 `locale`，默认 `'zh-CN'`。**不另建存储**——避免两套持久化机制。
- **Go 菜单如何随语言变**：`App.RefreshMenu()` 已存在（`app.go`），
  且 `buildMenu(a)` 是**纯函数式重建**。前端切语言后调 `RefreshMenu()` 即可。
  ⚠ 这要求 `buildMenu` 能读到当前语言 → 语言真源必须在 **Go 侧**也有一份，
  或由前端把 locale 传给 Go（见 §4 的双向同步）。

## 3. Go 菜单的语言处理

`buildMenu` 里的所有 `AddText/AddSubmenu/AddCheckbox` 标签改为查表：
```go
var menuLabels = map[string]map[string]string{
  "zh-CN": {"file": "文件", "new": "新建文件", ...},
  "en-US": {"file": "File", "new": "New File", ...},
  "ja-JP": {"file": "ファイル", "new": "新規ファイル", ...},
}
```
- key 用**语义字符串**（`"file"` / `"new"` / `"export-pdf"`），不用中文原文当 key；
- `t(locale, "file")` 未命中时回退到 `zh-CN`，再回退到 key 本身；
- **Go 侧的 locale 真源**：`App.locale` 字段 + `App.SetLocale(locale string)` 导出方法
  （前端切换后调用，触发 `RefreshMenu`）。

⚠ **单次事务原则**：切语言必须「一次写入 + 一次刷新」，不允许前端先改 UI 再异步刷菜单——
否则会出现「界面已英文、菜单还是中文」的中间态。

## 4. 同步时序（避免闪烁与不一致）

```
用户在设置面板切语言
  → setPref('locale', 'en-US')        // prefs.js 立即写 localStorage + 通知
  → 组件内 t() 响应式重渲染（界面立刻变）
  → SetLocale('en-US') → Go 存 + RefreshMenu()   // 菜单重建
```
**已知取舍**：菜单重建是同步 IPC，理论上有极短的「界面已变、菜单未变」窗口（<1ms，肉眼不可见）。
不引入异步队列——为亚毫秒问题增加状态机复杂度不值得。

## 5. 组件改造清单（逐个确认，不许漏）

| 文件 | 文案量 | 备注 |
|------|-------|------|
| `App.vue` | 最多（约 40 条） | 三个弹层（输入对话框/速查/关于）+ toast + 专注提示 |
| `components/Toolbar.vue` | ~15 | 按钮 title/tooltip |
| `components/StatusBar.vue` | ~10 | 状态栏 |
| `components/Outline.vue` | ~4 | 大纲面板标题/空态 |
| `components/HistoryPanel.vue` | ~8 | 历史快照面板 |
| `components/FileTree.vue` | ~6 | 文件树工具提示 |
| `components/TreeNode.vue` | ~3 | 节点操作 |
| `components/SettingsPanel.vue` | ~30 | **含新增「语言」选项本身** |
| `components/SegmentedControl.vue` | 0 | 纯控件，无文案 |
| `composables/useShortcutsHelp.js` | ~20 | 速查表描述列 |
| `editor/commands.js` 等 | 0 | 命令实现，无文案 |
| **Go `main.go`** | ~70 | 全部菜单标签 |

## 6. 验收标准

| # | 标准 |
|---|-------|
| AC-01 | 设置面板「外观」分类下有「语言」项，三档（简体中文 / English / 日本語），切换**立即生效** |
| AC-02 | 切换后**全部组件文案**同步变化（逐个组件人工核对，不抽查） |
| AC-03 | Go 菜单标签同步变化，且**键位不变**（`verify-shortcuts` 仍 0 漂移） |
| AC-04 | 刷新应用后语言保持（localStorage 往返） |
| AC-05 | `zh-CN.js` 是 key 最全的基准语言；**任何语言缺 key 时测试失败**（不是运行时才发现） |
| AC-06 | 缺 key 行为：返回 key 原文 + `console.warn`，不抛错、不返回空串 |
| AC-07 | 零 emoji（项目 P0-1） |
| AC-08 | 零新增依赖（`package.json` 不变） |
| AC-09 | 全部门禁绿：`npm test` / `verify-shortcuts` / `p0-emoji` / `go vet` / `render-check` / `wails build` |
| AC-10 | **行数债务棘轮不得增长**：`App.vue` 有效代码行 ≤ 现有登记值（`frontend/tests/contracts.test.mjs` 的 `LINE_EXEMPTIONS`） |

### 6.1 必须新增的测试（进 `npm test`）
1. **key 完整性**：三份字典的 key 集合与 `zh-CN` 完全一致（不多不少不少）——机械可查，**这是最重要的一条**；
2. **无硬编码残留**：用 Node 扫描 `frontend/src/**` 的模板与字符串字面量，
   断言「面向用户的可见文案」不出现未走 `t()` 的中文/英文单词。
   ⚠ 难点：注释里的中文**不算**残留（须先剥注释，复用 `tests/helpers/js-scan.mjs` 的 `stripComments`）。
   若这条实现成本过高，降级为「`SettingsPanel` 与 `Toolbar` 两个组件零残留」的窄断言，
   并在报告里写明未覆盖范围。**不得静默跳过。**
3. **Go 菜单 key 完整性**：`main.go` 的 `menuLabels` 三份 key 集合一致（可由 `contracts.test.mjs` 做）。

## 7. 已知坑（务必先读）

1. **⚠ 缺 key 抛错 = 白屏**。TDZ 白屏刚发生并已修复；本项目对「setup 期抛错」零容忍。
   `t()` 必须永不抛错。
2. **⚠ Go 侧不能 grep 确认**：本仓 shell `grep` 对 UTF-8 文件会**静默返回空**，
   且会匹配到注释掉的代码。核对 `menuLabels` 必须用 Node 或专用检索工具。
3. **⚠ 注释里的文案不译**。中文注释是项目既有风格（解释「为什么」），
   不要把注释也塞进 `t()`——那会让注释变成不可读的 key 串。
4. **⚠ 加速键描述的翻译**：速查表里的 `['⌘⇧B', '加粗']` 只需译描述，键位串不译。
5. **⚠ 别把文件树节点名/文档标题译掉**：那是用户内容，不是 UI 文案。
6. **⚠ `RefreshMenu` 会重建整个菜单**：切语言时若「最近打开」列表有内容，
   重建后必须仍正确（`buildMenu` 读 `app.recents`）——已有测试网覆盖事件闭合，但要实测一次。

## 8. 与本轮另一改动的关系

同批已落地：**Edit 菜单中文化**（`menu.EditMenu()` → 三平台统一自建中文菜单，
剪贴板改用 `App.ClipboardGet/ClipboardSet` + CM6 事务）。
国际化落地后，`buildMenu` 里的**中文标签将全部改为 `t(locale, key)`**，
本文件中「Go 菜单的语言处理」一节即为其契约。
