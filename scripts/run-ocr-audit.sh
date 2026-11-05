#!/usr/bin/env bash
# ==============================================================================
# run-ocr-audit.sh: 阿里 Open Code Review 自动化审计与门禁阻断脚本
# 基于源码核验陷阱设计：规避字段名不一致(path vs file)、不信任裸退出码、按 severity 阻断
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 项目本地临时沙箱（issue #8）：报告默认落在项目内已 gitignore 的 .loopx/tmp/，
# 禁止硬编码系统 /tmp 固定文件名（多 Agent/多进程互相覆写、重启/清理后证据丢失）。
# LOOPX_TMP_DIR 可覆盖沙箱目录；仍允许第 2 个 CLI 参数显式指定报告路径。
LOOPX_TMP_DIR="${LOOPX_TMP_DIR:-$PROJECT_ROOT/.loopx/tmp}"
mkdir -p "$LOOPX_TMP_DIR"

export PATH="$PATH:$HOME/.npm-global/bin"

BASE_REF="${1:-origin/main}"
REPORT_FILE="${2:-$LOOPX_TMP_DIR/ocr-audit-report-$$.json}"

echo "==> [L1 Audit] 启动阿里 Open Code Review 代码级扫描..."
echo "    - 比较基准: $BASE_REF -> HEAD"
echo "    - 报告输出: $REPORT_FILE"

# 检查 ocr CLI 是否可用
if ! command -v ocr >/dev/null 2>&1; then
    echo "[-] 错误: 未找到 ocr 命令，请确认全局安装: npm install -g @alibaba-group/open-code-review" >&2
    exit 1
fi

# 执行审查命令（强制 json 格式，面向 agent 输出）
ocr review --audience agent --repo . --from "$BASE_REF" --to HEAD --format json --output "$REPORT_FILE"

echo "==> [L1 Audit] 扫描完成，执行结构化缺陷判定..."

python3 - "$REPORT_FILE" << 'PYEOF'
import json, sys

# 报告路径由编排器单点解析（项目沙箱 / CLI 显式覆盖），脚本内不再硬编码系统 /tmp。
report_path = sys.argv[1]

try:
    with open(report_path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print(f"[-] 报告解析失败: {e}", file=sys.stderr)
    sys.exit(1)

comments = data.get("comments", [])
blocking_issues = []
advisory_issues = []

for c in comments:
    severity = str(c.get("severity", "")).lower()
    file_path = c.get("path") or c.get("file") or "unknown"
    line = c.get("line", 0)
    msg = c.get("comment") or c.get("message") or ""
    
    item = {
        "severity": severity,
        "path": file_path,
        "line": line,
        "comment": msg
    }
    
    if severity in ("high", "medium"):
        blocking_issues.append(item)
    else:
        advisory_issues.append(item)

print(f"==> 扫描概览: 共发现 {len(comments)} 条审查意见 (阻断项: {len(blocking_issues)}, 建议项: {len(advisory_issues)})")

if blocking_issues:
    print("\n[!] 发现阻断级缺陷 (High/Medium)，严禁提交 PR，必须就地修复:", file=sys.stderr)
    for idx, item in enumerate(blocking_issues, 1):
        print(f"  {idx}. [{item['severity'].upper()}] {item['path']}:{item['line']}", file=sys.stderr)
        print(f"     详情: {item['comment']}\n", file=sys.stderr)
    sys.exit(1)

if advisory_issues:
    print("\n[i] 存在低优先级/建议项 (Low/Style):")
    for idx, item in enumerate(advisory_issues[:5], 1):
        print(f"  {idx}. [{item['severity'].upper()}] {item['path']}:{item['line']} - {item['comment'][:80]}")

print("\n[✓] L1 审计全绿：零 High/Medium 缺陷，允许推进交付。")
sys.exit(0)
PYEOF
