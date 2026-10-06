# Inkmark · 交接说明

> **这份文档的用途**：对话窗口切换 / 新会话接手时，**先读这一份**，再按需读
> `docs/spec/` 与项目记忆。它记录「做到了什么、怎么验证、哪些坑别再踩」，
> 而不是流水账。
>
> 最后更新：2026-10-06（**装配层瘦身 + 跨平台原生化**交付后）
>
> ⚠️ **本次是架构级变更**：键位唯一真源从 `main.go` 的 `buildMenu()` 迁到了
> 前端 `frontend/src/composables/useShortcuts.js` 的 `COMMANDS` 表。
> 接手第一件事请读 §2 第五轮 与 §11「真源迁移对照表」。
> ⚠️ **App.vue 现在是 ≤150 行的纯装配层**（门禁硬上限）：新增行为一律先下沉到
> composables/，别往 App.vue 加行 —— 契约 5 会直接报红。

---

## 0. 三十秒上手

```bash
cd /Users/aftery/Desktop/myapp/inkmark

# 门禁全跑一遍（约 2 分钟，与 CI 口径一致）
cd frontend && npm test; cd ..          # 期望 106/106
node scripts/verify/verify-shortcuts.mjs    # 快捷键契约，期望退出码 0
node scripts/verify/scan-i18n-residue.mjs   # i18n 文案残留，期望退出码 0
./scripts/p0-check-emoji.sh frontend/src main.go app.go   # P0 零 emoji，期望退出码 0
/usr/local/opt/go/bin/go vet ./...           # 注意：go 不在 PATH
node scripts/smoke/render-check.mjs         # 真渲染冒烟（需先 npm run build），期望 PASS

# 交互探针（验「静默失败」类缺陷，render-check 覆盖不到）
cd frontend && npx vite --port 5599 --strictPort   # 另开终端起 dev server
cd .. && node scripts/probe/probe-slash.mjs         # 斜杠面板：输入 / 后按 Enter 是否真插入
node scripts/probe/probe-wysiwyg.mjs               # 表格/分割线/图片装饰是否产出 DOM
node scripts/probe/probe-theme.mjs                 # 暗色下各区域实际计算色

# 构建 + 启动
# ⚠️ 在 WorkBuddy 沙箱内跑会被 safe-delete shim 拦（vite 的 emptyDir 触发熔断）→ 需提权
PATH=/usr/local/opt/go/bin:$HOME/go/bin:$PATH ~/go/bin/wails build
# ⚠ 构建完成要 35-60 秒，产物在 build/bin/inkmark.app —— 别在构建完成前就 ls 它
open build/bin/inkmark.app
# ⚠ build 会删掉被跟踪的 frontend/dist/.gitkeep → 每次 build 后必须
#   git checkout -- frontend/dist/.gitkeep
```

**接手时先确认两件事**（本项目最常见的坑）：
1. `go` **不在 PATH**，用 `/usr/local/opt/go/bin/go`
2. shell `grep` 在本仓 UTF-8 文件上**会静默返回空**，且**会匹配注释里的代码**
   → 排查代码一律用专用检索工具（Read/Grep），不要用 shell grep 下结论

---

## 1. 项目是什么

跨平台桌面 Markdown 编辑器。Wails v2.16（Go 壳）+ Vue 3 + Vite 6 + CodeMirror 6。
GitHub 远端 `Aftery/Inkmark`，`main` 已与 origin 同步（`5ad7434`）。

### ✅ CI 已在 GitHub 上真实跑通
`5ad7434` 的 CI 结论 **success**（前两次推送 `b2cbbcb` / `8361c18` 也均 success）。
这是「本地绿 ≠ runner 绿」这一关的实证 —— 首次推送后最可能出的问题
（Node 预装版本、`npm ci` 的 lockfile 一致性）已确认不存在。

查 CI 状态（本机没装 `gh`，用公开 API）：
```bash
curl -s "https://api.github.com/repos/Aftery/Inkmark/actions/runs?per_page=3" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
    (j.workflow_runs||[]).forEach(r=>console.log(r.name,r.status,r.conclusion,r.head_sha.slice(0,7)))})"
```
若仓库转私有，此 API 会返回 401/404，届时需要装 `gh` 或用 token。


### 目录速查
```
main.go            应用入口（**按平台差异化窗口形态**：darwin 非无边框+毛玻璃 / linux 无边框）
app.go             暴露给前端的 Go 方法（文件读写/剪贴板/图像/版本/检查更新/关闭）
（locales.go 已删：唯一消费方是 buildMenu 的 t(locale,key)，菜单下线后无人使用）
version.go         版本单一真源（构建时 -ldflags -X main.version= 注入）
frontend/src/
  App.vue          **装配层（≤150 行硬上限）**：实例槽 + 依赖序装配 + 模板
  themes/
    index.css      唯一样式入口（tokens → base → preview → app-shell → platform-darwin）
    tokens/design-tokens.css   ** 样式唯一真源（新增 token 必须写这里）**
    app-shell.css  装配层布局（App.vue 样式迁出：骨架/弹层/提示/打印兜底）
    platform-darwin.css  macOS 毛玻璃适配（挂 <html data-platform>）
    prefs.js        用户偏好唯一真源（7 项：排版 4 + 主题外 3，含 locale）
    theme.js        主题偏好（light/dark/paper + 跟随系统）
  i18n/            三语字典（+2 key × 3 档）+ t()
  composables/
    useShortcuts.js      ** 键位唯一真源（COMMANDS 表 + 全局分发 + 命令总线）**
    usePrefs.js          排版偏好/主题/缩放的响应式封装（--zoom-scale 唯一写入者）
    useEditorSession.js  编辑器实例 + 派生状态（行列/字数/预览防抖）+ 文档替换
    useDocumentState.js  ** 文档状态机：dirty（唯一语义 + SetDirty 镜像）/ 800ms
                          自动保存 / 快照 / switchFile 边界 / 导出 / 历史面板**
    useFileAssets.js     图片粘贴拖拽落盘（Base64 → Go SaveImage → assets/ 相对路径）
    useCommands.js       ** 命令处理器注册面（registerCommands + 菜单结构 + Esc 路由）**
    useWorkspace.js      视图两态 / 专注 / 侧栏 / 打字机 / 窗口置顶
    usePlatform.js       平台识别（Environment 权威 + navigator 同步初判）
    useToast.js          轻提示
    useOutline.js        大纲高亮 + 跳转（自持度量失效：resize / 视图切换）
    useDialog / useFileOps / useShortcutsHelp
  components/      TitleBar（跨平台）/ Sidebar / SlashCommand / StatusBar /
                   HistoryPanel / SettingsPanel / InputDialog / ShortcutsDialog /
                   AboutDialog / FileTree / Outline / SegmentedControl …
  editor/          createEditor / commands / wysiwyg / outline /
                   slashCommand（斜杠面板 CM 扩展）/ imageDrop / sampleDocs
  tests/           106 条契约测试（node:test，零依赖）
scripts/
  emoji-pattern.mjs        P0 emoji 正则唯一真源
  p0-check-emoji.sh        薄封装（Node 实现）
  verify/parse-main-menu.mjs   main.go 菜单真源解析（共享）
  verify/verify-shortcuts.mjs  键位文档契约（CI 门禁）
  verify/scan-i18n-residue.mjs  i18n 文案残留（CI 门禁）
  verify/verify-i18n-switch.mjs 真浏览器三语切换（手动跑）
  smoke/render-check.mjs    真渲染门禁（dev + dist 双路径）
.github/workflows/ci.yml     5 道门禁
docs/spec/                   契约文档（见下）
```

---

## 2. 最近五轮做了什么

### 第一轮：设置面板 + 打印菜单规范化
- 新增 `components/SettingsPanel.vue`（外观 / 编辑器两分类，7 项）
- 新增 `themes/prefs.js`（用户偏好唯一真源）
- `⌘P` 从「导出 PDF」改为「**打印**」，导出 PDF 降为 `⇧⌘P`
- 菜单「设置…」最初放在文件菜单末尾（因 Wails 的 `AppMenu()` 是硬编码 Role），
  **第二轮已移入 Inkmark 应用菜单**

### 第二轮：工程底座（README / 测试网 / CI / 拆分）
- README 快捷键表按 `main.go` 重写，恢复真实待办清单
- 从零建测试网 104 条（`node:test`，**零新增依赖**）
- CI 4 道门禁 → 现 5 道
- `App.vue` 1368 → 1280（抽 `useDialog` / `useShortcutsHelp` / `useFileOps`）
- 修 P0 假绿灯：`p0-check-emoji.sh` 原用 GNU grep 的 `\x{}`，
  macOS 自带 grep 是 toybox 不支持 → 报错被 `2>/dev/null` + `|| true` 吞掉
  → **永远输出「✅ 通过」**，连带作废了前几轮「emoji 扫描通过」的证据

### 第三轮：滚动同步修复 + 弹层统一 + Edit 菜单中文化 + 三语国际化
- **滚动联动**（用户截图报）：左栏到底时右栏还剩一截。根因是尾锚点取
  `Math.max(最后标题y, maxScroll)`，当「末段高度 < 一屏高度」时尾锚点被抬到
  `maxScroll` 之上，源侧到底只映射到末段内部。修法：`mapScroll()` 边界吸附。
- **弹层尺寸统一**：新增 `--dialog-width-sm/md/lg` + `--dialog-min-height` token；
  设置面板改 `min-height` 修「切分类时高度跳变」
- **窗口菜单中文化**：`WindowMenu()` Role 硬编码英文 → 自建中文（三项均有等价 runtime API）
- **Edit 菜单中文化**：`EditMenu()` Role → 三平台统一自建中文 + 剪贴板走
  Wails API（详见 §4 的纠错）
- **三语国际化**：Go 菜单 83 key + 前端 155 key × 3 档，设置面板新增「语言」项

### 第四轮：单栏居中重构 + 原生菜单下线（产品减法）
用户要求砍掉三样东西，逐项落地：
- **双栏 / 分屏 / 滚动联动** → 单栏居中流式（`--single-measure: 46rem`）。
  `useOutlineSync.js` 整份删除（跨栏锚点映射 / 互斥锁 / 回声识别全部失去意义），
  改为 `useOutline.js`（只保留大纲高亮 + 跳转）。视图四态收敛为两态
  （`edit` / `reading`），⌘1~⌘4 随之取消。
- **顶部工具条** → `components/Toolbar.vue` 删除。格式命令改由**斜杠命令面板**
  与快捷键承接。字典里 30 条 `toolbar.*` 文案同步删除。
- **原生菜单** → `main.go` 只剩窗口配置（`Frameless: true`），`buildMenu`（300 行）
  与 `locales.go`（356 行）整份删除；`app.go` 连带删掉 RefreshMenu / SetLocale /
  三个 checkbox 镜像 / recents 状态（568 → 410 行）。

**架构级后果：键位真源从 Go 迁到前端**（详见 §11 对照表）。
`scripts/verify/parse-main-menu.mjs` 与 `verify-shortcuts.mjs` 已改为解析
`composables/useShortcuts.js` 的 `COMMANDS` 表；`contracts.test.mjs` 契约 1
从「Go emit ↔ safeEventsOn」改为「COMMANDS ↔ App.vue registerCommands」，
并加两条指针用例（main.go 不得再有 buildMenu、locales.go 不得复活）。
`useShortcutsHelp.js` 删掉手写 `SHORTCUTS` 常量，改为从命令表派生 ——
那张手写表正是 2026-06「加粗误写 ⌘B」漂移的根源。

**新增三个模块**（本轮核心交付）：
| 文件 | 职责 |
|---|---|
| `composables/usePrefs.js` | prefs/theme 的响应式薄封装；`cycleTheme`（四档循环）、`changeZoom`（80~150%） |
| `components/TitleBar.vue` | 自绘标题栏：拖拽区 + 下拉菜单（点击外部关闭）+ 居中文件名/脏圆点 + 窗口按钮 |
| `components/SlashCommand.vue`<br>`editor/slashCommand.js` | 斜杠命令面板：前者管面板状态/定位/过滤，后者管键位拦截（`Prec.high`）与文档变更 |

### 第五轮：装配层瘦身 + 跨平台原生化（架构闭环）
用户要求 `App.vue` 降到 150 行内，并把窗口形态按平台差异化（macOS 毛玻璃 / Linux 纯净无边框）。

**App.vue：1182 → 146 行（有效 126），且是门禁硬上限**（契约 5 从「白名单豁免」改成
「总行数 ≤150」——豁免意味着可以还债，硬上限意味着只能往下走）。拆法：
| 下沉到 | 装什么 |
|---|---|
| `useEditorSession.js` | 编辑器实例（写入 `shallowRef` 槽 `editorRef`）+ 行列/字数/预览防抖 + `syncAfterDocReplace` |
| `useDocumentState.js` | dirty（唯一语义 + `watch` 同步 `SetDirty`）/ 800ms 自动保存 / 快照 / **`switchFile` 边界** / 导出 / 历史 |
| `useCommands.js` | `registerCommands`（54 条命令的处理器）+ `menuGroups` + 全局 Esc 分层路由 |
| `useWorkspace.js` | 视图两态 / 专注 / 侧栏 / 打字机 / 窗口置顶 |
| `useFileAssets.js` | 图片粘贴拖拽落盘（云端图床的预留替换点） |
| `usePlatform.js` / `useToast.js` / `editor/sampleDocs.js` | 平台识别 / 轻提示 / 两份示例文档 |
| `components/{Sidebar,InputDialog,ShortcutsDialog,AboutDialog}.vue` | 模板四块（含各自的 `@media print`） |
| `themes/app-shell.css` | App.vue 的布局/弹层/提示样式整体迁出（弹层类三组件共用，不复制三份） |

**装配顺序成为契约**（tdz-order.test.mjs 逐条守着）：
`editorRef` 槽位必须先于任何 composable 调用；`onDocChange` / `refreshOutline` 是
**函数声明**（提升），声明刻意晚于注入点 —— 「函数声明豁免」用例正是覆盖这种写法。

**跨平台窗口形态**（main.go 按 `runtime.GOOS` 分流，见 §11 对照表）：
- darwin：`Frameless: false` + `mac.TitleBarHidden()` + `WebviewIsTransparent` +
  `WindowIsTranslucent`（Vibrant 毛玻璃）。⚠️ Wails v2.16 **没有**
  `TitleBarHiddenWithFullSizeContent`（go doc 核实 `pkg/options/mac/titlebar.go`
  只有 Default / Hidden / HiddenInset），`TitleBarHidden()` 即需求所述语义。
  红绿灯保留 → TitleBar 在 darwin 下 `v-if="!isDarwin"` 隐藏自绘窗口按钮，
  左侧菜单 `padding-left: 70px` 给红绿灯留白。
- linux / windows：`Frameless: true`（无边框纯净模式，`--wails-draggable` 生效）。
- 平台数据源 `usePlatform.js`：`Environment()` 权威 + `navigator` 同步初判（首帧不能等异步），
  结论落 `<html data-platform>` 供 `platform-darwin.css` 消费。

**顺带修掉的三个真实缺陷**（都是上一轮重构的漏网，不是本轮新引入）：
1. **速查表渲染空表**：模板绑 `shortcutRows`，而 `useShortcutsHelp` 返回的是 `rows`
   —— 变量名不匹配，⌘/ 打开后表格是空的。现由 `useCommands` 统一改名并透传。
2. **阅读态大纲失效**：`useOutline.setReadingPane()` 的注入调用在第四轮重写中丢了，
   阅读态高亮/跳转静默退化为「不算」。现由 App.vue 装配时注入 `previewEl`。
3. **`doc.unsaved` i18n key 不存在**：标题栏脏圆点的 title 显示成 key 原文。
   已补三档（`doc.unsaved` / `about.checkUpdate`）。

### 第六轮：修四个静默失败（真机截图 + headless 探针驱动）
用户报「暗色下大纲颜色没变 / 表格、图片没渲染 / 分割线没渲染 / 斜杠插入回车没反应」。
**四个全是静默失败**——不抛异常、构建通过、121 条测试全绿，只有真机才能看见。
故本轮新建了 `scripts/probe/`（三个 CDP 探针，见下），先复现再改，最后做变异自证。

| # | 现象 | 真因（探针实测，非推断） |
|---|---|---|
| 1 | 斜杠面板按 Enter 无反应 | `confirm()` 先 `close()`（把 `view=null`、`anchor=-1`），再把这两个已清空的变量传给 `insertSlashItem` → 守卫 `if (!view || anchor < 0) return false` **静默返回**。面板关了、文档没变 |
| 2 | 表格管道符裸露 | **误判纠正**：`@lezer/markdown` **是**支持 GFM 表格的（`markdownLanguage` 已 `configure([GFM, …])`，实测语法树里 `Table`/`TableRow`/`TableDelimiter` 全在）。真因是 `wysiwyg.js` 的 switch **没有这些分支** |
| 3 | `---` 与 `![alt](url)` 裸露 | 同上：`HorizontalRule` / `Image` 节点存在但无装饰。已补 `HrWidget`（`height:0`+`border-top` 撑高）、`ImageWidget`（非活跃行替换 + `onError` 占位） |
| 4 | 暗色下侧栏/大纲是浅色 | token 与计算色**全对**（实测 `--fg-2: #B4B7C2`、outline `rgb(180,183,194)`）。真因是 `platform-darwin.css` 的半透明层：`--surface` 只有 **78%** 不透明度，透明窗口下**透出 macOS 桌面壁纸**，深色被冲淡成浅灰。已提到 92%（`.app` 86%→94%，标题栏由 `transparent` 改为 `--surface` 55%） |

**顺带修掉的两处同类静默失效**（探针的 console 日志里抓到的，不是 review 看出来的）：
5. **大纲当前节高亮从未生效**：模板传的是 `:active-index="outlineSync.outlineActive"`。
   Vue **只解包顶层 ref**，composables 实例是普通对象 → 送进 prop 的是 `Ref` 实例
   （探针实测 `active-index=Ref< -1 >`）。已解包成顶层 `const`。
   同类：`:zoom="prefs.zoom.value"` → `const { zoom } = prefs`。
6. **wysiwyg 插件崩溃**（探针捕获 `Runtime.exceptionThrown`）：为取 Image 的 url/alt
   我写了 `node.state.doc`，而 lezer 的 `SyntaxNode` **没有** `.state` / `.doc`。
   已改为显式传 `doc`（`urlOf(node, doc)`）。

**新增文件**：`themes/editor-wysiwyg.css`（`.cm-md-*` 的唯一定义处，从 createEditor.js
迁出——写进 theme 会顶破行数棘轮，实测 260→280 被契约 5 拦下）、
`tests/wysiwyg-decor.test.mjs`（15 条行为契约）、
`scripts/probe/{probe-slash,probe-wysiwyg,probe-theme}.mjs`。

**教训（新增第 8 次「匹配到注释里的代码」）**：新测试首跑 4 条红，代码明明改对了——
断言 `/node\.state\.doc/` 命中了我自己写的**说明性注释**（「曾写成 node.state.doc
直接把插件打崩」）。测试内已加 `stripComments()`，所有断言切到剥离后的源码。

---

## 3. 怎么验证（不要只看「构建通过」）

本项目吃过两次教训：**「进程存活」不等于「界面渲染出来了」**（白屏时进程照样活着），
**「我以为失败了」不等于「我确认失败了」**。所以：

| 要验什么 | 怎么验（正确的） |
|---|---|
| 界面能不能用 | `node scripts/smoke/render-check.mjs`（真浏览器加载 dist，断言 `.main` / `.editor-host` 存在 + console 无 error）**不是** `pgrep` |
| 门禁有没有红 | 看**真实退出码**，不要用 `\| tail` —— 管道会把退出码换成 `tail` 的 0 |
| 改动有没有真效果 | **变异自证**：故意改坏 → 确认报红 → 还原 → 确认复绿 |
| 门禁本身有没有失效 | 元测试：造违规输入 → 确认门禁能报出。**门禁没有自检等于没装** |
| 菜单/快捷键对不对 | `node scripts/verify/verify-shortcuts.mjs`（README + 内联速查表 ↔ main.go 三方对齐） |
| 菜单真实长什么样 | 进程内 `NSApp.mainMenu` 转储（比截图硬，可复核）。方法见 `main.go` 注释 |

`render-check` 已内建**采集有效性自检**（HTTP 200 前置 + 预期噪声下限）——
它会先确认「采集链路是活的」再采信结果。这套机制是为了防我那次
「vite 根本没起来却把 0 条 warning 当成正常」的错误。

---

## 4. 已知的错误结论（别再重复）

### ① 「自建 Edit 菜单会让 ⌘C/⌘V 失效」——**错，已纠正**
我当时只看了菜单侧（Role 挂原生 selector），没验证快捷键注册路径。源码实测：
- 自建项经 `AddMenuItem`（`darwin/menu.go:62-64`）把 Accelerator 转成 key+modifier，
  最终走 `newMenuItem:...:keyEquivalent:` → **快捷键照常注册**
- 代价仅是 action 变成 Go 回调而非原生 `copy:` selector，前端补剪贴板读写即可

**判据（可复用）**：Role 菜单能否自建替换 = **其条目是否依赖原生 selector**。
依赖者必须保留（静默失效比英文标题更糟）；不依赖者可替换。

### ② 「`menu.About()` / `Hide()` / `Quit()` 可用」——**错**
它们在 `menuroles.go` 的 `/* */` 块内，Wails v2.16 只导出
`AppMenu` / `EditMenu` / `WindowMenu` 三个**整体** Role。
**错误来源**：`grep "^func"` 会匹配到被注释掉的声明。
**核实第三方 API 是否存在必须用 `go doc <pkg> <Symbol>` 或读源码。**

### ③ 「vite dev 白屏是冷启动假警报」——**错**
真相是第二处 `const` TDZ（`if (import.meta.env.DEV)` 块立即读取后声明的
`openFile`）。生产构建把 `import.meta.env.DEV` 替换为 false 并剔除整块，
所以**只验 dist 会系统性看不见 dev-only 的代码路径**。现在冒烟跑 dev + dist 两条。

### ⑤ 「用 try/catch 包住 getter 就安全了」—— **错（本轮实测）**
`usePrefs(() => editor)` 命中 `let editor` 的 TDZ 后，我一度在 `usePrefs` 里
`try { getEditor() } catch { null }` 兜底。结果：**TDZ 被一起吞掉，变异测试竟然 PASS** ——
即「兜底掩盖真问题」，是本仓最怕的失败模式（与 §5 两次假绿灯同源）。
正解是 `usePrefs` 初始化时**根本不读** editor（只写 CSS 变量），
另暴露 `syncZoomToEditor()` 让 App.vue 在 `onMounted 后主动补一次。
**教训：兜底不是修法。判据是「这个 catch 会不会把真错误吞掉」，会就别加。**

### ⑦ 「把示例文档搬出 App.vue 就会破坏 i18n 门禁」—— 错，真相是白名单判据太糙
`scan-i18n-residue.mjs` 里那条「Markdown 示例文档正文」的豁免按 `/App\.vue$/` 粗筛文件，
而它的行首形态过滤其实**漏判散文行**（如「一份可玩的速查表。改一改，立刻看到变化。」）
—— 之前不报是因为文件位置恰好对上了，**不是判据正确**。文档搬到
`editor/sampleDocs.js` 后立刻暴露 42 处误报。
修法是换成**整文件豁免**并写明理由，而不是给新文件再加一条行首正则。
**教训：白名单里的「粗筛 + 行形态」组合要问一句——它是真的判据，还是碰巧没报？**

### ⑧ 「弹层抽成组件后，App.vue 的 @media print 还能管住遮罩」—— 错
Vue scoped 样式**打不到子组件内部**（本仓在带遮罩组件那条用例里写过这句话），
但我在把输入框/速查/关于三个弹层抽成组件后，仍把「App.vue 打印块必须含
.dialog-mask」当成有效判据——那条规则一旦通过，反而是**死规则**：元素已不在
App.vue 的 DOM 里，打印时它什么也遮不住。已把契约 3 的该用例改成守
App.vue 真正仍拥有的关键项（`.export-preview` 必须恢复为正常流），
遮罩的打印职责由「每个带遮罩组件必须有自己的 @media print」那条通则继续兜。
**教训：组件拆分会改变 scoped 样式的可达范围，判据要跟着换锚点。**

### ⑥ `tdz-guard` 的「惰性包装豁免」有盲区（本轮实测）
`() => editor` 会被判为 lazy 而豁免 —— 这条规则本身没错，但它默认
「惰性 = 永不求值」。当某个 composable 在**构造期**就调用 getter 时（`usePrefs` 会），
豁免反而成了盲区：**dist 构建通过、104 条测试全绿，只有 render-check 报白屏**。
已在 `tdz-order.test.mjs` 补第三类守卫（「顶层声明行必须早于任何把它作为实参
传入的 composable 调用」）并跑过变异自证。
**教训：静态检查的豁免规则要考虑「被调用方会怎么用它」，不能只看调用点形态。**

### ④ `menuLabels` 匹配、`⚠️` 写注释里 —— 累计 7 次「匹配到注释里的代码」
本仓在这类错误上栽了 **7 次**（shell grep 静默 / `@media print` 注释误判 /
JSDoc 示例误判 / grep 匹配被注释的函数 / `indexOf` 命中注释里的 `menuLabels` /
**在注释里裸写块注释定界符导致自己刚写的注释提前闭合** /
**本轮：`indexOf('useFileOps({')` 命中 App.vue「顺序契约」注释里的同一字符串，
导致 tdz 变异脚本把隐患插进了注释里、造不出真实隐患**）。
**教训**：匹配前必须剥注释；注释里描述注释语法必须避免裸写定界符。

---

## 5. 门禁体系（5 道，全在 CI）

| 门禁 | 卡什么 | 命令 |
|---|---|---|
| `frontend` | 104 条测试 + vite 构建 | `npm test && npm run build` |
| `go` | vet + build（vet 不做链接，cgo 导出代码要 build 才暴露） | `go vet ./... && go build -o /dev/null .` |
| `p0-emoji` | 界面不得用 emoji 当图标（含注释） | `./scripts/p0-check-emoji.sh frontend/src` |
| `docs-contract` | 键位在 README / 速查表 / main.go 三处脱节 | `node scripts/verify/verify-shortcuts.mjs` |
| `i18n-residue` | 新写的用户可见文案漏了 `t()` | `node scripts/verify/scan-i18n-residue.mjs` |

### 两条关键机制
- **行数债务棘轮**：`frontend/tests/contracts.test.mjs` 的 `LINE_EXEMPTIONS`
  登记 `{文件, limit, reason}`，断言**不得增长**，90% 时出**非阻断** advisory。
  口径 = **有效代码行**（剥注释后的非空行）—— 早前用「总行数」会把注释
  当债务，**逼人改阈值、奖励删注释**，已改为有效代码行。
- **指针用例**：移除某项检查时必须补一条「该检查仍存在」的断言，
  防「检查消失却无人报错」的覆盖空窗。

### 本项目最危险的失败模式：**假绿灯**
门禁存在但不阻断，等于没有门禁，还提供虚假保证。本项目已发生 **2 次**：
1. `p0-check-emoji.sh` 因 grep 报错被吞 → 永远「通过」（2026-10-04 修）
2. `scan-i18n-residue.mjs` 退出码恒 0 → 放进 CI 也是永远绿（2026-10-06 修）

**新增/修改任何门禁时，必须做元测试**：造违规输入 → 确认能报红 → 确认退出码非 0。

---

## 6. 需要你人工确认的事（本机无 GUI 自动化权限）

自动化只验到「根节点渲染 + 标题栏/编辑区已挂载 + 零异常」，**交互全没被人看过**。
**第五轮后清单已重写**（旧的原生菜单项、视图四态相关项已随功能下线）。

1. **macOS 窗口形态**：窗口顶部**没有**原生长条，但**红绿灯在**；标题栏整体吃系统
   毛玻璃材质（拖动标题栏空白处窗口应跟随移动）
2. **macOS 红绿灯留白**：自绘菜单（「文件 / 编辑 / 格式 / 视图 / 窗口 / 帮助」）
   整体右移约 70px，**不被红绿灯压住**；右侧**不应**出现自绘窗口按钮
3. **Linux / Windows 窗口形态**：无边框；右侧有最小化/最大化/关闭三按钮；
   按住标题栏空白处可拖动窗口（`--wails-draggable`）
4. **关闭守卫**（两个入口都要试）：macOS 点红绿灯 / Linux 点自绘 ×——
   文档有未保存更改时应弹**系统**确认框；选「取消」则窗口不关
5. **菜单**：逐个展开；点菜单项生效；**点菜单外部自动关闭**；悬停另一项切换
6. **脏状态圆点**：改动文档后标题栏文件名左侧出现红点；⌘S 保存后消失；
   鼠标悬停红点的 title 应显示「未保存的更改」（不是 key 原文）
7. **斜杠命令面板**：**新行行首**输入 `/` → 面板在光标下方弹出；`↑↓` 切换、
   `Enter` 插入（**斜杠不残留**）、`Esc` 关闭；行中输入 `/` 应正常打出斜杠
8. **图片粘贴**：复制一张图片 → `⌘V`，应在光标处插入 `![](assets/...)`，
   且**同级目录出现 assets/**；文档未落盘时应提示「先保存」而不是静默失败
9. **快捷键速查**：`⌘/` 打开后**表格有内容**（第五轮修掉的空表回归项）
10. **阅读态大纲**：`view.outline` 切到阅读态后点大纲条目应能跳转
    （第五轮修回的 `setReadingPane` 注入）
11. **缩放**：⌘= / ⌘- / ⌘0，状态栏与正文字号同步变化
12. **三语切换**：设置 → 外观 → 语言，界面与标题栏菜单同步变、刷新后保持
13. **打印**：⌘P 只输出正文，无标题栏/侧栏/状态栏/弹层遮罩
14. **主题**：⇧⌘L 循环（浅 → 深 → 纸感），三套都正常

## 7. 已知未做 / 未验证（如实登记）

| 项 | 状态 |
|---|---|
| **单栏布局 + 跨平台窗口形态的真机目视** | 自动化只验到「根节点渲染 + 标题栏/编辑区已挂载 + 无异常」，**标题栏拖拽 / 红绿灯留白 / 毛玻璃 / 斜杠面板的真实交互全部需目视**（见 §6 的 14 项） |
| **macOS 透明窗口的代价** | `WebviewIsTransparent` + `WindowIsTranslucent` 在旧款 Intel Mac 上可能掉帧（透明窗口不能被合成器缓存）；本机是 macOS 12，只验到「能编译」，性能未实测 |
| **Linux（CachyOS）真机** | 无边框 + 自绘标题栏的 Linux 表现**从未在真机跑过**；窗口按钮对接的 `WindowMinimise/WindowToggleMaximise/CloseWindow` 在 Linux 后端的行为需目视 |
| **「最近打开」功能整体下线** | 它的唯一消费方是原生菜单的子菜单；自绘标题栏未做该入口。若要恢复，需前端加列表 + 重新暴露 Go 的 `GetRecents`（`recents.json` 持久化逻辑仍在 `app.go` 的 `recentsPath` 等函数里，但 `AddRecent` 调用点已删） |
| **`useOutline` 的阅读态分支未验证** | `setReadingPane` 的注入已在第五轮接回（此前丢失导致阅读态不高亮），但**阅读态的跳转仍未目视** |
| **CI 未在真实 runner 跑过** | 本地 5 道门禁全绿，但 push 后才知 runner 表现（历史上首次推送已验证过 lockfile 一致性，本轮新增的判据尚未验证） |
| **`release.yml` 真 runner** | 需 push 一个 `v*` tag 才会触发三平台打包。`ci.yml` 已验证在 runner 上绿，但 `release.yml` **一次都没跑过** |
| **检查更新** | 仓库**无任何 Release**，所以现在只会返回「无法检查更新」（不谎报「已是最新」）。要等第一个 Release |
| **macOS 未签名分发** | Gatekeeper 会拦，需 Apple 开发者账号（$99/年）签名+公证 |
| **「窗口 → 缩放」** | Wails 无「适配内容尺寸」API，用最大化近似（沿用既有裁决） |
| **关闭窗口** | Wails v2.16 **没有 `WindowClose`**，只有强制退出的 `Quit`。自建 `App.CloseWindow()`（先问 `OnBeforeClose` 再 Quit）。故 ⌘Q 之类的「退出应用」快捷键**未设**——自绘菜单里也没有「退出」项（macOS 走红绿灯，Linux 走自绘 ×） |
| **`treeSignal` 是空转的** | 文件树的 `reload-signal` 来自 `useFileOps` 的 `treeSignal`，但 Go 侧 `WatchDir` **未在 app.go 暴露**（`window.go?.main?.App?.WatchDir?.()` 恒为 undefined），故该 ref 从不自增、目录外部变更不会自动刷新。本轮原样保留（给后续 fsnotify 接线留位），**未删**是有意为之 |
| **无拼写检查** | 刻意不做：CM 的 lint 对 CJK 基本无效，中文场景是伪需求 |
| **零多标签页** | ADR-005 已预留 `dirty` 升级路径 |
| **导出模板文案** | `export/exporters.js` 的 HTML 模板未国际化（Spec §1 明确留待后续） |

## 8. 下一步的三个候选（按建议顺序）

### P0 · 目视验收第五轮（见 §6 的 14 项，重点是跨平台窗口形态）
本轮改了**窗口本体**（macOS 非无边框 + 毛玻璃、Linux 无边框）与**装配层结构**，
自动化只能验到「渲染 + 无异常」。三处高风险：`TitleBarHidden` 下拖动是否有效、
红绿灯留白是否够 70px、透明窗口在本机 macOS 12 上是否掉帧。

### P1 · 给新组合式函数补行为测试网
`useDocumentState` 的 dirty/自动保存/`switchFile` 三个契约目前只有静态断言
（`SetDirty` 镜像、命令闭合）。可测的纯逻辑已具备：把「标记 → 防抖 → 落盘 → 解脏」
抽成可注入时钟的纯函数，就能用 node:test 覆盖，而不必上浏览器。

### P2 · 接上文件树的外部变更监听（`treeSignal` 现在是空转的）
Go 侧 `WatchDir` 未暴露，`reload-signal` 恒为 0。补 fsnotify 后，
外部改文件/重命名会即时反映到文件树；这需要在 `app.go` 加一个导出方法
并重新生成 wailsjs 绑定（`wails generate module`）。

## 9. 契约文档索引

| 文档 | 内容 |
|---|---|
| `docs/spec/SPEC-engineering-baseline-v1.md` | 工程底座契约、门禁边界、踩坑留档 |
| `docs/spec/SPEC-app-menu-release-v1.md` | 应用菜单 + 发布流程（含 Wails 能力边界） |
| `docs/spec/SPEC-i18n-v1.md` | 国际化契约（三语、零依赖选型、6 条已知坑） |
| `docs/design/settings-panel-spec.md` | 设置面板设计 + 裁决记录 R1~R4 |
| `docs/decisions/OPEN-DECISIONS.md` | 悬而未决登记册（导出是否跟随字体偏好） |
| `docs/architecture/ADR-004.md` | 快捷键裁决（⌘B 归大纲、加粗用 ⌘⇧B） |
| `docs/architecture/ADR-005` | `dirty` 语义（多文档的升级路径） |

---

## 10. 项目记忆位置

- `../.workbuddy/memory/MEMORY.md` —— 长期约定（样式契约、Wails 菜单约束、弹层 token 契约）
- `../.workbuddy/memory/pitfalls.jsonl` —— 踩坑库（**只追加**，同签名只增 episode）
- `../.workbuddy/memory/2026-10-04.md` / `2026-10-05.md` / `2026-10-06.md` —— 每日工作日志

---

## 11. 真源迁移对照表（2026-10-06，最容易踩的地方）

| 关注点 | 迁移前（原生菜单时代） | 迁移后（单栏重构） |
|---|---|---|
| 键位真源 | `main.go` 的 `buildMenu()` | `frontend/src/composables/useShortcuts.js` 的 `COMMANDS` |
| 菜单文案 | `locales.go`（Go 三档表，83 key） | `frontend/src/i18n/*.js`（+59 key，文案沿用原措辞） |
| 菜单 UI | 系统菜单栏 | `components/TitleBar.vue`（菜单结构由命令表派生） |
| 快捷键注册 | Wails accelerator（Go 侧） | `installGlobalShortcuts()`（window keydown，前端） |
| 菜单 → 业务 | `EventsEmit('menu:xxx')` → `safeEventsOn` | 命令总线 `emitCommand(id)` |
| 契约 1 判据 | Go emit ↔ `safeEventsOn` | `COMMANDS` ↔ `registerCommands` |
| 应用内速查表 | 手写 `SHORTCUTS` 常量 | 从 `COMMANDS` 的 `descKey` 派生 |
| 语言同步 | 前端切 → `SetLocale` → `RefreshMenu` | 单点（前端 i18n），Go 侧无语言副本 |
| checkbox 状态 | Go 镜像（`SetScrollSync` 等） | 前端 localStorage（`inkmark-typewriter` 等） |
| 窗口关闭 | 系统菜单 / 系统标题栏 | `App.CloseWindow()`（**不可用 `runtime.Quit`**） |
| 滚动联动 | `useOutlineSync.js`（锚点映射 + 回声识别） | 已删，只剩 `useOutline.js` 的高亮与跳转 |

| 装配层 | `App.vue` 内联全部逻辑（1300+ 行） | `App.vue` 只装配（≤150 行硬上限），逻辑在 composables/ |
| 命令处理器注册面 | `App.vue` 的 `registerCommands()` | `composables/useCommands.js` 的 `registerCommands()` |
| dirty → Go 的同步 | `App.vue` 里的 `watch(dirty)` | `useDocumentState.js` 内部 `watch(dirty)`（与状态机同源） |
| 图片落盘 | `App.vue` 的 `onImageFile` + `editor/imageDrop.js` | `composables/useFileAssets.js`（输入层仍在 imageDrop.js） |
| 窗口形态 | 单一 `Frameless: true` | `main.go` 按 `GOOS` 分流（darwin 非无边框+毛玻璃 / 其余无边框） |
| 平台判定 | `navigator.platform` 散落各处 | `composables/usePlatform.js`（Environment 权威）+ `<html data-platform>` |
| 弹层与提示的 UI | `App.vue` 模板内联 | `components/{InputDialog,ShortcutsDialog,AboutDialog}.vue` + `themes/app-shell.css` |
| 装配层样式 | `App.vue` 的 `<style scoped>` | `themes/app-shell.css`（全局、弹层共用）+ `platform-darwin.css` |
| 关闭入口 | 系统菜单 / 系统标题栏 | macOS 红绿灯（系统）/ Linux 自绘 ×（`App.CloseWindow()`） |

**改键位时现在只需动三个地方**（门禁会挡住漏改）：
1. `useShortcuts.js` 的 `COMMANDS`（唯一真源）
2. README「快捷键」节（可从命令表生成，别手抄）
3. 若改的是 `⌘⌥1` 这类 heading 键位，注意命令表只登记了 h1~h3（⌘⌥4~6 已随
   「标题一~六」合并为一条命令而取消，README 已同步）
