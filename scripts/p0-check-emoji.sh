#!/bin/bash
# P0 门禁：emoji 扫描（零容忍）
# 用法：./scripts/p0-check-emoji.sh [扫描目录，默认 frontend/src]
# 退出码：0 = 通过；1 = 发现 emoji
# 依据：专家团 P0-1 绝对规则

set -uo pipefail
TARGET="${1:-frontend/src}"
# P0-1 emoji 正则（专家团门禁口径）
PATTERN='[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{FE00}-\x{FE0F}\x{1F000}-\x{1F02F}\x{1F0A0}-\x{1F0FF}\x{1F100}-\x{1F64F}\x{1F680}-\x{1F6FF}\x{1F900}-\x{1F9FF}\x{1FA00}-\x{1FA6F}\x{1FA70}-\x{1FAFF}\x{200D}\x{20E3}\x{E0020}-\x{E007F}]'

echo "P0 门禁：扫描 $TARGET 中的 emoji…"
HITS=$(grep -rInE "$PATTERN" "$TARGET" \
  --include='*.vue' --include='*.js' --include='*.ts' \
  --include='*.jsx' --include='*.tsx' --include='*.html' \
  2>/dev/null | grep -v '^\s*//' || true)

if [ -n "$HITS" ]; then
  echo "❌ 发现 emoji（P0-1 违反，退回重做）："
  echo "$HITS"
  exit 1
fi
echo "✅ 通过：未发现 emoji 作为功能图标"
exit 0
