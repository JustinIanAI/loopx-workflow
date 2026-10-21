#!/usr/bin/env bash
# ==============================================================================
# workflow-init.sh: LoopX AI-Native 研发与交付流一键初始化脚手架
# 用于为新仓库或现有仓库一键注入规范目录结构、四大门禁脚本、preflight 体检与技能挂载
# ==============================================================================
set -euo pipefail

echo "==> [Workflow Init] 开始初始化 LoopX AI-Native 研发环境..."

# 1. 执行前置体检与目录自动修复
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/preflight-check.sh" --fix

# 2. 安装 Git pre-commit 主干保护钩子
if [[ -d "$SCRIPT_DIR/../.git" && -f "$SCRIPT_DIR/git-hooks/pre-commit" ]]; then
    echo "==> [Workflow Init] 正在安装 Git pre-commit 熔断守卫..."
    mkdir -p "$SCRIPT_DIR/../.git/hooks"
    cp "$SCRIPT_DIR/git-hooks/pre-commit" "$SCRIPT_DIR/../.git/hooks/pre-commit"
    chmod +x "$SCRIPT_DIR/../.git/hooks/pre-commit"
    echo "    - 已安装: .git/hooks/pre-commit"
fi

# 3. 挂载本地技能软链接至全局 (可选)
GLOBAL_SKILLS_DIR="$HOME/.codex/skills"
mkdir -p "$GLOBAL_SKILLS_DIR"

echo "==> [Workflow Init] 正在挂载项目核心技能至 $GLOBAL_SKILLS_DIR ..."
for skill_dir in "$SCRIPT_DIR/../skills"/*; do
    if [[ -d "$skill_dir" ]]; then
        skill_name="$(basename "$skill_dir")"
        ln -sfn "$skill_dir" "$GLOBAL_SKILLS_DIR/$skill_name"
        echo "    - 已挂载: $skill_name"
    fi
done

# 4. 初始 Commit (若是新仓库)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -z "$(git status --porcelain)" ]]; then
        echo "==> [Workflow Init] Git 工作区干净，无需提交。"
    else
        echo "==> [Workflow Init] 提交初始化工作流骨架变更..."
        git add -A
        git commit -m "chore(workflow): bootstrap LoopX AI-Native workflow scaffolding and skills" || true
    fi
fi

echo "==> [✓] LoopX AI-Native 研发流水线初始化就绪！"
echo "    - 建议后续在编码前运行: ./scripts/preflight-check.sh"
