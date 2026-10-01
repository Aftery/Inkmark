# Phase C QA 验收报告

- **执行人**：QA 测试工程师（独立复核，未参与实现）
- **日期**：2026-10-01
- **验收对象**：Phase C 全部工作区改动（WYSIWYG 即时渲染 / 三主题 / 阅读模式 / 快照 / PDF 一键直出）
- **结论**：**QA 通过，可交付。P0 违规为零。**

## 一、验收总表

| # | 检查项 | 结论 | 证据 |
|---|-------|------|------|
| A1 | go build ./... && go vet ./... | PASS | 退出码 0（ld 警告为 macOS 版本差异，忽略） |
| A2 | 前端构建（dist-verify-qa，已删） | PASS | vite 6.4.3，338 modules，0 error |
| A3a | emoji 门禁 | PASS | frontend/src 与 Go 源码 0 命中（引用判据复核） |
| A3b | 渐变/弹跳缓动 | PASS | linear/radial/conic-gradient、overshoot 类 0 命中 |
| A3c | 裸 hex | PASS | 仅 design-tokens.css（token 定义豁免）与 exporters.js（导出内联色板，已批准例外） |
| A4 | 键位唯一性 | PASS | 自定义 accelerator 29 个 + EditMenu 6 键全互不重复；⌘B=大纲（main.go:122）、⌘⇧B=加粗（main.go:93）、⌘4=阅读模式（main.go:118） |
| B5a | docKey 派生 | PASS | snapshot.go:53-56；harness 16 位 hex + Clean 等价路径同 key |
| B5b | 内容去重 | PASS | snapshot.go:122-126；同内容写两次 count=1，变更后 count=2 |
| B5c | 10 版轮转 | PASS | snapshot.go:250-264；写 12 版剩 10 且保留最新，无 .tmp 残留 |
| B5d | 路径穿越守卫 | PASS | snapshot.go:72-82 + SnapshotRead 前缀校验；`../`、`\`、组合穿越、空串全拒 |
| B5e | 10MB 上限 | PASS | snapshot.go:113-115；maxBytes+1 拒，恰 maxBytes 过 |
| B5f | tmp+rename 原子落盘 | PASS | snapshot.go:140-147 |
| B6a | dispatch_sync=0 | PASS | export_pdf_darwin*.m/.h 全文件 0 次调用（唯一命中为注释）；实现为 performSelectorOnMainThread + NSCondition（.m:280-286） |
| B6b | ExportPDF 契约 | PASS | (html, optsJson)→(string, error)；optsJson 形状 {docTitle,dateText,fontFamily,colors}；默认文件名 Go 派生；取消返回 ("", nil) |
| B6c | SnapshotMeta json tags | PASS | name/size/createdAt/contentHash；列表 CreatedAt 降序 |
| B6d | main.go 菜单 | PASS | ⌘4 / 历史快照… / 格式子菜单 16 项 / EditMenu 拼回 / ⌘P 非 darwin 降级 |
| C7 | wysiwyg.js | PASS | update() 首行 composing 冻结（:218）；全文件 0 次 dispatch；装饰全行内（无 block、无跨行 replace）；atomicRanges 已提供（:237-239） |
| C8 | commands.js toggleInline | PASS（附 P1 瑕疵） | 摘除/包裹与选区平移正确；空格边界瑕疵见问题 1 |
| C9 | 主题接线 | PASS | data-theme 只存 light/dark/paper；手动覆盖>跟随系统；initTheme 在 mount 前；menu:toggle-theme 仅 main.js 一个监听点；防闪烁脚本解析规则一致 |
| C10 | App.vue 拆分与视图态 | PASS | 四视图态完整；Esc 回原态（含 isComposing 守卫）；行数 App.vue=800（已批准例外），其余全部 <300 |
| C11 | paths.js | PASS | resolveIcon 兜底正确；SEMANTICS=39、ICONS=37（注释计数瑕疵已修正） |
| C12 | exporters.js | PASS | 46rem/467px 双量规、--export-measure 注入、三主题色板齐全 |
| D13 | pdfExportDefaultName | PASS | harness 7 用例全过（特殊字符清洗/截断/空回退） |
| AC-09b | 深色主按钮对比度 | PASS | 无 accent 底色主按钮；勾选框用 var(--accent-on) |
| AC-14 | 快照与自动保存解耦 | PASS | ≥3 分钟节流 + 800ms 防抖独立 |
| AC-20 | 状态栏三重表达 | PASS | 图标形状+文案+颜色三重；loader 尊重 reduced-motion |

## 二、问题清单

**P0：无。**

**P1（可带病交付，需记录）：**
1. commands.js toggleInline：选区含首尾空格时产出 `** 文字 **`，CommonMark 左右翼规则下不渲染为粗体。→ **已派发修复**（trim 后包裹，无选区分支行为不变）。
2. index.html 防闪烁脚本与 theme.js 为两份解析规则实现，任一侧改动必须同步另一侧。→ **已补双向注释互链**。

**P2（已处理/记录）：**
3. paths.js:108 注释「38 个语义」实为 39 → 已修正。
4. StatusBar error 态图标复用 circle-dot（与 unsaved 同形），四态全可辨可后续优化。
5. 架构文档 §4.1 计划的 themes/wysiwyg.css 实际并入 createEditor.js 唯一 EditorView.theme（符合硬约束，文档字面偏差，建议回写）。
6. 仓库根自验脚本 → 已归档 scripts/verify/。
7. 打包 JS 1.76MB chunk 警告——Wails 本地加载影响小，低优先级。

## 三、人工验证清单（需 wails dev 真机，交有界面环境的人执行）

1. **AC-04**：中文输入法在 WYSIWYG 下拼音组合态——候选不闪烁、确认后原子替换、无丢字。
2. **AC-05**：粘贴 5000 行文档连续输入 20 字，Performance 面板无掉帧。
3. **AC-06**：从双栏按 ⌘4 进阅读模式（chrome 全隐、正文加宽），Esc 回双栏。
4. **AC-01/02/03**：光标移出/移入标记符显隐；保存后 diff 与手写原文逐字节一致。
5. **AC-16~19c**：⌘P 导出——只弹保存对话框无打印面板；产物 A4 多页（MediaBox 595 842）、文字可选中、页眉左文档名右日期、页脚右「第 X / N 页」9pt；dark 导出为白纸黑字；取消静默；非 darwin 降级 window.print()。
6. **AC-07/08**：三主题切换不重建编辑器；跟随系统切深浅；手动选定后停止跟随；重启持久化。
7. **AC-13**：停止输入 800ms 状态栏「已保存」；只读目录下保存失败有明确提示。
8. 工具条/状态栏三主题视觉抽查（纸感下 chrome 仍无衬线）。

## 四、harness 证据（临时 _test.go，跑完已删）

```
--- PASS: TestDocKeyDerivation (0.00s)
--- PASS: TestSnapshotDedup (0.00s)
--- PASS: TestSnapshotRotation (0.01s)
--- PASS: TestSnapshotTraversalGuard (0.00s)
--- PASS: TestSnapshotSizeLimit (0.04s)
--- PASS: TestSnapshotAtomicWrite (0.00s)
--- PASS: TestPdfExportDefaultName (0.00s)
ok  	inkmark	0.070s
```
