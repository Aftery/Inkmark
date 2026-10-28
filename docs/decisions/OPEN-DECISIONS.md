# OPEN-DECISIONS —— 悬而未决登记册

> 规范：只追加 + 就地关闭（`OPEN` → `RESOLVED`，补 Resolution 字段）。
> 每次 Phase 开始时复现未决项，逐条判断能否关闭。
> 三类固定 slug：`waiting-on-external-condition` / `design-decision-to-evaluate` / `existing-design-boundary`

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| 2026-10-28 | 评估报告 §3.2 | macOS 产物未签名 / 未公证（`release.yml` 无 `codesign` / `notarize` 步骤，实测 grep 命中 0） | Gatekeeper 会拦，用户需右键打开或 `xattr -d com.apple.quarantine`；正经分发需 Apple 开发者账号（$99/年） | 倾向「先补 codesign 再谈 notarize」——签名可自助，公证需账号 | 需 Apple 开发者账号与真实证书（外部条件） | 取得开发者账号后补齐 workflow 的签名与公证步骤 | OPEN |
| 2026-10-28 | 评估报告 §3.1 | 29 项目视清单大部分未过（`HANDOFF §6`，`verify-visual-checklist.mjs` 实测 29 项 / 漂移 0） | 自动化只验到「根节点渲染 + 标题栏/编辑区已挂载 + 零异常」；窗口拖拽 / 红绿灯留白 / 毛玻璃 / 斜杠面板等交互必须人眼 | 已有可执行产物 `docs/qa/visual-checklist.html`（单文件、双击即开），纯执行工作 | 需人工在真实窗口逐项操作并导出记录 | 29 项全部在 `docs/qa/VERIFICATION-LOG.md` 留下「通过 / 不通过 / 不适用」结论 | OPEN |

## 已关闭

| Date | Open Item | Resolution |
|------|-----------|------------|
| 2026-10-28 | 多标签页 / 多文档功能的 12 项设计争议（后台标签是否自动保存、关闭标签的键位、未落盘新文档的 dirty 初值、脏/异常标记的 token 与互斥规则、数字直跳、标签持久化存储位置、切走时是否留底快照、关到只剩一个标签、关闭后落点策略、Tab Switcher 的 MRU 快照语义、IME 合成期切标签、规格即契约） | **RESOLVED 2026-10-28：由 team-lead 逐项拍板（12/12），编号 MD-01…MD-12。** 完整裁决表（议题 / 裁决 / 理由 / 拍板人）见 `docs/plan/multi-tab-architecture.md` §12「已裁决」；对应的验收标准与测试计划见 `docs/plan/multi-tab-test-plan.md`。**关键裁决**：① 后台标签**同样自动保存**（MD-01）；② 关闭标签用 `⌘⌥W`，**不绑定 `⌘W`**（MD-02）；③ 未落盘空文档 dirty 初值 `false`，**同批修订 ADR-005 §一**以消除口径分歧（MD-03）；④ 脏/异常标记 = dirty `--meta` / error `--danger` / 未落盘 `--warn`，**优先级 error > 未落盘 > dirty、互斥只显示一个**（MD-04）；⑤ **不提供** `⌘1..9` 数字直跳（MD-05）；⑥ 标签持久化用 localStorage，**但必须存未落盘标签的内容**（上限 10 个），恢复过程只读不写（MD-06）；⑦ 同路径**幂等**——打开已打开文件 = 切到已有标签（PM 提出的架构约束，因 docKey 由路径派生，同文件双标签会让 ADR-005 §四 的映射退化）；⑧ IME 合成期切标签**升为 P0 级风险**，P1 之后立刻真机验证（MD-11）；⑨ 规格即契约，Spec 是唯一真源（MD-12）。**另有一处 team-lead 自裁反转**：MD-04 的 dirty token 原裁决为 `--muted`，经 PM 实测比对 + team-lead 复核 `design-tokens.css` 后改判为 `--meta`——`--muted` 在三个主题上对比度均高于 `--meta`（5.08~5.51:1 vs 3.31~3.53:1），是「更显眼」而非「更克制」的那个。本条为多标签页 P0–P6 实施的前置条件，决策已固化，不再悬置。 |
| 2026-10-04 | 导出产物（HTML / PDF）是否应跟随用户的「正文字体」偏好 | **RESOLVED 2026-10-13：不跟随。** 理由：导出物是分发格式，接收方环境未知——把作者本地的字体偏好写死进 HTML/PDF，会让排版随作者机器漂移，接收方看到的结果不可复现；保持主题级 `--font-body` 才能保证任何机器上导出排版一致。这与「标准档=跟随主题」的偏好契约同源（用户偏好是本地阅读体验，不是文档内容）。重开条件：出现「导出即本地还原」的真实需求（用户明确要求导出与屏幕完全一致）时，可重开为 design-decision-to-evaluate。当前实现零改动（exporters.js 仍读主题级变量），仅关闭登记。 |
