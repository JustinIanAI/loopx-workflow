#!/usr/bin/env bash
# ==============================================================================
# lib/paths.sh: loopx-workflow 唯一路径锚定与运行沙箱模块 (ADR-0007 / D1 / D2)
#
# 职责边界：
#   - 只管理 loopx-workflow 编排层自身路径与运行目录；不触碰 LoopX 原生运行态。
#   - 区分 WORKFLOW_ROOT（脚本/技能静态资产）与 REPO_ROOT（被操作的目标 Git 仓库）。
#   - 统一提供 wf_run_dir / wf_cleanup、wf_require_registry（worktree fail-closed）、
#     REGISTRY_ARGS 数组（支持含空格路径）与 wf_codex_home。
# ==============================================================================

if [[ -z "${_WF_PATHS_SH_LOADED:-}" ]]; then
_WF_PATHS_SH_LOADED=1

WORKFLOW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPO_ROOT=""
EFFECTIVE_ROOT="$WORKFLOW_ROOT"
IS_GIT_REPO=0
LOOPX_REGISTRY_PATH=""
LOOPX_REGISTRY_EXPLICIT=0
REGISTRY_ARGS=()
WF_RUN_DIR=""
_WF_CLEANUP_FILES=()
_WF_TRAP_INSTALLED=0

wf_codex_home() {
    printf '%s' "${CODEX_HOME:-$HOME/.codex}"
}

wf_resolve_repo_root() {
    local cwd="${1:-$PWD}" top=""
    if top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" && [[ -n "$top" && -d "$top" ]]; then
        (cd "$top" && pwd -P)
        return 0
    fi
    return 1
}

wf_init_paths() {
    local explicit_registry="${1:-}"
    if REPO_ROOT="$(wf_resolve_repo_root "$PWD")"; then
        IS_GIT_REPO=1
        EFFECTIVE_ROOT="$REPO_ROOT"
    else
        REPO_ROOT=""
        IS_GIT_REPO=0
        EFFECTIVE_ROOT="$WORKFLOW_ROOT"
    fi

    LOOPX_TMP_DIR="${LOOPX_TMP_DIR:-$EFFECTIVE_ROOT/.loopx/tmp}"
    LOOPX_CACHE_DIR="$EFFECTIVE_ROOT/.loopx/cache"
    LOOPX_REVIEW_CACHE_DIR="$LOOPX_CACHE_DIR/reviews"

    if [[ -n "$explicit_registry" ]]; then
        LOOPX_REGISTRY_PATH="$explicit_registry"
        LOOPX_REGISTRY_EXPLICIT=1
    elif [[ -n "${LOOPX_REGISTRY:-}" ]]; then
        LOOPX_REGISTRY_PATH="$LOOPX_REGISTRY"
        LOOPX_REGISTRY_EXPLICIT=1
    else
        LOOPX_REGISTRY_PATH="$EFFECTIVE_ROOT/.loopx/registry.json"
        LOOPX_REGISTRY_EXPLICIT=0
    fi

    REGISTRY_ARGS=()
    if [[ -f "$LOOPX_REGISTRY_PATH" ]]; then
        REGISTRY_ARGS=(--registry "$LOOPX_REGISTRY_PATH")
    fi
}

wf_require_repo_root() {
    if [[ "$IS_GIT_REPO" -ne 1 || -z "$REPO_ROOT" ]]; then
        echo "[-] [FAIL-CLOSED] 当前目录不是 Git 仓库（无法锚定 REPO_ROOT）: $PWD" >&2
        exit 1
    fi
}

wf_registry_display_flag() {
    if [[ "${#REGISTRY_ARGS[@]}" -eq 2 ]]; then
        local q
        printf -v q '%q' "${REGISTRY_ARGS[1]}"
        printf '%s' "--registry $q"
    fi
}

wf_is_linked_worktree() {
    local root="${1:-$REPO_ROOT}" git_dir="" common_dir=""
    [[ -n "$root" ]] || return 1
    git_dir="$(git -C "$root" rev-parse --git-dir 2>/dev/null || true)"
    common_dir="$(git -C "$root" rev-parse --git-common-dir 2>/dev/null || true)"
    [[ -n "$git_dir" && -n "$common_dir" ]] || return 1
    git_dir="$(cd "$root" && cd "$git_dir" && pwd -P)"
    common_dir="$(cd "$root" && cd "$common_dir" && pwd -P)"
    [[ "$git_dir" != "$common_dir" ]]
}

wf_main_checkout_registry_hint() {
    local root="${1:-$REPO_ROOT}" common_dir="" is_bare="" main_root=""
    [[ -n "$root" ]] || return 1
    is_bare="$(git -C "$root" rev-parse --is-bare-repository 2>/dev/null || echo "true")"
    [[ "$is_bare" == "false" ]] || return 1
    common_dir="$(git -C "$root" rev-parse --git-common-dir 2>/dev/null || true)"
    [[ -n "$common_dir" ]] || return 1
    common_dir="$(cd "$root" && cd "$common_dir" && pwd -P)"
    main_root="$(dirname "$common_dir")"
    if [[ -f "$main_root/.loopx/registry.json" ]]; then
        printf '%s' "$main_root/.loopx/registry.json"
        return 0
    fi
    return 1
}

# D1: 强制校验 LoopX registry 存在；附属 worktree 缺 registry 一律 fail-closed，
# 只提示主 checkout 候选路径，绝不自动回指。
wf_require_registry() {
    wf_require_repo_root
    if [[ -f "$LOOPX_REGISTRY_PATH" ]]; then
        REGISTRY_ARGS=(--registry "$LOOPX_REGISTRY_PATH")
        return 0
    fi
    if [[ "$LOOPX_REGISTRY_EXPLICIT" -eq 0 ]] && wf_is_linked_worktree "$REPO_ROOT"; then
        local hint=""
        hint="$(wf_main_checkout_registry_hint "$REPO_ROOT" || true)"
        echo "[-] [FAIL-CLOSED] 当前 worktree 无 LoopX registry: $LOOPX_REGISTRY_PATH" >&2
        echo "    可选：(1) 在本 worktree 执行 loopx bootstrap --project \"$REPO_ROOT\"" >&2
        if [[ -n "$hint" ]]; then
            echo "          (2) 显式指定 --registry \"$hint\" 或导出 LOOPX_REGISTRY" >&2
        else
            echo "          (2) 显式指定 --registry <主 checkout>/.loopx/registry.json 或导出 LOOPX_REGISTRY" >&2
        fi
        exit 1
    fi
    echo "[-] [FAIL-CLOSED] 本地 LoopX registry 缺失: $LOOPX_REGISTRY_PATH" >&2
    echo "    修复指令: loopx bootstrap --project \"$REPO_ROOT\"（或通过 --registry / LOOPX_REGISTRY 显式指定）" >&2
    exit 1
}

wf_install_cleanup_trap() {
    [[ "$_WF_TRAP_INSTALLED" -eq 1 ]] && return 0
    _WF_TRAP_INSTALLED=1
    trap 'rc=$?; wf_cleanup "$rc"; exit "$rc"' EXIT
    trap 'wf_cleanup 130; exit 130' INT
    trap 'wf_cleanup 143; exit 143' TERM
}

wf_run_dir() {
    local cmd="${1:-${WF_CMD:-flow}}"
    if [[ -n "${WF_RUN_DIR:-}" && -d "$WF_RUN_DIR" ]]; then
        return 0
    fi
    mkdir -p "$LOOPX_TMP_DIR"
    WF_RUN_DIR="$(mktemp -d "${LOOPX_TMP_DIR}/${cmd}.XXXXXX")"
    wf_install_cleanup_trap
}

wf_register_temp_file() {
    local f="${1:-}"
    [[ -n "$f" ]] || return 0
    _WF_CLEANUP_FILES+=("$f")
    wf_install_cleanup_trap
}

wf_unregister_temp_file() {
    local target="${1:-}" item
    local -a next=()
    for item in "${_WF_CLEANUP_FILES[@]:-}"; do
        [[ -n "$item" && "$item" != "$target" ]] && next+=("$item")
    done
    if [[ "${#next[@]}" -gt 0 ]]; then
        _WF_CLEANUP_FILES=("${next[@]}")
    else
        _WF_CLEANUP_FILES=()
    fi
}

wf_cleanup() {
    local rc="${1:-0}" f=""
    for f in "${_WF_CLEANUP_FILES[@]:-}"; do
        [[ -n "$f" ]] && rm -f -- "$f" 2>/dev/null || true
    done
    _WF_CLEANUP_FILES=()
    [[ -z "${WF_RUN_DIR:-}" ]] && return 0
    if [[ "$rc" -eq 0 && "${LOOPX_KEEP_TMP:-0}" != "1" ]]; then
        rm -rf -- "$WF_RUN_DIR" 2>/dev/null || true
    else
        echo "[i] 运行工件保留于: $WF_RUN_DIR" >&2
    fi
    WF_RUN_DIR=""
}

wf_discover_base_ref() {
    local root="${1:-$EFFECTIVE_ROOT}"
    node "$WORKFLOW_ROOT/lib/paths.js" --discover-base-ref "$root" 2>/dev/null
}

fi
