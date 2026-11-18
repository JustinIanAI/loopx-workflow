#!/usr/bin/env bash
# ==============================================================================
# preflight-check.sh: LoopX AI-Native 流水线前置环境与工程骨架体检哨兵 (v2.1)
# 验证核心 CLI、四大硬门禁、specs/features 资产包架构、仓库技能，
# 以及（本机已有 loopx 时）required skills / routes / 安装新鲜度。
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AUTO_FIX=false
if [[ "${1:-}" == "--fix" ]]; then
    AUTO_FIX=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# LoopX doctor 把技能检查标成 required:false，退出码 0 不能当成技能就绪。
# 本机没有 loopx 时不调用这里（ADR-0003：缺 CLI 只告警）。
verify_loopx_skill_readiness() {
    local doctor_out doctor_err doctor_status
    doctor_out="$(mktemp)"
    doctor_err="$(mktemp)"
    set +e
    loopx doctor --format json >"$doctor_out" 2>"$doctor_err"
    doctor_status=$?
    set -e
    if [[ "$doctor_status" -ne 0 ]]; then
        echo -e "      - LoopX skills/routes/新鲜度: ${RED}FAIL${NC} (loopx doctor 退出码 ${doctor_status})"
        echo -e "        ${RED}[FAIL-CLOSED] loopx doctor 验证未通过，不得把环境标记为就绪。${NC}"
        if [[ -s "$doctor_err" ]]; then
            sed 's/^/        /' "$doctor_err"
        fi
        echo -e "        修复指令: loopx doctor --format json"
        echo -e "        若提示 skills 缺失或过期，再执行: loopx workflow-skills --install && loopx slash-commands --install && loopx doctor --format json"
        rm -f "$doctor_out" "$doctor_err"
        return 1
    fi
    if ! node "$SCRIPT_DIR/loopx-skill-readiness.js" <"$doctor_out"; then
        echo -e "      - LoopX skills/routes/新鲜度: ${RED}FAIL${NC}"
        rm -f "$doctor_out" "$doctor_err"
        return 1
    fi
    echo -e "      - LoopX skills/routes/新鲜度: ${GREEN}PASS${NC}"
    rm -f "$doctor_out" "$doctor_err"
    return 0
}

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}        LoopX AI-Native 研发流水线前置环境自检 (Pre-flight Sentinel)   ${NC}"
echo -e "${BLUE}======================================================================${NC}"

# 1. 检查 Git 仓库状态
echo -n "[1/6] 检查 Git 版本控制状态... "
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC} (已在 Git 仓库内)"
    if ! git remote -v | grep -q 'origin'; then
        echo -e "      ${YELLOW}[!] 警告: 未配置名为 'origin' 的 Git Remote${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}FAIL${NC} (当前目录未初始化为 Git 仓库)"
    ERRORS=$((ERRORS + 1))
    if [[ "$AUTO_FIX" == true ]]; then
        echo -e "      ${BLUE}[Auto-Fix] 正在执行 git init...${NC}"
        git init
        echo -e "      ${GREEN}[✓] git init 完成${NC}"
        ERRORS=$((ERRORS - 1))
    fi
fi

# 2. 检查核心 CLI 工具连通性
echo "[2/6] 检查核心 CLI 工具链..."
REQUIRED_TOOLS=("git" "gh" "node" "npm")
RECOMMENDED_TOOLS=("loopx")

for tool in "${REQUIRED_TOOLS[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
        if [[ "$tool" == "node" ]]; then
            NODE_VER=$(node -v | sed "s/v//")
            NODE_OK=$(node -e '
                const [major, minor, patch] = process.versions.node.split(".").map(Number);
                const ok = major > 22 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 3)));
                process.stdout.write(ok ? "true" : "false");
            ')
            if [[ "$NODE_OK" == "true" ]]; then
                echo -e "      - 必需工具 node: ${GREEN}INSTALLED${NC} ($(which node), v${NODE_VER} >= 22.22.3)"
            else
                echo -e "      - 必需工具 node: ${RED}VERSION MISMATCH${NC} (v${NODE_VER} < 22.22.3, LoopX 2.x 要求 Node >= 22.22.3)"
                ERRORS=$((ERRORS + 1))
            fi
        else
            echo -e "      - 必需工具 $tool: ${GREEN}INSTALLED${NC} ($(which "$tool"))"
        fi
    else
        echo -e "      - 必需工具 $tool: ${RED}NOT FOUND${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

for tool in "${RECOMMENDED_TOOLS[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
        echo -e "      - 推荐工具 $tool: ${GREEN}INSTALLED${NC} ($(which "$tool"))"
        if [[ "$tool" == "loopx" ]]; then
            if ! verify_loopx_skill_readiness; then
                ERRORS=$((ERRORS + 1))
            fi
        fi
    else
        echo -e "      - 推荐工具 $tool: ${YELLOW}NOT FOUND (部分控制面特性受限)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# 3. 检查 GitHub 认证状态
echo -n "[3/6] 检查 GitHub CLI 认证状态... "
if gh auth status >/dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC} (已登录 GitHub)"
else
    echo -e "${YELLOW}WARN${NC} (未登录 gh CLI，PR 自动提交与核验功能将受限)"
    WARNINGS=$((WARNINGS + 1))
fi

# 4. 检查 package.json 与四大硬门禁配置
echo -n "[4/6] 检查本地四大硬门禁 (Typecheck, Lint, Build, Test)... "
if [[ -f "package.json" ]]; then
    REQUIRED_GATES=("typecheck" "lint" "build" "test")
    MISSING_GATES=()
    for gate in "${REQUIRED_GATES[@]}"; do
        if ! grep -q "\"$gate\":" package.json; then
            MISSING_GATES+=("$gate")
        fi
    done
    if [[ ${#MISSING_GATES[@]} -eq 0 ]]; then
        echo -e "${GREEN}PASS${NC} (四大硬门禁配置完整)"
    else
        echo -e "${RED}FAIL${NC} (缺失门禁 scripts: ${MISSING_GATES[*]})"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}FAIL${NC} (缺失 package.json)"
    ERRORS=$((ERRORS + 1))
fi

# 5. 检查工作流规范工程目录骨架
echo "[5/6] 检查流水线交付物与 Feature 资产包目录骨架..."
REQUIRED_DIRS=(
    "specs/features"
    "specs/archive"
    "docs/design"
    "docs/guides"
    "tests/unit"
    "tests/unit/issues"
    "scripts"
    "skills"
    "bin"
)

MISSING_DIRS=()
for dir in "${REQUIRED_DIRS[@]}"; do
    if [[ -d "$dir" ]]; then
        echo -e "      - 目录 $dir: ${GREEN}EXISTS${NC}"
    else
        echo -e "      - 目录 $dir: ${RED}MISSING${NC}"
        MISSING_DIRS+=("$dir")
    fi
done

if [[ ${#MISSING_DIRS[@]} -gt 0 ]]; then
    if [[ "$AUTO_FIX" == true ]]; then
        echo -e "      ${BLUE}[Auto-Fix] 正在自动创建缺失目录...${NC}"
        for dir in "${MISSING_DIRS[@]}"; do
            mkdir -p "$dir"
            echo -e "        ${GREEN}[✓] 已创建: $dir${NC}"
        done
    else
        echo -e "      ${YELLOW}[!] 存在 ${#MISSING_DIRS[@]} 个缺失目录，建议使用 --fix 参数自动初始化${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# 6. 检查核心技能挂载状态
echo -n "[6/6] 检查核心技能文件完整性... "
MISSING_SKILLS=0
CORE_SKILLS=(
    "code-review"
    "design-grill"
    "create-prd"
    "strategy-red-team"
    "user-stories"
    "prioritize-features"
    "test-driven-development"
    "open-code-review"
    "systematic-debugging"
    "anti-entropy-governance"
)
for s in "${CORE_SKILLS[@]}"; do
    if [[ ! -f "skills/$s/SKILL.md" ]]; then
        MISSING_SKILLS=$((MISSING_SKILLS + 1))
    fi
done

if [[ $MISSING_SKILLS -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (核心技能全部在位，PR Review / Issue Fix 已下沉 LoopX 原生生态)"
else
    echo -e "${RED}FAIL${NC} (缺失 $MISSING_SKILLS 项核心技能)"
    ERRORS=$((ERRORS + 1))
fi

echo -e "${BLUE}======================================================================${NC}"
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}[✗] 前置环境体检失败: 发现 $ERRORS 项阻断级错误, $WARNINGS 项警告。${NC}"
    echo -e "    请修复上述错误或执行: ./scripts/preflight-check.sh --fix"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}[!] 前置环境体检通过（带警告）: 0 阻断错误, $WARNINGS 项警告。可正常运行流水线。${NC}"
    exit 0
else
    echo -e "${GREEN}[✓] 前置环境体检 100% 完美通过！流水线已具备无缝执行条件。${NC}"
    exit 0
fi
