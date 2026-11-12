#!/usr/bin/env bash
# ==============================================================================
# fast-fix-push.sh: Fast-Path 分支 + PR 创建器
#
# 用法:
#   fast-fix-push.sh <ISSUE_ID> [COMMIT_MSG]
#
# 铁律 (REQ-ISSUE-PIPELINE-1 / ADR-0012 决策 7):
#   - 永不直推主干，永不快进 main，永不自动 approve / 自动 merge。
#   - 只做四件事:
#       1) 从当前 HEAD 创建分支 fast-fix/issue-<id>-<epoch>
#       2) 在新分支提交本地改动（无改动则沿用当前 HEAD）
#       3) git push -u origin <branch>
#       4) gh pr create（正文含 Fixes #<id> 与门禁证据段）
#   - 打印按 authorization_mode 决定的 Gate2 人工下一步。
#   - 任一步失败非 0；脚本不代替 Gate2，不产生任何授权记录。
# ==============================================================================
set -euo pipefail

usage() {
    cat >&2 <<'EOF'
用法: fast-fix-push.sh <ISSUE_ID> [COMMIT_MSG]

只创建 fast-fix 分支与 PR：
  - 不直推主干、不快进 main、不自动审批、不自动合并。
  - Gate2 必须由人工按 authorization_mode 完成后，再用 loopx-flow merge 合入。
EOF
}

fail() {
    echo "[-] [Fast-Path] $*" >&2
    exit 1
}

ISSUE_ID="${1:-}"
COMMIT_MSG="${2:-}"

if [[ -z "$ISSUE_ID" ]]; then
    echo "[-] [Fast-Path] 缺少 ISSUE_ID" >&2
    usage
    exit 1
fi

if [[ ! "$ISSUE_ID" =~ ^[0-9]+$ ]]; then
    fail "ISSUE_ID 必须是 GitHub Issue 数字编号: $ISSUE_ID"
fi

# ---------------------------------------------------------------------------
# 0. 前置能力检查（缺 git / gh / 非仓库 / 未认证均非 0）
# ---------------------------------------------------------------------------
command -v git >/dev/null 2>&1 || fail "缺少 git"
command -v gh  >/dev/null 2>&1 || fail "缺少 gh (GitHub CLI)"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "当前目录不是 Git 仓库"
gh auth status >/dev/null 2>&1 || fail "gh 未认证，请先执行 gh auth login"

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG_PATH="${REPO_ROOT}/loopx-workflow.config.json"

if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG="fix: fast-path fix for issue #${ISSUE_ID}"
fi
if [[ "$COMMIT_MSG" != *"#${ISSUE_ID}"* ]]; then
    COMMIT_MSG="${COMMIT_MSG} (Fixes #${ISSUE_ID})"
fi

echo "==> [Fast-Path] Issue #${ISSUE_ID}"
echo "    - 提交信息: ${COMMIT_MSG}"

# ---------------------------------------------------------------------------
# 1. 从当前 HEAD 创建 fast-fix 分支（本地工作区改动随分支切换保留，不落到原分支）
# ---------------------------------------------------------------------------
BRANCH_NAME="fast-fix/issue-${ISSUE_ID}-$(date +%s)"
if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
    fail "本地已存在同名分支: ${BRANCH_NAME}"
fi
echo "==> [Fast-Path] 从当前 HEAD 创建分支: ${BRANCH_NAME}"
git checkout -b "$BRANCH_NAME" || fail "创建分支失败: ${BRANCH_NAME}"

# ---------------------------------------------------------------------------
# 2. 在新分支上提交本地改动（无改动时沿用当前 HEAD，不算失败）
# ---------------------------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
    echo "==> [Fast-Path] 提交本地改动..."
    git add -A || fail "git add 失败"
    git commit -m "$COMMIT_MSG" || fail "git commit 失败"
else
    echo "[i] [Fast-Path] 工作区无改动，使用当前 HEAD"
fi

HEAD_SHA="$(git rev-parse HEAD)"

# ---------------------------------------------------------------------------
# 3. 推送分支（永不推送主干）
# ---------------------------------------------------------------------------
echo "==> [Fast-Path] 推送分支到 origin..."
git push -u origin "$BRANCH_NAME" || fail "推送分支失败: ${BRANCH_NAME}"

# ---------------------------------------------------------------------------
# 4. 创建 PR（正文含 Fixes #<id> + 门禁证据段）
# ---------------------------------------------------------------------------
PR_BODY="$(cat <<EOF
## Fast-Path 修复 (Issue #${ISSUE_ID})

Fixes #${ISSUE_ID}

### 变更说明
- 本次改动由 Fast-Path 分支进入 PR，未直推主干。
- 分支: ${BRANCH_NAME}
- HEAD: ${HEAD_SHA}

### 门禁证据 (Gate Evidence)
- 本地四大硬门禁 (typecheck / lint / build / test): 以 loopx-flow check 产出的质量收据与 CI "Four Gates" 状态检查为准。
- 代码审查: 由 loopx-flow review 发布 formal review，正文含精确 HEAD 与五段结论。
- Gate2 授权: 必须由人工按 authorization_mode 完成，本 PR 的创建不代表任何授权。

### 合并方式
- 只允许 loopx-flow merge 在 Gate2 通过后合入；禁止自动合并。
EOF
)"

echo "==> [Fast-Path] 创建 GitHub PR..."
if ! PR_URL="$(gh pr create --title "$COMMIT_MSG" --body "$PR_BODY" --head "$BRANCH_NAME")"; then
    fail "创建 PR 失败 (分支 ${BRANCH_NAME} 已推送)"
fi

PR_NUMBER="${PR_URL##*/}"
echo "==> [Fast-Path] PR 已创建: ${PR_URL}"
echo "    分支: ${BRANCH_NAME}"
echo "    HEAD: ${HEAD_SHA}"

# ---------------------------------------------------------------------------
# 5. 打印 Gate2 人工下一步（按 authorization_mode，缺/非法配置 fail closed）
# ---------------------------------------------------------------------------
resolve_mode() {
    local mode=""
    [[ -f "$CONFIG_PATH" ]] || return 1
    mode="$(node -e '
const fs = require("fs");
let d;
try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (_) { process.exit(2); }
if (!d || typeof d !== "object" || Array.isArray(d)) process.exit(2);
if (typeof d.schema_version !== "undefined" && d.schema_version !== "loopx_workflow_config_v0") process.exit(3);
const mode = d.authorization_mode;
if (mode !== "independent" && mode !== "single_owner") process.exit(4);
process.stdout.write(mode);
' "$CONFIG_PATH" 2>/dev/null || true)"
    case "$mode" in
        independent|single_owner) printf '%s' "$mode" ;;
        *) return 1 ;;
    esac
}

if ! MODE="$(resolve_mode)"; then
    echo "[!] [Fast-Path] 无法从配置解析 authorization_mode: ${CONFIG_PATH}" >&2
    echo "    Gate2 模式未知，fail closed；请先执行 loopx-flow init 修复配置。" >&2
    echo "    PR 已创建但未审批、未合并: ${PR_URL}" >&2
    exit 1
fi

echo ""
echo "==> [Fast-Path] Gate2 必须由人工完成（本脚本不自动 approve / merge）"
case "$MODE" in
    independent)
        cat <<EOF
    模式: Mode A (independent)
    1) 非作者真人审阅 PR 并在 GitHub 页面点击 Approve:
       ${PR_URL}
    2) 审批覆盖当前 HEAD 后，在本机执行:
       loopx-flow merge ${PR_NUMBER}
EOF
        ;;
    single_owner)
        cat <<EOF
    模式: Mode B (single_owner)
    1) Owner 在本机 TTY 执行:
       loopx-flow release-approve ${PR_NUMBER}
    2) 授权记录写入 PR 后执行:
       loopx-flow merge ${PR_NUMBER}
EOF
        ;;
esac
echo ""
echo "[i] 若分支保护尚未就绪，先执行: scripts/setup-branch-protection.sh --check"

exit 0
