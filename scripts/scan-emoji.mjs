#!/usr/bin/env node
/**
 * scan-emoji.mjs — P0-1 emoji 门禁的 CLI 封装
 * ============================================================================
 * 用法：node scripts/scan-emoji.mjs [目标目录，默认 frontend/src]
 * 退出码：0 = 通过；1 = 发现 emoji（P0-1 违反）
 *
 * 真正的正则与扫描逻辑在 scripts/emoji-pattern.mjs（唯一真源），本文件只负责
 * 参数解析与输出。拆分理由：真源必须是可被 node --test 直接 import 的 ESM 模块，
 * 而门禁入口要保持「一条命令、任意目录都能扫」的 CLI 形态。
 *
 * 【与 shell 版的行为差异（有意为之）】
 * 原 p0-check-emoji.sh 会在扫描出错时**依然报「通过」**（`2>/dev/null` + `|| true`
 * 吞掉 grep 的失败），是假绿灯来源。本实现遵循 fail-safe：
 *   - 目标路径不存在 → 报错退出 2（不静默通过）
 *   - 读取文件失败 → 该文件跳过，但计数并在结尾汇总（不静默吞掉）
 *   - 发现命中 → 逐条打出 文件:行号 + 码位 + 片段，退出 1
 * ============================================================================
 */

import { listCodeFiles, scanFiles, pathExists } from './emoji-pattern.mjs'

const target = process.argv[2] ?? 'frontend/src'

if (!pathExists(target)) {
  console.error(`P0 门禁：目标路径不存在：${target}`)
  console.error('（不静默通过——请确认路径后重跑；默认应为 frontend/src）')
  process.exit(2)
}

const files = listCodeFiles(target)
const hits = scanFiles(files)

console.log(`P0 门禁：扫描 ${target} 中的 emoji…`)
console.log(`（正则真源 scripts/emoji-pattern.mjs；已扫描 ${files.length} 个代码文件）`)

if (hits.length > 0) {
  console.error(`发现 ${hits.length} 处 emoji（P0-1 违反，退回重做）：`)
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.codepoint}  ${JSON.stringify(h.text)}`)
  }
  process.exit(1)
}

console.log('通过：未发现 emoji 作为功能图标')
process.exit(0)
