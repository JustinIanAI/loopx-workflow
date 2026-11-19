#!/usr/bin/env bash
# ==============================================================================
# run-ocr-audit.sh: 阿里 Open Code Review 自动化审计与门禁阻断脚本
# 基于源码核验陷阱设计：规避字段名不一致(path vs file)、不信任裸退出码、按 severity 阻断
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=../lib/paths.sh
source "$SCRIPT_DIR/../lib/paths.sh"
wf_init_paths

export PATH="$PATH:$HOME/.npm-global/bin"

BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
    BASE_REF="$(wf_discover_base_ref "$EFFECTIVE_ROOT" || echo "origin/main")"
fi
REPORT_FILE="${2:-}"
if [[ -z "$REPORT_FILE" ]]; then
    wf_run_dir ocr-audit
    REPORT_FILE="$WF_RUN_DIR/ocr-audit-report.json"
fi

echo "==> [L1 Audit] 启动阿里 Open Code Review 代码级扫描..."
echo "    - 比较基准: $BASE_REF -> HEAD"
echo "    - 报告输出: $REPORT_FILE"

# 检查 ocr CLI 是否可用
if ! command -v ocr >/dev/null 2>&1; then
    echo "[-] 错误: 未找到 ocr 命令，请确认全局安装: npm install -g @alibaba-group/open-code-review" >&2
    exit 1
fi

# 执行审查命令（强制 json 格式，面向 agent 输出）
ocr review --audience agent --repo "$EFFECTIVE_ROOT" --from "$BASE_REF" --to HEAD --format json --output "$REPORT_FILE"

echo "==> [L1 Audit] 扫描完成，执行结构化缺陷判定..."

node - "$REPORT_FILE" << 'NODE'
const fs = require('node:fs');
const reportPath = process.argv[2];
let data;
try {
  data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (e) {
  console.error(`[-] 报告解析失败: ${e.message}`);
  process.exit(1);
}
const comments = Array.isArray(data.comments) ? data.comments : [];
const blocking = [];
const advisory = [];
for (const c of comments) {
  const severity = String((c && c.severity) || '').toLowerCase();
  const item = {
    severity,
    path: (c && (c.path || c.file)) || 'unknown',
    line: (c && c.line) || 0,
    comment: (c && (c.comment || c.message)) || '',
  };
  if (severity === 'high' || severity === 'medium') blocking.push(item);
  else advisory.push(item);
}
console.log(`==> 扫描概览: 共发现 ${comments.length} 条审查意见 (阻断项: ${blocking.length}, 建议项: ${advisory.length})`);
if (blocking.length) {
  console.error('\n[!] 发现阻断级缺陷 (High/Medium)，严禁提交 PR，必须就地修复:');
  blocking.forEach((item, i) => {
    console.error(`  ${i + 1}. [${item.severity.toUpperCase()}] ${item.path}:${item.line}`);
    console.error(`     详情: ${item.comment}\n`);
  });
  process.exit(1);
}
if (advisory.length) {
  console.log('\n[i] 存在低优先级/建议项 (Low/Style):');
  advisory.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i + 1}. [${item.severity.toUpperCase()}] ${item.path}:${item.line} - ${item.comment.slice(0, 80)}`);
  });
}
console.log('\n[✓] L1 审计全绿：零 High/Medium 缺陷，允许推进交付。');
NODE
