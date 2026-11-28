'use strict';
/**
 * Gate1 发布前置（REQ-PR-LIFECYCLE-1 / ADR-0012 决策 3）Fail-Closed 验收。
 *
 * 场景：未跟踪 / 胶囊内未跟踪文件 / 未推送 / 无 PR / pr create --draft 失败（presentation=pending）
 *      / 远端领先 / 正常通过。
 * 全部在临时 git 仓库 + 临时裸远端中运行真实 bin/loopx-flow，控制面（loopx/gh）用 PATH mock；
 * 主仓 .loopx/registry.json 不参与，零残留。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('./helpers/m0-sandbox');

const FEATURE = 'gate1-publication';

function approveLoopxMock(dir) {
  h.mockLoopx(dir, `args="$*"
if [[ "$args" == *"configure-goal"* ]]; then exit 0; fi
if [[ "$args" == *"register-agent"* ]]; then exit 0; fi
if [[ "$args" == *"todo add"* ]]; then echo '{"todo_id":"todo_pub","schema_version":"loopx_coordination_todo_create_result_v0"}'; exit 0; fi
if [[ "$args" == *"todo complete"* ]]; then echo '{"schema_version":"loopx_coordination_todo_terminal_lifecycle_result_v0"}'; exit 0; fi
if [[ "$args" == *"sync-global"* ]]; then exit 0; fi
exit 0
`);
}

function noPrGhMock(dir) {
  h.mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "executor"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then echo "no pull requests found for branch" >&2; exit 1; fi
exit 0
`);
}

function publishedCapsule(prefix = 'gate1-pub-') {
  const dir = h.makeSandbox(prefix);
  h.writeConfig(dir, 'independent');
  const capsule = h.writeCapsule(dir, FEATURE);
  const published = h.publishSpecPackage(dir, FEATURE);
  return { dir, capsule, published };
}

function assertNotApproved(contractPath) {
  assert.doesNotMatch(fs.readFileSync(contractPath, 'utf8'), /FROZEN & APPROVED/);
}

test('未跟踪规格包 → Gate1 非 0 且不写批准标记', () => {
  const dir = h.makeSandbox('gate1-untracked-');
  try {
    const { contractPath } = h.writeCapsule(dir, FEATURE);
    h.writeConfig(dir, 'independent');
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(contractPath) });
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /未被 Git 跟踪/);
    assertNotApproved(contractPath);
  } finally { h.cleanup(dir); }
});

test('胶囊内仍有未跟踪文件 → Gate1 非 0（--untracked-files=all 覆盖 specs/features/**）', () => {
  const { dir, capsule } = publishedCapsule('gate1-spec-untracked-');
  try {
    h.write(dir, `specs/features/${FEATURE}/05-evidence.md`, '# evidence (未提交)\n');
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /未提交或未跟踪/);
    assertNotApproved(capsule.contractPath);
  } finally { h.cleanup(dir); }
});

test('分支已提交但未推送 → Gate1 非 0', () => {
  const dir = h.makeSandbox('gate1-unpushed-');
  try {
    const { contractPath } = h.writeCapsule(dir, FEATURE);
    h.writeConfig(dir, 'independent');
    h.addRemote(dir);
    execFileSync('git', ['add', '--', `specs/features/${FEATURE}`], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'docs: local only'], { cwd: dir, stdio: 'ignore' });
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(contractPath) });
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /尚未推送到 origin/);
    assertNotApproved(contractPath);
  } finally { h.cleanup(dir); }
});

test('已推送但无对应 PR → Gate1 非 0', () => {
  const { dir, capsule } = publishedCapsule('gate1-nopr-');
  try {
    approveLoopxMock(dir);
    noPrGhMock(dir);
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /没有可读的 PR/);
    assertNotApproved(capsule.contractPath);
  } finally { h.cleanup(dir); }
});

test('pr create --draft 失败 → presentation=pending 持久标记 + 非 0，且 Gate1 阻断', () => {
  const dir = h.makeSandbox('gate1-draftfail-');
  try {
    const capsule = h.writeCapsule(dir, FEATURE);
    h.writeConfig(dir, 'independent');
    execFileSync('git', ['checkout', '-q', '-b', `feature/${FEATURE}`], { cwd: dir, stdio: 'ignore' });
    h.write(dir, 'skills/code-review/scripts/authentic-review.js', 'process.stdout.write("PR body for test\\n");\n');
    h.mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "executor"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then echo "gh: network unreachable" >&2; exit 1; fi
exit 0
`);

    const create = h.run(dir, ['pr', 'create', FEATURE, '--draft']);
    assert.strictEqual(create.status, 1, create.stdout + create.stderr);
    assert.match(create.stderr + create.stdout, /presentation=pending/);
    const marker = path.join(dir, '.loopx/presentation', FEATURE + '.json');
    assert.strictEqual(fs.existsSync(marker), true, 'presentation=pending 必须持久化');
    const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.strictEqual(state.presentation, 'pending');
    assert.strictEqual(state.draft, true);
    assert.match(String(state.reason || ''), /network unreachable/);

    // 标记存在时即使规格包已推送，Gate1 也必须阻断（旧语义是 WARN）。
    h.publishSpecPackage(dir, FEATURE);
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });
    const approve = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(approve.status, 1, approve.stdout + approve.stderr);
    assert.match(approve.stderr + approve.stdout, /presentation=pending/);
    assertNotApproved(capsule.contractPath);
  } finally { h.cleanup(dir); }
});

// 读回口径是 `gh pr list --json ...,headRefOid` + jq `"url\theadRefOid"`；
// mock 用真实 HEAD 模拟「PR 头 == 本地 HEAD」，与生产同形。
function replayGhMock(dir, headExpr = '"$(git rev-parse HEAD)"') {
  h.mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "executor"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "list" ]]; then
  # 收紧 mock：生产读回必须取 headRefOid 并带 jq 过滤器；换成只认 url 的口径要让用例变红。
  [[ "$*" == *headRefOid* && "$*" == *"--jq"* ]] || { echo "mock: pr list 缺少 headRefOid/--jq: $*" >&2; exit 64; }
  printf 'https://github.com/o/r/pull/12\\t%s\\n' ${headExpr}
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then echo "a pull request for branch already exists" >&2; exit 1; fi
exit 0
`);
}

function pendingMarker(dir, feature = FEATURE) {
  const marker = path.join(dir, '.loopx/presentation', feature + '.json');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ schema_version: 'loopx_flow_presentation_v0', feature, presentation: 'pending' }, null, 2));
  return marker;
}

test('pr create 读回既有 PR → 清除 pending 标记并成功（重跑不再永久阻断 Gate1）', () => {
  const dir = h.makeSandbox('gate1-draftreplay-');
  try {
    h.writeCapsule(dir, FEATURE);
    h.writeConfig(dir, 'independent');
    execFileSync('git', ['checkout', '-q', '-b', `feature/${FEATURE}`], { cwd: dir, stdio: 'ignore' });
    replayGhMock(dir);

    // 模拟上一次 create 在服务端已成功、本地却判定失败留下的标记。
    const marker = pendingMarker(dir);

    const r = h.run(dir, ['pr', 'create', FEATURE, '--draft', '--base', 'develop']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /presentation=published/);
    assert.match(r.stderr, /既有 PR 未应用参数: .*--base develop/, '被忽略的参数必须披露，避免退出码 0 误导');
    assert.strictEqual(fs.existsSync(marker), false, '读回成功后必须清除 pending 标记');
  } finally { h.cleanup(dir); }
});

test('读回 PR 头与本地 HEAD 不一致 → fail-closed，保留 pending 标记', () => {
  const dir = h.makeSandbox('gate1-headmismatch-');
  try {
    h.writeCapsule(dir, FEATURE);
    h.writeConfig(dir, 'independent');
    execFileSync('git', ['checkout', '-q', '-b', `feature/${FEATURE}`], { cwd: dir, stdio: 'ignore' });
    replayGhMock(dir, '"$(printf %040d 1)"');
    const marker = pendingMarker(dir);

    const r = h.run(dir, ['pr', 'create', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /与本地 HEAD .* 不一致/);
    assert.strictEqual(fs.existsSync(marker), true, '头部漂移时不得清除标记');
  } finally { h.cleanup(dir); }
});

test('请求 feature 与当前分支不一致 → fail-closed，不清另一特性的标记', () => {
  const dir = h.makeSandbox('gate1-featuremismatch-');
  try {
    h.writeCapsule(dir, FEATURE);
    h.writeConfig(dir, 'independent');
    execFileSync('git', ['checkout', '-q', '-b', `feature/${FEATURE}`], { cwd: dir, stdio: 'ignore' });
    replayGhMock(dir);
    const other = 'another-feature';
    const marker = pendingMarker(dir, other);

    const r = h.run(dir, ['pr', 'create', other]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /与请求的 feature=another-feature 不一致/);
    assert.strictEqual(fs.existsSync(marker), true, '错配时不得清除其它特性标记');
  } finally { h.cleanup(dir); }
});

test('远端领先（本地未拉取）→ Gate1 非 0，禁止签落后于远端的 HEAD', () => {
  const { dir, capsule, published } = publishedCapsule('gate1-ahead-');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'gate1-ahead-clone-'));
  try {
    execFileSync('git', ['clone', '-q', published.bare, clone], { stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'other@example.com'], { cwd: clone, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'other'], { cwd: clone, stdio: 'ignore' });
    fs.writeFileSync(path.join(clone, 'REMOTE_AHEAD.md'), '# remote ahead\n');
    execFileSync('git', ['add', 'REMOTE_AHEAD.md'], { cwd: clone, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'remote ahead'], { cwd: clone, stdio: 'ignore' });
    execFileSync('git', ['push', '-q', 'origin', 'HEAD'], { cwd: clone, stdio: 'ignore' });

    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /不一致/);
    assertNotApproved(capsule.contractPath);
  } finally {
    h.cleanup(dir);
    fs.rmSync(clone, { recursive: true, force: true });
  }
});

test('已跟踪 + 已推送 + 可读 PR → approve 通过，spec_commit 指向包含 04-contract.md 的提交', () => {
  const { dir, capsule, published } = publishedCapsule('gate1-pass-');
  try {
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });
    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /Gate1 发布前置通过/);
    assert.match(fs.readFileSync(capsule.contractPath, 'utf8'), /- \*\*Contract-Status\*\*: FROZEN & APPROVED/);

    const calls = fs.readFileSync(path.join(dir, 'loopx-calls.log'), 'utf8');
    const completeLine = calls.split('\n').find((line) => line.includes('todo complete'));
    assert.ok(completeLine, '必须写 user_gate 授权记录');
    assert.match(completeLine, new RegExp('spec_commit=' + published.head));

    // spec_commit 必须真实指向包含规格包的 commit（不是只含旧骨架的 HEAD）。
    const tracked = execFileSync('git', ['show', `${published.head}:specs/features/${FEATURE}/04-contract.md`], {
      cwd: dir,
      encoding: 'utf8'
    });
    assert.match(tracked, /Feature Contract|Contract/);
  } finally { h.cleanup(dir); }
});
