const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const HOOK_SCRIPT = path.join(PROJECT_ROOT, 'scripts/git-hooks/pre-commit');

test('1. Stage Signature Gate: decisions check in specs/features/<feat>/01-decisions.md', () => {
  // Test non-existent feature
  const resMissing = spawnSync(LOOPX_FLOW, ['gate', 'verify', 'decisions', 'non-existent-feature-xyz'], {
    encoding: 'utf8'
  });
  assert.strictEqual(resMissing.status, 1, 'Missing decision file must fail gate check');

  // Test feature with APPROVED marker in 01-decisions.md
  const resApproved = spawnSync(LOOPX_FLOW, ['gate', 'verify', 'decisions', 'hard-guard'], {
    encoding: 'utf8'
  });
  assert.strictEqual(resApproved.status, 0, 'Approved decision file must pass gate check');
});

test('2. Stage Signature Gate: contract check in specs/features/<feat>/04-contract.md', () => {
  const contractPath = fs.existsSync(path.join(PROJECT_ROOT, 'specs/features/hard-guard/04-contract.md'))
    ? path.join(PROJECT_ROOT, 'specs/features/hard-guard/04-contract.md')
    : path.join(PROJECT_ROOT, 'specs/archive/hard-guard/04-contract.md');
  const contractSha = crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex');
  // 隔离：写入临时 registry（LOOPX_REGISTRY），绝不污染真实 .loopx/registry.json。
  // 真实 registry 被测试造出无 state_file 的 orphan goal 会阻塞 loopx migrate-local-state
  // （见 docs/adr/0007-environment-governance.md / INV-ENV-6）。
  const realRegPath = path.join(PROJECT_ROOT, '.loopx/registry.json');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-registry-'));
  const regPath = path.join(tmpDir, 'registry.json');
  let reg = { goals: [] };
  if (fs.existsSync(realRegPath)) {
    try { reg = JSON.parse(fs.readFileSync(realRegPath, 'utf8')); } catch (_) {}
  }
  if (!Array.isArray(reg.goals)) reg.goals = [];
  reg.goals = reg.goals.filter(item => item.id !== 'hard-guard-goal' && item.goal_id !== 'hard-guard-goal');
  reg.goals.push({
    id: 'hard-guard-goal',
    state_file: path.join(tmpDir, 'ACTIVE_GOAL_STATE.md'),
    control_plane: { progress_review: { contract_revision: contractSha } }
  });
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));

  // Test feature with FROZEN & APPROVED marker in 04-contract.md
  const resApproved = spawnSync(LOOPX_FLOW, ['gate', 'verify', 'contract', 'hard-guard'], {
    encoding: 'utf8',
    env: { ...process.env, LOOPX_REGISTRY: regPath },
  });
  assert.strictEqual(resApproved.status, 0, 'Approved contract file must pass gate check');
});

test('3. Pre-commit hook: must reject commit if on main branch', () => {
  assert.strictEqual(fs.existsSync(HOOK_SCRIPT), true, 'Hook script must exist: scripts/git-hooks/pre-commit');

  // Execute hook pretending branch is main
  const res = spawnSync(HOOK_SCRIPT, [], {
    encoding: 'utf8',
    env: { ...process.env, TEST_GIT_BRANCH: 'main' }
  });
  assert.strictEqual(res.status, 1, 'Hook must reject commit on main branch');
  assert.strictEqual(
    res.stderr.includes('严禁直接向 main 分支提交代码') || res.stdout.includes('严禁直接向 main 分支提交代码'),
    true
  );
});

test('4. Merge Fail-Closed Gate: must exit 1 when PR is not approved', () => {
  const res = spawnSync(LOOPX_FLOW, ['merge', '999999'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 1, 'Merge must exit 1 when PR is not approved or not found');
  assert.strictEqual(res.stderr.includes('[FAIL-CLOSED]'), true, 'Must output FAIL-CLOSED error message');
});
