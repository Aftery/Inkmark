# OPEN-DECISIONS —— 悬而未决登记册

> 规范：只追加 + 就地关闭（`OPEN` → `RESOLVED`，补 Resolution 字段）。
> 每次 Phase 开始时复现未决项，逐条判断能否关闭。
> 三类固定 slug：`waiting-on-external-condition` / `design-decision-to-evaluate` / `existing-design-boundary`

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| （暂无未决项） | — | — | — | — | — | — | — |

## 已关闭

| Date | Open Item | Resolution |
|------|-----------|------------|
| 2026-10-04 | 导出产物（HTML / PDF）是否应跟随用户的「正文字体」偏好 | **RESOLVED 2026-10-13：不跟随。** 理由：导出物是分发格式，接收方环境未知——把作者本地的字体偏好写死进 HTML/PDF，会让排版随作者机器漂移，接收方看到的结果不可复现；保持主题级 `--font-body` 才能保证任何机器上导出排版一致。这与「标准档=跟随主题」的偏好契约同源（用户偏好是本地阅读体验，不是文档内容）。重开条件：出现「导出即本地还原」的真实需求（用户明确要求导出与屏幕完全一致）时，可重开为 design-decision-to-evaluate。当前实现零改动（exporters.js 仍读主题级变量），仅关闭登记。 |
