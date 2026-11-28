'use strict';
/**
 * ADR-0022 验收：`merge_require_quality_receipt` 开关（默认关闭）。
 *
 * 背景：`loopx-flow check` 会生成并核验 change-quality 严格收据，但 `cmd_merge`
 * 一次 `change-quality verify` 都没有——跳过 check 的 PR 可以带着无收据/过期收据
 * 直接合入主干，而 ADR-0011 决策 8 要求「收据缺失/失效/未验证 → 非 0 且不得推进」。
 *
 * 本组用例只锁两件事：
 *   A. 开关缺失或非布尔 true 时，行为与今天逐字节一致（不新增任何 loopx 调用）；
 *   B. 开关为 true 时，verify 的 ok!=true 必须在 `gh pr merge` 之前 fail-closed。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

const FEATURE = 'gate2';
const HEAD = 'c'.repeat(40);
const RISK = { accepted_by: 'owner', accepted_at: '2026-11-12T00:00:00Z' };

function setup(opts = {}) {
  const dir = h.makeSandbox('adr22-');
  const capsule = h.writeCapsule(dir, FEATURE);
  h.writeConfig(dir, 'single_owner', RISK);
  if (opts.flag !== undefined) {
    const p = path.join(dir, 'loopx-workflow.config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    cfg.merge_require_quality_receipt = opts.flag;
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  }
  fs.writeFileSync(path.join(dir, 'scripts/setup-branch-protection.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  const files = {
    comments: path.join(dir, 'comments.json'),
    readiness: path.join(dir, 'readiness.json'),
    pullReviews: path.join(dir, 'pull-reviews.json'),
    mergeLog: path.join(dir, 'gh-merge.log'),
  };
  fs.writeFileSync(files.comments, releaseComment(capsule.contractSha));
  fs.writeFileSync(files.readiness, JSON.stringify({ ready: true, blocking_reasons: [] }));
  fs.writeFileSync(files.pullReviews, JSON.stringify([{ state: 'COMMENT', commit_id: HEAD }]));
  fs.writeFileSync(files.mergeLog, '');

  h.mockGh(dir, [
    'if [[ "$1" == "--version" ]]; then echo "gh version 2.62.0 (mock)"; exit 0; fi',
    'if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi',
    'if [[ "$1" == "api" && "$2" == "user" ]]; then echo "owner"; exit 0; fi',
    'if [[ "$1" == "pr" && "$2" == "view" ]]; then',
    '  args="$*"',
    '  if [[ "$args" == *"reviews,author,reviewDecision,isDraft"* ]]; then echo \'["pr-author","APPROVED","false",[]]\'; exit 0; fi',
    '  if [[ "$args" == *"state,mergedAt,reviewDecision,headRefOid,headRefName,baseRefName"* ]]; then echo "OPEN%%APPROVED%' + HEAD + '%feature/' + FEATURE + '%main"; exit 0; fi',
    '  if [[ "$args" == *"headRefOid,headRefName,isDraft"* ]]; then echo "' + HEAD + '%feature/' + FEATURE + '%false"; exit 0; fi',
    '  if [[ "$args" == *"isDraft"* ]]; then echo "false"; exit 0; fi',
    '  if [[ "$args" == *"headRefOid"* ]]; then echo "' + HEAD + '"; exit 0; fi',
    '  exit 0',
    'fi',
    'if [[ "$1" == "pr" && "$2" == "merge" ]]; then echo "merged $*" >> "' + files.mergeLog + '"; exit 0; fi',
    'if [[ "$1" == "api" && "$2" == *"/issues/"* && "$2" == *"/comments"* ]]; then cat "' + files.comments + '"; exit 0; fi',
    'if [[ "$1" == "api" && "$2" == *"/pulls/"* && "$2" == *"/reviews"* ]]; then cat "' + files.pullReviews + '"; exit 0; fi',
    'exit 0',
  ].join('\n'));

  const verifyOk = opts.verifyOk === true;
  h.mockLoopx(dir, [
    'if [[ "$*" == *"check-merge-readiness"* ]]; then cat "' + files.readiness + '"; exit 0; fi',
    'if [[ "$*" == *"change-quality verify"* ]]; then',
    verifyOk ? '  echo \'{"schema_version":"change_quality_receipt_verification_v2","ok":true,"receipt":{"id":"cq_1"}}\'; exit 0;' : '  echo \'{"schema_version":"change_quality_receipt_verification_v2","ok":false,"errors":["receipt_missing"]}\'; exit 1;',
    'fi',
    'exit 0',
  ].join('\n'));

  return { dir, files, contractSha: capsule.contractSha };
}

function releaseComment(contractSha) {
  const body = '<!-- loopx-flow:release-authorization:1@' + HEAD + ' -->\n' +
    'gate=2;mode=single_owner;head=' + HEAD + ';contract_sha=' + contractSha + ';principal=owner;approved_at=2026-11-12T00:00:00Z;risk_acceptance=owner@2026-11-12T00:00:00Z';
  return JSON.stringify([{ body, user: { login: 'owner' } }]);
}

function loopxCalls(dir) {
  const p = path.join(dir, 'loopx-calls.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function merge(dir) {
  return h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
}

test('开关缺失（默认关闭）→ 不调用 change-quality verify，merge 照常通过', () => {
  const { dir, files } = setup();
  try {
    const r = merge(dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(files.mergeLog, 'utf8'), /merged/);
    assert.doesNotMatch(loopxCalls(dir), /change-quality verify/);
  } finally { h.cleanup(dir); }
});

test('开关为字符串 "true" → 视为关闭（配置歧义不得点亮交付门禁）', () => {
  const { dir, files } = setup({ flag: 'true' });
  try {
    const r = merge(dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(files.mergeLog, 'utf8'), /merged/);
    assert.doesNotMatch(loopxCalls(dir), /change-quality verify/);
  } finally { h.cleanup(dir); }
});

test('开关开启 + verify ok=false → 在 gh pr merge 之前 fail-closed', () => {
  const { dir, files } = setup({ flag: true, verifyOk: false });
  try {
    const r = merge(dir);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /ADR-0022/);
    assert.match(r.stderr + r.stdout, /change-quality 严格收据核验未通过/);
    assert.match(loopxCalls(dir), /change-quality verify/);
    assert.strictEqual(fs.readFileSync(files.mergeLog, 'utf8'), '', '不得调用 gh pr merge');
  } finally { h.cleanup(dir); }
});

test('开关开启 + verify ok=true → 通过闸门并继续合入', () => {
  const { dir, files } = setup({ flag: true, verifyOk: true });
  try {
    const r = merge(dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /change-quality 严格收据核验通过/);
    assert.match(fs.readFileSync(files.mergeLog, 'utf8'), /merged/);
  } finally { h.cleanup(dir); }
});
