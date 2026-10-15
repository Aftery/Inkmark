# Inkmark · 交接说明

> **这份文档的用途**：对话窗口切换 / 新会话接手时，**先读这一份**，再按需读
> `docs/spec/` 与项目记忆。它记录「做到了什么、怎么验证、哪些坑别再踩」，
> 而不是流水账。
>
> 最后更新：2026-10-15（新增第十二轮：通道③ —— #8 的根因上一轮判断错了）
>
> 🔴 **2026-10-15 第十二轮：#8 图片粘贴的根因上一轮判断错了，已重做**
> 2026-10-15 用户复验：**「复制的图片只有名称」依旧**。
> 第十一轮认定「macOS 剪贴板给的是 file URL」并据此加的**通道② 是个从未执行过的分支** ——
> 真机上WKWebView 根本不把剪贴板图片暴露给 `clipboardData`，只有 `text/plain` 里的文件名，
> 于是 WebKit 默认行为把它**当文本插入**（现场 `osascript 'clipboard info'` 证实剪贴板里
> 只有图片数据、零file URL）。探针 18/18 全绿是因为**跑在无头 Chrome 上**，
> 它注入的输入形态真机上压根不存在。
> 新增**通道③：Go 侧直接读系统剪贴板**（macOS 用 cgo + AppKit，已在真剪贴板上端到端跑通）。
> 本轮同时给仓库**补上了第一份 Go 测试**并接进 CI（此前零Go 测试，判据逻辑完全裸奔）。
> 详见 §2第十二轮。
>
> ✅ **2026-10-14 第十一轮：修掉首次真机验收的 5 项不通过**（详见 §2 第十一轮）。
> 第十轮把 §6 的 22 项目视清单做成了可执行产物（`docs/qa/visual-checklist.html` +
> append-only 的 `VERIFICATION-LOG.md` + 漂移守卫门禁）。**第一次真机验收立刻用它抓到
> 5 个真缺陷**：斜杠面板（中文输入法全角 `／` 匹配不上）、图片粘贴（Finder ⌘C 给的是
> file URL 而非图片数据）、打印（`window.print()` 在 WKWebView 是空操作）、
> 任务列表 + 表格（**根因是阅读态此前根本没有入口**，整个预览 pane 是不可达代码）。
> **测试 155 → 197**（全部真行为测试）；新增 `scripts/probe/probe-r11-fixes.mjs`
> （无头 Chrome 端到端，**18/18 通过**）；变异自证 5 方向，**其中 2 个方向暴露出
> 测试自身假绿并已修正**（见 §4 ⑱⑲）；顺带修好两条一直是红的门禁脚本（路径 bug）。
>
> ✅ **2026-10-13 第十轮：目视清单从「文档正文」变成「可执行产物」**（详见 §2 第十轮）。
> §6 的 22 项原先验完就忘、没有痕迹。现有三件产物：单文件清单 `visual-checklist.html`
> （勾选 / 存档 / 导出）、append-only 的 `docs/qa/VERIFICATION-LOG.md`、
> 以及守「清单副本 ↔ §6 真源」编号+标题漂移的门禁（已接进 CI 的 `docs-contract` job）。
>
> ✅ **2026-10-13 第九轮：清掉三笔债**（详见 §2 第九轮）：
> ① **文件树外部变更监听接线** —— 文档原记「`WatchDir` 未在 app.go 暴露所以
> `treeSignal` 空转」是**过时的错误说法**（`watcher.go` 与 `app.go` 同包，方法早已
> 暴露，绑定也在册）；真正缺的是**前端没订阅 `fs:changed` 事件**。本轮补上订阅
> （`shouldReloadTree` 纯函数守卫 + `window.runtime?.EventsOn?.()` 浏览器兜底），
> 后端顺带修了一个真实缺陷：切换/停止文件夹时旧监听的去抖定时器会推出**陈旧
> payload**（代际校验修复）。
> ② **`stripComments` 双实现收敛** —— 删除 `contracts.test.mjs` 局部版，统一
> `helpers/lexer.mjs`。实测第四处差异比登记的三处更尖锐：**局部版对正则字面量里
> 的引号/反引号全盲**（`commands.js` 的 `FENCE_RE` 一个反引号即假言入串，此后
> 成片注释没被剥掉 —— 实测两版对该文件输出 **37 行不同**，非空白字符数
> local 8378 / lexer 7209，差 1169）。收敛后契约行为零变化（14 个 .vue 逐字节比对证实）。
> ③ **导出字体偏好裁决**：不跟随（OPEN-DECISIONS 已关闭，未决项清零）。
> **测试 141 → 155**（新增 14 条，含 7 条经真实 `useFileOps()` 驱动的订阅行为
> 测试——stub `window.runtime.EventsOn` 捕获真实回调，不走正则模拟）。
>
> ✅ **2026-10-12 第八轮：给「表格没渲染」加了状态栏常驻提示**。
> 用户连续两次截图报「表格完全没渲染」——**实测确认不是缺陷**：他写的
> `|-ds-| --sd-|`（分隔行含字母）与 `|| ||`（压根没分隔行）都不满足 GFM，
> 解析器判为普通段落是正确行为，与 GitHub/Typora 一致。真正的缺陷是
> **它什么都不告诉用户**（典型的静默失败）。故新增提示而非改渲染：
> `editor/tableHint.js`（纯函数判定）+ `composables/useTableHint.js`（模块级
> 单例）+ `StatusBar.vue` 常驻提示条 + 三档 i18n。
> **测试 126 → 141**（新增 15 条，本仓**首次写真行为测试**：真 `EditorState`
> + `ensureSyntaxTree`，此前全是源码正则断言）；新增
> `scripts/probe/probe-table-hint.mjs`（CDP 真按键，**9/9 通过**）。
> 三个实测坑与一次「两条用例零覆盖」的教训见 §2 第八轮与 §4 ⑬⑭⑮。
>
> ⚠ **本轮再次撞上「因为错误的原因而通过」的测试**（老问题的第 9、10 次）：
> 围栏代码块与普通引用块两条用例当时全绿，但变异自证发现它们**根本没触到**
> 被测规则（代码块内容是 `CodeText` 不是 `Paragraph`；引用块第二行以 `>`
> 开头不是管道行）。换成三行形态才真正击穿。**全绿不等于覆盖**。
>
> ⚠ **README 已于 2026-10-12 全量重写**：旧版停更在第四轮之前，仍在宣传
> 双栏 / 滚动联动 / 原生菜单 / `App.vue` 1352 行等早已下线或已完成的内容，
> 且声称「图片、分割线可走斜杠面板」（实际面板只有代码块 / 表格 / 待办 /
> 引用四项）。接手时若发现 README 与代码不符，以代码为准并顺手修。
>
> ✅ **2026-10-11 已修两处缺陷，并已推送、CI 在 runner 上复绿**：
> 1. `frontend/dist/.gitkeep` 已按原内容（blob `dfdc095`）恢复并**重新纳入 git 跟踪** ——
>    之前 `8774a7e` 误删它导致干净 clone 编不过（`main.go:13` 的
>    `//go:embed all:frontend/dist` 报 `no matching files found`），CI `go` 门禁连红两次。
> 2. `preview/markdown.js:135` 的标题 `id` 属性引号已从中文弯引号换回 ASCII 直引号 ——
>    之前「插入目录」生成的 `#slug` 与渲染出的 `id=“slug”` 永远对不上，跳转静默失效。
>    同一提交里第 117 行注释的引号也一并还原。
>
> **GitHub 上已复绿**（run `38143580960`，2026-10-11T13:32Z，5 个 job 全 success，
> 含此前连红两次的 `Go 静态检查与编译`）；复验手段见 §8（真 clone `go vet` +
> 渲染锚点比对 + 契约 6 的变异自证）。同类问题此后再犯会被**契约 6** 拦住，见 §5。
>
> **两道元守卫也已落地**（§5 的盲区 1、2 从此有门禁：契约 6 共 5 条判据，
> 逐条做过变异自证），测试数 121 → **126**（25 个 suite）。
> ⚠ 契约 6 的「跟踪态」判据查的是 `git ls-files`（index）而非工作区，
> 所以 `npm run build` 把 `.gitkeep` 从磁盘删掉后本地仍绿 —— 这是有意的，
> 但意味着**它只在干净 clone（CI）里才真正验到磁盘形态**。
>
> ⚠️ **架构级变更（第四轮）仍然有效**：键位唯一真源从 `main.go` 的 `buildMenu()` 迁到了
> 前端 `frontend/src/composables/useShortcuts.js` 的 `COMMANDS` 表。
> 接手第一件事请读 §2 第五轮 与 §11「真源迁移对照表」（架构语境），第二件事读 §8。
> ⚠️ **App.vue 现在是 ≤150 行的纯装配层**（门禁硬上限），且**实测正好 150 行、零余量**：
> 新增行为一律先下沉到 composables/，别往 App.vue 加行 —— 加 1 行契约 5 就报红。

---

## 0. 三十秒上手

```bash
cd /Users/aftery/Desktop/myapp/inkmark

# 门禁全跑一遍（约 2 分钟，与 CI 口径一致）
cd frontend && npm test; cd ..          # 期望 221/221
node scripts/verify/verify-shortcuts.mjs    # 快捷键契约，期望退出码 0
node scripts/verify/scan-i18n-residue.mjs   # i18n 文案残留，期望退出码 0
node scripts/verify/verify-visual-checklist.mjs  # 目视清单副本 ↔ §6 真源，期望退出码 0
./scripts/p0-check-emoji.sh frontend/src main.go app.go   # P0 零 emoji，期望退出码 0
# ↓ 这两个不在 CI（2026-10-14 发现它们因路径 bug 一直红着 —— 手动跑才有价值）
node scripts/verify/scripts-verify-icons.mjs        # 图标↔ phaseC 规格逐字比对，期望 24/24、退出码 0
node scripts/verify/scripts-verify-theme.mjs        # theme.js 优先级自检，期望 8/8、退出码 0
/usr/local/opt/go/bin/go vet ./...           # 注意：go 不在 PATH。⚠ 本机必绿（dist 有产物），别把它当「仓库编得出来」的证据
CGO_ENABLED=1 /usr/local/opt/go/bin/go test ./...   # Go 测试（2026-10-15 起CI 才跑；e2e 用例剪贴板为空时 skip）
CGO_ENABLED=0 GOOS=linux   /usr/local/opt/go/bin/go build -o /dev/null .   # 通道③ Linux 适配层不腐烂
CGO_ENABLED=0 GOOS=windows /usr/local/opt/go/bin/go build -o /dev/null .   # 通道③ Windows 适配层不腐烂
node scripts/smoke/render-check.mjs         # 真渲染冒烟（需先 npm run build），期望 PASS

# 交互探针（验「静默失败」类缺陷，render-check 覆盖不到）
# ⚠ vite 冷启动约 18s；且沙箱内后台任务起不来 vite，须在同一条命令里
#   (vite &) → 轮询 ready → 跑探针 → pkill
cd frontend && npx vite --port 5599 --strictPort   # 另开终端起 dev server
cd .. && node scripts/probe/probe-slash.mjs         # 斜杠面板：输入 / 后按 Enter 是否真插入
node scripts/probe/probe-wysiwyg.mjs               # 表格/分割线/图片装饰是否产出 DOM
node scripts/probe/probe-theme.mjs                 # 暗色下各区域实际计算色
node scripts/probe/probe-table-hint.mjs            # 表格提示：缺分隔行时出现、改对后消失
node scripts/probe/probe-r11-fixes.mjs             # 第十一轮修复：全角／/ file URL 粘贴 / ⌘P（⌘E 阅读态 5 项已随阅读态移除退役）

# 构建 + 启动
# ⚠️ 在 WorkBuddy 沙箱内跑会被 safe-delete shim 拦（vite 的 emptyDir 触发熔断）→ 需提权
PATH=/usr/local/opt/go/bin:$HOME/go/bin:$PATH ~/go/bin/wails build
# ⚠ 构建完成要 35-60 秒，产物在 build/bin/inkmark.app —— 别在构建完成前就 ls 它
open build/bin/inkmark.app
# ⚠ vite/wails build 会清空 frontend/dist/，把 .gitkeep 一起删掉（2026-10-11 实测复现）。
#   每次 build 后复位：git checkout -- frontend/dist/.gitkeep
#   （它现在重新被跟踪了，所以这条命令有效；`8774a7e` 误删期间会报 pathspec 不匹配）
#   ⚠ 本地就算忘了复位也验不出后果（本机 dist 有产物）—— 只有干净 clone 才炸。
```

**接手时先确认三件事**（本项目最常见的坑）：
1. `go` **不在 PATH**，用 `/usr/local/opt/go/bin/go`
2. shell `grep` 在本仓 UTF-8 文件上**会静默返回空**，且**会匹配注释里的代码**
   → 排查代码一律用专用检索工具（Read/Grep），不要用 shell grep 下结论
3. **本地 `go vet` 绿不代表仓库编得出来**（本机 `frontend/dist` 有产物）。
   涉及 embed / gitignore / 构建产物的改动，一律用干净 clone 复验 —— CI 曾在
   `6bdf3d6`/`f1343eb` 两次栽在这条上（`8774a7e` 误删 `frontend/dist/.gitkeep`），
   2026-10-11 已修并复验，见 §8

---

## 1. 项目是什么

跨平台桌面 Markdown 编辑器。Wails v2.16（Go 壳）+ Vue 3 + Vite 6 + CodeMirror 6。
GitHub 远端 `Aftery/Inkmark`，`main` 与 origin 同步（`18c2f28`），工作区干净。

### CI 状态（2026-10-11 用公开 API 实测，非回忆）
| HEAD | 结论 |
|---|---|
| `5ad7434` / `21771c7` / `a105c51` | **success**（5 道门禁全绿，实证「本地绿 ≠ runner 绿」这一关可过） |
| `6bdf3d6` / `f1343eb` | **failure** —— 只有 `Go 静态检查与编译` 红，step 是「静态检查」 |
| `18c2f28`（本轮 5 个提交） | **success**（run `38143580960`）—— 5 个 job 全绿，`Go 静态检查与编译` 的「静态检查」「编译」两步都过 |

根因（已在 `/tmp` 干净 clone 上 `go vet` 复现，报错一字不差）：
`main.go:13:12: pattern all:frontend/dist: no matching files found`，即 `8774a7e`
删掉 `frontend/dist/.gitkeep` 所致。**其余四道门禁在最新提交上仍是绿的**，
所以这不是环境漂移（Node 版本 / lockfile 一致性已确认没问题），是仓库自身的回归。

> **状态（2026-10-11）**：占位文件已恢复并重新跟踪，`go vet`/`go build` 在真 clone 上
> 均退出码 0（复验方法见 §8），并且**已推送到 origin/main**，`18c2f28` 的 run 全绿。
> 中间那两行 failure 是修复前的历史记录，保留在此是为了说明「本地绿 ≠ runner 绿」这条
> 教训的来由 —— 而不是当前状态。
> ⚠ runner 日志要 admin 权限才能下载（`/actions/runs/{id}/logs` 返回 403），
> 所以「runner 上跑了 126 条」这一步是**推断**（HEAD 含契约 6、该 job 绿），
> 不是从日志里读出来的。

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
                   ⚠ 第 13 行 `//go:embed all:frontend/dist` 要求 dist 目录存在（哪怕只有 .gitkeep）
app.go             暴露给前端的 Go 方法（文件读写/剪贴板/图像/版本/检查更新/关闭）
                   OnBeforeClose：关闭守卫对 Linux/GTK 已容错（返回文本 / "0"/"1" / 空串三种形态，
                   **只有明确命中「不保存退出」或 "1" 才放行**，其余一律视为取消）
                   图片三通道入口：SaveImage（数据）/ SaveImageFromPath（file URL）/
                   **SaveImageFromClipboard（系统剪贴板，通道③）**
clipboard_image.go ** 通道③ 的平台无关判据：魔数嗅探「什么字节才算图片」+ SVG 文本判定
clipboard_darwin.{go,m,h}  通道③ macOS 适配层（NSPasteboard → PNG，**cgo**）
clipboard_linux.go       通道③ Linux 适配层（xclip / wl-paste，带硬超时）⚠ 未真机验证
clipboard_windows.go     通道③ Windows 适配层（CF_DIBV5/CF_DIB/CF_HDROP）⚠ 未真机验证
clipboard_other.go       通道③ 其余平台兜底（恒返回空 → 优雅降级，保证任何 GOOS 都能编）
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
    useFileAssets.js     图片粘贴拖拽落盘（**三通道**：File 数据 / file URL / 系统剪贴板③，
                          都归一到 Go SaveImage* → assets/ 相对路径）
    useCommands.js       ** 命令处理器注册面（registerCommands + 菜单结构 + Esc 路由）**
    useWorkspace.js      视图两态 / 专注 / 侧栏 / 打字机 / 窗口置顶
    usePlatform.js       平台识别（Environment 权威 + navigator 同步初判）
    useToast.js          轻提示
    useOutline.js        大纲高亮 + 跳转（自持度量失效：resize / 视图切换）
    useTableHint.js      表格未渲染提示（**模块级单例**：useEditorSession 写、StatusBar 读，
                         不经 props —— App.vue 是 150 行硬上限，加不了行）
    useDialog / useFileOps / useShortcutsHelp
  components/      TitleBar（跨平台）/ Sidebar / SlashCommand / StatusBar /
                   HistoryPanel / SettingsPanel / InputDialog / ShortcutsDialog /
                   AboutDialog / FileTree / Outline / SegmentedControl …
  editor/          createEditor / commands / wysiwyg / outline /
                   slashCommand（斜杠面板 CM 扩展）/ imageDrop / sampleDocs /
                   tableHint（表格未渲染检测，**纯函数**；⚠ 不可进 wysiwyg.js 的 block 装饰）
                   markdownHighlight.js   ** codeLanguages 必须返回 `.language`**（见 §4 ⑨）
  preview/         markdown.js（markdown-it + highlight.js：**79 种语言**、
                   GFM 任务列表 markdown-it-task-lists、标题 id 由 anchors.js 生成）
                   ⚠ 标题 id 的引号必须是 ASCII 直引号（2026-10-11 修过一次弯引号污染）
  themes/          editor-wysiwyg.css 是 `.cm-md-*` 的唯一定义处（勿写进 CM theme，会顶破棘轮）
  tests/           221 条测试（node:test，零依赖）
                   ⚠ 第八轮起含**真行为测试**（真 EditorState + ensureSyntaxTree），
                     此前全是源码正则断言 —— 详见 §2 第八轮
                   ⚠ 第十一轮起 keymap 接线 pin 也用**真扩展 + 真 keyName + 真 run**
                     驱动（源码正则连「注释掉的绑定」都抓不到，见 §4 ⑲）
                   ⚠ 第十二轮新增 image-clipboard（通道③）；⚠ 探针跑在无头 Chrome 上，
                     **剪贴板语义 ≠ WKWebView**，别拿探针全绿当真机可用（见 §4 ⑳ ㉑）
                   契约 6 = embed 占位文件跟踪态 + 标题锚点引号形态（2026-10-11 新增）
  （Go 侧测试在仓库根：clipboard_image_test.go 判据 / clipboard_e2e_test.go 真剪贴板）
scripts/
  emoji-pattern.mjs        P0 emoji 正则唯一真源
  p0-check-emoji.sh        薄封装（Node 实现）
  verify/parse-main-menu.mjs   main.go 菜单真源解析（共享）
  verify/verify-shortcuts.mjs  键位文档契约（CI 门禁）
  verify/scan-i18n-residue.mjs  i18n 文案残留（CI 门禁）
  verify/verify-i18n-switch.mjs 真浏览器三语切换（手动跑）
  verify/scripts-verify-icons.mjs  图标 SVG 与 phaseC 规格逐字比对（手动，不在 CI）
  verify/scripts-verify-theme.mjs  theme.js 优先级逻辑自检（手动，不在 CI）
  smoke/render-check.mjs    真渲染门禁（dev + dist 双路径）
.github/workflows/ci.yml     5 道门禁
docs/spec/                   契约文档（见下）
```

---

## 2. 各轮做了什么（第一~十二轮；第七轮为 2026-10-11 按 git show 回补）

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
| `useCommands.js` | `registerCommands`（处理器注册面；命令表现为 **55 条**，第五轮时 54，第七轮加 `file.settings`）+ `menuGroups` + 全局 Esc 分层路由 |
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
   阅读态高亮/跳转静默退化为「不算」。当时由 App.vue 装配时注入 `previewEl`。
   （2026-10-14：阅读态整体移除，渲染收敛进编辑器内的表格真渲染，该注入点随之退役。）
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

### 第七轮：Linux 关闭守卫 + 代码高亮根因 + 标题栏拖拽（`1b645ee`…`f1343eb`，2026-10-07）

> 本轮**没写进 HANDOFF 就提交了**，本节是 2026-10-11 按 `git show` 逐commit 回补的。

四条改动：
1. **Linux/GTK 关闭守卫容错**（`app.go`）：系统确认框的返回值可能是按钮文本、按钮索引
   （`"0"`/`"1"`）或空串。原写法 `return choice != "不保存退出"` 在返回索引的平台上
   会把「取消」当成放行 → 直接丢未保存内容。现改为 switch，只有命中「不保存退出」或
   `"1"` 才放行，`default` 一律阻止关闭。
2. **设置入口进命令表**：`useShortcuts.js` 加 `file.settings`（⌘,）、`useCommands.js`
   接处理器（自绘标题栏当时没有设置入口）；README 快捷键表在 `21868e6` 同步。
3. **GFM 任务列表 + 高亮语言扩容**：`preview/markdown.js` 接 `markdown-it-task-lists`，
   highlight.js 注册语言从 22 扩到 78（仍是按需 `import .../lib/languages/x`，不引全量包）；
   编辑器侧补 `@codemirror/lang-java`（`8774a7e`）与三语 `menu.settings` key。
4. **三个静默失败 + 一处真机交互回归**（下表）。

| # | 现象 | 真因（实测/源码核实，非推断） | 提交 |
|---|---|---|---|
| 1 | 围栏代码块在编辑区完全没有颜色 | **两处叠加，只修一处没用**。(a) `codeLanguages` 回调返回了 `LanguageSupport`，而 lang-markdown 的 `getCodeParser` 取的是 `found.parser`；`LanguageSupport` 没有 `.parser` → **静默退化为纯文本**。正解是返回 `support().language`。(b) `syntaxHighlighting(mdHighlight, { fallback: true })` 与 `defaultHighlightStyle` 并列时，`getHighlighters` 的语义是 `main.length ? main : fallback` —— 有主样式就把 fallback 整体跳过；且默认色板与预览区 `--hl-*` 不同源（违反单一色板原则）。现只注册 `mdHighlight` | `f1343eb`（`8774a7e` 的 Java 语言包没治到根因） |
| 2 | 真机反馈「无边框平台窗口不能拖动」 | `--wails-draggable: no-drag` 被加在 `.tb-left` / `.tb-right` **布局容器**上。Wails 的 dragTest 只读 `e.target` 的计算值，而自定义属性**会向下继承** → 容器自身占据的 1fr 空白区也变成非拖动区。改为白名单式：root 保持 `drag`，只有 `.tb-menu-btn / .tb-dropdown / .tb-item / .tb-win` 逐个 `no-drag` | `f1343eb` |
| 3 | 关闭按钮的调用形态不可靠 | 原写法 `window.go?.main?.App?.CloseWindow?.()` 一路可选链——绑定名/形态不符时**静默 no-op**，点了没反应也不报错。改为从 `wailsjs/go/main/App` 具名 import `CloseWindow`，浏览器预览下用 `try/catch` 兜住（这里 catch 只兜「不在 Wails 环境」，不是兜业务失败） | `793838e` |
| 4 | 围栏底色与预览区不同源 | `.cm-md-codeblock` 用 `--bg-2` → 改 `--surface-warm`；`793838e` 另补了引用块 / 代码块的 `.cm-md-*` 装饰样式 | `f1343eb` |

**本轮欠下的两笔债（2026-10-11 均已修，见 §8 的复验记录）**：
- `8774a7e` 顺手删了**被跟踪的** `frontend/dist/.gitkeep`（`.gitignore` 用
  `frontend/dist/*` + `!frontend/dist/.gitkeep` 保它）→ 干净 clone 没有 dist 目录 →
  `//go:embed all:frontend/dist` 编译不过 → CI `go` 门禁连红两次。
- `1b645ee` 把 `preview/markdown.js:135` 的 `id="…"` 两个**直引号写成了中文弯引号**
  （同一提交里连注释中的 `"quotes"` 也被替换，说明是编辑器/输入法所致）。标题 id 从此
  带 `“ ”`，「插入目录」生成的 `#slug` 链接全部落空。
- **这两个当时都没被 121 条测试和其余 4 道门禁抓住**：embed 目录存在性不在测试口径内，
  标题锚点跳转根本没有门禁。与 §5「假绿灯」同族 —— 覆盖面之外的绿等于没绿。
  （2026-10-11 已由**契约 6** 收口，见 §5 与 §8；历史结论保留在此处，是为了记住
  「绿过一次」并不等于「验到了」。）

### 第八轮：表格未渲染提示 + README 全量重写（2026-10-12）

**起因**：用户两次截图报「表格完全没渲染」。**实测确认不是缺陷** ——
用编辑器同款解析器验证：`|-ds-| --sd-|` 的分隔行含字母（GFM 只允许 `-` 与
首尾 `:`）、`|| ||` 压根没有分隔行，两段都判为 `Document→Paragraph`，
markdown-it 同样输出 `<p>`。合法表格对照则产出全套 `Table*` 节点。
**真正的缺陷是它什么都不告诉用户** —— 标准行为，但本仓对待静默失败的立场
是「要么提示，要么别让用户撞」。

**新增 4 个文件 + 3 处接线**：
| 文件 | 职责 |
|---|---|
| `editor/tableHint.js`（92 行） | 纯函数 `detectSuspectTable(state)`：顶层 `Paragraph` + 连续 ≥2 行 `pipeRow` → 疑似未渲染，返回 `{line, lines}` |
| `composables/useTableHint.js`（53 行） | 模块级单例（与 `usePlatform` 同构）+ `checkTableHint` / `clearTableHint` |
| `tests/table-hint.test.mjs`（15 条） | **本仓首次真行为测试**（真 `EditorState`，此前全是源码正则断言） |
| `scripts/probe/probe-table-hint.mjs` | CDP 真按键探针，9/9 通过 |

**两个架构约束决定了方案形状（勿"优化"掉）**：
1. **不能进 `wysiwyg.js`**：该文件头明令「绝无 block 装饰」（CM6 抛 RangeError），
   插不进提示行；且它只负责渲染装饰，不该承担诊断职责。
2. **不能走 props 串联**：`App.vue` 是 ≤150 行硬上限且零余量，故用
   「模块级 ref + 组件直接 import」（先例：`TitleBar` import `isDarwin`）。
3. **不用 toast**：3200ms 自动消失，而这是「用户没察觉」的问题，提示必须常驻。

**接线要点**：`onEditorUpdate` 调 `checkTableHint`；`syncAfterDocReplace`
必须**手工补算**（`replaceDocument` 走 `setState` 不触发 updateListener，
否则切文档后上一份的提示会残留）；`onBeforeUnmount` 必须 `clearTableHint`。

**本轮再次撞上「因为错误的原因而通过」（老问题第 9、10 次）**：围栏代码块与
普通引用块两条用例当时全绿，但变异自证发现它们**根本没触到被测规则** ——
代码块内容是 `CodeText` 而非 `Paragraph`（压根进不到判定）；引用块第二行以
`>` 开头不是 `pipeRow`（被另一条规则挡掉）。换成**三行形态**才真正击穿顶层判定。
**教训：断言全绿不等于规则被覆盖；要问「它是因为哪一条规则才通过的」。**

**顺带清理**：`8774a7e` 把临时验证文件 `test-highlighting.md` 提交进了仓库，`6bdf3d6` 删除；
工作区现已无残留。

---

### 第九轮：文件树外部变更监听接线 + stripComments 收敛 + 导出字体裁决（2026-10-13）

**起因**：盘点 §7 未决项后，按「价值 × 风险」优先级清三笔债。走专家团精简路径
（存量维护，跳过调研/PRD/设计，门禁一道不减），开发与独立验证分离。

**① 文件树外部变更监听（`treeSignal` 空转）——先纠正一个文档谎言**

HANDOFF/README 原记「Go 侧 `WatchDir` 未在 app.go 暴露，故 `treeSignal` 从不自增」。
**实测该说法不成立**：`watcher.go`（`dd86e96` 引入）与 `app.go` 同属 `package main`，
`WatchDir` 方法早已暴露，`frontend/wailsjs/go/main/App.js:77` 绑定也在册，
`useFileOps.js` 也早已调用。**真正缺的是前端没有任何代码订阅 `fs:changed` 事件**。

| 文件 | 改动 |
|---|---|
| `composables/useFileOps.js` | 新增导出纯函数 `shouldReloadTree(payload, folderPath)`（严格相等 + 非空 + 类型守卫，不归一化——同源字符串不可能有斜杠差异，容忍它只会放进别处事件）；setup 内 `window.runtime?.EventsOn?.('fs:changed', cb)` 订阅，仅当 `payload === folderPath.value` 时 `treeSignal.value++`；修正第 44 行过时注释 |
| `watcher.go` | 修真实缺陷：去抖回调原来只校验 `a.ctx != nil`，**不校验监听是否仍存活**——切换/停止文件夹时旧监听残留的 250ms 定时器会把已失效目录推给前端（陈旧 payload → 刷新错误的树）。改为代际校验：取消旧监听与 `watchGen` 自增在同一把 `watchMu` 临界区内，`fire` 读代号走同一把锁 —— **临界区内无中间态**。**残余（QA 复验指出，如实登记）**：`fire` 在解锁之后才 `EventsEmit`，属读-后用非原子，理论上仍可能发出一次陈旧事件；功能上由前端 `shouldReloadTree` 守卫兜底，即前文所称「双防线」 |
| `tests/watcher-wiring.test.mjs`（新，14 条） | 5 条纯函数守卫语义 + **7 条经真实 `useFileOps()` 驱动的订阅行为**（stub `window.runtime.EventsOn` 捕获真实回调，不走正则模拟）+ 2 条跨文件事件名集合比对契约 |

**为什么订阅点不退订**：runtime 的 `EventsOff(eventName)` 会摘掉该事件**全部**回调，
将来若有第二个订阅者会被误伤；本监听与 app 同生命周期，不退订是有意为之。
**为什么不用具名 import `wailsjs/runtime`**（HANDOFF P3 原建议，已证伪）：
该绑定展开为 `window.runtime.EventsOnMultiple(...)` 直取，浏览器预览（vite dev 无
Wails runtime）下必抛。可选链兜底只出现在**已知的环境分支**上，符合 §4 ⑫ 的判据。

**② stripComments 双实现收敛（§7 登记的债）**

`contracts.test.mjs` 局部版（契约 3 的 `collectPrintBlocks` 在用）删除，统一
`helpers/lexer.mjs` 版（-89 行；契约 6 原本就用它，仅去别名）。
**收敛前实证**：对契约 3 实际扫描的 14 个 .vue 逐字节比对两份实现输出——**0 差异**；
契约 6 只是改名。全 src 树 49 个文件中 3 个有差异（`useEditorSession.js` /
`commands.js` / `exporters.js`），方向全部是**局部版该剥没剥**。
除 §7 已登记的三处差异，本轮实测到**第四处更尖锐的**（见 §4 ⑯）。

**③ 导出字体偏好裁决**：OPEN-DECISIONS 关闭为**不跟随**（导出物是分发格式，
把作者本地偏好写死进 HTML/PDF 会让排版随机器漂移；保持主题级 `--font-body`
才能任何机器导出一致）。实现零改动，未决项登记册清零。

**验证**：`npm test` 141 → **155/155**；p0-emoji / i18n 残留 / verify-shortcuts /
`go vet` / `go build -o /dev/null ./...` 全过；`wails generate module` 绑定零 diff
（仅 runtime.js 权限位 100644→100755，已 chmod 复位）；变异自证两侧各一次
（前端订阅名改错 → 行为 + 契约测试双红；Go 侧事件名改错 → 契约测试红）。
**独立验证者**（QA）另做复验，不采信开发自检结论。

**QA 复验判定 fail，并当场抓到一处「测试假绿灯」（本项目头号敌人）**：
`watcher-wiring.test.mjs` 里两条「浏览器预览兜底」用例**形同虚设** —— 它们先在
用例内设 `globalThis.window = {}`，**再**调 `mountOps()`，而 `mountOps()` 无条件
把 window 重设成带 `runtime.EventsOn` 的形态，前置条件被瞬间覆盖，缺失 runtime
的路径**从未真正进入**。QA 的判定性实证：把 `useFileOps.js` 的
`window.runtime?.EventsOn?.(…)` 改成无兜底的直取（真机浏览器必抛），这两条用例
**依然 2 pass**。修法：把「形态」提为 `mountOps({ installRuntime })` 显式入参
（`full` / `no-runtime` / `no-eventson`），并补「订阅数必须为 0」的断言；
修后同样注入 → **2 fail**，还原后 14/14 绿。
**教训（§4 ⑰）：helper 里的无条件初始化会静默覆盖用例的前置条件 —— 失败路径
测试必须让「失败条件」成为被测函数的显式入参，而不是用例里的一次全局赋值。**

QA 另指出 3 处文档数字失真（README suite 数 29→实测 31、HANDOFF 两处 141/28 旧值、
`commands.js` 差异「300+ 行/全部」实为 37 行）与 1 处措辞需打折（`fire` 的
read-then-act 非原子），均已按实测改正（见上文与 §4 ⑯）。

---

### 第十轮：真机目视清单做成可执行产物，并把「清单漂移」接入 CI（`f535f93`，2026-10-13）

**起因**：§6 那 22 项「只能在真机肉眼确认」的清单原先只是文档正文 —— 验完就忘、
没有痕迹，下次接手不知道哪几项验过、在哪个平台、结论如何。这与「恒绿的假用例」
是同一类病：**没有痕迹的验证 = 无法与「没验过」区分**。

| 产物 | 作用 |
|---|---|
| `docs/qa/visual-checklist.html`（971 行） | 单文件零依赖、双击即开。22 项逐项勾选 + 结论（未验/通过/不通过/不适用）+ 备注；平台/验证人/日期；进度汇总；localStorage 自动存档；导出 Markdown 回填仓库。颜色全走 Token（文件内镜像 design-tokens 亮/暗两套并注明同步义务），零字面色值、零 emoji |
| `docs/qa/VERIFICATION-LOG.md`（66 行） | **append-only** 记录「验过什么、结论如何」（§6 是「要验什么」）。含空模板，**不预填任何验证结果** |
| `scripts/verify/verify-visual-checklist.mjs`（204 行） | 清单副本 ↔ §6 的（编号, 标题）集合同步守卫。退出码 0=一致 / 1=漂移 / 2=解析器失效（**不可采信，绝不当作通过**） |

CI：`ci.yml` 的 `docs-contract` job 追加该守卫为第二步；顺带校正顶部那份
「写着三条、实际五条」的门禁清单。
**验证**：实现者两次变异自证（两侧各改一处 → 报红 → 逐字还原）；独立验证者（QA）
另补 4 个方向（HTML 侧改标题 / HTML 多一项 / JSON 非法 / JSON 空数组 → 退出码
**1 / 1 / 2 / 2** 全部符合预期），并查明标题比较是逐字 `!==`（仅 trim 首尾）。

**第一次真机验收随即用上它**：2026-10-13 macOS / aftery，**18/22 已验、13 通过、
5 不通过**（首次记录见 `docs/qa/VERIFICATION-LOG.md`）。这 5 项就是第十一轮的全部内容 ——
**这份清单第一次跑就抓出了 5 个真缺陷**，其中两项（#19/#20）是**清单自己暴露了不可达代码**，
见下。

---

### 第十一轮：修掉 2026-10-13 真机验收的 5 处不通过（2026-10-14）

**起因**：`docs/qa/VERIFICATION-LOG.md` 首次记录 5 项不通过。五条的旧形态**全是静默失败**
——不抛异常、构建通过、原有 155 条测试全绿。用户可见症状与根因如下。

| # | 用户原话 | 根因（钉死后的形态） | 修法 |
|---|---|---|---|
| 7 | 斜杆没反应 | keymap 只绑半角 `'/'`。中文输入法**中文标点模式**下 `/` 键产出全角 U+FF0F（`'／'`），`w3c-keyname` 对非 ASCII 可打印字符原样返回 → 永远匹配不上 | keymap 增绑 `key: '／'`；另加 `maybeOpenFromInserted` 兜底：输入法若走 composition/insertText 不产生可匹配 keydown，就从「刚插入的单个斜杠字符」反推开面板 |
| 8 | 复制图片后，过来黏贴只是文件名 | Finder 里 ⌘C 一个图片文件，剪贴板是 **file URL**（`text/uri-list`，部分应用只给 `text/plain`），**`dt.files` 是空的**。只认 `image/*` File 的实现把它放给浏览器默认行为 → 文件名被当文本插入 | `imagePathFromDataTransfer` 认 file URL → `App.SaveImageFromPath` 让 Go 读盘落库（webview 里 `fetch(file://)` 被跨源策略拦死，前端根本读不到）；两条通道归一成一个 `onImageFile` 回调，按 `typeof` 分流 |
| 13 | 快捷键没反应，菜单里面点击打印也没反应 | `window.print()` 在 Wails 的 WKWebView 里是**空操作**（无报错、无窗口） | `file.print` 改走 `docState.exportPdf()`（⌘P 与菜单同一命令处理器，两侧一起修好） |
| 19 / 20 | 预览效果没有 / 表格未渲染（导出可以） | **阅读态此前没有任何入口**：`toggleReading()` 只有 Esc 出口，没有命令、没有键位、没有菜单项 → `v-show="viewMode === 'reading'"` 的整个预览 pane 是**不可达代码**。导出能出，是因为导出读的是同一份 `previewHtml`，经隐藏在视口外的 `.export-preview` 渲染 —— 与阅读态 pane 无关 | 新增 `view.reading` 命令（分组 view）+ ⌘E；三语补 `menu.reading` / `shortcuts.reading`，删孤儿 `shortcuts.viewModes`（命令 55→56） |

**#20 的附带修复（畸形 HTML）**：`markdown-it-task-lists` 在 `enabled: true` 下
`disabledAttr` 是空串，输出的 `<input>` **缺一个空格** ——
`<input class="task-list-item-checkbox"type="checkbox">`。Chrome/WebKit 按 HTML5
规范容错解析（`--dump-dom` 实测勾选框正常渲染），但这是**依赖容错的畸形 HTML**：
换 stricter 的解析器或将来接净化器就会静默丢掉 `type`。`html: false` 下 `html_inline`
token 只可能来自该插件，故在 `preview/markdown.js` 定点补空格，**不动 node_modules**。

**新增测试（155 → 197 条，全部真行为，无源码正则）**

| 文件 | 条数 | 驱动方式 |
|---|---|---|
| `tests/image-paste.test.mjs` | 21 | `imagePathFromDataTransfer` 纯函数边界 + `imageDropHandlers` 双通道（stub view/event）+ `useFileAssets` 落盘（`goForm` 显式入参：`full`/`no-api`/`partial`，遵 §4 ⑰） |
| `tests/preview-markdown.test.mjs` | 8 | **真渲染器**输出比对：勾选框两种状态的 HTML 合法、label 包装、普通列表不受影响、表格/标题 id/slug 去重回归 |
| `tests/slash-fullwidth.test.mjs` | 11 | `maybeOpenFromInserted` 由**真 ChangeSet**（`state.update`）驱动 + 假 host；keymap 由**真扩展 + 真 `keyName` + 真 `run`** 驱动（见 §4 ⑲） |

**端到端探针**：`scripts/probe/probe-r11-fixes.mjs`（**18/18 通过**）在无头 Chrome 里对
五条路径逐条复现：全角 `／` 真实按键 + `Input.insertText` 兜底路径 + 半角回归 /
未落盘文档粘贴的「先保存」提示（断言**不调 Go、文档不被插入**）/ ⌘O 打开文档后
file URL 粘贴 → `SaveImageFromPath` 收到解码后的 `/Users/me/Pictures/截图.png` /
普通文本粘贴不被拦截 / ⌘P → Go `ExportPDF` / ⌘E 进阅读态后**真 DOM 断言**（2 个
`input[type=checkbox]`、1 个已勾选、真 `<table>` 含 2 个 `<th>`）+ ⌘E 再按退出。
**两个探针自身装配的坑（踩过就知道）**：① `getAppApi()` 的判据是
`window.runtime && window.go`，stub 只装 `window.go` 会让 ⌘P 静默退回 `window.print()`
分支 → 探针假红；② 图片落盘有「先保存」守卫，不先经 ⌘O 打开文档，`SaveImageFromPath`
根本不会被调用（**这是正确行为**，已改成独立的正向断言）。

**变异自证（5 个方向，逐条注入 → 报红 → 逐字还原；每步核对 `node` 退出码）**

| 变异 | 期望变红 | 实测 |
|---|---|---|
| 删 `text/uri-list` 分支 | 通道 ② 用例 | ✅ exit 1（4 条 subtest fail） |
| 删 `saveImageFile` 的字符串分流 | 「两条落盘通道」suite | ✅ exit 1 |
| 双通道守卫只查一个绑定（`partial` 形态） | 「旧绑定形态」用例 | ❌ **假绿** → 见下 |
| 删「先保存」守卫 | 「文档未落盘」用例 | ✅ exit 1 |
| 删 `html_inline` 补空格规则 | 勾选框 HTML 合法性用例 | ✅ exit 1 |
| 删全角 `'／'` 绑定 | keymap 接线 pin | ❌ **假绿** → 见下 |

**本轮最大的收获：变异自证抓出两个「假绿灯」**（两个方向注入后测试仍全绿，即
测试根本守不住它声称守的东西）：
- 「旧绑定形态」用例**只断言了 toast 条数**（`length === 1`）。少校验一个绑定时，
  调用不存在的方法抛 TypeError 被 `catch` 成 `imageFailed`，**条数同样是 1** —— 用户
  看到的其实是「插入图片失败：…」而不是「当前环境不支持」。补
  `assert.match(toasts[0].msg, /不支持/)` 后立刻红。
- keymap 接线 pin 是**源码正则** `assert.match(code, /key: '／'/)`。把绑定行**注释掉**后，
  正则照样匹配注释文本 → 假绿。改成**真实扩展驱动**：从 `EditorState` 的 `keymap` facet
  取回 CM 真正会用的绑定表（摊平方式与 `@codemirror/view` 内部 `getKeymap` 逐字一致），
  用 `w3c-keyname` 的**真** `keyName` 解析按键、调**真** `run`。删绑定即红。
  （两条教训已登记为 §4 ⑱ / ⑲。）

**顺带修好两条一直是红的门禁**：`scripts-verify-icons.mjs` 与 `scripts-verify-theme.mjs`
（原在 `scripts/`，搬进 `scripts/verify/` 后 `./docs/…`、`./frontend/…` 相对路径没跟着改）
→ `ENOENT` / `MODULE_NOT_FOUND`，**一直红着**，谁都没发现。改用与其他门禁一致的
`ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')` 约定后：
图标 **24/24 逐字一致**、主题 **8/8 断言通过**（内容侧本来就是对的，纯粹是路径 bug）。

**验证汇总（全部真实退出码）**：`npm test` 155 → **197/197**（39 suites）；
7 个 `verify/*.mjs` + `p0-check-emoji.sh` **exit 全 0**；`go vet ./...` exit 0；
`wails build` 成功（1m25s，产物 `build/bin/inkmark.app`，构建后已复位
`frontend/dist/.gitkeep`）；`wails generate module` 重新生成绑定（新增
`SaveImageFromPath`，runtime 侧仅权限位差异已 chmod 复位）。

---

### 第十二轮：通道③ —— 上一轮的 #8 修法根因是错的，真机复验再次失败（2026-10-15）

用户 2026-10-15 复验结论：**「复制的图片只有名称」依旧**，其余复验项通过。
这一轮把 #8 从根上重做——**上一轮（第十一轮）对 #8 的根因判断是错的**。

#### 上一轮错在哪

第十一轮认定「macOS 复制文件时剪贴板里只有 file URL（`text/uri-list`）」，
据此新增了 Go 的 `SaveImageFromPath` + 前端 `imagePathFromDataTransfer`（通道②）。
**这个根因在真机上从未成立过**，于是通道② 是个从未被执行过的分支。
错因有二，都值得记住：

1. **推断出来的，没测过**。当时没有人在真机上 dump 过一次剪贴板内容。
2. **探针跑在无头 Chrome 上**（`scripts/probe/` 用 CDP 连 Chrome）。
   Chrome 的剪贴板实现与 WKWebView **不同**：Chrome 会给 `files` / `file://`，
   WebKit 不会。探针注入的 `DataTransfer` 里手工塞了 `text/uri-list`，
   于是「18/18 全绿」——**它验证的是一个真机上不存在的输入形态**。
   这是「假绿灯」的第 5 次，但**成因全新**：不是断言写错，而是**验证环境与真机内核不同构**。

#### 真机证据（这次先取证再动手）

```
$ osascript -e 'clipboard info'
«class PNGf», 51779, «class 8BPS», 239892, GIF picture, 13827,
«class jp2 », 46868, JPEG picture, 39040, TIFF picture, 2215488, ...
$ pbpaste            # 空 —— 没有任何 file:// URL
```

剪贴板里是**纯图片数据**，**根本没有 file URL**。而用户看到的症状是
**文件名文本** `1643208705644.jpg` 被插进文档。因果链因此闭合：

> WKWebView（Safari 内核）**不把剪贴板图片暴露给 `clipboardData`** ——
> 无 `files`、无 `items`、也不在 `text/uri-list` 里给 `file://`，只有 `text/plain`
> 里的文件名。于是通道①② 全部落空→ 事件交回 WebKit 默认处理 →
> **默认行为就是把文件名当纯文本插入**。全程无异常、无日志。

#### 修法：新增通道③（Go 侧读系统剪贴板）

剪贴板的二进制内容在 webview 里**没有任何合法途径**读到
（`fetch(file://)` 被跨源策略拦死；`navigator.clipboard.read()` 无权限且异步，
paste 事件里等不到），只有进程内的原生剪贴板 API 能拿。故新增：

| 文件 | 职责 | 平台 |
|---|---|---|
| `clipboard_image.go` | **纯逻辑**：魔数嗅探（什么字节才算图片）+ SVG 文本判定 | 全平台 |
| `clipboard_darwin.go` + `.m` + `.h` | NSPasteboard → PNG 字节（cgo） | macOS |
| `clipboard_linux.go` | `xclip` / `wl-paste`（带**硬超时**） | Linux ⚠️未验|
| `clipboard_windows.go` | CF_DIBV5 / CF_DIB（补 BITMAPFILEHEADER）/ CF_HDROP | Windows ⚠️未验 |
| `clipboard_other.go` | 恒返回空 → 通道③ 优雅降级，不影响构建 | 其余 |
| `app.go` `SaveImageFromClipboard` | 对外入口：取字节 → 嗅探 → `writeImageAsset` | 全平台 |
| `imageDrop.js` | 门槛判定 + 误判兜底（见下） | 前端 |

**为什么判据用「嗅探字节」而不是信任平台给的格式名**：三个平台报上来的格式标识
完全不同（macOS 是 UTI `public.png`、Windows 的 CF_DIB **根本没有扩展名**、
Linux 是命令行输出）。信它们就等于把正确性押在最薄的一环上；**字节才是唯一真源**。
RIFF 家族（`RIFF` 前 4 字节）必须二次确认偏移8 处的类型标记，否则 **WAV 会被
误判成 webp**（这条有专门用例）。

#### 前端的两个坑（paste 是同步的，Go 调用是异步的）

1. **必须同步 `preventDefault`**：若等异步结果回来再拦，默认行为已经跑完、
   文件名文本已经插进文档，就只剩「多插一张 + 留垃圾」。代价是**必须在拦之前
   就判断这是不是图片粘贴**——门槛因此是**弱启发式**：只有当「通道①② 都没拿到」
   **且** `text/plain` 看起来像图片文件名（单行、无空白、无路径分隔符、带图片扩展名）
   时才拦。第一版漏了「无空白」这条，被自测当场抓到：粘贴 `foo.png bar.png`
   这种正常句子会被吞掉（比插不进图更严重的回归）。
2. **误判必须能还回去**：门槛是启发式，就一定会有误判。拦下默认行为后，
   若Go 侧返回空（剪贴板里其实没图片），**必须手工把文本原样 dispatch 回去**，
   否则用户的内容被静默吞掉（变异自证专门验了这条）。

另外：`Promise.resolve(fn())` 会**先同步执行** `fn()`，回调抛错会直接逃出
`paste()` 变成未捕获异常。必须写成 `Promise.resolve().then(fn)`。

#### 本轮的门禁升级

- **本仓此前从没有 Go 测试，CI 也不跑 `go test`** —— 判据纯逻辑完全裸奔。
  现新增 `clipboard_image_test.go`，并把 `go test` 接进 CI（Go job 第三步）。
- 新增**跨平台交叉编译**步骤：Linux / Windows 两份适配层此前**不在任何门禁里**，
  改坏了没人知道（同「脚本一直红着没人发现」那类坑）。注意**能编 ≠ 真能用**，
  真机验证仍未做，见 §7。
- 前端测试 202 → **221**（新增 `image-clipboard.test.mjs` 19 条）。

#### 变异自证（4 个方向，抓到 3 处问题，其中 2 处是测试自身假绿）

| 方向 | 结果 |
|---|---|
| 删 RIFF 二次确认（WAV 误判成 webp） | ✅ 精确报红 |
| 删「含空白则拒绝」 | ✅ 精确报红（**第一版实现的真 bug**） |
| 误判时不还回文本 | ✅ 精确报红 |
| 调换 SVG 与魔数分支顺序 | ❌ **假绿** → 查出是**等价变异体**：`looksLikeSVG` 只看头4 字节，两分支天然互斥 → 删除该恒真断言 |
| 删门槛里「通道①② 已拿到图片」的短路检查 | ❌ **第一次假绿** → 查出原因：paste() 里通道①② 成功时**早已 return true**，走不到门槛的短路检查，**两道防线互相掩护** → 新增 `shouldTryClipboardFallback` 直测，重跑后精确报红 |

**「假绿灯」累计 5 次**（本轮新增的第 4、5 次）。这一轮的两条新成因值得单列：

- **等价变异体不是缺陷，是断言没打中差异**（SVG 顺序那条）。
- **两道互相掩护的防线，绕道上层调用点的测试区分不出是哪一道在起作用**
  （短路检查那条）。解法是**把被掩盖的防线单独导出、直测**。

#### 端到端验证（真剪贴板，不是构造字节）

单元测试用**构造字节**只证明「给定这些字节会落盘」，**证明不了
「macOS 剪贴板真能读到字节」**——而这次的真机失败恰恰出在「以为能读到」。
故新增 `clipboard_e2e_test.go`（剪贴板为空时skip，CI 里属正常），
并用真实 NSPasteboard 跑通了两个场景：

```
场景A 剪贴板 = 复制的文件（furl）
  → 读到 filePath=/tmp/ink-e2e-test.png → 落盘 4816 字节 ✅
场景 B 剪贴板 = 纯图片数据（**用户遇到的形态**，与现场 dump 的类型列表一致）
  → filePath=""，读到 7718 字节 → 嗅探为 png → 落盘 ✅
```

#### 验证汇总

`npm test` **221/221**；`go test`（含 e2e）ok；`go vet` exit 0；
`go build`（darwin / linux / windows 三平台）exit 0；`npm run build` 成功；
7 个门禁 exit 全 0；`wails generate module` 已重生成绑定（新增
`SaveImageFromClipboard`）。`App.vue` 146 行（≤150 硬上限）。

---

本项目吃过两次教训：**「进程存活」不等于「界面渲染出来了」**（白屏时进程照样活着），
**「我以为失败了」不等于「我确认失败了」**。所以：

| 要验什么 | 怎么验（正确的） |
|---|---|
| 界面能不能用 | `node scripts/smoke/render-check.mjs`（真浏览器加载 dist，断言 `.main` / `.editor-host` 存在 + console 无 error）**不是** `pgrep` |
| 门禁有没有红 | 看**真实退出码**，不要用 `\| tail` —— 管道会把退出码换成 `tail` 的 0 |
| 改动有没有真效果 | **变异自证**：故意改坏 → 确认报红 → 还原 → 确认复绿 |
| 门禁本身有没有失效 | 元测试：造违规输入 → 确认门禁能报出。**门禁没有自检等于没装** |
| 菜单/快捷键对不对 | `node scripts/verify/verify-shortcuts.mjs`（README + 应用内速查表 ↔ `useShortcuts.js` 的 `COMMANDS` 三方对齐。原生菜单已在第四轮下线，**别再拿 main.go 当锚点**） |
| 标题栏菜单真实长什么样 | `useCommands.js` 的 `menuGroups` 是从 `COMMANDS` 派生的，结构对不对看 `TitleBar.vue` 渲染；要交互级取证用 `scripts/probe/` 的 CDP 探针 |
| **这个仓库能不能编出来** | **干净 clone** 跑 `go vet`（本机 dist 有产物，本地绿不作数）：`git clone --depth 1 file://$PWD /tmp/v && cd /tmp/v && /usr/local/opt/go/bin/go vet ./...` |
| CI 红在哪个 job / 哪一步 | 公开 API 两步：`…/actions/runs?per_page=6` 取 run id 与结论，再 `…/actions/runs/<id>/jobs` 列 job 与 step 结论（本机没装 `gh`） |

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

### ④ `menuLabels` 匹配、`⚠️` 写注释里 —— 累计 8 次「匹配到注释里的代码」
本仓在这类错误上栽了 **8 次**（shell grep 静默 / `@media print` 注释误判 /
JSDoc 示例误判 / grep 匹配被注释的函数 / `indexOf` 命中注释里的 `menuLabels` /
**在注释里裸写块注释定界符导致自己刚写的注释提前闭合** /
**本轮：`indexOf('useFileOps({')` 命中 App.vue「顺序契约」注释里的同一字符串，
导致 tdz 变异脚本把隐患插进了注释里、造不出真实隐患** /
**第六轮：断言 `/node\.state\.doc/` 命中我自己写的说明性注释，新测试首跑假报 4 条红**）。
**教训**：匹配前必须剥注释；注释里描述注释语法必须避免裸写定界符。

### ⑨ 「给 markdown 围栏装上语言包，就会有高亮」—— **错（第七轮实测）**
`8774a7e` 加了 `@codemirror/lang-java` 期待 Java 代码块上色，**颜色一个都没出来**。
真因是两层静默退化叠加（见 §2 第七轮表 #1）：`codeLanguages` 返回了 `LanguageSupport`，
而 lang-markdown 取的是 `found.parser`；以及 `fallback: true` 与主样式并列时主样式被整体跳过。
**判据（可复用）**：接第三方 CodeMirror 扩展的**回调返回值类型**必须以源码/类型定义为准，
「API 名字看起来对」不算验证；改完要在真编辑器里看见颜色，才算改完。

### ⑩ 「`--wails-draggable: no-drag` 加在容器上，子元素就都安全了」—— **错**
CSS **自定义属性会向下继承**，而 Wails 的 dragTest 只读 `e.target` 的计算值。
容器级 no-drag 会把该容器占据的**空白区**一并变成非拖动区 → 真机表现为「窗口拖不动」。
**判据**：继承型属性的白名单只能落在**叶子可点元素**上，别落在布局容器上。

### ⑪ 「本地 `go vet` 绿 = 这个仓库编得出来」—— **错（第七轮实测，代价是 CI 连红两次）**
本机 `frontend/dist/` 有构建产物，embed 指令自然通过；干净 clone 里该目录**被
gitignore 掉了**，只靠一个 `.gitkeep` 占位——而这个占位在 `8774a7e` 被误删。
**判据**：动到 `//go:embed` 的目标目录、`.gitignore`、「构建产物是否入库」中任一项，
必须 `git clone file://… /tmp/x && /usr/local/opt/go/bin/go vet ./...` 走一遍。
本地绿在这个问题上一文不值。

### ⑫ 「`window.go?.main?.App?.X?.()` 有可选链就不会出事」—— **半错**
可选链把「绑定不存在」也吞成 no-op：点了没反应、不报错、测试全绿（`793838e` 的
关闭按钮正是这样）。正解是走 `wailsjs/go/main/App` 的**具名 import**，让缺失在
编译/打包期就暴露；`try/catch` 只用来兜「浏览器预览没有 Wails 环境」这一个场景。
**判据**：兜底只该出现在**已知的环境分支**上，不该出现在主调用链上（与 §4 ⑤ 同源）。

### ⑬ 「用户说表格没渲染 = 我们的渲染坏了」—— **第八轮实测：不是**
用户写的两段文本（`|-ds-| --sd-|`、`|| ||`）都不满足 GFM，解析器判为段落是
**正确行为**，与 GitHub / Typora / VS Code 一致。**判据：先证明输入合法，
再讨论渲染**。GFM 表格要求「第 2 行是分隔行，且单元格只含 `-` 与首尾 `:`」——
分隔行写在第 3 行也不算表格（我的探针先写错成第 3 行，报了两个假 FAIL）。

### ⑭ 「`markdown()` 就是编辑器用的那个解析器」—— **错（第八轮实测）**
`@codemirror/lang-markdown` 的默认 `markdown()` 用 **commonmark**（无 GFM），
而 `createEditor.js` 传的是 `markdown({ base: markdownLanguage })` —— 那是扩展了
GFM 的版本。实测同一段合法表格：默认 `markdown()` → `Document, Paragraph`（认不出
表格！），`base: markdownLanguage` → `Document, Table, …`。
**判据**：写涉及解析的测试必须**复制生产代码的扩展参数**，否则合法输入会被判成
异常（假红），生产代码改错也验不出来（假绿）。与 §4 ⑨「API 名字对 ≠ 行为对」同族。

### ⑮ 「无头环境里 `syntaxTree(state)` 就是完整语法树」—— **错（第八轮实测）**
无头构造的 `EditorState` 上，`syntaxTree(state)` 只给**部分**树（3 行文档只解析出
`Document + Paragraph`），必须用 `ensureSyntaxTree(state, doc.length, 5000)` 强制
完整解析。**判据**：解析类测试断言前，先 dump 一遍节点名确认「你看到的树就是完整树」。

### ⑯ 「两份 stripComments 行为有差异，收敛就会动到契约」—— **第九轮实测：差异比登记的更尖锐，但契约零变化**
§7 原登记三处差异（`${}` 插值注释、未闭合引号跨换行、纯模板一致）。第九轮实测到
**第四处更尖锐的**：局部版对**正则字面量里的引号/反引号全盲** —— `commands.js` 的
`FENCE_RE = /^\s*(```|~~~)/` 一个反引号即假言入串，此后成片注释漏剥。
**实测数字**（不要凭感觉写「全部/几百行」）：两版对该文件输出 **37 行不同**，
非空白字符数 local 8378 / lexer 7209（差 1169）。
（方向上局部版漏剥，正是「匹配到注释里的代码」那族失效，§5 门禁最怕的东西）。
收敛方式：删局部版、统一 `helpers/lexer.mjs`。
**收敛前实证契约行为不变**：对契约 3 实际扫描的 14 个 .vue **逐字节比对**两份实现
输出——0 差异；契约 6 原本就用 helpers 版（仅去别名）；155/155 无一条断言被弱化。
**教训：「两份实现行为有差异」≠「收敛会改变契约」——先对真实输入集合做逐字节比对
再下结论，别拿差异清单当回归预测；但也别因此说「差不多」就留着不改。**

### ⑰ 「用例里先设好前置条件，再调被测函数」—— **错（第九轮 QA 复验实证）**
`watcher-wiring.test.mjs` 的两条「浏览器预览兜底」用例写成：
`globalThis.window = {}` → `mountOps({...})`。但 `mountOps()` 内部**无条件**
`globalThis.window = { runtime: { EventsOn } }` —— 前置条件被 helper 静默覆盖，
「缺失 runtime」的路径从未进入，用例恒绿。**判定性实证**：把被测代码里的
`window.runtime?.EventsOn?.(…)` 改成无兜底直取（真机必抛），两条用例**依然 2 pass**。
**判据**：任何「失败路径 / 降级路径」的用例，必须让**失败条件成为被测函数的显式
入参**（这里是 `mountOps({ installRuntime: 'no-runtime' })`），而不是用例里的一次
全局赋值；并且断言要打在**该路径特有的可观测差异**上（这里补「订阅数必须为 0」），
不能只写 `assert.doesNotThrow` —— 后者对「压根没执行到那行」毫无区分力。
同族问题：本仓 §5 的「因为错误的原因而通过」（第 9~11 次）。

### ⑱ 「断言了条数就等于断言了行为」—— **错（第十一轮变异自证实证）**
`image-paste.test.mjs` 的「旧绑定形态（只有 SaveImage）」用例原本只断言
`toasts.length === 1`。把双通道守卫改成**只查一个绑定**后，路径通道调用不存在的
`SaveImageFromPath` 抛 TypeError，被 `catch` 成 `imageFailed` toast —— **条数同样是 1**，
用例照样绿。可观测差异其实在**文案**上：用户该看到「当前环境不支持」，实际会是
「插入图片失败：…」。
**判据**：断言必须打在该路径**特有**的可观测差异上（这里是 toast 文案），
而不是一个「任何失败都会得到」的计数/布尔。计数类断言几乎总能在错误路径上碰巧成立。
同族：`assert.doesNotThrow`（§4 ⑰）、`assert(result != null)`。

### ⑲ 「源码正则能守住『某条绑定/接线不许丢』」—— **错（第十一轮变异自证实证）**
`slash-fullwidth.test.mjs` 的 keymap 接线 pin 原本是
`assert.match(code, /\{\s*key:\s*'／',\s*run:\s*onSlash\s*\}/)`。把绑定行**注释掉**
（甚至改成别的写法）后，正则照样在注释文本里匹配到 → 假绿。**正则匹配的是文件里
的字符，不是「CM 会不会执行它」。**
**正确形态**：驱动**真实对象**。这里是从 `EditorState` 的 `keymap` facet 取回
CM 真正会用的绑定表（摊平方式与 `@codemirror/view` 内部 `getKeymap` 逐字一致），
用 `w3c-keyname` 的**真** `keyName` 解析按键、调**真** `run` 并断言副作用。
**判据**：凡「不许弄丢」的接线，都要有办法从**运行期数据结构**里读回它；
做不到时，明确标注该接线由**探针**端到端负责（如本轮 `updateListener` → 兜底路径）。
正则只配守**文案/格式**类不变量，不配守行为。

### ⑳ 「macOS 复制文件时剪贴板给的是 file URL（`text/uri-list`）」—— **错（第十二轮真机证实）**
第十一轮据这句话加了 `SaveImageFromPath`（通道②），2026-10-15 真机复验**依旧失败**。
现场 `osascript -e 'clipboard info'` 显示剪贴板里**只有图片数据、零 file URL**。
真相：**WKWebView 不把剪贴板图片暴露给 `clipboardData`**——没有 `files`、没有 `items`、
也不在 `text/uri-list` 里给 `file://`，只有 `text/plain` 里的**文件名**；
WebKit 的默认粘贴行为就是**把它当纯文本插入**（这就是「粘贴只是文件名」，
无异常无日志）。故通道② 在真机上**从未执行过**。
**教训**：① 关于平台行为的结论**要取证**（`clipboard info` 一条命令的事），
不要靠「常识推断」写进注释与HANDOFF；② **Chrome ≠ WebKit** ——
`scripts/probe/` 全部跑在无头 Chrome 上，剪贴板语义与真机不同构，
**探针全绿不能证明真机可用**（本条与 §4 ⑲ 并列，同属「验证环境与被验证对象不同构」）。

### ㉑ 「探针全绿 ⇒ 真机没问题」—— **错，且成因全新（第十二轮）**
前几次假绿是「断言写错 / 正则匹配到注释」。这一次**断言完全正确、探针 18/18 全绿**，
但**它验证的输入形态真机上不存在**：探针用 CDP 构造 `DataTransfer` 并手工塞入
`text/uri-list`，而 WKWebView 压根不给这个字段。
**判据**：涉及**平台/内核能力**（剪贴板、文件系统、打印、原生菜单）时，
必须回答「**这个输入形态，真机上真的会产生吗？**」；
能用系统命令取证的（`osascript 'clipboard info'`、`pbpaste`）就先取证再写代码。

### ㉒ 「变异自证没报红 = 我的测试守得住」—— **错，两种伪装（第十二轮）**
两个方向注入了缺陷却全绿，但**原因完全不同**：
- **等价变异体**：实现里两个分支天然互斥（如 `looksLikeSVG` 只看头 4 字节，
  而没有图片格式以 `<svg` 开头）→ 调换顺序不改变任何输出。
  此时那条断言**本来就不可能抓到东西**，该删掉而不是留着自我安慰。
- **两道互相掩护的防线**：删掉深层短路检查后上层早已 `return`，
  绕道上层调用点的测试**区分不出是哪一道在起作用**。
  解法：把被掩盖的防线**单独导出并直测**（本轮 `shouldTryClipboardFallback`）。
**判据**：变异自证**报红**只说明「有判别力」；**不报红**必须区分
「等价变异 / 测试打错位置 / 真没守住」三者，不能一律当成通过。

---

## 5. 门禁体系（5 个 job / 8 项检查，全在 CI）

| 门禁 | 卡什么 | 命令 |
|---|---|---|
| `frontend` | 221 条测试 + vite 构建 | `npm test && npm run build` |
| `go` ① | vet（printf 动词错 / 不可达代码 / 锁复制） | `go vet ./...` |
| `go` ② | build（**vet 不做链接，cgo 导出代码要 build 才暴露**） | `go build -o /dev/null .` |
| `go` ③ | **测试**（2026-10-15 新增。此前本仓零Go 测试，「什么字节才算图片」的判据完全裸奔） | `CGO_ENABLED=1 go test ./...` |
| `go` ④ | **Linux / Windows 交叉编译**（2026-10-15 新增。通道③ 的另两个平台适配层此前不在任何门禁里，改坏了没人知道） | `CGO_ENABLED=0 GOOS=linux go build` + `GOOS=windows` |
| `p0-emoji` | 界面不得用 emoji 当图标（含注释） | `./scripts/p0-check-emoji.sh frontend/src main.go app.go` |
| `docs-contract` ① | 键位在 README / 应用内速查表 / **`useShortcuts.js` 的 `COMMANDS`** 三处脱节 | `node scripts/verify/verify-shortcuts.mjs` |
| `docs-contract` ② | 目视清单副本（`docs/qa/visual-checklist.html`）与 **HANDOFF §6 真源**的编号/标题漂移 | `node scripts/verify/verify-visual-checklist.mjs` |
| `i18n-residue` | 新写的用户可见文案漏了 `t()` | `node scripts/verify/scan-i18n-residue.mjs` |

> `docs-contract` 的真源在 2026-10-06 已从 `main.go` 的 `buildMenu` 迁到前端命令表
> （`ci.yml` 头部注释已同步说明）；`scripts/verify/parse-main-menu.mjs` 如今解析的是
> `useShortcuts.js`，文件名是历史遗留，别被它误导。
> 另有**两个手动脚本不在 CI**：`scripts-verify-icons.mjs`（图标与 phaseC 规格逐字比对，
> 实测 24/24 一致）、`scripts-verify-theme.mjs`（theme.js 优先级自检，8/8 断言）。
> ⚠ 这两个脚本曾在 2026-10-14 被查出**一直是红的**：它们原在 `scripts/`，搬进
> `scripts/verify/` 后 `./docs/…`、`./frontend/…` 相对路径没跟着改 → `ENOENT` /
> `MODULE_NOT_FOUND`。**没进 CI 的脚本没人跑 = 与不存在等价**，这是它们烂掉的原因。
> 已改用 `ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')` 约定修正；
> 内容侧本来就对，纯粹是路径 bug。**建议：要么接进 CI，要么每次交付前手动跑一遍并记退出码。**
> ⚠ `scripts-verify-icons.mjs` 内含 U+2717「✗」字形，落在 P0 emoji 正则的码点区间内。
> 当前 emoji 门禁只扫 `frontend/src` + `main.go` + `app.go`，故它从未被扫到；**若哪天
> 把扫描面扩到 `scripts/`，这条会立刻变红**。这是已知的（有意保留的）边界，不是待修缺陷。

### 两条关键机制
- **行数债务棘轮**：`frontend/tests/contracts.test.mjs` 的 `LINE_EXEMPTIONS`
  登记 `{文件, limit, reason}`，断言**不得增长**，90% 时出**非阻断** advisory。
  口径 = **有效代码行**（剥注释后的非空行）—— 早前用「总行数」会把注释
  当债务，**逼人改阈值、奖励删注释**，已改为有效代码行。
- **指针用例**：移除某项检查时必须补一条「该检查仍存在」的断言，
  防「检查消失却无人报错」的覆盖空窗。

### 本项目最危险的失败模式：**假绿灯**
门禁存在但不阻断，等于没有门禁，还提供虚假保证。本项目已发生 **6 次**：
1. `p0-check-emoji.sh` 因 grep 报错被吞 → 永远「通过」（2026-10-04 修）
2. `scan-i18n-residue.mjs` 退出码恒 0 → 放进 CI 也是永远绿（2026-10-06 修）
3. 「旧绑定形态」用例只断言 toast **条数**，错误路径文案走错也照样绿
   （2026-10-14 变异自证发现，**交付前**拦住，见 §4 ⑱）
4. keymap 接线 pin 用**源码正则**，绑定被注释掉仍匹配注释文本
   （2026-10-14 变异自证发现，**交付前**拦住，见 §4 ⑲）
5. **探针验证的输入形态真机上不存在**：`probe-r11-fixes.mjs` 跑在无头 Chrome 上，
   手工往 `DataTransfer` 里塞 `text/uri-list`；而 WKWebView 压根不给这个字段 →
   探针 18/18 全绿，真机粘贴依旧坏。**断言完全正确、环境不同构**
   （2026-10-15 真机复验暴露，见 §4 ⑳ ㉑）
6. **变异自证没报红 ≠ 测试守得住**：要区分「等价变异体」「测试打错位置」
   「真没守住」三者（2026-10-15，见 §4 ㉒）

后四次的教训是：**「测试全绿」本身就是需要被验证的对象**。所以每个方向的修复都要做
**变异自证**（注入缺陷 → 必须报红），而不是只看修复后测试是不是绿的 ——
绿的可能是测试根本管不到。五次实战已证明变异自证是本仓最高性价比的检查手段。
**第六次补上一条**：涉及平台/内核能力时，还要问「**这个输入形态真机上真会产生吗**」。

**新增/修改任何门禁时，必须做元测试**：造违规输入 → 确认能报红 → 确认退出码非 0。

### 门禁**口径之外**的盲区：两处已收口，一处收不了（第七轮的两次红都出在这儿）
「五道全绿」不等于「没问题」。第七轮暴露的两个盲区，2026-10-11 已由**契约 6**（5 条判据）
纳入 CI 口径：
1. ~~占位文件的跟踪态没有断言守着~~ → **已收口**：契约 6 断言 `frontend/dist/.gitkeep`
   仍在 `git ls-files` 里、`.gitignore` 的反向豁免还在、`main.go` 的 `go:embed` 锚点未消失。
   纪律仍然有效：**涉及 embed / gitignore / 构建产物的改动，要用干净 clone 复验一次**
   （见 §4 ⑪），门禁只在事后兜底。
2. ~~标题锚点 / 「插入目录」跳转没有任何断言~~ → **已收口**：契约 6 断言 heading_open
   逐字输出 `id="${…}">`、两侧同取自 `editor/anchors` 的 `createSlugCounter`，
   并且「产出 HTML 的文件在剥注释后不得出现中文弯引号」。
   ⚠ 但这条只覆盖到**静态形态**，真机点按是否跳转仍属目视项（§6 第 18 项）。
3. **真机交互**（拖拽、红绿灯留白、毛玻璃、斜杠面板手感）—— 无法进门禁，见 §6 的 22 项。

---

## 6. 需要你人工确认的事（本机无 GUI 自动化权限）

自动化只验到「根节点渲染 + 标题栏/编辑区已挂载 + 零异常」，**交互全没被人看过**。
**第五轮后清单已重写**（旧的原生菜单项、视图四态相关项已随功能下线）。

> **这份清单有可执行副本了（2026-10-13 新增）**：
> 1. 打开 `docs/qa/visual-checklist.html`（单文件、双击即开、零依赖）逐项勾选，
>    记结论（通过/不通过/不适用）与备注；平台/验证人/日期填好后**点「导出 Markdown」**。
> 2. 把导出结果**追加**到 `docs/qa/VERIFICATION-LOG.md` 末尾（append-only，不改历史行）。
> 3. 本节仍是**唯一真源**（「要验什么」）；HTML 是它的副本、LOG 是「验过什么」。
>    两份副本的**编号与标题**由门禁 4 的第二步机检守着
>    （`node scripts/verify/verify-visual-checklist.mjs`，退出码 1=漂移 / 2=解析失效不可采信）。
> **已知边界**：守卫只比对**编号+标题**，不比对正文要点（正文允许精简，但不许改义）。
> 清单**未做 `@media print`**（打印会带上工具栏），设计用途是屏幕并在应用旁使用。

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
   - 🔧 **第十一轮已修，待复验**：原来只绑半角 `/`，而中文输入法的**中文标点模式**
     下 `/` 键产出的是全角 `／`（U+FF0F）→ 面板永不弹出（首次验收就栽在这）。
     现两种形态都绑，另加「刚插入单个斜杠字符」的兜底。**复验必须切到中文输入法**
     再按斜杠 —— 当初漏的就是这个条件（旧探针用半角模拟，所以探针绿而真机红）。
8. **图片粘贴**：复制一张图片 → `⌘V`，应在光标处插入 `![](assets/...)`，
   且**同级目录出现 assets/**；文档未落盘时应提示「先保存」而不是静默失败
   - 🔧 **第十二轮已修，待复验**：第十一轮的修法（通道②读 file URL）**根因判断错了**，
     真机上从未生效过。现场 `osascript 'clipboard info'` 证实剪贴板里**只有图片数据、
     零 file URL**；**WKWebView 压根不把剪贴板图片暴露给 `clipboardData`**，只有
     `text/plain` 里的文件名，于是 WebKit 默认行为把它当文本插入（就是用户看到的现象）。
     现新增**通道③：Go 侧直接读系统剪贴板**（macOS 走 cgo + AppKit，已在真实剪贴板上
     端到端跑通两种形态）。
     **复验请三种方式都试**：
     ① 截图工具 / 浏览器里复制图片 → 应插入 `![](assets/…)`，**不是文件名**；
     ② Finder 里选中图片文件 ⌘C → 同上；
     ③ ⚠️ **回归重点：粘贴一段普通中文 / 代码不得被吞掉**（门槛是弱启发式，
     「像图片文件名」就拦，误判时必须把文本原样还回去）。
9. **快捷键速查**：`⌘/` 打开后**表格有内容**（第五轮修掉的空表回归项）
10. **大纲跳转**：`⌘B` 打开大纲，点条目应跳到对应标题、当前节高亮随滚动更新
    （原「阅读态大纲」项随阅读态 2026-10-14 移除改写为编辑态大纲跳转）
11. **缩放**：⌘= / ⌘- / ⌘0，状态栏与正文字号同步变化
12. **三语切换**：设置 → 外观 → 语言，界面与标题栏菜单同步变、刷新后保持
13. **打印**：⌘P 只输出正文，无标题栏/侧栏/状态栏/弹层遮罩
    - 🔧 **第十一轮已修，待复验**：原来 `⌘P` 调 `window.print()`，在 Wails 的
      WKWebView 里是**空操作**（不报错、不弹窗）→ 用户看到的正是「快捷键没反应，
      菜单里点打印也没反应」。现改走导出 PDF（与菜单同一命令处理器），
      两个入口应都能弹出保存对话框。
14. **主题**：⇧⌘L 循环（浅 → 深 → 纸感），三套都正常

**第七轮新增的回归项（2026-10-07 改的正是这些，必须目视）**

15. **无边框平台拖窗口**（Linux/Windows）：按住标题栏**空白处**（菜单之间、菜单与
    文件名之间）应能拖动；点菜单按钮/窗口按钮**不应**带着窗口移动。
    这条就是 `f1343eb` 修的「容器级 no-drag 把空白区也变成非拖动区」，改法脆弱，
    **以后往标题栏加元素时，必须给新元素逐个补 `no-drag`**（见 §4 ⑩）。
16. **代码块高亮**：编辑区里写一个 ```` ```java ```` 围栏，关键字必须**有颜色**，
    且与右栏/预览区同一套色板（`--hl-*`）。`f1343eb` 之前是全程纯文本，属静默失败。
17. **Linux 关闭按钮**：自绘 × 必须真的关闭窗口（`793838e` 从可选链改成具名 import）。
18. **「插入目录」生成**：菜单「格式 ▸ 插入 ▸ 目录」应在光标处生成 TOC 文本。
    2026-10-11 修掉了锚点引号污染（§8），逻辑层已用渲染比对验过。
    （原「插入目录跳转」项依赖阅读态，随阅读态 2026-10-14 移除改为验生成。）
19. **GFM 任务列表**：`- [ ]` / `- [x]` 在**编辑区**应渲染成勾选框（WYSIWYG 装饰）。
    - 🔧 **第十一轮已修（根因不在渲染器），待复验**：这条与第 20 项当初判「不通过」，
      根因是阅读态不可达。阅读态已于 2026-10-14 整体移除，验收口径改为编辑区
      WYSIWYG 装饰直接目视。

**第八轮新增（2026-10-12）**

20. **表格未渲染提示**（CDP 探针已 9/9 通过，但仍需目视一次）：敲入
    `| a | b |` 回车 `| c | d |` → 合法表格现在**真渲染**（2026-10-14 落地，
    `src/editor/tableRender.js`）；此提示只对**未解析成 Table** 的坏语法出现，
    验法是敲入缺分隔行的管道行 → 状态栏左侧应常驻橙色提示并带行号；
    补上 `| --- | --- |` → 提示立刻消失、表格渲染出来。
    ⚠ 眼睛要看的是**提示的可读性与位置**（会不会被右侧行/列信息挤掉、
    长文案会不会溢出），这些探针验不了。
    - 🔧 **第十一轮：同 19 的根因（阅读态不可达）**。另附带修了一处畸形
      HTML：`markdown-it-task-lists` 在 `enabled:true` 下输出的 `<input>` 缺一个空格
      （`<input class="task-list-item-checkbox"type="checkbox">`），浏览器按 HTML5
      容错能解析，但换 stricter 解析器/接净化器就会静默丢 `type`，已在渲染器定点补齐。
21. **提示的误报体感**：连续写管道表格期间提示常驻是否显得吵？判定规则是
    「顶层段落 + 连续 ≥2 行管道行」，若发现写作时莫名被提示，把这条报回来。

**第九轮新增（2026-10-13）**

22. **文件树外部变更监听**（fsnotify，沙箱内无法验证，`wails dev` 真机确认）：
    ① 打开一个文件夹，在**外部**（Finder / 终端）往里新建或删除一个文件 →
    文件树应在约 250ms 去抖后自动刷新；② 切到另一个文件夹后，往**旧**文件夹
    扔文件，树**不应**刷新（代际校验 + 前端相等守卫双防线，验的就是这个）；
    ③ 关闭文件夹（打开空文档）后，往原目录扔文件，无任何刷新。
    已知未修项不影响验收：去抖边界双发（同 root 多刷一次）、fsnotify 内部
    错误时监听静默死亡（`w.Errors` 被吞，建议后续至少记日志）。

## 7. 已知未做 / 未验证（如实登记）

| 项 | 状态 |
|---|---|
| ✅ **CI `go` 门禁红** | **已修 + 已有门禁 + runner 已复绿（2026-10-11）**：`frontend/dist/.gitkeep` 按原 blob `dfdc095` 恢复并重新纳入跟踪；真 clone 的 `go vet`/`go build` 均退出码 0；契约 6 从此守着它的跟踪态。已随 `18c2f28` 推送，run `38143580960` 五个 job 全 success。见 §8 |
| ✅ **标题锚点被智能引号污染** | **已修 + 已有门禁（2026-10-11）**：`preview/markdown.js:135` 的 `id=“…”` 换回 `id="…"`（第 117 行注释一并还原）；渲染比对从 FAIL 转 PASS，构建产物里也确认无弯引号 id。契约 6 守着引号形态与两侧 slug 同源，**同批已推送** |
| ✅ **「剥注释」有两份实现** | **已收敛（2026-10-13，第九轮）**：删除 `contracts.test.mjs` 局部版（-89 行），统一 `tests/helpers/lexer.mjs` 版；契约 6 原本就用它（仅去别名）。收敛前实证：契约 3 扫描的 14 个 .vue 逐字节比对两份输出 **0 差异**，155/155 无断言弱化。原登记的三处差异之外实测到第四处（局部版对正则字面量里的引号全盲 —— 对 `commands.js` 实测 37 行输出不同，非空白字符数 local 8378 / lexer 7209），见 §4 ⑯。教训：差异存在 ≠ 契约会变，先逐字节比对再下结论；反过来「差异很小」也不能当作不修的理由 |
| **单栏布局 + 跨平台窗口形态的真机目视** | 自动化只验到「根节点渲染 + 标题栏/编辑区已挂载 + 无异常」，**标题栏拖拽 / 红绿灯留白 / 毛玻璃 / 斜杠面板的真实交互全部需目视**（见 §6 的 22 项） |
| **macOS 透明窗口的代价** | `WebviewIsTransparent` + `WindowIsTranslucent` 在旧款 Intel Mac 上可能掉帧（透明窗口不能被合成器缓存）；本机是 macOS 12，只验到「能编译」，性能未实测 |
| **Linux（CachyOS）真机** | 无边框 + 自绘标题栏的 Linux 表现**从未在真机跑过**；窗口按钮对接的 `WindowMinimise/WindowToggleMaximise/CloseWindow` 在 Linux 后端的行为需目视 |
| **「最近打开」功能整体下线** | 它的唯一消费方是原生菜单的子菜单；自绘标题栏未做该入口。若要恢复，需前端加列表 + 重新暴露 Go 的 `GetRecents`（`recents.json` 持久化逻辑仍在 `app.go` 的 `recentsPath` 等函数里，但 `AddRecent` 调用点已删） |
| **表格真渲染待真机验收** | 2026-10-14 落地：编辑器内 StateField block 装饰渲染真表格（`src/editor/tableRender.js`），单元格可直接编辑并同步回 Markdown 源码；单元测试已过，光标进出切换渲染/源码、Tab 换格、IME 输入等真机路径待目视（见 §6 第 20 项）。原「`useOutline` 阅读态分支未验证」随阅读态 2026-10-14 整体移除而消失 |
| **通道③ 的 Linux / Windows 适配层未在真机验证** | 2026-10-15 落地：图片粘贴新增第三条通道（Go 侧读系统剪贴板）。**macOS 已用真实 NSPasteboard 端到端跑通两个场景**（复制的文件 / 纯图片数据），但 `clipboard_linux.go`（xclip / wl-paste）与 `clipboard_windows.go`（CF_DIBV5 / CF_DIB / CF_HDROP）**只做到「能交叉编译过」，剪贴板 IO 从未在真机跑过**。⚠️ 这正是本仓最熟悉的形态：**能编 ≠ 能用**。首次在Linux / Windows 真机上验过时，请更新本行。两处已知风险：① Linux 的剪贴板工具未装时静默返回空（图片插不进去，但不报错）；② Windows 的 CF_DIB 需补 `BITMAPFILEHEADER` 才被认成 BMP，若 alpha 处理不当可能得到黑底 |
| **通道③ 的真机复验（#8）** | 2026-10-15 代码已完成并端到端验证，但**尚未在真机编辑器里复验**。复验要点：① 复制图片（截图工具 / 浏览器图片）后⌘V 应插入 `![](assets/…)` 而非文件名；② 从 Finder ⌘C 一个图片文件后 ⌘V 同上；③ **粘贴一段普通中文 / 代码不得被吞**（门槛是弱启发式，这是最需要盯的回归）；④ 文档未保存时粘贴应提示先保存 |
| **真正的「系统打印面板」未实现** | Wails 的 WKWebView 不实现 `window.print()`，故 `⌘P` 落地为「生成 PDF」（见 §2 第十一轮）。真正的系统打印需原生 `NSPrintOperation`（macOS）/ `GTK` 打印（Linux），未做。**已知的重复**：`⌘P`（`file.print`）与 `⇧⌘P`（`file.exportPdf`）目前**同效**——保留两条是因为 `⇧⌘P` 在快捷键表/README 里是既有契约，删除会破坏用户肌肉记忆与门禁口径。若将来做原生打印，`⌘P` 应切回真打印、`⇧⌘P` 保持导出 |
| **CI 的 runner 表现** | 已实测（2026-10-11）：`5ad7434`/`21771c7`/`a105c51` success，`6bdf3d6`/`f1343eb` failure（仅 `go` job），**`18c2f28` success**（run `38143580960`，五 job 全绿）。「本地绿、runner 绿」这一关现在是通过的；那两行 failure 是仓库自身回归（占位文件被删），已修 |
| **`release.yml` 真 runner** | 需 push 一个 `v*` tag 才会触发三平台打包。`ci.yml` 在 `18c2f28` 上已复绿（见上表），但 `release.yml` **一次都没跑过** —— 打第一个 tag 时它是首次执行，三平台构建的坑（Linux 的 webkit2_41 tag、macOS 签名）都还没被它验过 |
| **检查更新** | 仓库**无任何 Release**，所以现在只会返回「无法检查更新」（不谎报「已是最新」）。要等第一个 Release |
| **macOS 未签名分发** | Gatekeeper 会拦，需 Apple 开发者账号（$99/年）签名+公证 |
| **「窗口 → 缩放」** | Wails 无「适配内容尺寸」API，用最大化近似（沿用既有裁决） |
| **关闭窗口** | Wails v2.16 **没有 `WindowClose`**，只有强制退出的 `Quit`。自建 `App.CloseWindow()`（先问 `OnBeforeClose` 再 Quit）。故 ⌘Q 之类的「退出应用」快捷键**未设**——自绘菜单里也没有「退出」项（macOS 走红绿灯，Linux 走自绘 ×） |
| ✅ **`treeSignal` 空转** | **已接线（2026-10-13，第九轮）**。原记录「Go 侧 `WatchDir` 未暴露」不成立——`watcher.go` 与 `app.go` 同包，方法早已暴露、绑定在册；真正缺的是**前端没订阅 `fs:changed`**。已补：`useFileOps.js` 的 `shouldReloadTree(payload, folderPath)` 纯函数守卫（严格相等才自增）+ `window.runtime?.EventsOn?.()` 订阅 + 14 条测试（含 7 条真实驱动）。`watcher.go` 另修去抖回调陈旧 payload 缺陷（代际校验）。**待 `wails dev` 真机确认三场景**：① 目录内新建/删除文件树即时刷新；② 切文件夹后旧目录迟到事件不触发；③ 空串停止后无事件推送。遗留 advisory：去抖边界双发、`w.Errors` 静默吞掉 |
| **无拼写检查** | 刻意不做：CM 的 lint 对 CJK 基本无效，中文场景是伪需求 |
| **零多标签页** | ADR-005 已预留 `dirty` 升级路径 |
| **导出模板文案** | `export/exporters.js` 的 HTML 模板未国际化（Spec §1 明确留待后续） |

## 8. 已修记录与下一步候选（2026-10-11）

> **本轮已落远端**：`54f6488`（占位文件）→ `d7f6eb3`（锚点引号）→ `6701bd3`（本文件同步）
> → `583a535`（契约 6）→ `18c2f28`（本文件记门禁落地），5 个提交都在 `origin/main`，
> CI run `38143580960` 五个 job 全 success。下面三段是「怎么验的」，接手时不必重跑，
> 但**改动同类路径时照抄这些手段**。

### ✅ 已完成 · 恢复 `frontend/dist/.gitkeep`（已推送，CI `go` 门禁已复绿）
改法：`git show '8774a7e^:frontend/dist/.gitkeep'` 取回原文（三行中文注释）写回并
`git add` —— blob 校验与删除前**逐字一致**（`dfdc0957…`）。

**复验（这才是重点，本地绿不作数）**：
```bash
# 用临时 tag 指向「含暂存修复」的树，做一次真 clone，验完删 tag
t=$(git write-tree); c=$(git commit-tree "$t" -p HEAD -m tmp)
git tag inkmark-verify-tmp "$c"
rm -rf /tmp/x && git clone -q --depth 1 -b inkmark-verify-tmp "file://$PWD" /tmp/x
ls -a /tmp/x/frontend/dist            # 只有 .gitkeep —— 与新 clone 完全同形
(cd /tmp/x && /usr/local/opt/go/bin/go vet ./...); echo $?   # 0（修复前是 no matching files found）
git tag -d inkmark-verify-tmp
```
实测结果：`go vet` 退出码 0，`go build -o /dev/null .` 退出码 0
（只有一条既有的 `ld: warning: object file … built for newer macOS version (13.0)
than being linked (12.0)`，本机 SDK 与部署目标不一致导致，与本次修复无关）。
**顺带证实了 §0 那条**：`npm run build` 确实会把 `.gitkeep` 从工作区删掉，
`git checkout -- frontend/dist/.gitkeep` 现在是有效的复位手段。

**推送后再验一次（2026-10-11，`18c2f28`）**：上面那套是用临时 tag 造的树，
这次直接 `git clone` 远端提交上来的 HEAD，结果同形 —— `frontend/dist` 里只有
`.gitkeep`、`go vet`/`go build` 退出码均 0；在同一个干净 clone 里软链 `node_modules`
后跑 `node --test tests/contracts.test.mjs` 得 **37/37 绿**，说明「跟踪态」判据
在新 clone 上不会假红。runner 侧同理：CI 的 checkout 就是干净 clone，
`Go 静态检查与编译` 已 success。

### ✅ 已完成 · 修「插入目录」跳转失效（弯引号污染）
`preview/markdown.js:135` 的两个 U+201D 换回 ASCII `"`（第 117 行注释一并还原）。
**变异自证**（改前 → 改后，脚本直接跑真 `createRenderer()`）：

| | 渲染出的 `id=` | TOC 目标 | 结果 |
|---|---|---|---|
| 改前 | `”你好世界”`、`”install-guide”` | `你好世界`、`install-guide` | **FAIL，0/3 对上** |
| 改后 | `id="你好世界"` | 同上 | **PASS，3/3 对上** |

另在构建产物里做了正负两头确认：`' id=\"'+g+'\">'` 存在（修复真进了 bundle）、
`id=` 后跟弯引号 0 处。`npm test` 121/121（补契约 6 后为 126/126）、其余四道门禁退出码均 0、
`render-check` PASS（dist 路径，0 console error、0 未捕获异常）。

### ✅ 已完成 · 两道元守卫落地（契约 6，5 条判据，121 → 126 条测试）
新增在 `frontend/tests/contracts.test.mjs` 末尾的 `契约 6 · embed 占位与标题锚点`：

| 判据 | 卡什么 |
|---|---|
| 指针用例 | `main.go` 仍写着 `go:embed all:frontend/dist` —— 防「判据锚点静默消失」 |
| 跟踪态 | `git ls-files frontend/dist/.gitkeep` 必须非空（干净 clone 编得过的前提） |
| 反向豁免 | `.gitignore` 的 `!frontend/dist/.gitkeep` 还在（否则 build 后再也 add 不回来） |
| id 形态 | `preview/markdown.js` 逐字含 `id="${md._slugs.slug(text)}">`；且渲染侧与 `insertToc` 两侧同取自 `editor/anchors` 的 `createSlugCounter` |
| 弯引号 | 4 个「产出 HTML」的文件（markdown / anchors / commands / exporters）**剥注释后**代码里不得出现 `“ ” ‘ ’` |

**元测试（变异自证，四条各造一次违规，逐条报红后还原）**：
| 注入的违规 | 报红的判据 |
|---|---|
| 把 id 的两端换回 U+201D | id 形态 + 弯引号（2 条同时红） |
| `git rm --cached frontend/dist/.gitkeep`（复现 `8774a7e`） | 跟踪态 |
| 删掉 `.gitignore` 的反向豁免行 | 反向豁免 |
| 把 `go:embed all:frontend/dist` 改成别的路径 | 指针用例 |

**CI 侧**：契约 6 随 `583a535` 入库，`18c2f28` 的 `前端测试与构建` job success，
说明这 5 条判据在 runner 的**干净 checkout** 上跑过且没有假红（跟踪态那条最怕的就是这个）。
⚠ 「runner 上跑了 126 条」这个数字本身是**推断**（HEAD 含该文件 + 该步绿）——
下载 job 日志需要仓库 admin（`/actions/runs/{id}/logs` 返回 403），本机也没装 `gh`。

**补门禁时踩到的新坑（不是「匹配到注释」那一族，是加载期就炸）**：`contracts.test.mjs` 里
**已有一个局部 `stripComments`**（契约 3 打印块在用），再从 helpers `import { stripComments }`
会 `SyntaxError: Identifier has already been declared` —— 而且是**整个测试文件加载失败、
37 条一起红**，不是只红新加的那条。已用别名 `stripCommentsLexer` 绕开。
**登记为债**：同一个「剥注释」口径现在有两份实现（局部函数 + `helpers/lexer.mjs`）。
**三处差异已实测**（不是读代码猜的）：`${}` 里的注释 helpers 会剥、局部版当字符串保留；
未闭合单引号跨换行时 helpers 断串后照常剥后面的 `//` 注释、局部版会把那行注释一起吞进
「字符串」里（**方向上局部版更危险** —— 它会让「匹配到注释里的代码」这一族复活）；
纯模板内容两边一致。应收敛成一份，收敛前先确认契约 3 的行为不变（它有自己的一条危险场景用例）。

### P1 · 目视验收第七轮（§6 的 15~19 项）
本轮改的正是**窗口拖动**与**关闭链路**这两条自动化验不到的路径：
`f1343eb` 把 no-drag 从容器下放到叶子元素（漏一个就点不动，多一个就拖不动），
`793838e` 改了关闭按钮的调用形态。§6 前 14 项仍待目视（第五轮欠的）。

### P2 · 给新组合式函数补行为测试网
`useDocumentState` 的 dirty/自动保存/`switchFile` 三个契约目前只有静态断言
（`SetDirty` 镜像、命令闭合）。可测的纯逻辑已具备：把「标记 → 防抖 → 落盘 → 解脏」
抽成可注入时钟的纯函数，就能用 node:test 覆盖，而不必上浏览器。

### P3 · 接上文件树的外部变更监听 —— **已落地（2026-10-13，第九轮）**

原记录有两处不成立，如实改写：①「Go 侧 `WatchDir` 未暴露」**错**——`watcher.go`
与 `app.go` 同属 `package main`，方法早已暴露，`wailsjs/go/main/App.js:77` 绑定
也在册，`useFileOps.js` 也早已调用；真正缺的是**前端没订阅 `fs:changed` 事件**。
②「接的时候一并改成具名 import」**不应采纳**——具名 import `wailsjs/runtime` 的
`EventsOn` 会展开为 `window.runtime.EventsOnMultiple(...)` 直取，浏览器预览
（vite dev 无 Wails runtime）下必抛；本任务用 `window.runtime?.EventsOn?.()`
可选链兜底（与 §4 ⑫ 的判据一致：兜底只出现在已知的环境分支上）。
已落地内容见 §2 第九轮：`shouldReloadTree` 纯函数守卫 + 订阅 + 14 条测试
（含 7 条真实驱动）；`watcher.go` 顺带修了去抖回调陈旧 payload 缺陷。
**剩余：`wails dev` 真机确认三场景**（§7 treeSignal 行）。

## 9. 契约文档索引

| 文档 | 内容 |
|---|---|
| `docs/spec/SPEC-engineering-baseline-v1.md` | 工程底座契约、门禁边界、踩坑留档 |
| `docs/spec/SPEC-app-menu-release-v1.md` | 应用菜单 + 发布流程（含 Wails 能力边界） |
| `docs/spec/SPEC-i18n-v1.md` | 国际化契约（三语、零依赖选型、6 条已知坑） |
| `docs/design/settings-panel-spec.md` | 设置面板设计 + 裁决记录 R1~R4 |
| `docs/decisions/OPEN-DECISIONS.md` | 悬而未决登记册（**当前 0 未决 / 1 已决**：导出不跟随字体偏好） |
| `docs/qa/visual-checklist.html` | §6 目视清单的可执行副本（单文件、零依赖、导出 Markdown 留痕） |
| `docs/qa/VERIFICATION-LOG.md` | append-only 验证记录：「验过什么、结论如何」（§6 是「要验什么」） |
| `scripts/verify/verify-visual-checklist.mjs` | 上两者的编号/标题同步守卫（门禁 4 第二步） |
| `docs/architecture/ADR-004.md` | 快捷键裁决（⌘B 归大纲、加粗用 ⌘⇧B） |
| `docs/architecture/ADR-005` | `dirty` 语义（多文档的升级路径） |

---

## 10. 项目记忆位置

- `../.workbuddy/memory/MEMORY.md` —— 长期约定（样式契约、Wails 菜单约束、弹层 token 契约）
- `../.workbuddy/memory/pitfalls.jsonl` —— 踩坑库（**只追加**，同签名只增 episode）
- `../.workbuddy/memory/2026-09-28 … 2026-10-06.md` —— 每日工作日志

> ⚠ 日志**止于 2026-10-06**：第七轮那四个提交（10-07）**没有工作日志**，本文 §2 第七轮、
> §4 ⑨~⑫ 是 2026-10-11 逐 commit `git show` 回补的。以后每轮交付当天就补日志，
> 别再到「文档落后一周」这种状态。

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
