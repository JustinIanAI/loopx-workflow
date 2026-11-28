'use strict';
/**
 * ADR-0024 验收：本地 `.loopx/registry.json` 缺失时，编排器改用 LoopX 自报的运行时 registry。
 *
 * 背景：D1 迁移后权威 registry 在 runtime_root（本机为 `~/.loopx/registry.global.json`），
 * 而 `lib/paths.sh` 的默认值仍是 `<repo>/.loopx/registry.json`。该文件不存在会让
 * `approve|check|merge|issue|integrate|todo` 在入口 fail-closed——人就算在 GitHub 留了
 * `gate=1`/`gate=2` 评论，编排器也跑不起来。
 *
 * 本组用例锁四件事：
 *   A. 本地 registry 存在 → 行为不变，且不额外调用 `loopx --format json status`；
 *   B. 本地缺失 + LoopX 能自报 → 放行，并把自报路径作为 `--registry` 传给后续调用；
 *   C. 本地缺失 + LoopX 报不出 → 仍 fail-closed（不放宽）；
 *   D. 显式 `--registry`/`LOOPX_REGISTRY` 指向不存在的文件 → 仍 fail-closed，且不浪费一次探询。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

function sandbox() {
  const dir = h.makeSandbox('adr24-');
  const files = {
    calls: path.join(dir, 'loopx-calls.log'),
    status: path.join(dir, 'status.json'),
    statusExit1: path.join(dir, 'status-exit-1'),
    globalRegistry: path.join(dir, 'runtime-root', 'registry.global.json'),
  };
  fs.mkdirSync(path.dirname(files.globalRegistry), { recursive: true });
  fs.writeFileSync(files.globalRegistry, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));
  fs.writeFileSync(files.calls, '');
  h.mockLoopx(dir, [
    'if [[ "$*" == *"--format json status"* ]]; then',
    '  cat "' + files.status + '"',
    '  [[ -f "' + files.statusExit1 + '" ]] && exit 1',
    '  exit 0',
    'fi',
    'if [[ "$1" == "todo" && "$2" == "list" ]]; then echo \'{"goals":[]}\'; exit 0; fi',
    'exit 0',
  ].join('\n'));
  return { dir, files };
}

function setStatus(files, registryPath) {
  const body = registryPath ? { registry: registryPath } : { ok: false, goal_count: 0 };
  fs.writeFileSync(files.status, JSON.stringify(body));
}

function calls(files) {
  return fs.readFileSync(files.calls, 'utf8');
}

function dropLocalRegistry(dir) {
  fs.rmSync(path.join(dir, '.loopx/registry.json'), { force: true });
}

test('A. 本地 registry 存在 → 不探询 LoopX，行为与今日一致', () => {
  const { dir, files } = sandbox();
  try {
    setStatus(files, files.globalRegistry);
    const r = h.run(dir, ['todo', 'list'], { LOOPX_REGISTRY: '' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const log = calls(files);
    assert.doesNotMatch(log, /--format json status/, '本地 registry 可用时不得多跑一次 status');
    // 编排器内部用 `pwd -P` 规范化路径，macOS 上 /var 会变成 /private/var
    assert.match(log, new RegExp('--registry ' + fs.realpathSync(dir) + '/\\.loopx/registry\\.json'));
  } finally { h.cleanup(dir); }
});

test('B. 本地缺失 + LoopX 自报 → 放行并把自报路径传给后续调用', () => {
  const { dir, files } = sandbox();
  try {
    dropLocalRegistry(dir);
    setStatus(files, files.globalRegistry);
    const r = h.run(dir, ['todo', 'list'], { LOOPX_REGISTRY: '' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /改用 LoopX 运行时 registry/);
    const log = calls(files);
    assert.match(log, /--format json status/, '必须先向 LoopX 探询默认 registry');
    assert.match(log, new RegExp('--registry ' + files.globalRegistry), '自报路径必须成为后续调用的 --registry');
  } finally { h.cleanup(dir); }
});

test('C. 本地缺失 + LoopX 报不出 registry → 仍 fail-closed', () => {
  const { dir, files } = sandbox();
  try {
    dropLocalRegistry(dir);
    setStatus(files, null);
    const r = h.run(dir, ['todo', 'list'], { LOOPX_REGISTRY: '' });
    assert.notStrictEqual(r.status, 0, '解析不出时必须保持阻断');
    assert.match(r.stderr, /本地 LoopX registry 缺失/);
    assert.doesNotMatch(calls(files), /todo list/, 'fail-closed 时不得执行真实 todo 调用');
  } finally { h.cleanup(dir); }
});

test('E. `loopx status` 报 ok:false 且退出码非 0，但输出了 registry → 仍按输出解析', () => {
  const { dir, files } = sandbox();
  try {
    dropLocalRegistry(dir);
    setStatus(files, files.globalRegistry);
    fs.writeFileSync(files.statusExit1, '');
    const r = h.run(dir, ['todo', 'list'], { LOOPX_REGISTRY: '' });
    assert.strictEqual(r.status, 0, '退出码不是判据，可解析的输出才是：' + r.stdout + r.stderr);
    assert.match(r.stderr, /改用 LoopX 运行时 registry/);
  } finally { h.cleanup(dir); }
});

test('D. 显式指定且路径不存在 → fail-closed，且不探询', () => {
  const { dir, files } = sandbox();
  try {
    setStatus(files, files.globalRegistry);
    const missing = path.join(dir, 'nowhere', 'registry.json');
    const r = h.run(dir, ['todo', 'list'], { LOOPX_REGISTRY: missing });
    assert.notStrictEqual(r.status, 0, '显式路径不存在必须阻断');
    assert.match(r.stderr, /显式指定的 LoopX registry 不存在/);
    assert.doesNotMatch(calls(files), /--format json status/, '显式路径错误不应浪费一次探询');
  } finally { h.cleanup(dir); }
});
