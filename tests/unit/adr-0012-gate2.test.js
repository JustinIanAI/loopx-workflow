'use strict';
/**
 * ADR-0012 Gate2 正式命令验收（merge / release-approve）。
 * 在临时 git 仓库运行真实 bin/loopx-flow；gh/loopx/分支保护脚本全部替身。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

const FEATURE = 'gate2';
const HEAD = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const RISK = { accepted_by: 'owner', accepted_at: '2026-11-12T00:00:00Z' };

function setup(opts = {}) {
  const dir = h.makeSandbox('adr12-');
  // ADR-0021 重绑需要真实 commit：调用方可在写替身之前把沙箱仓库的历史造好。
  const prepared = typeof opts.prepareRepo === 'function' ? opts.prepareRepo(dir) : null;
  const mode = opts.mode || 'independent';
  const capsule = h.writeCapsule(dir, FEATURE);
  const contractSha = capsule.contractSha;
  h.writeConfig(dir, mode, mode === 'single_owner' ? RISK : undefined);
  fs.writeFileSync(path.join(dir, 'scripts/setup-branch-protection.sh'), '#!/usr/bin/env bash\nexit $(cat "$(dirname "$0")/../bp-exit" 2>/dev/null || echo 0)\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'bp-exit'), String(opts.bpExit || 0));

  const head = (prepared && prepared.head) || opts.head || HEAD;
  const baseRefName = (prepared && prepared.baseRefName) || 'main';
  const headRef = opts.headRef || ('feature/' + FEATURE);
  const draft = opts.draft === true ? 'true' : 'false';
  const decision = opts.decision || 'APPROVED';
  const state = opts.state || 'OPEN';
  const reviews = opts.reviews || JSON.stringify(['pr-author', decision, draft, [{ author: { login: 'reviewer' }, commit: { oid: head }, state: 'APPROVED' }]]);
  const comments = opts.comments || '[]';
  const pullReviews = opts.pullReviews || JSON.stringify([{ state: 'COMMENT', commit_id: head }]);
  const readiness = opts.readiness || JSON.stringify({ ready: true, blocking_reasons: [] });
  const login = opts.login || 'owner';

  const files = { reviews: path.join(dir, 'reviews.json'), comments: path.join(dir, 'comments.json'), pullReviews: path.join(dir, 'pull-reviews.json'), readiness: path.join(dir, 'readiness.json'), mergeLog: path.join(dir, 'gh-merge.log') };
  fs.writeFileSync(files.reviews, reviews);
  fs.writeFileSync(files.comments, comments);
  fs.writeFileSync(files.pullReviews, pullReviews);
  fs.writeFileSync(files.readiness, readiness);
  fs.writeFileSync(files.mergeLog, '');

  const gh = [
    'if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi',
    'if [[ "$1" == "api" && "$2" == "user" ]]; then echo "' + login + '"; exit 0; fi',
    'if [[ "$1" == "pr" && "$2" == "view" ]]; then',
    '  args="$*"',
    '  if [[ "$args" == *"baseRefName"* && "$args" != *"headRefOid"* ]]; then echo "' + baseRefName + '"; exit 0; fi',
    '  if [[ "$args" == *"reviews,author,reviewDecision,isDraft"* ]]; then cat "' + files.reviews + '"; exit 0; fi',
    '  if [[ "$args" == *"state,mergedAt,reviewDecision,headRefOid,headRefName,baseRefName"* ]]; then echo "' + state + '%%' + decision + '%' + head + '%' + headRef + '%main"; exit 0; fi',
    '  if [[ "$args" == *"headRefOid,headRefName,isDraft"* ]]; then echo "' + head + '%' + headRef + '%' + draft + '"; exit 0; fi',
    '  if [[ "$args" == *"isDraft"* ]]; then echo "' + draft + '"; exit 0; fi',
    '  if [[ "$args" == *"headRefOid"* ]]; then echo "' + head + '"; exit 0; fi',
    '  exit 0',
    'fi',
    'if [[ "$1" == "pr" && "$2" == "merge" ]]; then echo "merged $*" >> "' + files.mergeLog + '"; exit 0; fi',
    'if [[ "$1" == "api" && "$2" == *"/issues/"* && "$2" == *"/comments"* ]]; then cat "' + files.comments + '"; exit 0; fi',
    'if [[ "$1" == "api" && "$2" == *"/pulls/"* && "$2" == *"/reviews"* ]]; then cat "' + files.pullReviews + '"; exit 0; fi',
    'if [[ "$1" == "pr" && "$2" == "comment" ]]; then echo "commented" >> "' + files.mergeLog + '.comment"; exit 0; fi',
    'exit 0'
  ].join('\n');
  h.mockGh(dir, gh);

  const loopx = [
    'if [[ "$*" == *"check-merge-readiness"* ]]; then cat "' + files.readiness + '"; exit 0; fi',
    'exit 0'
  ].join('\n');
  h.mockLoopx(dir, loopx);

  return { dir, contractSha, files, signedHead: prepared ? prepared.signedHead : null, head };
}

function releaseComment(contractSha, opts = {}) {
  const head = opts.head || HEAD;
  const body = '<!-- loopx-flow:release-authorization:1@' + head + ' -->\n' +
    'gate=2;mode=single_owner;head=' + head + ';contract_sha=' + contractSha + ';principal=owner;approved_at=2026-11-12T00:00:00Z;risk_acceptance=owner@2026-11-12T00:00:00Z';
  return JSON.stringify([{ body, user: { login: 'owner' } }]);
}

test('T1 Mode A review commit != headRefOid → merge 非 0', () => {
  const { dir } = setup({ mode: 'independent', reviews: JSON.stringify(['pr-author', 'APPROVED', 'false', [{ author: { login: 'reviewer' }, commit: { oid: OLD }, state: 'APPROVED' }]]) });
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /Mode A|formal review/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), '');
  } finally { h.cleanup(dir); }
});

test('T2 Mode A readiness ready!=true → merge 非 0', () => {
  const { dir } = setup({ mode: 'independent', readiness: JSON.stringify({ ready: false, blocking_reasons: ['status_checks_failed'] }) });
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /readiness/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), '');
  } finally { h.cleanup(dir); }
});

test('T3 Mode B 缺 release-authorization 评论 → merge 非 0', () => {
  const { dir } = setup({ mode: 'single_owner' });
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /release-authorization/);
  } finally { h.cleanup(dir); }
});

test('T4 Gate1 评论不得继承为 Gate2 → merge 非 0', () => {
  const { dir, contractSha } = setup({ mode: 'single_owner' });
  const gate1 = JSON.stringify([{ body: '<!-- loopx-flow:gate1-authorization:' + FEATURE + '@' + contractSha + ' -->\ngate=1;mode=independent;contract_sha=' + contractSha + ';approver=approver1', user: { login: 'approver1' } }]);
  fs.writeFileSync(path.join(dir, 'comments.json'), gate1);
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /release-authorization/);
  } finally { h.cleanup(dir); }
});

test('T5 Draft PR → merge 非 0', () => {
  const { dir } = setup({ mode: 'independent', draft: true });
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /Draft/);
  } finally { h.cleanup(dir); }
});

test('T6 分支保护失配 → merge 非 0 并给修复指令', () => {
  const { dir } = setup({ mode: 'independent', bpExit: 1 });
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /分支保护/);
    assert.match(r.stderr + r.stdout, /setup-branch-protection.sh --apply/);
  } finally { h.cleanup(dir); }
});

test('T7 Mode B 合法授权 + readiness 忽略列表 → merge 通过', () => {
  const { dir, contractSha } = setup({ mode: 'single_owner', readiness: JSON.stringify({ ready: false, blocking_reasons: ['current_head_conclusion_not_approval', 'github_review_decision_not_approved'] }) });
  fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), /merged/);
  } finally { h.cleanup(dir); }
});

test('T8 Mode B readiness 命中允许列表 → merge 非 0', () => {
  const { dir, contractSha } = setup({ mode: 'single_owner', readiness: JSON.stringify({ blocking_reasons: ['status_checks_failed'] }) });
  fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /Mode B readiness/);
  } finally { h.cleanup(dir); }
});

test('T8b Mode B readiness 命中 repository_merge_state_blocked → merge 非 0（不再忽略）', () => {
  const { dir, contractSha } = setup({ mode: 'single_owner', readiness: JSON.stringify({ blocking_reasons: ['repository_merge_state_blocked'] }) });
  fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /repository_merge_state_blocked/);
  } finally { h.cleanup(dir); }
});

test('T9 Mode B readiness blocking_reasons 缺失 → merge 非 0', () => {
  const { dir, contractSha } = setup({ mode: 'single_owner', readiness: JSON.stringify({ ready: true }) });
  fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /Mode B readiness/);
  } finally { h.cleanup(dir); }
});

test('release-approve 非 TTY → 非 0', () => {
  const { dir } = setup({ mode: 'single_owner' });
  try {
    const r = h.run(dir, ['release-approve', '1']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /TTY/);
  } finally { h.cleanup(dir); }
});

test('release-approve principal != accepted_by → 非 0', () => {
  const { dir } = setup({ mode: 'single_owner', login: 'other' });
  try {
    const r = h.run(dir, ['release-approve', '1']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /accepted_by|principal/);
  } finally { h.cleanup(dir); }
});

test('T8 自动化不得生成 author-owned 批准（静态断言）', () => {
  const src = fs.readFileSync(path.join(h.PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js'), 'utf8');
  assert.strictEqual(src.includes('--approve'), false, 'review 自动化不得使用 gh pr review --approve');
  assert.strictEqual(/event\s*:\s*['"]APPROVE['"]/.test(src), false, 'review 自动化不得发送 APPROVE event');
});

test('T9 已 MERGED 但缺 release-authorization → 记审计告警而非静默通过', () => {
  const { dir } = setup({ mode: 'single_owner', state: 'MERGED' });
  try {
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /审计告警/);
  } finally { h.cleanup(dir); }
});

test('配置损坏时 merge 非 0，不退回 reviewDecision，不调用 gh pr merge', () => {
  const { dir } = setup({ mode: 'single_owner', decision: 'APPROVED' });
  fs.writeFileSync(path.join(dir, 'loopx-workflow.config.json'), '{');
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /授权配置|authorization_mode/);
    assert.doesNotMatch(r.stdout + r.stderr, /审查决议确认/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), '');
  } finally { h.cleanup(dir); }
});

test('authorization_mode 为空时 merge 非 0，不退回 reviewDecision', () => {
  const { dir } = setup({ mode: 'single_owner', decision: 'APPROVED' });
  fs.writeFileSync(path.join(dir, 'loopx-workflow.config.json'), JSON.stringify({
    schema_version: 'loopx_workflow_config_v0',
    authorization_mode: ''
  }));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /授权配置|authorization_mode/);
    assert.doesNotMatch(r.stdout + r.stderr, /审查决议确认/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), '');
  } finally { h.cleanup(dir); }
});

test('Mode B 接受 Agent review issue comment（当前发布通道）作为 head 证据', () => {
  const { dir, contractSha } = setup({
    mode: 'single_owner',
    pullReviews: '[]',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] })
  });
  const release = JSON.parse(releaseComment(contractSha));
  const agentReview = {
    body: 'Reviewer: model_agent\n\n## 动机\n...\n\n<!-- loopx-flow:review:1@' + HEAD.toLowerCase() + ' -->',
    user: { login: 'agent' }
  };
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify(release.concat([agentReview])));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), /merged/);
  } finally { h.cleanup(dir); }
});

test('Mode B 兼容 GitHub formal review COMMENTED 状态与多页 --paginate 输出', () => {
  const paginatedReviews = JSON.stringify([{ state: 'COMMENTED', commit_id: HEAD, user: { login: 'agent' } }])
    + '\n' + JSON.stringify([{ state: 'DISMISSED', commit_id: OLD, user: { login: 'other' } }]);
  const { dir, contractSha } = setup({
    mode: 'single_owner',
    pullReviews: paginatedReviews,
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] })
  });
  const paginatedComments = releaseComment(contractSha) + '\n' + JSON.stringify([]);
  fs.writeFileSync(path.join(dir, 'comments.json'), paginatedComments);
  try {
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), /merged/);
  } finally { h.cleanup(dir); }
});

test('Mode B 支持非 feature/* 分支（fix/issue-* / fast-fix/*）走 Gate2 merge（contract_sha=none）', () => {
  const { dir } = setup({
    mode: 'single_owner',
    headRef: 'fix/issue-19',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] })
  });
  fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment('none'));
  try {
    const r = h.run(dir, ['merge', '1'], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), /merged/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'loopx-calls.log'), 'utf8'), /--goal-id\s+-goal/);
  } finally { h.cleanup(dir); }
});

test('set -u 下无参调用 status --next / release-approve 不会报 unbound variable', () => {
  const root = path.resolve(__dirname, '../..');
  const r1 = h.run(root, ['status', '--next']);
  assert.doesNotMatch(r1.stderr, /unbound variable/i);
  const r2 = h.run(root, ['release-approve']);
  assert.strictEqual(r2.status, 1);
  assert.doesNotMatch(r2.stderr, /unbound variable/i);
  assert.match(r2.stderr, /请指定 PR 编号/);
});

test('P0-B：gh pr merge 携带 --match-head-commit，single_owner 校验操作者与 read -r 交互确认', () => {
  const { dir, contractSha } = setup({
    mode: 'single_owner',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] })
  });
  fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha));
  try {
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const mergeLog = fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8');
    assert.match(mergeLog, new RegExp(`--match-head-commit ${HEAD}`));
  } finally { h.cleanup(dir); }

  // Operator login != accepted_by must fail closed in single_owner merge
  const mismatch = setup({
    mode: 'single_owner',
    login: 'someone-else',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] })
  });
  fs.writeFileSync(path.join(mismatch.dir, 'comments.json'), releaseComment(mismatch.contractSha));
  try {
    const r = h.run(mismatch.dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /操作者身份校验失败/);
    assert.strictEqual(fs.readFileSync(path.join(mismatch.dir, 'gh-merge.log'), 'utf8'), '');
  } finally { h.cleanup(mismatch.dir); }

  // P2-1 source invariant: single_owner approve & release-approve enforce explicit read -r prompt
  const flowSrc = fs.readFileSync(path.join(h.PROJECT_ROOT, 'bin/loopx-flow'), 'utf8');
  assert.match(flowSrc, /签署 Gate1 契约授权[\s\S]*read -r confirm_reply/);
  assert.match(flowSrc, /签发 Gate2 发布授权[\s\S]*read -r confirm_reply/);
});

// --- ADR-0021：Gate2 重绑（默认关闭）在真实 merge 入口上的接线 ---
// 纯函数层面由 tests/unit/gate2-rebind.test.js 覆盖；这里锁住「开关、候选筛选、
// WARN 与 fail-closed 接线」——即 reviewer 指出的"安全敏感分支无自动化验证"。

function enableRebind(dir) {
  const p = path.join(dir, 'loopx-workflow.config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.gate2_rebind = 'patch_id';
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

test('Mode B + gate2_rebind=patch_id：仅 base 前进换 head → 复用签名并打 WARN', () => {
  const { dir, contractSha, signedHead, head } = setup({
    mode: 'single_owner',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] }),
    prepareRepo: (d) => h.withRebindHistory(d),
  });
  try {
    assert.notStrictEqual(head, signedHead, '沙箱历史必须换过 head');
    enableRebind(dir);
    fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha, { head: signedHead }));

    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /Gate2 重绑/, '命中重绑必须在 stderr 打印 WARN');
    assert.match(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), /merged/);
  } finally { h.cleanup(dir); }
});

test('Mode B 默认关闭：同样的换 head 不得重绑', () => {
  const { dir, contractSha, signedHead } = setup({
    mode: 'single_owner',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] }),
    prepareRepo: (d) => h.withRebindHistory(d),
  });
  try {
    fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha, { head: signedHead }));
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 1, '开关未开时必须与改动前逐字等价地 fail-closed');
    assert.match(r.stderr + r.stdout, /release-authorization/);
    assert.doesNotMatch(r.stderr, /Gate2 重绑/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8').trim(), '', '不得调用 gh pr merge');
  } finally { h.cleanup(dir); }
});

test('Mode B + gate2_rebind：签署后改动内容 → 指纹不同，仍 fail-closed', () => {
  const { dir, contractSha, signedHead } = setup({
    mode: 'single_owner',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] }),
    prepareRepo: (d) => h.withRebindHistory(d, { currentContent: 'export const a = 2;\n' }),
  });
  try {
    enableRebind(dir);
    fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment(contractSha, { head: signedHead }));
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /Gate2 重绑/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8').trim(), '');
  } finally { h.cleanup(dir); }
});

test('Mode B + gate2_rebind：评论不是合法 JSON → fail-closed 有文案，不得裸退出 2', () => {
  const { dir } = setup({
    mode: 'single_owner',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] }),
    prepareRepo: (d) => h.withRebindHistory(d),
  });
  try {
    enableRebind(dir);
    fs.writeFileSync(path.join(dir, 'comments.json'), '<html>proxy error</html>');
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.notStrictEqual(r.status, 0, '解析失败必须非 0');
    assert.match(r.stderr + r.stdout, /fail-closed|FAIL-CLOSED/i, '不得以裸退出码结束而丢掉 fail-closed 文案');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'gh-merge.log'), 'utf8'), '', '失败路径不得调用 gh pr merge');
  } finally { h.cleanup(dir); }
});

test('Mode B + gate2_rebind：contract_sha 不符的评论永不进入指纹判定', () => {
  const { dir, signedHead } = setup({
    mode: 'single_owner',
    readiness: JSON.stringify({ blocking_reasons: ['current_head_conclusion_not_approval'] }),
    prepareRepo: (d) => h.withRebindHistory(d),
  });
  try {
    enableRebind(dir);
    fs.writeFileSync(path.join(dir, 'comments.json'), releaseComment('0'.repeat(64), { head: signedHead }));
    const r = h.run(dir, ['merge', '1', FEATURE], { LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /Gate2 重绑/);
  } finally { h.cleanup(dir); }
});
