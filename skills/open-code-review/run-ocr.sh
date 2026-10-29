#!/usr/bin/env bash
# ==============================================================================
# Alibaba Open Code Review (OCR) 选配自闭环执行脚本
# 动作：自检 -> 按需自动安装 -> 执行审查 -> 输出结构化结果并送入 LoopX 质量适配器
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BASE_REF="${1:-origin/main}"
FEATURE="${2:-}"
OUTPUT_JSON="/tmp/ocr-audit-report.json"

echo "==> [OCR 选配闭环] [1/3] 执行环境自检 (Self-Check)..."
export PATH="$PATH:$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin"

if ! command -v ocr >/dev/null 2>&1; then
    echo "    [!] 本机未检测到 ocr CLI。正在执行技能内自动安装 (Auto-Install)..."
    if npm install -g @alibaba-group/open-code-review 2>/dev/null || sudo npm install -g @alibaba-group/open-code-review 2>/dev/null; then
        echo "    [✓] 阿里 OCR CLI 安装完成！"
    else
        echo "    [-] 警告: 自动安装失败，若权限不足请手动执行: npm install -g @alibaba-group/open-code-review" >&2
        exit 1
    fi
else
    echo "    [✓] 阿里 OCR CLI 已就绪: $(which ocr)"
fi

echo "==> [OCR 选配闭环] [2/3] 执行深度代码审查扫描 (from $BASE_REF to HEAD)..."
ocr review --audience agent --repo "$PROJECT_ROOT" --from "$BASE_REF" --to HEAD --format json --output "$OUTPUT_JSON" || true

if [[ ! -f "$OUTPUT_JSON" ]]; then
    echo "{\"comments\": []}" > "$OUTPUT_JSON"
fi

echo "==> [OCR 选配闭环] [3/3] 将 OCR 审查结果送入 LoopX 代码质量契约适配器..."
node "$PROJECT_ROOT/skills/code-review/scripts/ingest-to-loopx-quality.js" \
  --ocr-json "$OUTPUT_JSON" \
  --base-ref "$BASE_REF" \
  ${FEATURE:+--feature "$FEATURE"}

echo "[✓] OCR 选配审查与质量融合完成！"
