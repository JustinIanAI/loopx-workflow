'use strict';
/**
 * ADR-0017 / Issue #79：阶段重试必须有总预算上限。
 *
 * 单次预算 × 最大重试次数会把最长等待放大到 3×（默认 30 分钟）。
 * 默认只允许「首轮 + 至多一轮完整重试」，超出即停机并如实记录；
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

function timedOutStage(delayMs) {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { error: 'exit null: timed out', error_code: 'ETIMEDOUT', timed_out: true, signal: 'SIGTERM' };
  };
}

async function runWith(sbx, { delayMs, timeoutMs, env }) {
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
      backoffBaseMs: 1,
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
    // timeoutMs=100 → 默认总预算 200ms；单轮就花掉 ~120ms，再来一轮会超限。
    const r = await runWith(sbx, { delayMs: 120, timeoutMs: 100 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retry_budget_exhausted, true);
    assert.strictEqual(r.attempts, 1, '超出总预算时不得再起第二轮');
    const log = fs.readFileSync(pipelineLogPath(sbx.dir, 42), 'utf8');
    assert.match(log, /event=retry_budget_exhausted/);
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
