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

test('签署后只改空白/缩进：指纹必须变，不得重绑（--stable 会漏判，故用 --verbatim）', () => {
  const dir = repo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    const signedHead = commit(dir, 'notes.md', '# Title\n\n- item\n', 'docs: item');
    // 仅空白变化：四空格在 Markdown 里就是代码块，语义已变，但 git patch-id --stable
    // 会把空白归一化掉，从而把「格式化后的提交」误判成同一份改动。
    const reformatted = commit(dir, 'notes.md', '# Title\n\n    - item\n', 'docs: indent');
    assert.strictEqual(
      sameChange({ cwd: dir, baseRef: 'main', signedHead, currentHead: reformatted }),
      false,
      '仅空白/缩进调整也必须 fail-closed 重新签字',
    );
    assert.notStrictEqual(
      changePatchId(dir, 'main', signedHead),
      changePatchId(dir, 'main', reformatted),
      '空白敏感：两个 head 的改动指纹必须不同',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('base 在同一文件上方插入无关行导致改动位移：仍算同一份改动（-U0 剥上下文）', () => {
  const dir = repo();
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'head\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'app base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    const signedHead = commit(dir, 'app.js', 'head\nFEATURE\n', 'feat: append');

    // main 前进：在改动上方插入一行，使 rebase/合并后 FEATURE 下沉到第 3 行。
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'app.js', 'NEWTOP\nhead\n', 'main: insert above');
    git(dir, 'checkout', '-q', 'feature');
    git(dir, 'merge', '-q', '--no-edit', 'main');
    const moved = git(dir, 'rev-parse', 'HEAD');

    assert.notStrictEqual(moved, signedHead);
    assert.strictEqual(
      sameChange({ cwd: dir, baseRef: 'main', signedHead, currentHead: moved }),
      true,
      '同一改动在文件内位移（hunk 行号变化、上下文变化）不应作废签名',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI：fetch 失败必须显式告警，不得与「指纹不等」在错误面上混淆', () => {
  const dir = repo();
  try {
    // 无 origin：fetch 必然失败，但本地 origin/main 也不存在 → 仍 fail-closed（退出 1）。
    const signed = commit(dir, 'feature.js', 'export const a = 1;\n', 'feat');
    const current = commit(dir, 'feature.js', 'export const a = 2;\n', 'feat2');
    const r = require('node:child_process').spawnSync(
      process.execPath,
      [path.join(__dirname, '../../lib/gate2-rebind.js'), 'same-change', 'origin/main', signed, current],
      { cwd: dir, encoding: 'utf8', env: { ...process.env } },
    );
    assert.strictEqual(r.status, 1, '取不到 ref 必须 fail-closed');
    assert.match(r.stderr, /无法 fetch origin\/main/, 'fetch 失败必须显式告警，否则离线与指纹不等无法区分');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
