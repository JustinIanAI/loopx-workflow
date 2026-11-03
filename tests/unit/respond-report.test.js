'use strict';
/**
 * respond-report.js — 原生五段式回复报告生成器验收测试
 *
 * 目标：`loopx-flow respond` 复用 `loopx pr-review` 的 review_template 五段式格式，
 * findings 来自原生评审产物（.loopx/reviews/<pr>@<head>.json），不再自造 5-Block 版式。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HELPER = path.join(PROJECT_ROOT, 'skills/code-review/scripts/respond-report.js');
const HEAD = '1111111111111111111111111111111111111111';
const GATES = JSON.stringify({
  typecheck: 'PASSED', lint: 'PASSED', build: 'PASSED', test: 'PASSED', loopx_status: 'PASSED',
});

function nativeReviewBody(verdict = 'REQUEST_CHANGES') {
  return [
    'Reviewer: model_agent · model=codex · provider=openai · declaration=self_reported · head=' + HEAD,
    '',
    '## 动机',
    '动机段落内容足够长以通过原生字数下限，说明问题背景与改进目标。',
    '## 改动思路',
    '改动思路段落说明架构与实现取舍，满足原生字数下限要求。',
    '## 具体改动',
    '### 关键代码讲解',
    '- `bin/loopx-flow` — 命令编排改造',
    '## 对主干的风险',
    '风险段落说明触发条件、影响范围与最小修复方向。',
    '## 我的整体评价',
    '评价段落给出交付、长程与体验判断，并记录残余风险。',
    'English verdict: ' + verdict,
  ].join('\n');
}

function makeArtifactDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'respond-report-'));
  const artifact = {
    schema_version: 'loopx_flow_review_artifact_v0',
    pr: 7,
    head_oid: HEAD,
    verdict: 'REQUEST_CHANGES',
    reviewer: { actor_kind: 'model_agent', declaration_source: 'self_reported', declared_model: 'codex', declared_provider: 'openai' },
    findings: [
      { file: 'bin/loopx-flow', line: 542, severity: 'P0', summary: 'respond 无法识别原生报告格式' },
      { file: 'skills/code-review/scripts/authentic-review.js', line: 447, severity: 'P1', summary: '声明来源默认 runtime_reported' },
    ],
    native_check: { ok: true, errors: [] },
    review_body: nativeReviewBody(),
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, `7@${HEAD}.json`), JSON.stringify(artifact, null, 2));
  return dir;
}

function runHelper(args) {
  try {
    const out = execFileSync('node', [HELPER, ...args], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 60000 });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('1. Native five-section response is generated from the review artifact', () => {
  const dir = makeArtifactDir();
  try {
    const r = runHelper(['--pr', '7', '--head', HEAD, '--review-dir', dir, '--gates-json', GATES, '--print']);
    assert.strictEqual(r.code, 0, r.out);
    for (const label of ['动机', '改动思路', '具体改动', '对主干的风险', '我的整体评价']) {
      assert.match(r.out, new RegExp(`^## ${label}$`, 'm'), `must include native section ${label}`);
    }
    assert.match(r.out, /^### 关键代码讲解$/m);
    assert.match(r.out, /^### 验证矩阵$/m);
    assert.match(r.out, /bin\/loopx-flow/);
    assert.match(r.out, /respond 无法识别原生报告格式/);
    assert.match(r.out, /declaration=self_reported/);
    assert.doesNotMatch(r.out, /5-Block|Block\s*[1-5]\b|fiveBlock/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. Fail-closed when no native review artifact exists (禁止静默输出“无阻塞缺陷”)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'respond-report-empty-'));
  try {
    const r = runHelper(['--pr', '7', '--head', HEAD, '--review-dir', dir, '--gates-json', GATES, '--print']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /FAIL-CLOSED|评审产物/);
    assert.doesNotMatch(r.out, /未指出任何阻塞缺陷/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('3. Fail-closed when artifact body is not the native five-section format', () => {
  const dir = makeArtifactDir({
    review_body: '## Block 1 · PR 元数据\n- PR #7\n## Block 4 · 模型审查结论\nEnglish verdict: REQUEST_CHANGES',
  });
  try {
    const r = runHelper(['--pr', '7', '--head', HEAD, '--review-dir', dir, '--gates-json', GATES, '--print']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /FAIL-CLOSED|原生/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('4. Resolution mapping is honored per finding index', () => {
  const dir = makeArtifactDir();
  const resolutions = path.join(dir, 'resolutions.json');
  fs.writeFileSync(resolutions, JSON.stringify({
    resolutions: [
      { finding_index: 1, status: 'fixed', summary: '解析逻辑改为原生报告签名', evidence: 'tests/unit/respond-report.test.js' },
      { finding_index: 2, status: 'deferred', summary: '声明来源改造随下轮提交', evidence: 'review-carryover.json' },
    ],
  }));
  try {
    const r = runHelper(['--pr', '7', '--head', HEAD, '--review-dir', dir, '--gates-json', GATES, '--print', '--resolutions-file', resolutions]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /解析逻辑改为原生报告签名/);
    assert.match(r.out, /已修复（待复审确认）/);
    assert.match(r.out, /本轮未修复（已登记）/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
