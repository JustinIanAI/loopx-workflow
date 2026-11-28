'use strict';
/**
 * Gate1 决策落款不再是「自己的输出」前置条件（Issue #75/#85 卡死根因）。
 *
 * 事故形态：`grep` 全仓只有一个写入者——`cmd_approve` 在人工授权通过后写
 * `- **Status**: APPROVED BY HUMAN (...)`；而同一命令开头又要求该标记**已存在**。
 * 新胶囊默认 `status: PROPOSED`，于是：
 *   ① approve 永远进不去（要求自己的输出）；
 *   ② 连 `--prepare`（零写入、只打印签名模板）也被这道前置挡住，
 *      异步场景下人类拿不到模板 → 特征分支主线被 Gate1 卡住。
 *
 * 修复后：Gate1 只要求决策文件存在；APPROVED 落款仍由**人工授权通过后**写入，
 * 授权渠道（gate=1 评论 / TTY）与 `--yes` 拒绝规则一字未改。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

const FEATURE = 'gate1-decisions';
const PROPOSED = '# Decisions\n\n- **Status**: PROPOSED\n\n- D1: 沿用现有命令形状\n';

function approveLoopxMock(dir) {
  h.mockLoopx(dir, `args="$*"
if [[ "$args" == *"configure-goal"* ]]; then exit 0; fi
if [[ "$args" == *"register-agent"* ]]; then exit 0; fi
if [[ "$args" == *"todo add"* ]]; then echo '{"todo_id":"todo_dec","schema_version":"loopx_coordination_todo_create_result_v0"}'; exit 0; fi
if [[ "$args" == *"todo complete"* ]]; then echo '{"schema_version":"loopx_coordination_todo_terminal_lifecycle_result_v0"}'; exit 0; fi
if [[ "$args" == *"sync-global"* ]]; then exit 0; fi
exit 0
`);
}

function decisionsPath(dir) {
  return path.join(dir, 'specs', 'features', FEATURE, '01-decisions.md');
}

function proposedCapsule(prefix) {
  const dir = h.makeSandbox(prefix);
  h.writeConfig(dir, 'independent');
  const capsule = h.writeCapsule(dir, FEATURE, { decisions: PROPOSED });
  const published = h.publishSpecPackage(dir, FEATURE);
  return { dir, capsule, published };
}

test('01-decisions 为 PROPOSED → approve 仍可通过，并在授权后落款 APPROVED BY HUMAN', () => {
  const dir = h.makeSandbox('gate1-decisions-proposed-');
  try {
    const capsule = h.writeCapsule(dir, FEATURE, { decisions: PROPOSED });
    h.writeConfig(dir, 'independent');
    h.publishSpecPackage(dir, FEATURE);
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });

    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Gate1 发布前置通过/);

    const decisions = fs.readFileSync(decisionsPath(dir), 'utf8');
    assert.match(decisions, /- \*\*Status\*\*: APPROVED BY HUMAN \(/, '必须由授权通过后的命令写入落款');
    assert.doesNotMatch(decisions, /PROPOSED/, '原 PROPOSED 行应被落款替换');
  } finally { h.cleanup(dir); }
});

test('PROPOSED 决策下 --prepare 能打印签名模板，且零写入', () => {
  const { dir, capsule } = proposedCapsule('gate1-decisions-prepare-');
  try {
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });

    const r = h.run(dir, ['approve', 'contract', FEATURE, '--prepare']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`<!-- loopx-flow:gate1-authorization:${FEATURE}@`));
    assert.match(r.stdout, /gate=1;mode=independent/);

    const decisions = fs.readFileSync(decisionsPath(dir), 'utf8');
    assert.strictEqual(decisions, PROPOSED, '--prepare 必须零写入，不得改动决策文件');
  } finally { h.cleanup(dir); }
});

test('决策文件缺失 → 仍然 fail-closed，不写批准标记', () => {
  const dir = h.makeSandbox('gate1-decisions-missing-');
  try {
    h.writeConfig(dir, 'independent');
    const capsule = h.writeCapsule(dir, FEATURE, { decisions: PROPOSED });
    fs.rmSync(decisionsPath(dir), { force: true });
    h.publishSpecPackage(dir, FEATURE);
    approveLoopxMock(dir);
    h.ghGate1Mock(dir, { feature: FEATURE, sha: h.lockedShaFile(capsule.contractPath) });

    const r = h.run(dir, ['approve', 'contract', FEATURE]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /未找到 01-decisions\.md/);
    assert.doesNotMatch(
      fs.readFileSync(capsule.contractPath, 'utf8'),
      /FROZEN & APPROVED/,
    );
  } finally { h.cleanup(dir); }
});
