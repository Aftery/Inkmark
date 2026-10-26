// markdown/emoji.js — `:shortcode:` 表情的唯一口径
// ----------------------------------------------------------------------------
// 【为什么单独一层】短码表情要在两处生效：markdown-it 渲染器（预览 / 导出）与
// 编辑器 WYSIWYG（把 `:smile:` 直接画成对应表情字符）。两处的「短码 → 字符」映射必须
// 是同一份数据，否则会出现「导出是表情、编辑器是源码」这种同文档两副面孔的
// 缺陷 —— 而且完全静默。
//
// 【数据来源】直接用 markdown-it-emoji 自带的全量表（约 1800 条，含 GitHub
// 别名），不再引第二份 emoji 名单。这样两边覆盖范围天然一致，也不会出现
// 「编辑器认 :white_check_mark:、渲染器不认」的漂移。
//
// 【为什么编辑器侧需要 LOOKUP 而不是插件】
// 编辑器只有 lezer 语法树的 `Emoji` 节点（`:smile:` 的区间），它不认识短码
// 是否合法。故编辑器侧走 `emojiFor(shortcode)`：命中才替换成表情字符，未命中
// （`:not_an_emoji:`）保持源码原样 —— 与 GitHub 行为一致（不认识的短码就是
// 文本，不该被吞掉）。

import data from 'markdown-it-emoji/lib/data/full.mjs'
import { bare } from 'markdown-it-emoji'

/** 短码名（不含冒号）→ emoji 字符。唯一真源。 */
export const EMOJI_LOOKUP = data

/**
 * 取短码对应的表情。
 *
 * @param {string} name 短码名，可带或不带两侧冒号（`:smile:` 或 `smile`）
 * @returns {string|null} 命中返回表情字符，未命中返回 null
 */
export function emojiFor(name) {
  if (!name) return null
  const key = String(name).trim().replace(/^:+|:+$/g, '')
  if (!key) return null
  return Object.prototype.hasOwnProperty.call(EMOJI_LOOKUP, key) ? EMOJI_LOOKUP[key] : null
}

/**
 * markdown-it 插件：`:shortcode:` → 表情字符。
 *
 * 【为什么用 `bare` + 自己传 defs，而不是直接用 `full`】
 * `full` 多带一份 emoticon 快捷表（`:smile:` 之外还有 `:)`、`;)`、`:+1:` 之类），
 * 其中 `8)` `;)` `;)` 这类**纯标点序列**在中文技术文档里误伤率很高
 * （实测：`价格 8) 结束` 会被改成 `价格` + U+1F60E + ` 结束`，而用户根本没写表情；
 * 具体码位不写进注释 —— 本仓 P0-1 门禁扫的是源码文本，字面 emoji 一律违规）。
 * 本仓要的是「用户显式写了 `:code:` 才渲染」，故用 bare（只认短码）配 full 表
 * （覆盖 GitHub 全部 1800 条别名，`:white_check_mark:` / `:bulb:` 都认）。
 *
 * 「未命中的短码保持文本」（`:not_real:`）由 bare 的替换规则天然保证 ——
 * 表里没有就原样留下，与 GitHub 行为一致。
 *
 * @param {import('markdown-it')} md
 */
export function emojiPlugin(md) {
  md.use(bare, { defs: EMOJI_LOOKUP })
}
