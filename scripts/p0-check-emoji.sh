#!/bin/bash
# P0 门禁：emoji 扫描（零容忍）—— 薄封装，真源在 scripts/emoji-pattern.mjs
#
# 用法：./scripts/p0-check-emoji.sh [扫描目录，默认 frontend/src]
# 退出码：0 = 通过；1 = 发现 emoji；2 = 目标路径不存在
#
# ---------------------------------------------------------------------------
# 【为什么改成薄封装：一次真实的假绿灯事故】
# 本脚本原为单文件实现，用 GNU grep 的 `-P` + `\x{H}` 码点语法扫描。但 macOS 自带
# grep 是 BSD / toybox（本机 toybox 0.8.13）**不支持 `-P`**（实测报
# `grep: invalid option -- P`），而原脚本第 13-16 行同时写了 `2>/dev/null`（吞 stderr）
# 与 `|| true`（吞非零退出码），于是 grep 失败被当成「无命中」→ **永远打印「通过」exit 0**。
# 往 frontend/src 注入真实 U+1F600 仍报「✅ 通过」，而 node --test 同时报 fail——
# 即当时的门禁在 macOS 上完全无效，AC-07 没有证据支撑。
# 现在扫描逻辑搬到 Node（RegExp 的 u flag 原生支持 \u{H}），本文件只做转发。
# 刻意【不保留】`2>/dev/null` / `|| true`：那正是报错被吞、假绿灯的元凶。
# ---------------------------------------------------------------------------
#
# 【下面这行 PATTERN 仅供 frontend/tests/contracts.test.mjs 读取】
# 真源在 scripts/emoji-pattern.mjs（RegExp 字面量形态）。加载器优先读 JS 模块，
# 本行是回退路径与「双源并存则码点区间必须一致」那条交叉校验的比对对象。
# **改任一处必须同步另一处**，否则 contracts.test.mjs 会报红。
# 注意码点写法是 shell 风格的 \x{H}（与 JS 的 \u{H} 在 u flag 下语义等价）。
PATTERN='[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{FE00}-\x{FE0F}\x{1F000}-\x{1F02F}\x{1F0A0}-\x{1F0FF}\x{1F100}-\x{1F64F}\x{1F680}-\x{1F6FF}\x{1F900}-\x{1F9FF}\x{1FA00}-\x{1FA6F}\x{1FA70}-\x{1FAFF}\x{200D}\x{20E3}\x{E0020}-\x{E007F}]'

set -uo pipefail
exec node "$(dirname "$0")/scan-emoji.mjs" "$@"
