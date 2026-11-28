'use strict';
/**
 * ADR-0021：Gate2 重绑的判定语义。
 * 场景取自真实事故：strict 分支保护下，合入一个 PR 让 base 前进，其余 PR 变 BEHIND；
 * 更新分支换 head 后，作者已签的 gate=2 全部作废，同一份改动被迫反复签字。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sameChange, changePatchId } = require('../../lib/gate2-rebind.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate2-rebind-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function commit(dir, file, content, message) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function advanceMain(dir) {
  git(dir, 'checkout', '-q', 'main');
  return commit(dir, 'other.txt', 'main moved\n', 'main advance');
}

test('base 前进 + 干净合并：patch-id 一致，签名可重绑', () => {
  const dir = repo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    const signedHead = commit(dir, 'feature.js', 'export const a = 1;\n', 'feat: a');
    advanceMain(dir);
    git(dir, 'checkout', '-q', 'feature');
    git(dir, 'merge', '-q', '--no-edit', 'main');
    const updatedHead = git(dir, 'rev-parse', 'HEAD');

    assert.notStrictEqual(updatedHead, signedHead, 'update-branch 必须换 head');
    assert.strictEqual(
      sameChange({ cwd: dir, baseRef: 'main', signedHead, currentHead: updatedHead }),
      true,
      '改动内容未变时，既有 gate=2 应继续有效',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('签署后改动内容：patch-id 改变，签名不得重绑', () => {
  const dir = repo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    const signedHead = commit(dir, 'feature.js', 'export const a = 1;\n', 'feat: a');
    const tampered = commit(dir, 'feature.js', 'export const a = 666;\n', 'feat: change after signing');
    assert.strictEqual(
      sameChange({ cwd: dir, baseRef: 'main', signedHead, currentHead: tampered }),
      false,
      '内容变更必须 fail-closed 回到重新签字',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('冲突手工解决改变了改动：同样不得重绑', () => {
  const dir = repo();
  try {
    fs.writeFileSync(path.join(dir, 'conflict.txt'), 'v1\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'conflict base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    const signedHead = commit(dir, 'conflict.txt', 'feature-side\n', 'feat: conflict');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'conflict.txt', 'main-side\n', 'main: conflict');
    git(dir, 'checkout', '-q', 'feature');
    try { git(dir, 'merge', '--no-edit', 'main'); } catch (_) { /* 预期冲突 */ }
    fs.writeFileSync(path.join(dir, 'conflict.txt'), 'resolved by hand\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '--no-edit');
    const resolved = git(dir, 'rev-parse', 'HEAD');

    assert.strictEqual(
      sameChange({ cwd: dir, baseRef: 'main', signedHead, currentHead: resolved }),
      false,
      '人工解决冲突即内容变更，必须重新签字',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('同一 head 恒等；空改动与未知 commit 一律不重绑', () => {
  const dir = repo();
  try {
    const head = git(dir, 'rev-parse', 'HEAD');
    assert.strictEqual(sameChange({ cwd: dir, baseRef: 'main', signedHead: head, currentHead: head }), true);

    git(dir, 'checkout', '-q', '-b', 'empty');
    assert.strictEqual(changePatchId(dir, 'main', git(dir, 'rev-parse', 'HEAD')), null, '空改动不构成可重绑交付');

    assert.strictEqual(
      sameChange({ cwd: dir, baseRef: 'main', signedHead: 'f'.repeat(40), currentHead: head }),
      false,
      '未知 commit 必须 fail-closed',
    );
    assert.strictEqual(sameChange({ cwd: dir, baseRef: '', signedHead: head, currentHead: head }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
