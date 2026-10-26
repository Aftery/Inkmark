// markdown/footnote.js — 脚注的渲染口径（markdown-it-footnote 的定制包装）
// ----------------------------------------------------------------------------
// 【为什么需要这层包装而不是直接 md.use(footnote)】
// markdown-it-footnote 的默认产物有三处与本仓排版冲突，且**全都不报错**：
//
//   1) 尾部用一个裸 `<hr class="footnotes-sep">` 把正文和脚注隔开 —— 与本仓
//      「标题/分割线只靠留白分层、不用装饰线」的视觉规格相悖（三主题一致）。
//   2) 回跳锚点用「左弯箭头 + 变体选择符」（U+21A9 U+FE0E）—— 变体选择符正落在
//      本仓 P0-1「零 emoji」门禁的扫描区间（\uFE00-\uFE0F）里，字面写进源码即违规。
//      更重要的是它是**功能图标**，按项目规则必须语义化，不能用字符充当图标。
//   3) 脚注标题（`脚注` / `Footnotes`）默认不输出，读者看到正文尾部突然出现
//      一串编号列表且无小标题，属于「静默的信息缺失」。
//
// 故这里只替换三处 renderer rule，其余（解析、编号、多段落、命名脚注）全部
// 复用插件本体 —— 不重写解析器（脚注解析的边界极多，自写必错）。
//
// 【编号与 aria】
// 上标编号带 `role="doc-noteref"` 与 `aria-label`，屏幕阅读器读作「脚注 1」，
// 而不是把数字直接读成「一」。回跳链接用箭头形 CMS 图标？不 —— 用**文本**
// `回跳`（语义化、可翻译、零 emoji），且 `aria-label` 说明方向。

import footnote from 'markdown-it-footnote'
import { t } from '../i18n/index.js'

/**
 * 安装脚注。**必须在 render 时才知道语言**，故标题文案走 t()（i18n 唯一真源）。
 *
 * @param {import('markdown-it')} md
 */
export function installFootnote(md) {
  md.use(footnote)

  // 上标引用：`文字[^1]` → `<sup class="footnote-ref"><a …>1</a></sup>`
  md.renderer.rules.footnote_ref = (tokens, idx, options, env, self) => {
    const id = self.rules.footnote_anchor_name(tokens, idx, options, env, self)
    const caption = self.rules.footnote_caption(tokens, idx, options, env, self)
    const refid = tokens[idx].meta.subId > 0 ? `${id}:${tokens[idx].meta.subId}` : id
    const num = String(tokens[idx].meta.id + 1)
    return `<sup class="footnote-ref"><a href="#fn${id}" id="fnref${refid}"` +
      ` role="doc-noteref" aria-label="${t('footnote.ref', { n: num })}">${caption}</a></sup>`
  }

  // 尾部区块开头：去掉裸分割线，改成一个可读小标题（有脚注时才出现）
  md.renderer.rules.footnote_block_open = () =>
    `<section class="footnotes">\n<h2 class="footnotes-title">${t('footnote.title')}</h2>\n` +
    '<ol class="footnotes-list">\n'

  // 回跳：不用 ↩ 字符（功能图标禁字符化），改语义化文本 + aria-label
  md.renderer.rules.footnote_anchor = (tokens, idx, options, env, self) => {
    const id = self.rules.footnote_anchor_name(tokens, idx, options, env, self)
    const sub = tokens[idx].meta.subId > 0 ? `:${tokens[idx].meta.subId}` : ''
    const n = String(tokens[idx].meta.id + 1)
    return ` <a href="#fnref${id}${sub}" class="footnote-backref"` +
      ` aria-label="${t('footnote.back', { n })}">${t('footnote.backText')}</a>`
  }
}
