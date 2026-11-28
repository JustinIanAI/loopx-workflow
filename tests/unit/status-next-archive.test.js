'use strict';
/**
 * Issue #94：`status --next` 只读投影必须区分 active / archived / unknown。
 *
 * 已交付并归档到 specs/archive/<feature>/ 的特性不得再被建议 `approve contract`；
 * 活跃特性投影保持原样。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

function writeContract(dir, feature, status) {
  const capsule = path.join(dir, 'specs/features', feature);
  fs.mkdirSync(capsule, { recursive: true });
  fs.writeFileSync(path.join(capsule, '04-contract.md'), `# Contract\n\n- **Contract-Status**: ${status}\n`);
}

test('已归档特性：输出 Archived (delivered)，不再建议 approve contract', () => {
  const dir = h.makeSandbox('status-next-archived-');
  try {
    const archived = path.join(dir, 'specs/archive', 'gate-signature');
    fs.mkdirSync(archived, { recursive: true });
    fs.writeFileSync(path.join(archived, '04-contract.md'), '# archived contract\n');

    const r = h.run(dir, ['status', '--next', 'gate-signature']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Archived \(delivered\)/);
    assert.doesNotMatch(r.stdout, /Next: loopx-flow approve contract/);
    assert.match(r.stdout, /Next: none/);
  } finally { h.cleanup(dir); }
});

test('两个目录都不存在：输出 Unknown feature', () => {
  const dir = h.makeSandbox('status-next-unknown-');
  try {
    const r = h.run(dir, ['status', '--next', 'no-such-feature']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Unknown feature/);
    assert.doesNotMatch(r.stdout, /Next: loopx-flow approve contract/);
  } finally { h.cleanup(dir); }
});

test('活跃特性投影不变：未授权仍建议 approve contract', () => {
  const dir = h.makeSandbox('status-next-active-');
  try {
    writeContract(dir, 'active-feature', 'DRAFT (Pending Approval)');
    const r = h.run(dir, ['status', '--next', 'active-feature']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Next: loopx-flow approve contract active-feature/);
    assert.doesNotMatch(r.stdout, /Archived/);
  } finally { h.cleanup(dir); }
});
