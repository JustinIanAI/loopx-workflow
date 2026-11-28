'use strict';
/**
 * ADR-0017 D3 / #79 剩余 gap 2：salvage 只接受「可核验件齐全」的结果，并必须披露进正文。
 * 覆盖三条：接受判据、拒绝路径的日志、正文披露位置。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readPartialStageOutput,
  salvageFieldCheck,
  buildSalvageDisclosure,
  finalizeReviewBody,
  runStageWithState,
  readStageState,
  pipelineLogPath,
} = require('../../skills/code-review/scripts/authentic-review.js');

const HEAD = 'a'.repeat(40);

const REVIEW_OK = {
  review_body: '## 动机\nbody',
  verdict: 'APPROVE',
  findings: [],
  declaration: { declaration: 'self_reported', model: 'codex', provider: 'openai' },
};
const REVIEW_NO_VERDICT = { review_body: '## 动机\nbody', findings: [], declaration: { declaration: 'self_reported' } };
const REVIEW_NO_DECL = { review_body: '## 动机\nbody', verdict: 'APPROVE', findings: [] };
const LEGACY_PARTIAL = { review_body: '## 动机\nbody', evidence: {} };
const EVIDENCE_OK = { evidence: { correctness: { status: 'verified' } } };
const EVIDENCE_EMPTY = { evidence: {} };

function runWith(stdout) {
  return { error: 'exit null: ', stdout, stderr: '', rawStdout: '', status: null, signal: 'SIGTERM', error_code: 'ETIMEDOUT', timed_out: true, tmp_msg: null };
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salvage-'));
  const runDirPath = path.join(dir, 'run');
  fs.mkdirSync(runDirPath, { recursive: true });
  const prevTmp = process.env.LOOPX_TMP_DIR;
  process.env.LOOPX_TMP_DIR = path.join(dir, 'tmp');
  return {
    dir,
    runDir: { dir: runDirPath, file: (name) => path.join(runDirPath, name) },
    restore() {
      if (prevTmp === undefined) delete process.env.LOOPX_TMP_DIR;
      else process.env.LOOPX_TMP_DIR = prevTmp;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('salvage 判据：stage1 必须是 review_body + verdict + 声明三件齐全', () => {
  assert.deepStrictEqual(salvageFieldCheck(REVIEW_OK, 'stage1'), ['review_body', 'verdict', 'declaration']);
  assert.strictEqual(salvageFieldCheck(REVIEW_NO_VERDICT, 'stage1'), null);
  assert.strictEqual(salvageFieldCheck(REVIEW_NO_DECL, 'stage1'), null);
  // 旧行为（只要有 review_body 就算成功）被收紧：缺 verdict/声明一律不可 salvage
  assert.strictEqual(salvageFieldCheck(LEGACY_PARTIAL, 'stage1'), null);
  assert.deepStrictEqual(salvageFieldCheck({ ...REVIEW_OK, declaration: undefined, reviewer: { model: 'x' } }, 'stage1'), ['review_body', 'verdict', 'declaration']);
});

test('salvage 判据：stage2 要非空 evidence，未知阶段一律拒绝', () => {
  assert.deepStrictEqual(salvageFieldCheck(EVIDENCE_OK, 'stage2'), ['evidence']);
  assert.strictEqual(salvageFieldCheck(EVIDENCE_EMPTY, 'stage2'), null);
  assert.strictEqual(salvageFieldCheck(REVIEW_OK, 'stage9'), null);
});

test('readPartialStageOutput：按阶段取判据，拒绝时保留字节用于诊断', () => {
  const ok = readPartialStageOutput(runWith(JSON.stringify(REVIEW_OK)), 'stage1');
  assert.strictEqual(ok.salvaged, true);
  assert.deepStrictEqual(ok.fields, ['review_body', 'verdict', 'declaration']);
  assert.ok(ok.bytes > 0);

  const rejected = readPartialStageOutput(runWith(JSON.stringify(LEGACY_PARTIAL)), 'stage1');
  assert.strictEqual(rejected.salvaged, false);
  assert.deepStrictEqual(rejected.fields, []);
  assert.ok(rejected.bytes > 0, '拒绝也要记录字节数，便于排障');
  assert.strictEqual(rejected.text, '');

  const stage2 = readPartialStageOutput(runWith(JSON.stringify(EVIDENCE_OK)), 'stage2');
  assert.strictEqual(stage2.salvaged, true);
});

test('runStageWithState：接受 salvage 时返回可核验件清单并写 state/log', async () => {
  const s = sandbox();
  try {
    const r = await runStageWithState({
      repoRoot: s.dir,
      pr: 79,
      stage: 'stage1',
      prompt: 'p',
      agentBin: 'codex',
      runDir: s.runDir,
      diffText: '',
      selection: { env: {} },
      headOid: HEAD,
      timeoutMs: 1500,
      backoffBaseMs: 1,
      heartbeatIntervalMs: 0,
      runFn: () => runWith(JSON.stringify(REVIEW_OK)),
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.salvaged, true);
    assert.deepStrictEqual(r.salvage_fields, ['review_body', 'verdict', 'declaration']);
    assert.strictEqual(r.error_class, 'ETIMEDOUT');
    assert.strictEqual(r.attempt, 1);

    const state = readStageState(s.dir, 79, 'stage1');
    assert.strictEqual(state.salvage, true);
    assert.deepStrictEqual(state.salvage_fields, ['review_body', 'verdict', 'declaration']);

    const log = fs.readFileSync(pipelineLogPath(s.dir, 79), 'utf8');
    assert.match(log, /event=salvage action=accept_partial_output trigger=ETIMEDOUT why=verifiable_fields_recovered fields=review_body,verdict,declaration/);
  } finally {
    s.restore();
  }
});

test('runStageWithState：可核验件不齐时拒绝 salvage 并留痕，不按成功返回', async () => {
  const s = sandbox();
  try {
    const r = await runStageWithState({
      repoRoot: s.dir,
      pr: 79,
      stage: 'stage1',
      prompt: 'p',
      agentBin: 'codex',
      runDir: s.runDir,
      diffText: '',
      selection: { env: {} },
      headOid: HEAD,
      timeoutMs: 10,
      maxAttempts: 1,
      backoffBaseMs: 1,
      heartbeatIntervalMs: 0,
      runFn: () => runWith(JSON.stringify(LEGACY_PARTIAL)),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.salvaged, undefined);

    const log = fs.readFileSync(pipelineLogPath(s.dir, 79), 'utf8');
    assert.match(log, /event=salvage_rejected trigger=ETIMEDOUT why=verifiable_fields_missing required=review_body,verdict,declaration/);
    assert.doesNotMatch(log, /event=salvage action=accept_partial_output/);
  } finally {
    s.restore();
  }
});

test('buildSalvageDisclosure：无 salvage 时零输出，有则写机械披露句', () => {
  assert.strictEqual(buildSalvageDisclosure([]), '');
  assert.strictEqual(buildSalvageDisclosure(null), '');
  const text = buildSalvageDisclosure([
    { stage: 'stage1', attempt: 2, error_class: 'ETIMEDOUT', fields: ['review_body', 'verdict', 'declaration'] },
    { stage: 'stage2', attempt: 1, error_class: 'ETIMEDOUT', fields: ['evidence'] },
  ]);
  assert.match(text, /本次结果由超时\/中断后的部分输出恢复，恢复范围：stage1:review_body\/verdict\/declaration；stage2:evidence。/);
  assert.match(text, /阶段 `stage1` 第 2 次调用未正常返回（ETIMEDOUT）/);
  assert.match(text, /阶段 `stage2` 第 1 次调用未正常返回/);
});

test('finalizeReviewBody：披露落在「我的整体评价」内，且不破坏五段结构', () => {
  const body = [
    '## 动机', 'm', '', '## 改动思路', 'a', '', '## 具体改动', 'b', '',
    '## 对主干的风险', 'c', '', '## 我的整体评价', 'd',
  ].join('\n');
  const disclosure = buildSalvageDisclosure([{ stage: 'stage1', attempt: 1, error_class: 'ETIMEDOUT', fields: ['review_body', 'verdict', 'declaration'] }]);
  const out = finalizeReviewBody(body, { headOid: HEAD, verdict: 'REQUEST_CHANGES', reviewer: { declared_model: 'codex', declared_provider: 'openai', declaration_source: 'self_reported' }, salvageDisclosure: disclosure });
  assert.match(out, /^Reviewer: /);
  const sectionStart = out.indexOf('## 我的整体评价');
  const salvageStart = out.indexOf('### 部分输出恢复披露');
  assert.ok(salvageStart > sectionStart, '披露必须在「我的整体评价」之后');
  assert.ok(out.trimEnd().endsWith('English verdict: REQUEST_CHANGES'));
  // 五段仍在，且顺序未变
  const order = ['## 动机', '## 改动思路', '## 具体改动', '## 对主干的风险', '## 我的整体评价'].map(h => out.indexOf(h));
  assert.deepStrictEqual(order.slice().sort((x, y) => x - y), order);
});

test('finalizeReviewBody：没有 salvage 时不注入任何披露段', () => {
  const body = '## 动机\nm\n\n## 改动思路\na\n\n## 具体改动\nb\n\n## 对主干的风险\nc\n\n## 我的整体评价\nd';
  const out = finalizeReviewBody(body, { headOid: HEAD, verdict: 'APPROVE', reviewer: { declared_model: 'codex', declared_provider: 'openai', declaration_source: 'self_reported' } });
  assert.doesNotMatch(out, /部分输出恢复披露/);
});
