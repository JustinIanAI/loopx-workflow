'use strict';
/**
 * ADR-0017 / Issue #79：阶段重试必须有总预算上限。
 *
 * 单次预算 × 最大重试次数会把最长等待放大到 3×（默认 30 分钟）。
 * 默认只允许「首轮 + 至多一轮按剩余额度裁剪的重试」，超出即停机并如实记录；
 * REVIEW_RETRY_BUDGET_MS 可显式放宽，非法值在模块加载期 Fail-Closed。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  runStageWithState,
  pipelineLogPath,
} = require('../../skills/code-review/scripts/authentic-review.js');

const SRC = path.join(__dirname, '../../skills/code-review/scripts/authentic-review.js');
const HEAD = 'd'.repeat(40);

function sandbox(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, restore() { fs.rmSync(dir, { recursive: true, force: true }); } };
}

// 尊重调用方传入的超时值：真实 `execStage` 由 spawnSync 超时终止，
// mock 若不理会超时参数，就无法验证「重试轮按剩余额度裁剪」这一不变量。
function timedOutStage(delayMs) {
  return async (_bin, _prompt, timeoutMs) => {
    const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(delayMs, timeoutMs) : delayMs;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return { error: 'exit null: timed out', error_code: 'ETIMEDOUT', timed_out: true, signal: 'SIGTERM' };
  };
}

async function runWith(sbx, { delayMs, timeoutMs, env, backoffBaseMs = 1 }) {
  const prev = process.env.REVIEW_RETRY_BUDGET_MS;
  if (env === undefined) delete process.env.REVIEW_RETRY_BUDGET_MS;
  else process.env.REVIEW_RETRY_BUDGET_MS = env;
  try {
    return await runStageWithState({
      repoRoot: sbx.dir,
      pr: 42,
      stage: 'stage1',
      prompt: 'p',
      agentBin: 'codex',
      runDir: null,
      diffText: '',
      selection: null,
      headOid: HEAD,
      timeoutMs,
      maxAttempts: 3,
      backoffBaseMs,
      heartbeatIntervalMs: 0,
      force: true,
      runFn: timedOutStage(delayMs),
    });
  } finally {
    if (prev === undefined) delete process.env.REVIEW_RETRY_BUDGET_MS;
    else process.env.REVIEW_RETRY_BUDGET_MS = prev;
  }
}

test('慢轮次耗尽总预算：停止重试并标记 retry_budget_exhausted', async () => {
  const sbx = sandbox('retry-budget-slow-');
  try {
    // timeoutMs=100 → 默认总预算 200ms；首轮按 100ms 预算超时，还剩 ~100ms：
    // 必须真的起第二轮，且第二轮超时被裁到剩余额度，总耗时不得越过 200ms 硬上限。
    const r = await runWith(sbx, { delayMs: 120, timeoutMs: 100 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retry_budget_exhausted, true);
    assert.strictEqual(r.attempts, 2, '还剩额度时必须起第二轮；第二轮耗尽后才停机');
    const log = fs.readFileSync(pipelineLogPath(sbx.dir, 42), 'utf8');
    assert.match(log, /event=retry_budget_exhausted/);
    const second = log.match(/attempt=2\b[^\n]*event=start[^\n]*timeout_ms=(\d+)/);
    assert.ok(second, '第二轮必须留下 start 记录');
    const secondTimeout = Number(second[1]);
    assert.ok(secondTimeout > 0 && secondTimeout <= 100, `第二轮超时必须裁到剩余额度，实际 ${secondTimeout}ms`);
    const retry = log.match(/attempt=1\b[^\n]*event=retry[^\n]*next_timeout_ms=(\d+)/);
    assert.ok(retry, '重试事件必须记录下一轮被裁剪后的超时');
    assert.strictEqual(Number(retry[1]), secondTimeout, 'retry 事件与第二轮 start 的超时口径必须一致');
    const exhausted = log.match(/event=retry_budget_exhausted[^\n]*elapsed_total_ms=(\d+)[^\n]*retry_budget_ms=(\d+)/);
    assert.ok(exhausted, '预算耗尽事件必须同时记录已花与预算');
    assert.ok(
      Number(exhausted[1]) <= Number(exhausted[2]) + 50,
      `总耗时不得越过 retry_budget_ms 硬上限（容差 50ms 覆盖调度开销）：${exhausted[1]}ms > ${exhausted[2]}ms`,
    );
  } finally { sbx.restore(); }
});

test('快轮次不触发总预算闸门：仍可用到 maxAttempts', async () => {
  const sbx = sandbox('retry-budget-fast-');
  try {
    const r = await runWith(sbx, { delayMs: 5, timeoutMs: 100 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retry_budget_exhausted, false);
    assert.strictEqual(r.attempts, 3);
  } finally { sbx.restore(); }
});

test('REVIEW_RETRY_BUDGET_MS 可显式放宽', async () => {
  const sbx = sandbox('retry-budget-env-');
  try {
    const r = await runWith(sbx, { delayMs: 30, timeoutMs: 100, env: '10000' });
    assert.strictEqual(r.retry_budget_exhausted, false);
    assert.strictEqual(r.attempts, 3);
  } finally { sbx.restore(); }
});

test('非法 REVIEW_RETRY_BUDGET_MS 在加载期 Fail-Closed', () => {
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SRC)});`], {
    encoding: 'utf8',
    env: { ...process.env, REVIEW_RETRY_BUDGET_MS: 'not-a-number' },
  });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /REVIEW_RETRY_BUDGET_MS/);
});

test('退避计入总预算硬上限：剩余额度按 elapsed + backoff 裁剪', async () => {
  const sbx = sandbox('retry-budget-backoff-');
  try {
    // timeoutMs=100 → 总预算 200ms；首轮花 ~100ms，退避 40ms 也占预算：
    // 第二轮超时必须 ≤ 200 - 100 - 40 ≈ 60ms，而不是 100ms。
    const r = await runWith(sbx, { delayMs: 200, timeoutMs: 100, backoffBaseMs: 40 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.attempts, 2);
    const log = fs.readFileSync(pipelineLogPath(sbx.dir, 42), 'utf8');
    assert.match(log, /attempt=1\b[^\n]*event=retry[^\n]*backoff_ms=40/);
    const second = log.match(/attempt=2\b[^\n]*event=start[^\n]*timeout_ms=(\d+)/);
    assert.ok(second, '第二轮必须留下 start 记录');
    assert.ok(Number(second[1]) <= 60, `第二轮超时必须扣掉退避，实际 ${second[1]}ms`);
    const exhausted = log.match(/event=retry_budget_exhausted[^\n]*backoff_ms=(\d+)/);
    assert.ok(exhausted, '预算耗尽事件必须记录退避');
  } finally { sbx.restore(); }
});
