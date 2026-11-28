'use strict';
/**
 * Feature: ADR-0017 Stage 1 — 审查管线异步执行器。
 *
 * 验证 PR-A 的唯一核心增量：runReviewAgent 由 spawnSync 改为异步 spawn 后，
 *   * 等待模型期间调用方事件循环保持可用（并发计时器持续推进）；
 *   * 预算内的慢推理一律 wait-out，不被提前强杀；
 *   * 预算耗尽才终止，且诊断形状与既有 REVIEW_TIMEOUT_MS 语义一致（ETIMEDOUT）；
 *   * 预算默认值 600000 与非法值 Fail-Closed 规则未被重定义；
 *   * runStageWithState 走真实异步执行器时，心跳与 wait_out 日志并存（可观测证据）。
 *
 * 时序类断言一律使用宽松阈值（>= 间隔的一半），避免 CI 抖动误报。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  runReviewAgent,
  runStageWithState,
  pipelineLogPath,
  readStageState,
  TIMEOUT_MS,
  BUDGET_MS,
} = require('../../skills/code-review/scripts/authentic-review.js');

const SRC = path.join(__dirname, '../../skills/code-review/scripts/authentic-review.js');
const HEAD = 'b'.repeat(40);
const OK_JSON = JSON.stringify({
  review_body: '## 动机\nbody',
  verdict: 'APPROVE',
  findings: [],
  evidence: {},
});

// 用 node 写假执行器：不产生孙进程，SIGTERM 能立即结束，避免管道被孤儿进程牵住。
function writeAgent(dir, name, { delayMs = 0, body = '', exitCode = 0 } = {}) {
  const script = [
    '#!/usr/bin/env node',
    'process.stdin.resume();',
    "process.stdin.on('data', () => {});",
    'const finish = () => {',
    `  process.stdout.write(${JSON.stringify(body)});`,
    `  process.exit(${exitCode});`,
    '};',
    delayMs > 0 ? `setTimeout(finish, ${delayMs});` : 'finish();',
    '',
  ].join('\n');
  const p = path.join(dir, name);
  fs.writeFileSync(p, script, { mode: 0o755 });
  return p;
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-exec-'));
  const bin = path.join(dir, 'bin');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  const prevPath = process.env.PATH;
  const prevTmp = process.env.LOOPX_TMP_DIR;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  process.env.LOOPX_TMP_DIR = path.join(dir, 'tmp');
  return {
    dir,
    bin,
    runDir: { dir: runDir, file: (name) => path.join(runDir, name) },
    restore() {
      process.env.PATH = prevPath;
      if (prevTmp === undefined) delete process.env.LOOPX_TMP_DIR;
      else process.env.LOOPX_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('异步执行：等待模型期间调用方事件循环持续可用（并发计时器推进）', async () => {
  const s = sandbox();
  try {
    writeAgent(s.bin, 'claude', { delayMs: 400, body: '{"ok":true}' });
    const ticks = [];
    const ticker = setInterval(() => ticks.push(Date.now()), 25);
    const started = Date.now();
    const pending = runReviewAgent('claude', 'compact prompt', 5000, s.runDir, '');
    assert.strictEqual(typeof pending.then, 'function', 'runReviewAgent 必须返回 Promise（非阻塞调用方）');
    let result;
    try {
      result = await pending;
    } finally {
      clearInterval(ticker);
    }
    const elapsed = Date.now() - started;
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.match(result.stdout, /\{"ok":true\}/);
    assert.ok(elapsed >= 300, `fake agent 应耗时 ~400ms，实际 ${elapsed}ms`);
    assert.ok(
      ticks.length >= Math.floor(elapsed / 25) / 2,
      `事件循环应在等待期间推进，实际 ${ticks.length} 次 / ${elapsed}ms`,
    );
    // 首个 tick 必须远早于模型返回，证明计时器与模型等待是并发而非串行。
    assert.ok(ticks[0] - started < elapsed / 2, '事件循环 tick 应发生在模型返回之前');
  } finally {
    s.restore();
  }
});

test('预算内慢推理 wait-out：不提前 SIGTERM，正常返回模型输出', async () => {
  const s = sandbox();
  try {
    writeAgent(s.bin, 'claude', { delayMs: 300, body: '{"slow":true}' });
    const started = Date.now();
    const result = await runReviewAgent('claude', 'p', 5000, s.runDir, '');
    const elapsed = Date.now() - started;
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.strictEqual(result.timed_out, undefined, '预算内的慢推理不得被标记超时');
    assert.strictEqual(result.signal, undefined, '预算内的慢推理不得被信号强杀');
    assert.match(result.stdout, /\{"slow":true\}/);
    assert.ok(elapsed >= 250, `应等待模型跑完，实际 ${elapsed}ms`);
  } finally {
    s.restore();
  }
});

test('预算耗尽才终止：ETIMEDOUT 诊断沿用既有预算语义', async () => {
  const s = sandbox();
  try {
    writeAgent(s.bin, 'claude', { delayMs: 5000, body: '' });
    const started = Date.now();
    const result = await runReviewAgent('claude', 'p', 120, s.runDir, '');
    const elapsed = Date.now() - started;
    assert.strictEqual(result.timed_out, true);
    assert.strictEqual(result.error_code, 'ETIMEDOUT');
    assert.strictEqual(result.signal, 'SIGTERM');
    assert.strictEqual(result.timeout_ms, 120);
    assert.match(result.error, /^exit null:/);
    assert.ok(elapsed < 3000, `预算 120ms 后应尽快终止，实际 ${elapsed}ms`);
  } finally {
    s.restore();
  }
});

test('预算语义回归：默认 600000，非法 REVIEW_TIMEOUT_MS 仍 Fail-Closed', () => {
  assert.strictEqual(TIMEOUT_MS, 600000);
  assert.strictEqual(BUDGET_MS, TIMEOUT_MS, 'REVIEW_TIMEOUT_MS 未设置时预算即默认 600000');
  const run = (env) => spawnSync(process.execPath, ['-e', 'require(process.argv[1])', SRC], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  const bad = run({ REVIEW_TIMEOUT_MS: 'not-a-number' });
  assert.notStrictEqual(bad.status, 0, '非法 REVIEW_TIMEOUT_MS 必须非零退出');
  assert.match(String(bad.stderr || ''), /FAIL-CLOSED.*REVIEW_TIMEOUT_MS/);
  const ok = run({ REVIEW_TIMEOUT_MS: '120000' });
  assert.strictEqual(ok.status, 0, String(ok.stderr || ''));
});

test('runStageWithState 走真实异步执行器：心跳与 wait_out 日志并存', async () => {
  const s = sandbox();
  try {
    writeAgent(s.bin, 'claude', { delayMs: 220, body: OK_JSON });
    const r = await runStageWithState({
      repoRoot: s.dir,
      pr: 154,
      stage: 'stage1',
      prompt: 'compact prompt',
      agentBin: 'claude',
      runDir: s.runDir,
      diffText: '',
      selection: { env: {} },
      headOid: HEAD,
      timeoutMs: 5000,
      backoffBaseMs: 1,
      heartbeatIntervalMs: 40,
    });
    assert.strictEqual(r.ok, true, `stage failed: ${r.error}`);
    assert.strictEqual(r.attempt, 1);
    const state = readStageState(s.dir, 154, 'stage1');
    assert.strictEqual(state.status, 'ok');
    assert.strictEqual(fs.readFileSync(state.output_path, 'utf8'), OK_JSON);
    const log = fs.readFileSync(pipelineLogPath(s.dir, 154), 'utf8');
    assert.match(log, /heartbeat stage=stage1 attempt=1 elapsed_ms=\d+/, '等待期间应由心跳子进程持续留痕');
    assert.match(log, /event=wait_out .*heartbeat_interval_ms=40 .*outcome=ok/, '慢推理 wait-out 必须留日志');
  } finally {
    s.restore();
  }
});
