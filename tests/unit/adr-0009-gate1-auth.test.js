'use strict';
/**
 * ADR-0009 Gate1 正式命令验收（T1–T9）。
 * 全部在临时 git 仓库中运行真实 bin/loopx-flow，控制面（loopx/gh）用 PATH mock。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

const FEATURE = 'gate1-auth';

function approveLoopxMock(dir, override = '') {
  h.mockLoopx(dir, `args="$*"
if [[ "$args" == *"configure-goal"* ]]; then exit 0; fi
if [[ "$args" == *"register-agent"* ]]; then exit 0; fi
if [[ "$args" == *"todo add"* ]]; then echo '{"todo_id":"todo_gate1"}'; exit 0; fi
if [[ "$args" == *"todo complete"* ]]; then exit 0; fi
if [[ "$args" == *"sync-global"* ]]; then exit 0; fi
` + override);
}

function approveGhMock(dir, commentsFile) {
  if (!fs.existsSync(commentsFile)) fs.writeFileSync(commentsFile, '[]');
  h.mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "executor"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "list" ]]; then echo "7"; exit 0; fi
if [[ "$1" == "api" && "$2" == "repos/owner/repo/issues/7/comments" ]]; then cat "$COMMENTS_FILE"; exit 0; fi
exit 0
`.replace('$COMMENTS_FILE', commentsFile));
}

function gateComments(dir, sha) {
  const commentsFile = path.join(dir, 'comments.json');
  const body = '<!-- loopx-flow:gate1-authorization:' + FEATURE + '@' + sha + ' -->\n' +
    'gate=1;mode=independent;contract_sha=' + sha + ';spec_commit=' + 'b'.repeat(40) + ';approver=approver1';
  fs.writeFileSync(commentsFile, JSON.stringify([{ body, user: { login: 'approver1' } }]));
  return commentsFile;
}

function sandboxWithConfig(mode, risk) {
  const dir = h.makeSandbox('adr9-');
  h.writeConfig(dir, mode, risk);
  return dir;
}

test('T1 single_owner 非 TTY approve 必须失败且不写批准标记', () => {
  const dir = sandboxWithConfig('single_owner', { accepted_by: 'owner', accepted_at: '2026-11-12T00:00:00Z' });
  try {
    h.writeCapsule(dir, FEATURE);
    approveLoopxMock(dir);
    approveGhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /TTY/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8'), /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

test('T2 single_owner approve --yes 必须失败', () => {
  const dir = sandboxWithConfig('single_owner', { accepted_by: 'owner', accepted_at: '2026-11-12T00:00:00Z' });
  try {
    h.writeCapsule(dir, FEATURE);
    approveLoopxMock(dir);
    approveGhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE, '--yes']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /--yes/);
  } finally { h.cleanup(dir); }
});

test('T3 缺 loopx-workflow.config.json 必须失败且不写批准标记', () => {
  const dir = h.makeSandbox('adr9-');
  try {
    h.writeCapsule(dir, FEATURE);
    approveLoopxMock(dir);
    approveGhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /授权配置/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8'), /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

test('T4 single_owner 缺风险接受必须失败', () => {
  const dir = sandboxWithConfig('single_owner');
  try {
    h.writeCapsule(dir, FEATURE);
    approveLoopxMock(dir);
    approveGhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /授权配置校验失败|risk/i);
  } finally { h.cleanup(dir); }
});

test('T5a independent 无第二账号 gate=1 评论必须失败', () => {
  const dir = sandboxWithConfig('independent');
  try {
    h.writeCapsule(dir, FEATURE);
    approveLoopxMock(dir);
    approveGhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /第二 GitHub 账号/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8'), /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

test('T5b independent 评论 SHA == configure-goal 锁定 SHA == 最终落盘 SHA', () => {
  const dir = sandboxWithConfig('independent');
  try {
    const capsule = h.writeCapsule(dir, FEATURE);
    // 评论必须绑定最终落盘字节（含固定批准标记行）的 SHA，而不是加标记前的 SHA
    const lockedSha = h.lockedShaFile(capsule.contractPath);
    approveLoopxMock(dir);
    approveGhMock(dir, gateComments(dir, lockedSha));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);

    const contractPath = path.join(dir, 'specs/features', FEATURE, '04-contract.md');
    const finalSha = h.sha256(fs.readFileSync(contractPath, 'utf8'));
    const contract = fs.readFileSync(contractPath, 'utf8');
    assert.match(contract, /- \*\*Contract-Status\*\*: FROZEN & APPROVED/);
    assert.doesNotMatch(contract, /FROZEN & APPROVED BY/, '审批人/时间不得写进参与哈希的正文');

    const calls = fs.readFileSync(path.join(dir, 'loopx-calls.log'), 'utf8');
    const configureLine = calls.split('\n').find((line) => line.includes('configure-goal'));
    assert.ok(configureLine, '必须调用 configure-goal');
    const lockedMatch = configureLine.match(/--progress-review-contract-revision ([0-9a-f]{64})/);
    assert.ok(lockedMatch, `configure-goal 必须携带 64 位 contract SHA: ${configureLine}`);
    assert.strictEqual(lockedMatch[1], lockedSha, 'configure-goal 参数必须等于评论绑定的 SHA');
    assert.strictEqual(finalSha, lockedSha, '最终落盘字节必须等于评论/锁定 SHA');
    assert.match(calls, /todo complete .*--decision-outcome approve/);
    assert.match(calls, new RegExp('contract_sha=' + lockedSha));
    assert.match(calls, new RegExp('decision-scope other:goal:' + lockedSha));
    assert.match(calls, /principal=approver1/);
  } finally { h.cleanup(dir); }
});

function gateVerifySandbox({ configMode = 'single_owner', evidenceMode = 'single_owner', evidenceOverride = null, tamper = false, outcome = 'approve', risk = { accepted_by: 'owner', accepted_at: '2026-11-12T00:00:00Z' } } = {}) {
  const dir = h.makeSandbox('adr9-gv-');
  const contract = h.lockedContractText(h.contractText(FEATURE));
  const contractPath = h.write(dir, 'specs/features/' + FEATURE + '/04-contract.md', contract);
  const sha = h.sha256(fs.readFileSync(contractPath, 'utf8'));
  h.writeConfig(dir, configMode, configMode === 'single_owner' ? risk : undefined);
  h.registryWithGoal(dir, FEATURE + '-goal', sha);
  const evidence = evidenceOverride !== null ? evidenceOverride : h.gate1Evidence({
    mode: evidenceMode,
    sha,
    feature: FEATURE,
    principal: evidenceMode === 'single_owner' ? 'owner' : 'approver1',
    risk: evidenceMode === 'single_owner' ? risk.accepted_by + '@' + risk.accepted_at : undefined
  });
  const todosFile = path.join(dir, 'todos.json');
  fs.writeFileSync(todosFile, h.userGateTodos(sha, evidence, outcome));
  h.mockLoopx(dir, 'if [[ "$*" == *"todo list"* ]]; then cat "' + todosFile + '"; exit 0; fi');
  if (tamper) fs.appendFileSync(contractPath, '\n- tampered after lock\n');
  return { dir, sha };
}

test('T6 gate verify：evidence 缺键必须失败', () => {
  const { dir } = gateVerifySandbox({ evidenceOverride: h.gate1Evidence({ mode: 'single_owner', sha: 'a'.repeat(64), feature: FEATURE, principal: 'owner' }).replace(/;spec_commit=[0-9a-f]{40}/, '') });
  try {
    const r = h.run(dir, ['gate', 'verify', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /缺键|spec_commit/);
  } finally { h.cleanup(dir); }
});

test('T7 gate verify：decision_outcome=reject 必须失败', () => {
  const { dir } = gateVerifySandbox({ outcome: 'reject' });
  try {
    const r = h.run(dir, ['gate', 'verify', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /user_gate|授权记录/);
  } finally { h.cleanup(dir); }
});

test('T8 gate verify：契约 SHA 变化必须失败', () => {
  const { dir } = gateVerifySandbox({ tamper: true });
  try {
    const r = h.run(dir, ['gate', 'verify', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /篡改|TAMPERED|不一致/);
  } finally { h.cleanup(dir); }
});

test('T9 gate verify：配置模式与 evidence 模式不一致必须失败', () => {
  const { dir } = gateVerifySandbox({ configMode: 'single_owner', evidenceMode: 'independent' });
  try {
    const r = h.run(dir, ['gate', 'verify', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /mode|模式/);
  } finally { h.cleanup(dir); }
});

test('story id 不在契约 AC 矩阵 → approve 非 0 且不写批准标记', () => {
  const dir = sandboxWithConfig('independent');
  try {
    h.writeCapsule(dir, FEATURE, {
      stories: '# Stories\n\n- **Story-09**: 孤立故事\n  - AC-09-1: 故事文件里有 AC，矩阵没有对应行\n',
      contract: [
        '# Contract: ' + FEATURE,
        '',
        '- **Contract-Status**: DRAFT (Pending Approval)',
        '',
        '## 2. AC 矩阵',
        '',
        '| AC | Story | 验证 |',
        '|---|---|---|',
        '| AC-01-1 | Story-01 | tests/unit/adr-0009-gate1-auth.test.js |',
        '',
        '## 3. Scope / 非目标',
        '',
        '- **Scope**: 仅本特性',
        '- **Verification Plan**: npm run test',
        '- **依赖顺序**: Story-01',
        '- **引用**: REQ-CHECKPOINT-1',
        ''
      ].join('\n')
    });
    approveLoopxMock(dir);
    approveGhMock(dir, path.join(dir, 'comments.json'));
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /AC 矩阵/);
    assert.match(r.stderr + r.stdout, /Story-09/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'specs/features', FEATURE, '04-contract.md'), 'utf8'), /FROZEN & APPROVED/);
  } finally { h.cleanup(dir); }
});

test('T0 gate verify：single_owner 配置 + 匹配 evidence 通过', () => {
  const { dir } = gateVerifySandbox({});
  try {
    const r = h.run(dir, ['gate', 'verify', 'contract', FEATURE]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /GATE PASS/);
  } finally { h.cleanup(dir); }
});
