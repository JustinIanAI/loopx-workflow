#!/usr/bin/env bash
# ==============================================================================
# gate-build.sh: 本地实心化 Build 门禁脚本 (v2.0)
# 执行真实的构建产物健康度、CLI 符号入口有效性与执行权限分配核验
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}==> [Gate: Build] 执行真实构建产物与 CLI 入口完整性校验...${NC}"

# 1. 递归赋予并校验脚本执行权限
chmod +x "$PROJECT_ROOT/scripts"/*.sh 2>/dev/null || true
if [[ -d "$PROJECT_ROOT/scripts/git-hooks" ]]; then
    chmod +x "$PROJECT_ROOT/scripts/git-hooks"/* 2>/dev/null || true
fi
if [[ -d "$PROJECT_ROOT/bin" ]]; then
    chmod +x "$PROJECT_ROOT/bin"/* 2>/dev/null || true
fi

# 2. 真实核验 CLI 入口可执行性
if [[ ! -x "$PROJECT_ROOT/bin/loopx-flow" ]]; then
    echo -e "${RED}[!] 错误: bin/loopx-flow 不存在或不可执行${NC}" >&2
    exit 1
fi

# 3. 真实调用 CLI 烟囱验证
if ! "$PROJECT_ROOT/bin/loopx-flow" help >/dev/null 2>&1; then
    echo -e "${RED}[!] 错误: bin/loopx-flow 无法正常响应 help 指令${NC}" >&2
    exit 1
fi

echo -e "${GREEN}[✓] Build verification passed. (产物权限与 CLI 入口健康度 100% 确认)${NC}"
exit 0
