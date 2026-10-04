# OPEN-DECISIONS —— 悬而未决登记册

> 规范：只追加 + 就地关闭（`OPEN` → `RESOLVED`，补 Resolution 字段）。
> 每次 Phase 开始时复现未决项，逐条判断能否关闭。
> 三类固定 slug：`waiting-on-external-condition` / `design-decision-to-evaluate` / `existing-design-boundary`

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| 2026-10-04 | Phase 3（设置面板 R4） | 导出产物（HTML / PDF）是否应跟随用户的「正文字体」偏好 | `export/exporters.js` 与 `composables/useDocumentPersistence.js` 仍读主题级 `--font-body`（R4 只把偏好作用域收到编辑区+预览区，未动导出链路） | 倾向**不跟随**：导出物是「分发格式」，应保持主题级稳定的排版，而不是把用户本地偏好写死进 HTML/PDF | 需用户表态导出语义（本地还原 vs 分发保真） | 用户确认导出意图后 | OPEN（design-decision-to-evaluate） |

## 已关闭

| Date | Open Item | Resolution |
|------|-----------|------------|
| — | — | — |
