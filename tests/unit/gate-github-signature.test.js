'use strict';
/**
 * ADR-0019：Gate1 / Gate2 的 GitHub 评论签名授权路径。
 * 覆盖 --prepare 零写入、single_owner 评论成功、作者/SHA 不符拒绝、Gate2 评论复用。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const h = require('./helpers/m0-sandbox');

const FEATURE = 'gate-signature';
const HEAD = 'c'.repeat(40);
const RISK = { accepted_by: 'owner', accepted_at: '2026-11-12T00:00:00Z' };

function approveLoopxMock(dir) {
  h.mockLoopx(dir, `args="$*"
if [[ "$args" == *"configure-goal"* ]]; then exit 0; fi
if [[ "$args" == *"register-agent"* ]]; then exit 0; fi
if [[ "$args" == *"todo add"* ]]; then echo '{"todo_id":"t1","schema_version":"loopx_coordination_todo_create_result_v0"}'; exit 0; fi
if [[ "$args" == *"todo complete"* ]]; then echo '{"schema_version":"loopx_coordination_todo_terminal_lifecycle_result_v0"}'; exit 0; fi
if [[ "$args" == *"sync-global"* ]]; then exit 0; fi
`);
}

function gate1GhMock(dir, commentsFile, login = 'owner') {
  if (!fs.existsSync(commentsFile)) fs.writeFileSync(commentsFile, '[]');
  h.mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "${login}"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "list" ]]; then echo "7"; exit 0; fi
if [[ "$1" == "api" && "$2" == "repos/owner/repo/issues/7/comments" ]]; then cat "${commentsFile}"; exit 0; fi
exit 0
`);
}

function writeGate1Comments(file, { sha, specCommit, approver = 'owner', mode = 'single_owner' }) {
  const body = '<!-- loopx-flow:gate1-authorization:' + FEATURE + '@' + sha + ' -->\n' +
    'gate=1;mode=' + mode + ';contract_sha=' + sha + ';spec_commit=' + specCommit + ';approver=' + approver;
  fs.writeFileSync(file, JSON.stringify([{ body, user: { login: approver } }]));
}

function gate1Sandbox() {
  const dir = h.makeSandbox('adr19-g1-');
  h.writeConfig(dir, 'single_owner', RISK);
  const capsule = h.writeCapsule(dir, FEATURE);
  approveLoopxMock(dir);
  return { dir, capsule, lockedSha: h.lockedShaFile(capsule.contractPath) };
}

test('Gate1 --prepare 打印评论模板且零写入', () => {
  const { dir, lockedSha } = gate1Sandbox();
  try {
    gate1GhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE, '--prepare']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp('contract_sha : ' + lockedSha));
    assert.match(r.stdout, /gate=1;mode=single_owner;contract_sha=/);
    const contract = fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8');
    assert.doesNotMatch(contract, /FROZEN & APPROVED/);
    const calls = fs.existsSync(path.join(dir, 'loopx-calls.log')) ? fs.readFileSync(path.join(dir, 'loopx-calls.log'), 'utf8') : '';
    assert.doesNotMatch(calls, /configure-goal/, '--prepare 不得锁 SHA');
  } finally { h.cleanup(dir); }
});

test('Gate1 single_owner 有效评论（作者=accepted_by）→ 无 TTY 也通过', () => {
  const { dir, lockedSha } = gate1Sandbox();
  try {
    const specCommit = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    writeGate1Comments(path.join(dir, 'comments.json'), { sha: lockedSha, specCommit });
    gate1GhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const contract = fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8');
    assert.match(contract, /Contract-Status\*\*: FROZEN & APPROVED/);
    const calls = fs.readFileSync(path.join(dir, 'loopx-calls.log'), 'utf8');
    assert.match(calls, new RegExp('--decision-scope other:goal:' + lockedSha));
    assert.match(calls, /principal=owner/);
  } finally { h.cleanup(dir); }
});

test('Gate1 评论作者不是 accepted_by → 拒绝且不写批准标记', () => {
  const { dir, lockedSha } = gate1Sandbox();
  try {
    const specCommit = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    writeGate1Comments(path.join(dir, 'comments.json'), { sha: lockedSha, specCommit, approver: 'other' });
    gate1GhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /TTY/);
    const contract = fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8');
    assert.doesNotMatch(contract, /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

test('Gate1 评论 SHA 与当前锁定字节不一致 → 拒绝', () => {
  const { dir } = gate1Sandbox();
  try {
    const specCommit = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    writeGate1Comments(path.join(dir, 'comments.json'), { sha: '0'.repeat(64), specCommit });
    gate1GhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    const contract = fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8');
    assert.doesNotMatch(contract, /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

function gate2Sandbox(comments) {
  const dir = h.makeSandbox('adr19-g2-');
  h.writeConfig(dir, 'single_owner', RISK);
  const capsule = h.writeCapsule(dir, FEATURE);
  const commentsFile = path.join(dir, 'comments.json');
  fs.writeFileSync(commentsFile, comments || '[]');
  const commentLog = path.join(dir, 'comment-posted.log');
  fs.writeFileSync(commentLog, '');
  h.mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "owner"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then echo "${HEAD}%feature/${FEATURE}%false"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "comment" ]]; then echo "posted" >> "${commentLog}"; exit 0; fi
if [[ "$1" == "api" && "$2" == "repos/owner/repo/issues/1/comments" ]]; then cat "${commentsFile}"; exit 0; fi
exit 0
`);
  h.mockLoopx(dir, 'exit 0');
  return { dir, contractSha: capsule.contractSha, commentLog };
}

function gate2Comment(contractSha) {
  const body = '<!-- loopx-flow:release-authorization:1@' + HEAD + ' -->\n' +
    'gate=2;mode=single_owner;head=' + HEAD + ';contract_sha=' + contractSha + ';principal=owner;risk_acceptance=owner@2026-11-12T00:00:00Z';
  return JSON.stringify([{ body, user: { login: 'owner' } }]);
}

test('Gate2 --prepare 打印评论模板且不写评论', () => {
  const { dir, commentLog } = gate2Sandbox('[]');
  try {
    const r = h.run(dir, ['release-approve', '1', '--prepare']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /gate=2;mode=single_owner;head=/);
    assert.strictEqual(fs.readFileSync(commentLog, 'utf8'), '', '--prepare 不得写评论');
  } finally { h.cleanup(dir); }
});

test('Gate2 single_owner 有效评论 → 无 TTY 也通过且不重复写评论', () => {
  const { dir, contractSha, commentLog } = gate2Sandbox('[]');
  try {
    fs.writeFileSync(path.join(dir, 'comments.json'), gate2Comment(contractSha));
    const r = h.run(dir, ['release-approve', '1']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /已检测到 Gate2 GitHub 授权评论/);
    assert.strictEqual(fs.readFileSync(commentLog, 'utf8'), '', '已有评论时不得重复写');
  } finally { h.cleanup(dir); }
});

test('Gate2 无有效评论且未加 --interactive → 失败并提示 TTY', () => {
  const { dir } = gate2Sandbox('[]');
  try {
    const r = h.run(dir, ['release-approve', '1']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /TTY/);
  } finally { h.cleanup(dir); }
});

test('Gate1 评论 spec_commit 与当前 HEAD 不一致 → 拒绝', () => {
  const { dir, lockedSha } = gate1Sandbox();
  try {
    writeGate1Comments(path.join(dir, 'comments.json'), { sha: lockedSha, specCommit: 'e'.repeat(40) });
    gate1GhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    const contract = fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8');
    assert.doesNotMatch(contract, /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

test('Gate1 --prepare --yes → 拒绝', () => {
  const { dir } = gate1Sandbox();
  try {
    const r = h.run(dir, ['approve', 'contract', FEATURE, '--prepare', '--yes']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /--yes/);
    assert.doesNotMatch(r.stdout, /contract_sha :/);
  } finally { h.cleanup(dir); }
});

test('Gate1 --interactive 无 TTY → 失败并提示 TTY', () => {
  const { dir } = gate1Sandbox();
  try {
    const r = h.run(dir, ['approve', 'contract', FEATURE, '--interactive']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /TTY/);
  } finally { h.cleanup(dir); }
});

test('Gate1 independent 模式 --prepare 产出 independent 模板', () => {
  const dir = h.makeSandbox('adr19-g1-ind-');
  try {
    h.writeConfig(dir, 'independent');
    h.writeCapsule(dir, FEATURE);
    approveLoopxMock(dir);
    gate1GhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE, '--prepare']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /gate=1;mode=independent;/);
    assert.doesNotMatch(r.stdout, /gate=1;mode=single_owner;/);
    assert.match(r.stdout, /approver=<第二 GitHub 账号 login>/);
  } finally { h.cleanup(dir); }
});
