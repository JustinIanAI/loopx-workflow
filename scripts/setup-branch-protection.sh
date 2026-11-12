#!/usr/bin/env bash
# ==============================================================================
# setup-branch-protection.sh: Gate2 分支保护检查与收敛 (REQ-CI-PROTECTION-1)
#
# 用法:
#   setup-branch-protection.sh [--mode independent|single_owner] [--branch main] [--check|--apply]
#
#   --check   只读: 读取当前分支保护并输出一行 JSON 结论; ok=true 才 exit 0 (默认动作)
#   --apply   幂等收敛分支保护 (PUT; single_owner 额外 DELETE required_pull_request_reviews),
#             然后内部执行 --check 并按其结果退出
#   --mode    显式指定模式; 缺省时读取仓库根 loopx-workflow.config.json 的 authorization_mode
#   --branch  目标分支, 默认 main (允许字母/数字/. _ -, 不含 /)
#
# 退出码:
#   0  --check: ok=true; --apply: 收敛后 --check ok=true
#   1  --check: ok=false (stdout 仍输出 JSON 结论); --apply: 任一步失败
#   2  用法错误 / 配置缺失或非法 / 模式非法 / 分支名非法 (fail closed, 不输出 JSON)
#
# 模式规则 (ADR-0012 决策 1/5/7):
#   independent : PR review (required_approving_review_count >= 1 + dismiss_stale_reviews
#                 + require_last_push_approval) + status check (context = "Four Gates", strict)
#   single_owner: 只要求 PR + status check (context = "Four Gates", strict); 不得要求 approving review
#   两者共同: enforce_admins=true, allow_force_pushes=false, allow_deletions=false
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${PROJECT_ROOT}/loopx-workflow.config.json"

SCHEMA_VERSION="branch_protection_check_v0"
STATUS_CHECK_CONTEXT="Four Gates"

MODE=""
BRANCH="main"
ACTION="check"
REPO=""

usage() {
    cat >&2 <<'EOF'
用法: setup-branch-protection.sh [--mode independent|single_owner] [--branch main] [--check|--apply]

  --check   只读检查 (默认); 输出一行 JSON, ok=true 时 exit 0
  --apply   幂等收敛分支保护, 然后内部 --check 并按其结果退出
  --mode    显式模式; 缺省读取 loopx-workflow.config.json 的 authorization_mode
  --branch  目标分支, 默认 main

分支保护规则按 authorization_mode 区分 (见 ADR-0012):
  independent  : PR + >=1 approving review + status check "Four Gates" (strict)
  single_owner : PR + status check "Four Gates" (strict), 不要求 approving review
共同: enforce_admins=true, allow_force_pushes=false, allow_deletions=false
EOF
}

fail() {
    echo "[-] [setup-branch-protection] $*" >&2
    exit 2
}

log() {
    echo "[setup-branch-protection] $*" >&2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)
            [[ $# -ge 2 ]] || fail "缺少 --mode 参数值"
            MODE="$2"
            shift 2
            ;;
        --branch)
            [[ $# -ge 2 ]] || fail "缺少 --branch 参数值"
            BRANCH="$2"
            shift 2
            ;;
        --check|--apply)
            ACTION="${1#--}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "未知参数: $1"
            ;;
    esac
done

if [[ ! "$BRANCH" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail "branch 非法 (仅支持不含 / 的分支名): $BRANCH"
fi

# ---------------------------------------------------------------------------
# 模式解析: 显式 --mode 胜出; 否则读配置; 缺失/非法 → fail closed (exit 2)
# ---------------------------------------------------------------------------
if [[ -n "$MODE" ]]; then
    case "$MODE" in
        independent|single_owner) ;;
        *) fail "非法 --mode: $MODE (可选 independent|single_owner)" ;;
    esac
else
    [[ -f "$CONFIG_PATH" ]] || fail "缺少授权配置: $CONFIG_PATH (fail closed; 先执行 loopx-flow init)"
    if PARSED_MODE="$(node -e '
const fs = require("fs");
let config;
try { config = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (_) { process.exit(2); }
if (!config || typeof config !== "object" || Array.isArray(config)) process.exit(2);
if (typeof config.schema_version !== "undefined" && config.schema_version !== "loopx_workflow_config_v0") process.exit(3);
const mode = config.authorization_mode;
if (mode !== "independent" && mode !== "single_owner") process.exit(4);
process.stdout.write(mode);
' "$CONFIG_PATH" 2>/dev/null)"; then
        MODE="$PARSED_MODE"
    else
        RC=$?
        case "$RC" in
            2) fail "配置不是合法 JSON 对象: $CONFIG_PATH [config_invalid]" ;;
            3) fail "配置 schema_version 非法: $CONFIG_PATH [config_invalid]" ;;
            4) fail "authorization_mode 缺失或非法: $CONFIG_PATH [mode_invalid]" ;;
            *) fail "无法解析授权配置: $CONFIG_PATH [config_invalid]" ;;
        esac
    fi
fi

case "$MODE" in
    independent|single_owner) ;;
    *) fail "模式非法: $MODE [mode_invalid]" ;;
esac

# ---------------------------------------------------------------------------
# 公共辅助
# ---------------------------------------------------------------------------
resolve_repo() {
    local repo
    if repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"; then
        repo="$(printf '%s' "$repo" | tr -d '[:space:]')"
        if [[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
            REPO="$repo"
            return 0
        fi
    fi
    return 1
}

emit_check_json() {
    local ok="$1"
    shift
    node -e '
const result = {
  schema_version: process.argv[2],
  ok: process.argv[1] === "true",
  mode: process.argv[3],
  branch: process.argv[4],
  reasons: process.argv.slice(5)
};
process.stdout.write(JSON.stringify(result) + "\n");
' "$ok" "$SCHEMA_VERSION" "$MODE" "$BRANCH" "$@"
}

classify_api_failure() {
    local text="${1:-}"
    case "$text" in
        *"HTTP 404"*|*"Not Found"*|*"Branch not protected"*)
            printf 'protection_missing' ;;
        *)
            printf 'gh_api_failed' ;;
    esac
}

# 用 node 解析保护 JSON 并按模式比较; 输出唯一一行 JSON; exit 0/1 表达 ok
NODE_COMPARE='
const fs = require("fs");
const mode = process.argv[1];
const branch = process.argv[2];
const reasons = [];
let protection = null;
let parseFailed = false;
try { protection = JSON.parse(fs.readFileSync(0, "utf8")); }
catch (_) { parseFailed = true; }

const enabled = (value) => {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && typeof value.enabled === "boolean") return value.enabled;
  return null;
};

if (parseFailed || !protection || typeof protection !== "object" || Array.isArray(protection)) {
  reasons.push("malformed_protection_json");
} else {
  const requiredStatusChecks = protection.required_status_checks;
  if (!requiredStatusChecks || typeof requiredStatusChecks !== "object") {
    reasons.push("required_status_checks_missing");
  } else {
    const contexts = Array.isArray(requiredStatusChecks.contexts) ? requiredStatusChecks.contexts : [];
    const checks = Array.isArray(requiredStatusChecks.checks)
      ? requiredStatusChecks.checks.map((item) => (item && item.context) || "")
      : [];
    if (!contexts.includes("Four Gates") && !checks.includes("Four Gates")) {
      reasons.push("status_check_four_gates_missing");
    }
    if (requiredStatusChecks.strict !== true) reasons.push("status_check_not_strict");
  }

  const requiredReviews = protection.required_pull_request_reviews;
  if (mode === "independent") {
    if (!requiredReviews || typeof requiredReviews !== "object") {
      reasons.push("required_pull_request_reviews_missing");
    } else {
      const count = requiredReviews.required_approving_review_count;
      if (!(typeof count === "number" && count >= 1)) reasons.push("required_approving_review_count_below_1");
      if (requiredReviews.dismiss_stale_reviews !== true) reasons.push("dismiss_stale_reviews_disabled");
      if (requiredReviews.require_last_push_approval !== true) reasons.push("require_last_push_approval_disabled");
    }
  } else if (mode === "single_owner") {
    if (requiredReviews && typeof requiredReviews === "object") {
      reasons.push("unexpected_required_pull_request_reviews");
    }
  }

  if (enabled(protection.enforce_admins) !== true) reasons.push("enforce_admins_disabled");
  if (enabled(protection.allow_force_pushes) !== false) reasons.push("force_pushes_allowed");
  if (enabled(protection.allow_deletions) !== false) reasons.push("deletions_allowed");
}

const result = {
  schema_version: "branch_protection_check_v0",
  ok: reasons.length === 0,
  mode: mode,
  branch: branch,
  reasons: reasons
};
process.stdout.write(JSON.stringify(result) + "\n");
process.exit(reasons.length === 0 ? 0 : 1);
'

run_compare() {
    local raw="$1" out status
    if out="$(printf '%s' "$raw" | node -e "$NODE_COMPARE" "$MODE" "$BRANCH")"; then
        printf '%s\n' "$out"
        return 0
    else
        status=$?
        printf '%s\n' "$out"
        return "$status"
    fi
}

# ---------------------------------------------------------------------------
# --check: 只读; 无论 gh 缺失/未认证/404/JSON 非法都输出 ok=false + reason
# ---------------------------------------------------------------------------
run_check() {
    if ! command -v gh >/dev/null 2>&1; then
        emit_check_json false gh_missing
        return 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        emit_check_json false gh_unauthenticated
        return 1
    fi
    if ! resolve_repo; then
        emit_check_json false repo_identity_unresolved
        return 1
    fi

    local out
    if out="$(gh api "repos/${REPO}/branches/${BRANCH}/protection" 2>&1)"; then
        run_compare "$out"
        return $?
    else
        emit_check_json false "$(classify_api_failure "$out")"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# --apply: 幂等收敛后再跑 --check
# ---------------------------------------------------------------------------
run_apply() {
    if ! command -v gh >/dev/null 2>&1; then
        echo "[-] [setup-branch-protection] 缺少 gh" >&2
        return 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        echo "[-] [setup-branch-protection] gh 未认证" >&2
        return 1
    fi
    if ! resolve_repo; then
        echo "[-] [setup-branch-protection] 无法解析 owner/repo" >&2
        return 1
    fi

    log "apply mode=${MODE} branch=${BRANCH} repo=${REPO}"

    if [[ "$MODE" == "single_owner" ]]; then
        log "single_owner: 清除 required_pull_request_reviews (若存在)"
        local out
        if out="$(gh api --method DELETE "repos/${REPO}/branches/${BRANCH}/protection/required_pull_request_reviews" 2>&1)"; then
            log "  -> 已删除 required_pull_request_reviews"
        else
            case "$out" in
                *"HTTP 404"*|*"Not Found"*|*"Required reviews not enabled"*)
                    log "  -> 未启用 required_pull_request_reviews，跳过" ;;
                *)
                    echo "[-] [setup-branch-protection] 删除 required_pull_request_reviews 失败: $out" >&2
                    return 1 ;;
            esac
        fi
    fi

    local payload
    if ! payload="$(node -e '
const mode = process.argv[1];
const payload = {
  required_status_checks: { strict: true, contexts: ["Four Gates"] },
  enforce_admins: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_pull_request_reviews: null,
  restrictions: null
};
if (mode === "independent") {
  payload.required_pull_request_reviews = {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 1,
    require_last_push_approval: true
  };
}
process.stdout.write(JSON.stringify(payload));
' "$MODE")"; then
        echo "[-] [setup-branch-protection] 生成分支保护载荷失败" >&2
        return 1
    fi

    log "PUT 分支保护..."
    local put_out
    if ! put_out="$(printf '%s' "$payload" | gh api --method PUT "repos/${REPO}/branches/${BRANCH}/protection" --input - 2>&1)"; then
        echo "[-] [setup-branch-protection] 收敛分支保护失败 (PUT): ${put_out}" >&2
        return 1
    fi

    log "收敛完成，执行 --check 验证..."
    if run_check; then
        log "分支保护已收敛并通过校验"
        return 0
    fi
    return 1
}

case "$ACTION" in
    check)
        if run_check; then exit 0; else exit 1; fi
        ;;
    apply)
        if run_apply; then exit 0; else exit 1; fi
        ;;
    *)
        fail "未知动作: $ACTION"
        ;;
esac
