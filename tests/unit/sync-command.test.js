'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('./helpers/m0-sandbox');

function fixture(body) {
  const dir = h.makeSandbox('sync-command-');
  const log = path.join(dir, 'sync-argv.jsonl');
  h.mock(dir, 'loopx', `node -e 'const fs=require("fs");fs.appendFileSync(process.env.SYNC_CALLS,JSON.stringify(process.argv.slice(1))+"\\n")' -- "$@"
n=$(wc -l < "$SYNC_CALLS" | tr -d ' ')
if [[ "$n" -le "$SYNC_FAILS" ]]; then echo "sync failure $n" >&2; exit 7; fi
exit 0`);
  const registry = path.join(dir, '.loopx/registry.json');
  const before = fs.readFileSync(registry, 'utf8');
  const run = (args, env = {}) => h.run(dir, args, {
    SYNC_CALLS: log, SYNC_FAILS: '0', LOOPX_TMP_DIR: path.join(dir, '.loopx/tmp'), ...env
  });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  try {
    body({ dir, registry, run, calls });
    if (fs.existsSync(registry)) assert.equal(fs.readFileSync(registry, 'utf8'), before);
  } finally { h.cleanup(dir); }
}

test('sync without arguments passes no goal, even on a feature branch', () => fixture(({ dir, registry, run, calls }) => {
  execFileSync('git', ['checkout', '-qb', 'feature/unrelated'], { cwd: dir });
  const r = run(['sync']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(calls(), [['--registry', registry, 'sync-global']]);
  assert.match(r.stdout, /同步完成/);
}));

test('sync forwards a goal as one argv value', () => fixture(({ registry, run, calls }) => {
  const r = run(['sync', '--goal-id', 'valid-goal']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(calls(), [['--registry', registry, 'sync-global', '--goal-id', 'valid-goal']]);
}));

test('sync preserves spaced registry paths and explicit registry precedence', () => fixture(({ dir, registry, run, calls }) => {
  const explicit = path.join(dir, 'registry with spaces.json');
  fs.copyFileSync(registry, explicit);
  assert.equal(run(['--registry', explicit, 'sync', '--goal-id', 'goal value']).status, 0);
  assert.equal(run(['sync'], { LOOPX_REGISTRY: explicit }).status, 0);
  assert.deepEqual(calls(), [
    ['--registry', explicit, 'sync-global', '--goal-id', 'goal value'],
    ['--registry', explicit, 'sync-global']
  ]);
}));

test('sync rejects malformed arguments before invoking loopx', () => fixture(({ run, calls }) => {
  for (const args of [
    ['--goal-id'], ['--goal-id', ''], ['--goal-id', '  '], ['--goal-id', '--unknown'],
    ['--unknown'], ['extra'], ['--goal-id=gid'], ['--goal-id', 'a', '--goal-id', 'a'],
    ['--goal-id', 'a', '--goal-id', 'b'], ['--goal-id', 'a', 'extra'], ['--help', 'extra']
  ]) {
    const r = run(['sync', ...args]);
    assert.equal(r.status, 2, JSON.stringify(args) + r.stdout + r.stderr);
    assert.match(r.stderr, /用法/);
  }
  assert.deepEqual(calls(), []);
}));

test('sync help works without registry and never invokes loopx', () => fixture(({ dir, run, calls }) => {
  fs.unlinkSync(path.join(dir, '.loopx/registry.json'));
  for (const flag of ['--help', '-h']) {
    const r = run(['sync', flag]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /sync.*--goal-id/);
  }
  assert.deepEqual(calls(), []);
}));

test('sync missing registry fails without synchronization or bootstrap', () => fixture(({ dir, run, calls }) => {
  fs.unlinkSync(path.join(dir, '.loopx/registry.json'));
  const r = run(['sync']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /registry|注册表/);
  assert.deepEqual(calls(), []);
}));

test('sync missing loopx fails with repair instructions', () => fixture(({ dir, run, calls }) => {
  const tools = path.join(dir, 'tools');
  fs.mkdirSync(tools);
  for (const name of ['bash', 'git', 'dirname']) {
    const location = execFileSync('/bin/sh', ['-c', 'command -v ' + name], { encoding: 'utf8' }).trim();
    fs.symlinkSync(location, path.join(tools, name));
  }
  const r = run(['sync'], { PATH: tools });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /loopx.*安装|安装.*loopx/);
  assert.deepEqual(calls(), []);
}));

for (const failures of [1, 2]) {
  test(`sync succeeds after ${failures} transient failures`, () => fixture(({ run, calls }) => {
    const r = run(['sync', '--goal-id', 'valid-goal'], { SYNC_FAILS: String(failures) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(calls().length, failures + 1);
    assert.match(r.stdout, /同步完成/);
  }));
}

test('sync exhausts three attempts, preserves final error and gives a facade retry', () => fixture(({ dir, run, calls }) => {
  const r = run(['sync', '--goal-id', 'missing-goal'], { SYNC_FAILS: '3' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(calls().length, 3);
  assert.match(r.stderr, /FAIL-CLOSED/);
  assert.match(r.stderr, /sync failure 3/);
  assert.match(r.stderr, /loopx-flow.*sync.*--goal-id missing-goal/);
  assert.doesNotMatch(r.stdout, /同步完成/);
  assert.equal(fs.existsSync(path.join(dir, 'specs/features/sync-command')), false);
}));
