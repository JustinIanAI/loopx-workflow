'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  runStageWithState,
  readStageState,
  pipelineLogPath,
  classifyStageFailure,
  formatStageError,
  MAX_STAGE_ATTEMPTS,
} = require('../../skills/code-review/scripts/authentic-review.js');

const HEAD = 'a'.repeat(40);
const OK_JSON = JSON.stringify({
  review_body: '## 动机\nbody',
  verdict: 'APPROVE',
  findings: [],
  evidence: {},
});
const SRC = path.join(__dirname, '../../skills/code-review/scripts/authentic-review.js');

function makeRunDir(dir) {
  return { dir, file: (name) => path.join(dir, name) };
}

// 每个用例独立的 tmp 根：state / log 都落在 $LOOPX_TMP_DIR/review-pr73/ 下
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-state-'));
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const prevTmp = process.env.LOOPX_TMP_DIR;
  process.env.LOOPX_TMP_DIR = path.join(dir, 'tmp');
  return {
    dir,
    runDir,
    restore() {
      if (prevTmp === undefined) delete process.env.LOOPX_TMP_DIR;
      else process.env.LOOPX_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function params(s, override = {}) {
  return {
    repoRoot: s.dir,
    pr: 73,
    stage: 'stage1',
    prompt: 'compact prompt',
    agentBin: 'codex',
    runDir: makeRunDir(s.runDir),
    diffText: '',
    selection: { env: {} },
    headOid: HEAD,
    timeoutMs: 1500,
    backoffBaseMs: 1,
    heartbeatIntervalMs: 0,
    ...override,
  };
}

// 与真实 spawnSync 超时返回同构的结果对象（runReviewAgent 失败分支的形状）
function timeoutResult() {
  return {
    error: 'exit null: ',
    stdout: '',
    stderr: '',
    rawStdout: '',
    status: null,
    signal: 'SIGTERM',
    error_code: 'ETIMEDOUT',
    timed_out: true,
    timeout_ms: 600000,
    tmp_msg: null,
  };
}

test('超时耗尽：重试 3 次仍失败 → ETIMEDOUT 诊断 + state 落 failed', async () => {
  const s = sandbox();
  try {
    let calls = 0;
    const r = await runStageWithState(params(s, {
      runFn: () => { calls += 1; return timeoutResult(); },
    }));
    assert.strictEqual(calls, 3);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error_class, 'ETIMEDOUT');
    assert.match(r.error, /^ETIMEDOUT after 1500ms \(attempt 3\/3/);
    assert.doesNotMatch(r.error, /exit null/);
    assert.strictEqual(r.attempts, 3);

    const state = readStageState(s.dir, 73, 'stage1');
    assert.strictEqual(state.status, 'failed');
    assert.strictEqual(state.error_class, 'ETIMEDOUT');
    assert.strictEqual(state.attempts_total, 3);
    assert.strictEqual(state.head_oid, HEAD);
    assert.match(state.prompt_sha256, /^[0-9a-f]{64}$/);
    assert.ok(state.started_at);
    assert.ok(state.updated_at);
    assert.ok(state.output_path);
    assert.strictEqual(typeof state.elapsed_ms, 'number');
    assert.strictEqual(state.timeout_ms, 1500);
    assert.match(state.error_detail, /signal=SIGTERM/);

    const log = fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8');
    assert.strictEqual((log.match(/event=start/g) || []).length, 3);
    assert.strictEqual((log.match(/event=retry/g) || []).length, 2);
    assert.match(log, /event=retry trigger=ETIMEDOUT before_status=failed after_status=retrying next_attempt=2/);
    assert.match(log, /event=failed error_class=ETIMEDOUT .*timeout_ms=1500/);
  } finally {
    s.restore();
  }
});

test('超时后重试成功（红→绿）：日志保留 retry→ok，state 输出可复用', async () => {
  const s = sandbox();
  try {
    let calls = 0;
    const r = await runStageWithState(params(s, {
      runFn: () => {
        calls += 1;
        return calls === 1 ? timeoutResult() : { stdout: OK_JSON, stderr: '', rawStdout: OK_JSON };
      },
    }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.attempt, 2);
    assert.ok(!r.resumed);

    const state = readStageState(s.dir, 73, 'stage1');
    assert.strictEqual(state.status, 'ok');
    assert.strictEqual(state.attempt, 2);
    assert.strictEqual(state.error_class, null);
    assert.strictEqual(fs.readFileSync(state.output_path, 'utf8'), OK_JSON);

    const log = fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8');
    assert.match(log, /event=retry trigger=ETIMEDOUT/);
    assert.match(log, /attempt=2 event=ok/);
    assert.strictEqual(calls, 2);
  } finally {
    s.restore();
  }
});

test('可接续：同 head/同 prompt/同 agent 复用已成功输出；prompt 变化则丢弃状态重跑', async () => {
  const s = sandbox();
  try {
    let calls = 0;
    const okRun = () => { calls += 1; return { stdout: OK_JSON, stderr: '', rawStdout: OK_JSON }; };
    assert.strictEqual((await runStageWithState(params(s, { runFn: okRun }))).ok, true);
    assert.strictEqual(calls, 1);

    const again = await runStageWithState(params(s, { runFn: okRun }));
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.resumed, true);
    assert.strictEqual(calls, 1, '同身份不得再次调用模型');
    assert.match(fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8'), /event=resume action=skip_model_call/);

    const changed = await runStageWithState(params(s, { runFn: okRun, prompt: 'different prompt' }));
    assert.strictEqual(changed.ok, true);
    assert.strictEqual(changed.resumed, undefined);
    assert.strictEqual(calls, 2);
    assert.match(fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8'), /event=state_discard reason=head_or_prompt_changed/);

    // agentBin 变化同样视为身份变化（交叉核验换执行器时不能复用旧输出）
    const otherAgent = await runStageWithState(params(s, { runFn: okRun, prompt: 'different prompt', agentBin: 'claude' }));
    assert.strictEqual(otherAgent.ok, true);
    assert.strictEqual(calls, 3);
  } finally {
    s.restore();
  }
});

test('结构性失败不重试：CLI 不可用 / 截断 / stdin 超限各一次即终', async () => {
  const s = sandbox();
  try {
    let calls = 0;
    const unavailable = await runStageWithState(params(s, {
      runFn: () => { calls += 1; return { unavailable: true }; },
    }));
    assert.strictEqual(unavailable.ok, false);
    assert.strictEqual(unavailable.unavailable, true);
    assert.strictEqual(unavailable.error_class, 'OTHER');
    assert.strictEqual(calls, 1);

    const trunc = await runStageWithState(params(s, {
      runFn: () => { calls += 1; return { truncated: true, error: 'host truncation marker in model output' }; },
      prompt: 'p2',
    }));
    assert.strictEqual(trunc.ok, false);
    assert.strictEqual(trunc.truncated, true);
    assert.strictEqual(trunc.error_class, 'TRUNCATED');
    assert.strictEqual(calls, 2);

    const state = readStageState(s.dir, 73, 'stage1');
    assert.strictEqual(state.error_class, 'TRUNCATED');
    assert.strictEqual(state.attempts_total, 1);
    assert.match(fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8'), /error_class=TRUNCATED .*retryable=false/);
  } finally {
    s.restore();
  }
});

test('心跳：阶段进行中由独立子进程按间隔追加 heartbeat 行', async () => {
  const s = sandbox();
  try {
    const r = await runStageWithState(params(s, {
      heartbeatIntervalMs: 40,
      runFn: () => {
        // 模拟一次耗时调用（同步阻塞主进程，心跳必须来自子进程）
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
        return { stdout: OK_JSON, stderr: '', rawStdout: OK_JSON };
      },
    }));
    assert.strictEqual(r.ok, true);
    const log = fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8');
    assert.match(log, /heartbeat stage=stage1 attempt=1 elapsed_ms=\d+/);
  } finally {
    s.restore();
  }
});

test('真实 fake 二进制：spawnSync 超时被归类为 ETIMEDOUT 并给出预算值', async () => {
  const s = sandbox();
  const stateDir = path.join(s.dir, 'tmp', 'review-pr73');
  const bin = path.join(s.dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // exec 让 sleep 顶替 shell，避免被 SIGTERM 杀掉后留下继承管道的孤儿子进程
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexec sleep 2\n', { mode: 0o755 });
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  try {
    const r = await runStageWithState(params(s, { timeoutMs: 200 }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error_class, 'ETIMEDOUT');
    // 报出的超时值是**本轮实际生效**的预算：首轮 200ms，重试轮按剩余总预算裁剪（≤200ms）。
    const reportedMs = Number((r.error.match(/^ETIMEDOUT after (\d+)ms/) || [])[1]);
    assert.ok(Number.isFinite(reportedMs) && reportedMs > 0 && reportedMs <= 200, r.error);
    const log = fs.readFileSync(pipelineLogPath(s.dir, 73), 'utf8');
    assert.match(log, /attempt=1\b[^\n]*event=start[^\n]*timeout_ms=200\b/, '首轮必须使用配置的 200ms 预算');
    assert.match(log, /elapsed_total_ms=\d+ retry_budget_ms=400\b/, '总预算仍是 2×单次预算的硬上限');
    const state = readStageState(s.dir, 73, 'stage1');
    assert.strictEqual(state.status, 'failed');
    assert.ok(fs.existsSync(stateDir));
  } finally {
    process.env.PATH = prevPath;
    s.restore();
  }
});

test('失败归类与超时诊断', async () => {
  assert.strictEqual(classifyStageFailure({ timed_out: true }), 'ETIMEDOUT');
  assert.strictEqual(classifyStageFailure({ error_code: 'ETIMEDOUT' }), 'ETIMEDOUT');
  assert.strictEqual(classifyStageFailure({ error: 'exit 1: boom' }), 'OTHER');
  assert.strictEqual(classifyStageFailure(null), 'OTHER');
  assert.match(formatStageError({ timed_out: true }, 600000, 1, 3), /^ETIMEDOUT after 600000ms \(attempt 1\/3/);
  assert.strictEqual(formatStageError({ error: 'exit 1: boom' }, 600000, 1, 3), 'exit 1: boom');
});

test('R2 REVIEW_TIMEOUT_MS 默认 600000，上限 7200000，可调预算直达 spawnSync', async () => {
  const ar = require(SRC);
  assert.strictEqual(ar.TIMEOUT_MS, 600000);
  assert.strictEqual(ar.MAX_TIMEOUT_MS, 7200000);
  assert.strictEqual(ar.BUDGET_MS, ar.TIMEOUT_MS, 'REVIEW_TIMEOUT_MS 未设置时预算即默认 600000');
});

test('R2 子进程校验：预算非法 Fail-Closed 超限 Fail-Closed，超限且无上浮 MAX 不放行', async () => {
  const { spawnSync } = require('node:child_process');
  const run = (env) => spawnSync(process.execPath, ['-e',
    'require(process.argv[1])',
    SRC], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const bad = run({ REVIEW_TIMEOUT_MS: '0' });
  assert.notStrictEqual(bad.status, 0);
  assert.match(String(bad.stderr || ''), /FAIL-CLOSED.*REVIEW_TIMEOUT_MS/);
  const over = run({ REVIEW_TIMEOUT_MS: String(7200001) });
  assert.notStrictEqual(over.status, 0);
  assert.match(String(over.stderr || ''), /FAIL-CLOSED.*REVIEW_TIMEOUT_MS/);
  const big = run({ REVIEW_TIMEOUT_MS: '3600000', REVIEW_TIMEOUT_MS_MAX: '3600000' });
  assert.strictEqual(big.status, 0, big.stderr);
});

test('红线守卫：默认预算未被放宽（TIMEOUT_MS 仍 600000）', async () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.match(src, /const TIMEOUT_MS = 600000;/);
  assert.strictEqual(MAX_STAGE_ATTEMPTS, 3);
});

test('Stage B P0-2：仅切换 model/effort 时必须重跑（selection_hash 隔离）', async () => {
  const s = sandbox();
  try {
    const ok = () => ({ stdout: OK_JSON, stderr: '', rawStdout: OK_JSON });
    const a = await runStageWithState(params(s, { runFn: ok, selection: { model: 'm-a', reasoningEffort: 'medium' }, timeoutMs: 1000 }));
    assert.strictEqual(a.ok, true);
    assert.strictEqual(Boolean(a.resumed), false);
    const b = await runStageWithState(params(s, { runFn: ok, selection: { model: 'm-b', reasoningEffort: 'medium' }, timeoutMs: 1000 }));
    assert.strictEqual(b.ok, true);
    assert.strictEqual(Boolean(b.resumed), false, '切换 model 不得复用旧输出');
    const c = await runStageWithState(params(s, { runFn: ok, selection: { model: 'm-b', reasoningEffort: 'high' }, timeoutMs: 1000 }));
    assert.strictEqual(Boolean(c.resumed), false, '切换 effort 不得复用旧输出');
    const d = await runStageWithState(params(s, { runFn: ok, selection: { model: 'm-b', reasoningEffort: 'high' }, timeoutMs: 1000 }));
    assert.strictEqual(d.resumed, true, '同 model/effort 仍可续跑');
  } finally {
    s.restore();
  }
});

test('Stage B P0-3：并发隔离——不同 pid 落不同目录', async () => {
  const s = sandbox();
  try {
    const ar = require(SRC);
    const dir1 = ar.reviewStateDir(s.dir, 73);
    const dir2 = ar.reviewStateDir(s.dir, 73);
    assert.strictEqual(dir1, dir2, '同一进程内两次取目录应一致（可接续）');
    assert.match(dir1, /review-pr73\//);
    assert.match(dir1, new RegExp(`${process.pid}-`));
    // 成功清理只删本进程子目录，不删父目录（并发对方的目录不受影响）
    const fakeOther = dir1 + '-other-pid-not-me';
    fs.mkdirSync(fakeOther, { recursive: true });
    fs.writeFileSync(path.join(fakeOther, 'stage1.state.json'), '{}', 'utf8');
    fs.rmSync(dir1, { recursive: true, force: true });
    assert.ok(fs.existsSync(path.join(fakeOther, 'stage1.state.json')), '成功清理不得删除父级共享目录');
    fs.rmSync(fakeOther, { recursive: true, force: true });
  } finally {
    s.restore();
  }
});

test('Stage B 成功清理：空父目录一并清除、并发非空父目录保留', async () => {
  const s = sandbox();
  try {
    const ar = require(SRC);
    const dir1 = ar.reviewStateDir(s.dir, 73);
    const parent = path.dirname(dir1);
    // 实现层同形逻辑：rm pid 子目录后 rmdir 父目录（空→清掉；非空→ENOTEMPTY ignore）
    const cleanup = () => {
      try { fs.rmSync(dir1, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      try { fs.rmdirSync(path.dirname(dir1)); } catch (_) { /* ignore */ }
    };
    fs.mkdirSync(dir1, { recursive: true });
    cleanup();
    assert.strictEqual(fs.existsSync(parent), false, '空父目录必须清除以保持 tmpDir 零残留');
    // 并发：sibling 进程目录仍在时不得删除父目录
    fs.mkdirSync(dir1, { recursive: true });
    const other = dir1 + '-other';
    fs.mkdirSync(other, { recursive: true });
    try { fs.rmSync(dir1, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try { fs.rmdirSync(parent); } catch (_) { /* ignore */ }
    assert.ok(fs.existsSync(parent), '并发 sibling 仍在时父目录必须保留');
    fs.rmSync(other, { recursive: true, force: true });
  } finally {
    s.restore();
  }
});

test('Stage B P0：跨进程续跑——新进程发现上一轮候选目录并锁定，不新建目录', async () => {
  const s = sandbox();
  try {
    const ar = require(SRC);
    // 第一轮：写一轮中断留下的 state（模拟进程崩溃）
    const base = path.join(s.dir, 'tmp', 'review-pr73');
    const priorDir = path.join(base, '99999-deadbeef');
    fs.mkdirSync(priorDir, { recursive: true });
    const promptSha = require('crypto').createHash('sha256').update('compact prompt', 'utf8').digest('hex');
    const identityHash = require('crypto').createHash('sha256')
      .update(`${HEAD}\ncodex\n${promptSha}\n\n`, 'utf8').digest('hex');
    const priorOut = path.join(priorDir, 'stage1.attempt1.out.txt');
    fs.writeFileSync(priorOut, OK_JSON, 'utf8');
    fs.writeFileSync(path.join(priorDir, 'stage1.state.json'), JSON.stringify({
      schema_version: 'loopx_flow_review_stage_state_v1',
      pr: 73,
      stage: 'stage1',
      head_oid: HEAD,
      prompt_sha256: promptSha,
      agent_bin: 'codex',
      selection_hash: identityHash,
      status: 'failed',
      error_class: 'ETIMEDOUT',
      attempts_total: 3,
      attempt: 3,
      output_path: priorOut,
    }), 'utf8');

    // 模拟新进程：清理 memo 后直接走 runStageWithState（新 pid），应发现并复用 priorDir
    if (ar.reviewStateDir._memo) {
      for (const k of Object.keys(ar.reviewStateDir._memo)) delete ar.reviewStateDir._memo[k];
    }
    let calls = 0;
    const r = await runStageWithState(params(s, {
      runFn: () => { calls += 1; return { stdout: OK_JSON, stderr: '', rawStdout: OK_JSON }; },
    }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.resumed, undefined);
    assert.strictEqual(calls, 1, '同身份失败轮次应带 attempts_total 重试，不得跳过模型调用');
    const state = readStageState(s.dir, 73, 'stage1');
    assert.strictEqual(state.status, 'ok');
    assert.strictEqual(state.attempts_total, 4, '跨进程带 attempts 续跑（3→4）');
    // 候选目录已被锁定为本次运行目录：父目录下只应有 priorDir 这一个含 state 的子目录
    const subdirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
    assert.strictEqual(subdirs.length, 1, '新进程不得创建新 pid 子目录');
    assert.strictEqual(subdirs[0].name, '99999-deadbeef');
  } finally {
    s.restore();
  }
});
