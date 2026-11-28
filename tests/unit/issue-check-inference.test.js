'use strict';
/**
 * check 在 Issue 修复分支上的 Goal 推断（ADR-0023 / REQ-ISSUE-PIPELINE-1）。
 * 用 --with-ocr 的 fail-closed 分支证明：Goal 身份已从 fix/issue-<id> 推断成功，
 * 且 Issue 路径不再尝试写 05-evidence；不实际跑四大门禁。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const sandbox = require('./helpers/m0-sandbox');

function setup(branch) {
  const dir = sandbox.makeSandbox('issue-check-');
  sandbox.mockLoopx(dir, 'echo "[mock loopx] $*"; exit 0');
  execFileSync('git', ['checkout', '-q', '-b', branch], { cwd: dir });
  return dir;
}

test('check 在 fix/issue-<id> 分支上推断每 Issue Goal，并拒绝 --with-ocr', () => {
  const dir = setup('fix/issue-19');
  try {
    const res = sandbox.run(dir, ['check', '--with-ocr']);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /--with-ocr 只适用于 Feature 胶囊/);
    assert.match(res.stdout, /推断 Issue Goal: issue-19-goal/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('check 在无法解析 Goal 的分支上给出 fix/issue-<id> 修复指引', () => {
  const dir = setup('chore/scratch');
  try {
    const res = sandbox.run(dir, ['check']);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /fix\/issue-<id>/);
    assert.match(res.stderr, /--goal-id/);
  } finally {
    sandbox.cleanup(dir);
  }
});
