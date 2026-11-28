'use strict';
/**
 * Issue 修复模式的 PR 正文生成（authentic-review.js --issue-body-file）。
 * 动机来自 Issue 正文，不读 Feature 胶囊；验证矩阵仍来自本地四门禁实测。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AUTH = path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js');
const sandbox = require('./helpers/m0-sandbox');

test('pr create --issue: contract_impact=changed 缺 --adr 时 fail-closed', () => {
  const dir = sandbox.makeSandbox('issue-pr-flags-');
  try {
    sandbox.mockGh(dir, 'echo "[mock gh] $*"; exit 0');
    execFileSync('git', ['checkout', '-q', '-b', 'fix/issue-49'], { cwd: dir });
    const res = sandbox.run(dir, ['pr', 'create', '--issue', '49', '--impact', 'R2', '--contract-impact', 'changed']);
    assert.strictEqual(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /--adr/);
    assert.match(res.stderr, /FAIL-CLOSED/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('--issue-body-file 生成含 Issue 动机与真实 diff 的 PR 正文，不读 Feature 胶囊', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-pr-body-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'issue.md'), 'Gate flaky on reruns\n\nReproduction confirmed on main.\n');
    fs.writeFileSync(path.join(dir, 'diff.patch'), [
      'diff --git a/bin/loopx-flow b/bin/loopx-flow',
      'new file mode 100755',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/bin/loopx-flow',
      '@@ -0,0 +1 @@',
      '+echo hi',
      ''
    ].join('\n'));

    const res = spawnSync(process.execPath, [
      AUTH, '--generate-pr-body',
      '--issue-body-file', path.join(dir, 'issue.md'),
      '--impact', 'R1',
      '--goal-id', 'issue-19-goal',
      '--diff-file', path.join(dir, 'diff.patch')
    ], { cwd: dir, encoding: 'utf8', timeout: 180000 });

    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /## 动机 \/ Motivation/);
    assert.match(res.stdout, /Gate flaky on reruns/);
    assert.match(res.stdout, /## 改动思路 \/ Approach/);
    assert.match(res.stdout, /`bin\/loopx-flow`/);
    assert.match(res.stdout, /### 验证矩阵/);
    assert.doesNotMatch(res.stdout, /NOT_PROVIDED（diff 中无该文件明细/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Issue 正文自带的 loopx-meta / loopx-impact 标记不会混入 PR 正文', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-pr-markers-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'issue.md'), [
      '<!-- loopx-impact: {"level":"R0","contract_impact":"none","adrs":[],"regression":[],"rollback":""} -->',
      '',
      'Gate flaky on reruns',
      '',
      '<!-- loopx-meta: {"goal_id":"issue-49-goal"} -->',
      ''
    ].join('\n'));

    const res = spawnSync(process.execPath, [
      AUTH, '--generate-pr-body',
      '--issue-body-file', path.join(dir, 'issue.md'),
      '--impact', 'R2',
      '--goal-id', 'issue-49-goal'
    ], { cwd: dir, encoding: 'utf8', timeout: 180000 });

    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /Gate flaky on reruns/);
    assert.doesNotMatch(res.stdout, /<!--\s*loopx-impact/, 'Issue 自带标记必须剥离，否则 merge 会读到错误分级');
    assert.doesNotMatch(res.stdout, /<!--\s*loopx-meta/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pr update --issue: 非法 --issue/--contract-impact 与 changed 缺 --adr 均 fail-closed', () => {
  const dir = sandbox.makeSandbox('issue-pr-update-');
  try {
    sandbox.mockGh(dir, 'echo "[mock gh] $*"; exit 0');
    execFileSync('git', ['checkout', '-q', '-b', 'fix/issue-49'], { cwd: dir });
    const badIssue = sandbox.run(dir, ['pr', 'update', '115', '--issue', 'abc']);
    assert.strictEqual(badIssue.status, 1, `${badIssue.stdout}${badIssue.stderr}`);
    assert.match(badIssue.stderr, /--issue/);

    const badImpact = sandbox.run(dir, ['pr', 'update', '115', '--issue', '49', '--impact', 'R9']);
    assert.strictEqual(badImpact.status, 1, `${badImpact.stdout}${badImpact.stderr}`);
    assert.match(badImpact.stderr, /--impact/);

    const badContract = sandbox.run(dir, ['pr', 'update', '115', '--issue', '49', '--contract-impact', 'maybe']);
    assert.strictEqual(badContract.status, 1, `${badContract.stdout}${badContract.stderr}`);
    assert.match(badContract.stderr, /--contract-impact/);

    const missingAdr = sandbox.run(dir, ['pr', 'update', '115', '--issue', '49', '--impact', 'R2', '--contract-impact', 'changed']);
    assert.strictEqual(missingAdr.status, 1, `${missingAdr.stdout}${missingAdr.stderr}`);
    assert.match(missingAdr.stderr, /--adr/);
  } finally {
    sandbox.cleanup(dir);
  }
});
