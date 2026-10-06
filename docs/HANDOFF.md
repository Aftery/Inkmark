# Inkmark · 交接说明

> **这份文档的用途**：对话窗口切换 / 新会话接手时，**先读这一份**，再按需读
> `docs/spec/` 与项目记忆。它记录「做到了什么、怎么验证、哪些坑别再踩」，
> 而不是流水账。
>
> 最后更新：2026-10-06（国际化 + Edit 菜单中文化交付后）

---

## 0. 三十秒上手

```bash
cd /Users/aftery/Desktop/myapp/inkmark

# 门禁全跑一遍（约 2 分钟，与 CI 口径一致）
cd frontend && npm test; cd ..          # 期望 104/104
node scripts/verify/verify-shortcuts.mjs    # 快捷键契约，期望退出码 0
node scripts/verify/scan-i18n-residue.mjs   # i18n 文案残留，期望退出码 0
./scripts/p0-check-emoji.sh frontend/src    # P0 零 emoji，期望退出码 0
/usr/local/opt/go/bin/go vet .              # 注意：go 不在 PATH

# 构建 + 启动
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
main.go            菜单构建（buildMenu）+ 应用入口
app.go             暴露给前端的 Go 方法（文件读写/剪贴板/菜单/版本/检查更新）
locales.go         Go 菜单标签的三语言文案表（83 key × 3 档）
version.go         版本单一真源（构建时 -ldflags -X main.version= 注入）
frontend/src/
  App.vue          主组件（有效代码行 1111，登记阈值 1142）
  themes/
    tokens/design-tokens.css   ** 样式唯一真源（新增 token 必须写这里）**
    prefs.js        用户偏好唯一真源（7 项：排版 4 + 主题外 3，含 locale）
    theme.js        主题偏好（light/dark/paper + 跟随系统）
  i18n/            三语字典（155 key × 3 档）+ t()
  composables/     useDialog / useFileOps / useShortcutsHelp / useOutlineSync
  components/      SettingsPanel / Toolbar / StatusBar / HistoryPanel / FileTree …
  tests/           104 条契约测试（node:test，零依赖）
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

## 2. 最近三轮做了什么

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

### ④ `menuLabels` 匹配、`⚠️` 写注释里 —— 累计 6 次「匹配到注释里的代码」
本仓在这类错误上栽了 6 次（shell grep 静默 / `@media print` 注释误判 /
JSDoc 示例误判 / grep 匹配被注释的函数 / `indexOf` 命中注释里的 `menuLabels` /
**在注释里裸写块注释定界符导致自己刚写的注释提前闭合**）。
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

自动化覆盖不到原生菜单点击与快捷键点按（`-10004` 权限拒绝），以下需目视：

1. **Edit 菜单的剪贴板**：选中文本 `⌘C` → 到别处粘贴；`⌘X` 剪切；`⌘V` 粘贴
2. **菜单点击**：Inkmark 菜单里「关于 Inkmark」「检查更新…」「隐藏 ⌘H」「退出 ⌘Q」
3. **三语切换**：设置 → 外观 → 语言，确认**界面与原生菜单同步变**、刷新后保持
4. **滚动同步**：双栏模式下左栏滚到底，确认右栏也到底
5. **弹层**：设置面板切「外观 / 编辑器」，确认尺寸稳定不跳变

---

## 7. 已知未做 / 未验证（如实登记）

| 项 | 状态 |
|---|---|
| **Windows / Linux 真机** | 菜单分流代码已写，**从未在真机跑过**。菜单已改为三平台统一自建，但渲染与事件接线仍未验证 |
| **release.yml 真 runner** | 需 push 一个 `v*` tag 才会触发三平台打包。`ci.yml` 已验证在 runner 上绿，但 `release.yml` **一次都没跑过** |
| **检查更新** | 仓库**无任何 Release**，所以现在只会返回「无法检查更新」（不谎报「已是最新」）。要等第一个 Release |
| **macOS 未签名分发** | Gatekeeper 会拦，需 Apple 开发者账号（$99/年）签名+公证 |
| **「窗口 → 缩放」** | Wails 无「适配内容尺寸」API，用最大化近似 |
| **「隐藏其他 / 显示全部」** | Wails 无 `hideOtherApplications` API，**省略**（非置灰） |
| **「编辑」菜单英文** | 保留系统 Role 是**有意识的取舍**（见 §4①），非漏改 |
| **导出模板文案** | `export/exporters.js` 的 HTML 模板未国际化（Spec §1 明确留待后续） |
| **无拼写检查** | 刻意不做：CM 的 lint 对 CJK 基本无效，中文场景是伪需求 |
| **零多标签页** | ADR-005 已预留 `dirty` 升级路径 |

---

## 8. 下一步的三个候选（按建议顺序）

### P0 · 补 `App.vue` 行为测试网
**为什么第一**：`App.vue` 仍是 1111 有效行（阈值 1142，余量仅 31），
script 主体里的分栏拖拽 / 视图四态 / 滚动联动 / 保存编排**刻意未拆** ——
拆了没有安全网兜底。**必须先有它自己的行为测试网再拆**，
否则就是裸奔。行数棘轮只剩 31 行额度，说明已到必须处理的临界点。

### P1 · 推第一个 Release + 验证多平台打包
`release.yml` 已就绪（三平台 matrix：macOS universal / Windows amd64 / Linux amd64），
但**从未在真实 runner 跑过**。打完第一个 tag 后「检查更新」才真正可用。

### P2 · 导出模板国际化 / 拼写检查
都是真实需求但优先级低于上面两条（前者影响面小，后者是伪需求）。

---

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
