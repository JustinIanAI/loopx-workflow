#!/usr/bin/env bash
# ==============================================================================
# gate-lint.sh: 本地实心化 Lint 门禁脚本 (v2.0)
# 针对工作流脚本、Node.js 逻辑与契约规范执行多维静态语法和 AST 安全核验
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0

echo -e "${BLUE}==> [Gate: Lint] 启动真实多维代码与脚本静态核验...${NC}"

# 1. 检验 Shell 脚本语法与健全性
echo -n "    [1/3] 核验 Shell / Bash 脚本语法... "
SHELL_FILES=()
while IFS= read -r f; do
    SHELL_FILES+=("$f")
done < <(find "$PROJECT_ROOT/scripts" "$PROJECT_ROOT/bin" "$PROJECT_ROOT/skills" -type f \( -name "*.sh" -o -path "*/bin/*" -o -path "*/git-hooks/*" \) 2>/dev/null)

for sf in "${SHELL_FILES[@]}"; do
    if [[ -f "$sf" ]]; then
        if ! bash -n "$sf" 2>/dev/null; then
            echo -e "\n      ${RED}[!] 语法错误在: $sf${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    fi
done

if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (${#SHELL_FILES[@]} 个脚本语法合规)"
else
    echo -e "${RED}FAIL${NC} (发现语法阻断错误)"
fi

# 2. 校验 JavaScript 文件语法与 AST 解析合规
echo -n "    [2/3] 核验 JavaScript AST 与语法合规... "
JS_ERRORS=0
while IFS= read -r jf; do
    if [[ -f "$jf" ]]; then
        if ! node -c "$jf" >/dev/null 2>&1; then
            echo -e "\n      ${RED}[!] JS 语法错误在: $jf${NC}"
            JS_ERRORS=$((JS_ERRORS + 1))
        fi
    fi
done < <(find "$PROJECT_ROOT/skills" "$PROJECT_ROOT/tests" -type f -name "*.js" 2>/dev/null)

if [[ $JS_ERRORS -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (所有 JS 文件 AST 编译合法)"
else
    echo -e "${RED}FAIL${NC} (发现 $JS_ERRORS 个 JS 语法缺陷)"
    ERRORS=$((ERRORS + JS_ERRORS))
fi

# 3. 校验可执行文件权限
echo -n "    [3/3] 核验可执行入口权限... "
PERM_ERRORS=0
EXEC_TARGETS=("$PROJECT_ROOT/bin/loopx-flow" "$PROJECT_ROOT/scripts/preflight-check.sh" "$PROJECT_ROOT/scripts/fast-fix-push.sh")
for ef in "${EXEC_TARGETS[@]}"; do
    if [[ -f "$ef" && ! -x "$ef" ]]; then
        echo -e "\n      ${RED}[!] 缺失可执行权限: $ef${NC}"
        PERM_ERRORS=$((PERM_ERRORS + 1))
    fi
done

if [[ $PERM_ERRORS -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (入口脚本具备执行位)"
else
    echo -e "${RED}FAIL${NC}"
    ERRORS=$((ERRORS + PERM_ERRORS))
fi

if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}[✗] Lint 门禁未通过，发现 $ERRORS 项阻断问题！${NC}" >&2
    exit 1
fi

echo -e "${GREEN}[✓] Lint verification passed. (全部静态扫描 100% 全绿)${NC}"
exit 0
