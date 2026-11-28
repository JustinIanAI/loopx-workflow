const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const flow = path.resolve(__dirname, '../../bin/loopx-flow');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-integrate-configure-'));
const repo = path.join(sandbox, 'target repo');
const bin = path.join(sandbox, 'bin');
const log = path.join(sandbox, 'calls');
const registry = path.join(sandbox, 'registry with spaces.json');
fs.mkdirSync(path.join(repo, 'nested'), { recursive: true });
fs.mkdirSync(bin);
assert.equal(spawnSync('git', ['init', repo]).status, 0);
fs.writeFileSync(registry, JSON.stringify({ schema_version: '0.1', goals: [] }));
fs.writeFileSync(path.join(bin, 'loopx'), `#!/usr/bin/env bash
printf '%s\\0' "$@" >> "$CONFIGURE_CALLS"
printf 'native output\\n'
if [[ "\${CONFIGURE_EXIT:-0}" != 0 ]]; then
  printf 'native configure diagnostic\\n' >&2
fi
exit "\${CONFIGURE_EXIT:-0}"
`, { mode: 0o755 });
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const required = ['--base-ref', 'main', '--integration-branch', 'integration/x', '--source-branch', 'feat/x'];
function run(args = required, extraEnv = {}, cliPrefix = []) {
  fs.rmSync(log, { force: true });
  return spawnSync(flow, [...cliPrefix, 'integrate', 'configure', ...args], {
    cwd: path.join(repo, 'nested'), encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOOPX_REGISTRY: registry,
      LOOPX_TMP_DIR: path.join(sandbox, 'tmp'), CONFIGURE_CALLS: log, CONFIGURE_EXIT: '0', ...extraEnv }
  });
}
function calls() {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\0').slice(0, -1) : [];
}
function expected(args, registryPath = registry) {
  return ['--registry', registryPath, 'integration-branch', 'configure', '--repo-path', fs.realpathSync(repo), ...args];
}

test('AC1: required args delegate exactly once, anchored to target root; defaults stay absent', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), expected(required));
  assert.match(result.stdout, /native output/);
  assert.match(result.stdout, /配置预演完成/);
});

for (const optional of [['--replace'], ['--execute'], ['--plan-file', 'plans/integration plan.json'],
  ['--replace', '--execute', '--plan-file', 'plans/integration plan.json']]) {
  test(`AC2: explicit options forward intact: ${optional.join(' ')}`, () => {
    const args = [...required, ...optional];
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), expected(args));
    assert.match(result.stdout, optional.includes('--execute') ? /配置已落盘/ : /配置预演完成/);
  });
}

test('AC2: reordered options preserve argv boundaries and never execute metacharacters', () => {
  const marker = path.join(sandbox, 'must-not-exist');
  const args = ['--plan-file', `plan "quoted"; $(touch '${marker}')`, '--source-branch', 'feat/"quoted"',
    '--replace', '--integration-branch', 'integration/a b', '--base-ref', 'main'];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), expected(args));
  assert.equal(fs.existsSync(marker), false);
});

for (const option of ['--base-ref', '--integration-branch', '--source-branch']) {
  test(`AC3: missing required ${option} exits 2 without native calls`, () => {
    const index = required.indexOf(option);
    const result = run(required.filter((_, i) => i !== index && i !== index + 1));
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(calls(), []);
  });
}
for (const option of ['--base-ref', '--integration-branch', '--source-branch', '--plan-file']) {
  const rest = required.filter((_, i) => i !== required.indexOf(option) && i !== required.indexOf(option) + 1);
  // plan-file is optional, so its invalid cases still need all three required values.
  const validRest = option === '--plan-file' ? required : rest;
  for (const value of ['', '   ', '\t\n', '--unknown']) {
    test(`AC3: ${option} invalid value ${JSON.stringify(value)} exits 2 with zero calls`, () => {
      const result = run([...validRest, option, value]);
      assert.equal(result.status, 2, result.stderr);
      assert.deepEqual(calls(), []);
    });
  }
  test(`AC3: ${option} without a value exits 2 with zero calls`, () => {
    const result = run([...validRest, option]);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(calls(), []);
  });
}

for (const duplicate of [['--base-ref', 'other'], ['--integration-branch', 'other'], ['--source-branch', 'other'],
  ['--replace', '--replace'], ['--execute', '--execute'], ['--plan-file', 'a', '--plan-file', 'b']]) {
  test(`AC4: duplicate ${duplicate[0]} exits 2 without native calls`, () => {
    const result = run([...required, ...duplicate]);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(calls(), []);
  });
}
for (const unknown of ['--unknown', '--status', '--repo-path', '--format', '--base-ref=main', 'extra', '--']) {
  test(`AC4: rejects ${unknown} without native calls`, () => {
    const result = run([...required, unknown]);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(calls(), []);
  });
}
for (const exit of ['7', '42', '127']) {
  test(`AC5: native exit ${exit} becomes 1 with diagnostics and no success`, () => {
    const result = run(required, { CONFIGURE_EXIT: exit });
    assert.equal(result.status, 1);
    assert.deepEqual(calls(), expected(required));
    assert.match(result.stdout, /native output/);
    assert.match(result.stderr, /native configure diagnostic/);
    assert.match(result.stderr, /FAIL-CLOSED/);
    assert.doesNotMatch(result.stdout, /配置预演完成|配置已落盘/);
  });
}

test('AC6: explicit global registry wins over environment, including spaces', () => {
  const result = run(required, { LOOPX_REGISTRY: path.join(sandbox, 'absent') }, ['--registry', registry]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), expected(required));
});

test('AC3: bare configure refuses to run sync or configure', () => {
  const result = run([]);
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(calls(), []);
});

test('AC5: missing loopx fails closed', () => {
  const noLoopx = path.join(sandbox, 'no-loopx-bin');
  fs.mkdirSync(noLoopx);
  for (const command of ['bash', 'dirname', 'git']) {
    const located = spawnSync('/bin/sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
    assert.equal(located.status, 0);
    fs.symlinkSync(located.stdout.trim(), path.join(noLoopx, command));
  }
  const result = run(required, { PATH: noLoopx });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /未检测到 loopx CLI/);
  assert.deepEqual(calls(), []);
});

test('AC6: missing explicit registry stays fail-closed', () => {
  const result = run(required, { LOOPX_REGISTRY: path.join(sandbox, 'missing-registry.json') });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /registry 缺失/);
  assert.deepEqual(calls(), []);
});

test('AC7: help advertises configure and all six options', () => {
  const result = spawnSync(flow, ['help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /integrate configure/);
  for (const option of [...required.filter((_, i) => i % 2 === 0), '--replace', '--execute', '--plan-file']) {
    assert.ok(result.stdout.includes(option), `help missing ${option}`);
  }
});
