const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FAST_FIX_SCRIPT = path.join(PROJECT_ROOT, 'scripts/fast-fix-push.sh');
const SETUP_SCRIPT = path.join(PROJECT_ROOT, 'scripts/setup-branch-protection.sh');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'loopx-workflow.config.json');

const INDEPENDENT_PROTECTION = {
  required_status_checks: { strict: true, contexts: ['Four Gates'] },
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_last_push_approval: true,
    required_approving_review_count: 1
  },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false }
};

const SINGLE_OWNER_WITH_REVIEWS = {
  required_status_checks: { strict: true, contexts: ['Four Gates'] },
  required_pull_request_reviews: { required_approving_review_count: 1 },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false }
};

function configContent(mode) {
  const config = {
    schema_version: 'loopx_workflow_config_v0',
    authorization_mode: mode
  };
  if (mode === 'single_owner') {
    config.single_owner_risk_acceptance = {
      accepted_by: 'mock-owner',
      accepted_at: '2026-01-01T00:00:00Z'
    };
  }
  return JSON.stringify(config, null, 2) + '\n';
}

// 临时写入仓库根配置；无论成功与否都恢复原状（不存在则删除）
function withConfig(mode, fn) {
  const existed = fs.existsSync(CONFIG_PATH);
  const original = existed ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
  fs.writeFileSync(CONFIG_PATH, configContent(mode));
  try {
    return fn();
  } finally {
    try {
      if (existed && original !== null) {
        fs.writeFileSync(CONFIG_PATH, original);
      } else if (fs.existsSync(CONFIG_PATH)) {
        fs.unlinkSync(CONFIG_PATH);
      }
    } catch (_) {
      // 清理失败不应掩盖断言结果
    }
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // best effort
  }
}

// 唯一临时目录中的 mock gh：auth/repo 成功，api 返回指定保护 JSON
function createMockGh(protection) {
  const dir = makeTempDir('loopx-fastpath-protection-');
  const protectionFile = path.join(dir, 'protection.json');
  fs.writeFileSync(protectionFile, JSON.stringify(protection, null, 2) + '\n');

  const mockGh = path.join(dir, 'gh');
  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'case "${1:-}" in',
    '  auth) exit 0 ;;',
    '  repo) echo "mock-owner/mock-repo" ;;',
    '  api) cat "${MOCK_PROTECTION_FILE:?}" ;;',
    '  *) echo "mock gh: unhandled: $*" >&2; exit 1 ;;',
    'esac',
    ''
  ].join('\n');
  fs.writeFileSync(mockGh, script, { mode: 0o755 });
  return { dir, protectionFile };
}

// 构造一个不含 gh 的 PATH：仅提供脚本所需 bash / dirname / node
function createPathWithoutGh() {
  const dir = makeTempDir('loopx-nogh-bin-');
  const bashPath = fs.existsSync('/bin/bash') ? '/bin/bash' : '/usr/bin/bash';
  const dirnamePath = fs.existsSync('/usr/bin/dirname') ? '/usr/bin/dirname' : '/bin/dirname';
  fs.symlinkSync(bashPath, path.join(dir, 'bash'));
  fs.symlinkSync(dirnamePath, path.join(dir, 'dirname'));
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  return dir;
}

function runCheck(options) {
  const env = Object.assign({}, process.env);
  if (options.mockDir) {
    env.PATH = options.mockDir + path.delimiter + (process.env.PATH || '');
  }
  if (options.cleanPath) {
    env.PATH = options.cleanPath;
  }
  if (options.protectionFile) {
    env.MOCK_PROTECTION_FILE = options.protectionFile;
  }
  return spawnSync(SETUP_SCRIPT, ['--check'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env
  });
}

function stdoutJsonLines(res) {
  const lines = (res.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

test('1. fast-fix-push.sh 不得直推 main，也不得自动合并', () => {
  const content = fs.readFileSync(FAST_FIX_SCRIPT, 'utf8');
  assert.strictEqual(content.includes('git push origin main'), false, '不得包含直推 main 的命令');
  assert.strictEqual(content.includes('gh pr merge'), false, '不得包含 gh pr merge');
  assert.strictEqual(content.includes('--auto'), false, '不得包含 --auto');
  assert.strictEqual(content.includes('gh pr create'), true, '必须通过 gh pr create 创建 PR');
});

test('2. setup-branch-protection.sh 存在、可执行且无 eval', () => {
  assert.strictEqual(fs.existsSync(SETUP_SCRIPT), true, '脚本必须存在');
  const stat = fs.statSync(SETUP_SCRIPT);
  assert.strictEqual(Boolean(stat.mode & 0o111), true, '脚本必须可执行');
  const content = fs.readFileSync(SETUP_SCRIPT, 'utf8');
  assert.strictEqual(content.startsWith('#!/usr/bin/env bash'), true, '必须使用 bash shebang');
  assert.strictEqual(content.includes('set -euo pipefail'), true, '必须启用 set -euo pipefail');
  assert.strictEqual(content.includes('eval'), false, '不得使用 eval');
});

test('3. independent 模式 + 合规保护 JSON → --check 退出 0 且 ok=true', () => {
  withConfig('independent', () => {
    const mock = createMockGh(INDEPENDENT_PROTECTION);
    try {
      const res = runCheck({ mockDir: mock.dir, protectionFile: mock.protectionFile });
      assert.strictEqual(res.status, 0, '合规保护必须 exit 0; stderr=' + res.stderr);
      const lines = stdoutJsonLines(res);
      assert.strictEqual(lines.length, 1, '--check 必须只输出一行 JSON');
      assert.strictEqual(lines[0].schema_version, 'branch_protection_check_v0');
      assert.strictEqual(lines[0].ok, true);
      assert.strictEqual(lines[0].mode, 'independent');
      assert.strictEqual(lines[0].branch, 'main');
      assert.deepStrictEqual(lines[0].reasons, []);
    } finally {
      cleanupDir(mock.dir);
    }
  });
});

test('4. single_owner 模式 + 仍要求 approving review → --check 非 0 且 ok=false', () => {
  withConfig('single_owner', () => {
    const mock = createMockGh(SINGLE_OWNER_WITH_REVIEWS);
    try {
      const res = runCheck({ mockDir: mock.dir, protectionFile: mock.protectionFile });
      assert.notStrictEqual(res.status, 0, 'single_owner 仍要求 approving review 必须非 0');
      const lines = stdoutJsonLines(res);
      assert.strictEqual(lines.length, 1, '--check 必须只输出一行 JSON');
      assert.strictEqual(lines[0].ok, false);
      assert.strictEqual(lines[0].mode, 'single_owner');
      assert.ok(
        lines[0].reasons.includes('unexpected_required_pull_request_reviews'),
        'reason 必须包含 unexpected_required_pull_request_reviews; 实际: ' + JSON.stringify(lines[0].reasons)
      );
    } finally {
      cleanupDir(mock.dir);
    }
  });
});

test('5. PATH 中缺少 gh → --check fail closed (ok=false)', () => {
  withConfig('independent', () => {
    const cleanDir = createPathWithoutGh();
    try {
      const res = runCheck({ cleanPath: cleanDir });
      assert.notStrictEqual(res.status, 0, 'gh 缺失必须非 0');
      const lines = stdoutJsonLines(res);
      assert.strictEqual(lines.length, 1, '--check 必须只输出一行 JSON');
      assert.strictEqual(lines[0].ok, false);
      assert.ok(
        lines[0].reasons.includes('gh_missing'),
        'reason 必须包含 gh_missing; 实际: ' + JSON.stringify(lines[0].reasons)
      );
    } finally {
      cleanupDir(cleanDir);
    }
  });
});
