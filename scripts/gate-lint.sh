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
echo -n "    [1/5] 核验 Shell / Bash 脚本语法... "
SHELL_FILES=()
while IFS= read -r f; do
    SHELL_FILES+=("$f")
done < <(find "$PROJECT_ROOT/scripts" "$PROJECT_ROOT/bin" "$PROJECT_ROOT/skills" "$PROJECT_ROOT/lib" -type f \( -name "*.sh" -o -path "*/bin/*" -o -path "*/git-hooks/*" \) 2>/dev/null)

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
echo -n "    [2/5] 核验 JavaScript AST 与语法合规... "
JS_ERRORS=0
while IFS= read -r jf; do
    if [[ -f "$jf" ]]; then
        if ! node -c "$jf" >/dev/null 2>&1; then
            echo -e "\n      ${RED}[!] JS 语法错误在: $jf${NC}"
            JS_ERRORS=$((JS_ERRORS + 1))
        fi
    fi
done < <(find "$PROJECT_ROOT/skills" "$PROJECT_ROOT/tests" "$PROJECT_ROOT/scripts" "$PROJECT_ROOT/lib" -type f -name "*.js" 2>/dev/null)

if [[ $JS_ERRORS -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (所有 JS 文件 AST 编译合法)"
else
    echo -e "${RED}FAIL${NC} (发现 $JS_ERRORS 个 JS 语法缺陷)"
    ERRORS=$((ERRORS + JS_ERRORS))
fi

# 3. 校验可执行文件权限
echo -n "    [3/5] 核验可执行入口权限... "
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

# 4. 静态路径与临时工件卫生守卫（ADR-0007 / Issue #8 / §4.1）
echo -n "    [4/5] 核验临时工件与跨平台静态卫生守卫... "
HYGIENE_OUT="$(node - "$PROJECT_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const scanRoots = ['bin', 'lib', 'scripts', 'skills'];
const violations = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.isFile()) checkFile(full);
  }
}

function isCodeFile(rel) {
  return /\.(sh|js|cjs|mjs)$/.test(rel)
    || rel.startsWith('bin/')
    || rel.startsWith('scripts/git-hooks/');
}

function checkFile(abs) {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (!isCodeFile(rel)) return;
  if (rel === 'scripts/gate-lint.sh') return;
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const isJs = /\.(js|cjs|mjs)$/.test(rel);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/loopx-allow:\s*\S+/.test(line)) return;
    if (isJs && (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))) return;
    if (!isJs && trimmed.startsWith('#')) return;

    if (/\bos\.tmpdir\s*\(|\btmpdir\s*\(/.test(line)) {
      violations.push(`${rel}:${idx + 1} 禁止直接调用 os.tmpdir()/tmpdir()`);
    }
    if (!isJs && /\bmktemp\b/.test(line)) {
      // 允许带模板且落在 LOOPX_TMP_DIR 的 mktemp；禁止裸 mktemp
      if (!/mktemp\s+(-d\s+)?"?\$\{?LOOPX_TMP_DIR\}?\//.test(line)) {
        violations.push(`${rel}:${idx + 1} 禁止裸 mktemp（须用 wf_run_dir 或模板指向 LOOPX_TMP_DIR）`);
      }
    }
    if (/(?:^|[\s;|&`(])which\s+[A-Za-z0-9_$-]|spawnSync\(\s*['"]which['"]|execFileSync\(\s*['"]which['"]|sh\(\s*['"]which['"]/.test(line)) {
      violations.push(`${rel}:${idx + 1} 禁止外部 which（Shell 用 command -v，Node 用 lib/paths.js findOnPath）`);
    }
    if (/\bpython3\b/.test(line)) {
      violations.push(`${rel}:${idx + 1} 禁止隐式 python3 依赖`);
    }
    if (/spawnSync\(\s*['"]sleep['"]/.test(line)) {
      violations.push(`${rel}:${idx + 1} 禁止外部 spawnSync('sleep')，请用 sleepSync`);
    }
    if (isJs && /['"]\.loopx\/(?!tmp|cache)/.test(line)) {
      violations.push(`${rel}:${idx + 1} 禁止 CWD 相对 .loopx/ 路径，请用 lib/paths.js 锚定 REPO_ROOT`);
    }
    if (/\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\/|C:\\\\[A-Za-z0-9_.-]+/.test(line)
      && rel !== 'scripts/git-hooks/pre-commit' && rel !== 'scripts/gate-lint.sh') {
      violations.push(`${rel}:${idx + 1} 禁止宿主机绝对路径字面量`);
    }
  });
}

for (const d of scanRoots) walk(path.join(root, d));
if (violations.length) {
  process.stdout.write(violations.join('\n'));
  process.exit(1);
}
NODE
)" || HYGIENE_RC=$?
if [[ "${HYGIENE_RC:-0}" -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (无 /tmp、裸 mktemp、which、python3 或本机路径违规)"
else
    echo -e "${RED}FAIL${NC}"
    printf '%s\n' "$HYGIENE_OUT" | sed 's/^/      [!] /'
    ERRORS=$((ERRORS + 1))
fi

# 5. Git 跟踪面边界与凭据/绝对路径泄露守卫（§4.3 / R3 / R9 / R20）
echo -n "    [5/5] 核验 Git 跟踪面边界与敏感凭据防泄露... "
BOUNDARY_OUT="$(node - "$PROJECT_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.argv[2];
const issues = [];

let tracked = [];
try {
  tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch (_) {
  process.exit(0);
}

for (const rel of tracked) {
  if (/^(\.loopx\/|\.codex\/|qa-acceptance\/)/.test(rel)) {
    issues.push(`禁止跟踪运行时/私有目录文件: ${rel}`);
    continue;
  }
  if (rel === 'scripts/git-hooks/pre-commit' || rel === 'scripts/gate-lint.sh') continue;
  if (/\.(png|jpg|jpeg|gif|pdf|ico|woff|woff2|zip|tar|gz)$/i.test(rel)) continue;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (/loopx-allow:\s*\S+/.test(line)) return;
    if (/\b(?:oc|ou)_[0-9a-f]{32}\b|\bcli_[0-9a-f]{16}\b/.test(line)) {
      issues.push(`${rel}:${idx + 1} 检测到疑似飞书真实标识 (oc_/ou_/cli_)`);
    }
    if (/"(?:base_token|app_secret)"\s*:\s*"(?![*<])[A-Za-z0-9_-]{12,}"/.test(line)) {
      issues.push(`${rel}:${idx + 1} 检测到疑似真实 base_token/app_secret 凭据`);
    }
    if (!rel.startsWith('tests/') && !rel.startsWith('skills/systematic-debugging/')
      && /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(line)) {
      issues.push(`${rel}:${idx + 1} 检测到宿主机本机绝对路径`);
    }
  });
}

if (issues.length) {
  process.stdout.write(issues.join('\n'));
  process.exit(1);
}
NODE
)" || BOUNDARY_RC=$?
if [[ "${BOUNDARY_RC:-0}" -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC} (无受跟踪运行态目录或凭据/路径泄露)"
else
    echo -e "${RED}FAIL${NC}"
    printf '%s\n' "$BOUNDARY_OUT" | sed 's/^/      [!] /'
    ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}[✗] Lint 门禁未通过，发现 $ERRORS 项阻断问题！${NC}" >&2
    exit 1
fi

echo -e "${GREEN}[✓] Lint verification passed. (全部静态扫描 100% 全绿)${NC}"
exit 0
