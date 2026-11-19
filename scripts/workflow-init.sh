#!/usr/bin/env bash
# ==============================================================================
# workflow-init.sh: LoopX AI-Native 研发与交付流一键初始化脚手架
# 用于为新仓库或现有仓库一键注入规范目录结构、四大门禁脚本、preflight 体检与技能挂载
# ==============================================================================
set -euo pipefail

LINK_GLOBAL_SKILLS=false
for arg in "$@"; do
    case "$arg" in
        --link-global-skills) LINK_GLOBAL_SKILLS=true ;;
    esac
done

echo "==> [Workflow Init] 开始初始化 LoopX AI-Native 研发环境..."

# 1. 执行前置体检与目录自动修复
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=../lib/paths.sh
source "$SCRIPT_DIR/../lib/paths.sh"
wf_init_paths

"$SCRIPT_DIR/preflight-check.sh" --fix
wf_init_paths

# 2. 安装 Git pre-commit 主干保护钩子
TARGET_GIT_DIR=""
if [[ "$IS_GIT_REPO" -eq 1 ]]; then
    TARGET_GIT_DIR="$(git -C "$REPO_ROOT" rev-parse --git-dir 2>/dev/null || true)"
    if [[ -n "$TARGET_GIT_DIR" ]]; then
        TARGET_GIT_DIR="$(cd "$REPO_ROOT" && cd "$TARGET_GIT_DIR" && pwd -P)"
    fi
fi
if [[ -n "$TARGET_GIT_DIR" && -f "$WORKFLOW_ROOT/scripts/git-hooks/pre-commit" ]]; then
    echo "==> [Workflow Init] 正在安装 Git pre-commit 熔断守卫..."
    mkdir -p "$TARGET_GIT_DIR/hooks"
    cp "$WORKFLOW_ROOT/scripts/git-hooks/pre-commit" "$TARGET_GIT_DIR/hooks/pre-commit"
    chmod +x "$TARGET_GIT_DIR/hooks/pre-commit"
    echo "    - 已安装: .git/hooks/pre-commit"
fi

# 3. 挂载本地技能软链接至全局 (ADR-0007 修订：默认关闭，仅显式 --link-global-skills 启用)
if [[ "$LINK_GLOBAL_SKILLS" == "true" ]]; then
    GLOBAL_SKILLS_DIR="$(wf_codex_home)/skills"
    mkdir -p "$GLOBAL_SKILLS_DIR"
    echo "==> [Workflow Init] 正在挂载项目核心技能至 $GLOBAL_SKILLS_DIR ..."
    for skill_dir in "$WORKFLOW_ROOT/skills"/*; do
        if [[ -d "$skill_dir" ]]; then
            skill_real="$(cd "$skill_dir" && pwd -P)"
            skill_name="$(basename "$skill_real")"
            ln -sfn "$skill_real" "$GLOBAL_SKILLS_DIR/$skill_name"
            echo "    - 已挂载: $skill_name -> $skill_real"
        fi
    done
else
    echo "==> [Workflow Init] 跳过宿主机全局技能软链挂载（防多 worktree 污染；如需显式挂载请传 --link-global-skills）"
fi

# 4. 初始 Commit (若是新仓库)
if [[ "$IS_GIT_REPO" -eq 1 ]]; then
    if [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
        echo "==> [Workflow Init] Git 工作区干净，无需提交。"
    else
        echo "==> [Workflow Init] 提交初始化工作流骨架变更..."
        git -C "$REPO_ROOT" add -A -- . ':!.loopx' ':!.codex' ':!qa-acceptance'
        git -C "$REPO_ROOT" commit -m "chore(workflow): bootstrap LoopX AI-Native workflow scaffolding and skills" || true
    fi
fi

echo "==> [✓] LoopX AI-Native 研发流水线初始化就绪！"
echo "    - 本机已有 loopx 时，required skills、routes 与安装新鲜度已在 preflight 中核验。"
echo "    - 建议后续在编码前运行: ./scripts/preflight-check.sh"
