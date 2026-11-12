'use strict';
/**
 * Feature: ingest gate-results — 四门禁真实退出码消费（ADR-0011 T1/T3 / REQ-QUALITY-1）
 *
 * ingest 不重跑四门禁，只消费 check 落盘的 gate-results：
 *   - 缺 --gate-results / 不可读 / 非法 JSON / 四门禁缺项 → 非 0，门禁写 not_run，不写 passed 收据；
 *   - 任一门禁真实失败（status=failed 或 exit_code 非 0）→ 非 0，05-evidence 记录真实退出码；
 *   - 仅当四门禁齐全且 exit_code === 0 → passed，05-evidence 记录来源与逐门禁真实退出码。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INGEST_SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const GATE_RESULTS_SCHEMA = 'loopx_flow_gate_results_v0';
// 证据行以 "| `typecheck` |" 开头；用字面反引号避免测试源码里出现模板字面量。
const BT = String.fromCharCode(96);

function allPassGates() {
  return [
    { name: 'typecheck', command: 'npm run typecheck', exit_code: 0, status: 'passed' },
    { name: 'lint', command: 'npm run lint', exit_code: 0, status: 'passed' },
    { name: 'build', command: 'npm run build', exit_code: 0, status: 'passed' },
    { name: 'test', command: 'npm run test', exit_code: 0, status: 'passed' }
  ];
}

// 独立胶囊 + mock loopx：不写真实 .loopx registry，也避免依赖宿主机 loopx。
function makeSandbox() {
  const feature = 'ingest-gates-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  const capsuleDir = path.join(PROJECT_ROOT, 'specs/features', feature);
  fs.mkdirSync(capsuleDir, { recursive: true });

  const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-gates-bin-'));
  const callsLog = path.join(tmpBin, 'loopx-calls.log');
  const mockLoopx = '#!/usr/bin/env bash\necho "$*" >> ' + JSON.stringify(callsLog) + '\nexit 0\n';
  fs.writeFileSync(path.join(tmpBin, 'loopx'), mockLoopx, { mode: 0o755 });

  const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-gates-json-'));
  return { feature: feature, capsuleDir: capsuleDir, tmpBin: tmpBin, callsLog: callsLog, gateDir: gateDir };
}

function writeGateResults(sandbox, gates) {
  const file = path.join(sandbox.gateDir, 'gate-results.json');
  fs.writeFileSync(file, JSON.stringify({ schema_version: GATE_RESULTS_SCHEMA, gates: gates }));
  return file;
}

function runIngest(sandbox, extraArgs) {
  return spawnSync(process.execPath, [
    INGEST_SCRIPT,
    '--feature', sandbox.feature
  ].concat(extraArgs || []), {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: sandbox.tmpBin + ':' + (process.env.PATH || '') }
  });
}

function readEvidence(sandbox) {
  return fs.readFileSync(path.join(sandbox.capsuleDir, '05-evidence.md'), 'utf8');
}

function gateRow(text, name) {
  return text.split('\n').find((line) => line.startsWith('| ' + BT + name + BT));
}

function loopxCalls(sandbox) {
  if (!fs.existsSync(sandbox.callsLog)) return '';
  return fs.readFileSync(sandbox.callsLog, 'utf8');
}

function cleanup(sandbox) {
  fs.rmSync(sandbox.capsuleDir, { recursive: true, force: true });
  fs.rmSync(sandbox.tmpBin, { recursive: true, force: true });
  fs.rmSync(sandbox.gateDir, { recursive: true, force: true });
}

test('1. 缺 --gate-results：非 0，四门禁写 not_run，不记录收据', () => {
  const sandbox = makeSandbox();
  try {
    const res = runIngest(sandbox, []);
    assert.notStrictEqual(res.status, 0, '缺少 gate-results 时必须非 0');
    const text = readEvidence(sandbox);
    assert.strictEqual(text.includes('NOT_RUN'), true, '05-evidence 不得写 PASSING');
    assert.strictEqual(text.includes('PASSING'), false, '缺结果时不得写 PASSING');
    assert.strictEqual(text.includes('Gate Results Source'), true);
    assert.strictEqual(text.includes('NOT_PROVIDED'), true, '必须标明 gate-results 未提供');
    for (const name of ['typecheck', 'lint', 'build', 'test']) {
      const row = gateRow(text, name);
      assert.ok(row, '05-evidence 必须有 ' + name + ' 门禁行');
      assert.ok(row.includes('not_run'), name + ' 必须写 not_run，实际: ' + row);
    }
    assert.strictEqual(loopxCalls(sandbox).includes('change-quality record'), false, '不得记录收据');
  } finally {
    cleanup(sandbox);
  }
});

test('2. 真实门禁失败：非 0，05-evidence 记录真实 failed 退出码，不记录收据', () => {
  const sandbox = makeSandbox();
  try {
    const gates = allPassGates();
    gates[1] = { name: 'lint', command: 'npm run lint', exit_code: 7, status: 'failed' };
    const gateFile = writeGateResults(sandbox, gates);
    const res = runIngest(sandbox, ['--gate-results', gateFile]);
    assert.notStrictEqual(res.status, 0, '门禁失败时必须非 0');
    const text = readEvidence(sandbox);
    assert.strictEqual(text.includes('PASSING'), false, '门禁失败时不得写 PASSING');
    assert.strictEqual(text.includes('FAILED (Gate Failures Present)'), true);
    const lintRow = gateRow(text, 'lint');
    assert.ok(lintRow, '05-evidence 必须有 lint 门禁行');
    assert.ok(lintRow.includes(BT + '7' + BT), 'lint 行必须记录真实退出码 7: ' + lintRow);
    assert.ok(lintRow.includes('failed'), 'lint 行必须记录 failed: ' + lintRow);
    assert.strictEqual(loopxCalls(sandbox).includes('change-quality record'), false, '不得记录收据');
  } finally {
    cleanup(sandbox);
  }
});

test('3. 四门禁缺项：缺失门禁写 not_run，不把已通过项整体写成 PASSING', () => {
  const sandbox = makeSandbox();
  try {
    const gates = allPassGates().filter((gate) => gate.name !== 'test');
    const gateFile = writeGateResults(sandbox, gates);
    const res = runIngest(sandbox, ['--gate-results', gateFile]);
    assert.notStrictEqual(res.status, 0, '四门禁缺项时必须非 0');
    const text = readEvidence(sandbox);
    assert.strictEqual(text.includes('PASSING'), false);
    assert.strictEqual(text.includes('NOT_RUN'), true);
    const testRow = gateRow(text, 'test');
    assert.ok(testRow, '05-evidence 必须有 test 门禁行');
    assert.ok(testRow.includes('not_run'), '缺失门禁必须写 not_run: ' + testRow);
    const typecheckRow = gateRow(text, 'typecheck');
    assert.ok(typecheckRow.includes('passed'), '已实测通过项保留真实结果: ' + typecheckRow);
    assert.strictEqual(loopxCalls(sandbox).includes('change-quality record'), false, '不得记录收据');
  } finally {
    cleanup(sandbox);
  }
});

test('4. 非法 JSON：非 0，不写 passed', () => {
  const sandbox = makeSandbox();
  try {
    const gateFile = path.join(sandbox.gateDir, 'gate-results.json');
    fs.writeFileSync(gateFile, '{ not-json');
    const res = runIngest(sandbox, ['--gate-results', gateFile]);
    assert.notStrictEqual(res.status, 0, '非法 JSON 时必须非 0');
    const text = readEvidence(sandbox);
    assert.strictEqual(text.includes('PASSING'), false);
    assert.strictEqual(text.includes('not_run'), true);
    assert.strictEqual(loopxCalls(sandbox).includes('change-quality record'), false, '不得记录收据');
  } finally {
    cleanup(sandbox);
  }
});

test('5. 四门禁全绿：退出 0，05-evidence 记录来源与逐门禁真实退出码', () => {
  const sandbox = makeSandbox();
  try {
    const gateFile = writeGateResults(sandbox, allPassGates());
    const res = runIngest(sandbox, ['--gate-results', gateFile]);
    assert.strictEqual(res.status, 0, '全绿必须退出 0: ' + res.stderr);
    const text = readEvidence(sandbox);
    assert.strictEqual(text.includes('PASSING'), true);
    assert.strictEqual(text.includes(GATE_RESULTS_SCHEMA), true, '来源必须是稳定的 schema，不能写宿主机临时路径');
    assert.strictEqual(text.includes(gateFile), false, '临时路径会让每次 check 改写证据');
    for (const name of ['typecheck', 'lint', 'build', 'test']) {
      const row = gateRow(text, name);
      assert.ok(row && row.includes(BT + '0' + BT), name + ' 行必须记录真实退出码 0: ' + row);
      assert.ok(row.includes('passed'), name + ' 行必须写 passed: ' + row);
      assert.strictEqual(row.includes('not_applicable'), false, '四门禁不得标 not_applicable');
    }
    assert.strictEqual(text.includes('not_applicable'), false, '四门禁不得标 not_applicable');
  } finally {
    cleanup(sandbox);
  }
});

test('6. 已跟踪的 05-evidence 再 ingest 一次不得改字节', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-stable-'));
  const feature = 'stable-evidence';
  const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-stable-bin-'));
  let gateFile = '';
  try {
    execSync('git init -q && git config user.email t@example.com && git config user.name t', { cwd: dir });
    fs.mkdirSync(path.join(dir, 'specs/features', feature), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# stable\n');
    execSync('git add -A && git commit -qm init', { cwd: dir });
    const base = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    const mock = [
      '#!/usr/bin/env bash',
      'if [[ "$*" == *prepare* ]]; then',
      '  printf \'%s\\n\' \'{"scope":{"scope_fingerprint":"fixture","base_commit":"' + base + '","base_ref":"HEAD"}}\'',
      '  exit 0',
      'fi',
      'exit 0'
    ].join('\n');
    fs.writeFileSync(path.join(tmpBin, 'loopx'), mock, { mode: 0o755 });
    gateFile = path.join(os.tmpdir(), 'ingest-stable-gates-' + process.pid + '.json');
    fs.writeFileSync(gateFile, JSON.stringify({ schema_version: GATE_RESULTS_SCHEMA, gates: allPassGates() }));
    const run = () => spawnSync(process.execPath, [
      INGEST_SCRIPT, '--feature', feature, '--goal-id', feature + '-goal', '--gate-results', gateFile
    ], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: tmpBin + ':' + (process.env.PATH || '') } });
    const first = run();
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    const evidencePath = path.join(dir, 'specs/features', feature, '05-evidence.md');
    const before = fs.readFileSync(evidencePath, 'utf8');
    execSync('git add specs/features/' + feature + '/05-evidence.md && git commit -qm evidence', { cwd: dir });
    const second = run();
    assert.strictEqual(second.status, 0, second.stdout + second.stderr);
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), before);
    assert.strictEqual(execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmpBin, { recursive: true, force: true });
    if (gateFile) fs.rmSync(gateFile, { force: true });
  }
});
