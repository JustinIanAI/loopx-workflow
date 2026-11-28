'use strict';
/**
 * ADR-0010 决策 4/11/12 · ADR-0015 决策 4 的 T2 / T3 负向专项测试。
 *
 * 第 1 层用 Contract Fake CLI 注入「必需 Flag / 子命令缺失」与「help 不可用（UNKNOWN）」；
 * 第 2 层注入「未知 schema_version」；第 3 层验证版本号变化只软提示、不阻断。
 * Fake CLI 的帮助文本按 loopx 2.3.0 锚点的真实 usage 结构编写（含 `{choice1,choice2}` 形式），
 * 另有一条真实 CLI 金丝雀用例：本机存在 loopx 2.3.x 时直接对真实帮助签名跑全量 BLOCK 能力。
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MODULE = path.join(PROJECT_ROOT, 'lib/capability-probe.js');
const probe = require(MODULE);

const sandboxes = [];
after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
});

const ANCHOR_HELP = {
  'bootstrap --help': [
    'usage: loopx bootstrap [-h] [--project PROJECT] --goal-id GOAL_ID [--state-file STATE_FILE]',
    '  --goal-id GOAL_ID     Stable goal id.',
    '  --state-file STATE_FILE                        Active goal state path.'
  ].join('\n'),
  'todo claim --help': [
    'usage: loopx todo claim --goal-id GOAL_ID [options]',
    'options:',
    '  --goal-id GOAL_ID     Goal id whose active state should receive the todo.',
    '  --todo-id TODO_ID     Structured todo id from status/quota.',
    '  --claim-operation-id CLAIM_OPERATION_ID',
    '  --claimed-by CLAIMED_BY',
    '  --agent-id AGENT_ID   Attribute the lifecycle actor.'
  ].join('\n'),
  'todo complete --help': [
    'usage: loopx todo [--format {markdown,json}] --goal-id GOAL_ID',
    '  --claim-operation-id CLAIM_OPERATION_ID',
    '  --evidence EVIDENCE'
  ].join('\n'),
  'todo add --help': [
    'usage: loopx todo [--format {markdown,json}] --goal-id GOAL_ID',
    '  --required-write-scope REQUIRED_WRITE_SCOPES',
    '  --task-domain TASK_DOMAIN',
    '  --task-repository TASK_REPOSITORY',
    '  --validation-command VALIDATION_COMMAND',
    '  --operation-id OPERATION_ID',
    '  --claim-operation-id CLAIM_OPERATION_ID',
    '  --task-class {advancement_task,continuous_monitor,user_gate,user_action,blocker}',
    '  --decision-scope DECISION_SCOPE',
    '  --decision-outcome {approve,reject,cancel}',
    '  --global-gate'
  ].join('\n'),
  'change-quality prepare --help': [
    'usage: loopx change-quality prepare [-h] [--format {markdown,json}] --goal-id GOAL_ID',
    '                                   [--repo-path REPO_PATH] [--base-ref BASE_REF]'
  ].join('\n'),
  'change-quality record --help': [
    'usage: loopx change-quality record [-h] --goal-id GOAL_ID [--repo-path REPO_PATH]',
    '                                  [--base-ref BASE_REF] --result-json RESULT_JSON [--execute]'
  ].join('\n'),
  'change-quality verify --help': [
    'usage: loopx change-quality verify [-h] --goal-id GOAL_ID [--repo-path REPO_PATH]',
    '                                  [--base-ref BASE_REF]'
  ].join('\n'),
  'pr-review --help': [
    'usage: loopx pr-review [-h] [--goal-id GOAL_ID] [--check-result CHECK_RESULT]',
    '                       [--check-merge-readiness NUMBER@HEAD_OID]'
  ].join('\n'),
  'goal-lifecycle --help': [
    'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID --operation {stop,resume}',
    '                            [--reason REASON] [--execute]'
  ].join('\n'),
  'sync-global --help': [
    'usage: loopx sync-global [-h] [--goal-id GOAL_ID] [--replace-state] [--dry-run]'
  ].join('\n'),
  'issue-fix --help': [
    'usage: loopx issue-fix [-h]',
    '                       {repository-memory-sync,workflow-plan,feasibility,outcome,metrics} ...'
  ].join('\n'),
  'integration-branch --help': [
    'usage: loopx integration-branch [-h] {configure,status,sync} ...'
  ].join('\n'),
  'goal-acceptance --help': [
    'usage: loopx goal-acceptance [-h] [--format {markdown,json}] --goal-id GOAL_ID',
    '                             {inspect,prepare,configure,verify}'
  ].join('\n')
};

function makeFakeCli({ version = '2.3.0', help = ANCHOR_HELP } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-probe-'));
  sandboxes.push(dir);
  const bin = path.join(dir, 'loopx');
  const cases = Object.entries(help).map(([args, text]) => {
    if (text === null) return `    "${args}") exit 2 ;;`;
    const file = path.join(dir, `help-${Buffer.from(args, 'utf8').toString('hex')}.txt`);
    fs.writeFileSync(file, `${text}\n`);
    return `    "${args}") cat "${file}"; exit 0 ;;`;
  }).join('\n');
  fs.writeFileSync(bin, `#!/usr/bin/env bash
args="$*"
if [[ "$args" == "--version" ]]; then echo "loopx ${version}"; exit 0; fi
if [[ "$args" == *"--help" ]]; then
  case "$args" in
${cases}
    *) echo "usage: loopx"; exit 2 ;;
  esac
fi
echo '{"schema_version":"loopx_test_unknown_v0"}'
exit 0
`, { mode: 0o755 });
  return bin;
}

function runModule(args, input) {
  return spawnSync(process.execPath, [MODULE, ...args], {
    encoding: 'utf8',
    input: input || undefined,
    cwd: PROJECT_ROOT
  });
}

function withHelp(overrides) {
  return { ...ANCHOR_HELP, ...overrides };
}

test('doctor matrix: anchor-shaped help passes every Required Capability Set row', () => {
  const bin = makeFakeCli();
  const result = probe.probeCapabilities({ loopxBin: bin, scope: 'doctor' });
  assert.strictEqual(result.schema_version, 'loopx_flow_capability_matrix_v0');
  assert.deepStrictEqual(result.blocked, []);
  assert.ok(result.entries.length >= 10, 'matrix must cover the full Required Capability Set');
  for (const entry of result.entries) assert.strictEqual(entry.status, 'PASS', `${entry.id}: ${entry.detail}`);
});

test('T2: missing required flag fails closed with the upgrade diagnostic card', () => {
  const bin = makeFakeCli({
    help: withHelp({ 'todo claim --help': ANCHOR_HELP['todo claim --help'].replace('  --claimed-by CLAIMED_BY\n', '') })
  });
  const r = runModule(['require', '--scope', 'todo', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /LoopX 升级契约差异诊断卡/);
  assert.match(r.stderr, /触发命令/);
  assert.match(r.stderr, /期望/);
  assert.match(r.stderr, /影响范围/);
  assert.match(r.stderr, /适配定位/);
  assert.match(r.stdout, /BLOCK/);
  assert.match(r.stdout, /--claimed-by/);
});

test('T2: issue-fix.feasibility missing blocks issue but is only WARN for the doctor matrix', () => {
  const bin = makeFakeCli({
    help: withHelp({ 'issue-fix --help': 'usage: loopx issue-fix [-h] {workflow-plan,outcome} ...' })
  });
  const required = runModule(['require', '--scope', 'issue', '--loopx-bin', bin]);
  assert.strictEqual(required.status, 1);
  assert.match(required.stderr, /feasibility/);

  const doctor = runModule(['matrix', '--scope', 'doctor', '--loopx-bin', bin]);
  assert.strictEqual(doctor.status, 0, 'doctor is a diagnostic view and must not block');
  const issueRow = doctor.stdout.split('\n').find((line) => line.startsWith('issue-fix.feasibility'));
  assert.ok(issueRow, 'matrix must include issue-fix.feasibility');
  assert.match(issueRow, /WARN/);
});

test('T2: integration-branch missing subcommand blocks integrate', () => {
  const bin = makeFakeCli({
    help: withHelp({ 'integration-branch --help': 'usage: loopx integration-branch [-h] {configure,status} ...' })
  });
  const r = runModule(['require', '--scope', 'integrate', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /sync/);
  assert.match(r.stderr, /升级契约差异诊断卡/);
});

test('T2: help probe unavailable is UNKNOWN and blocks BLOCK capabilities', () => {
  const bin = makeFakeCli({ help: withHelp({ 'todo complete --help': null }) });
  const r = runModule(['require', '--scope', 'todo', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /UNKNOWN/);
  assert.match(r.stderr, /升级契约差异诊断卡/);
});

test('goal.lifecycle accepts the real {stop,resume} choice form and rejects a missing stop', () => {
  const full = probe.probeCapabilities({ loopxBin: makeFakeCli(), scope: 'merge' });
  assert.ok(!full.blocked.some((entry) => entry.id === 'goal.lifecycle'), JSON.stringify(full.blocked));

  const withoutStop = makeFakeCli({
    help: withHelp({
      'goal-lifecycle --help': 'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID --operation {resume}'
    })
  });
  const r = runModule(['require', '--scope', 'merge', '--loopx-bin', withoutStop]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--operation 缺少取值 stop/);
});

test('T5 layer 3: version drift alone is a soft advisory and never blocks', () => {
  const bin = makeFakeCli({ version: '2.4.0' });
  const r = runModule(['require', '--scope', 'todo', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 0);

  const matrix = runModule(['matrix', '--scope', 'doctor', '--loopx-bin', bin]);
  assert.strictEqual(matrix.status, 0);
  assert.match(matrix.stdout, /版本软提示: loopx 2\.4\.0/);
  assert.match(matrix.stdout, /不阻断/);
});

test('T3: unknown schema_version fails closed with the diagnostic card', () => {
  const payload = JSON.stringify({ ok: true, schema_version: 'loopx_coordination_todo_claim_result_v9' });
  const bad = runModule(['assert-schema', '--consumer', 'todo.claim'], payload);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /升级契约差异诊断卡/);
  assert.match(bad.stderr, /不在白名单/);

  const missing = runModule(['assert-schema', '--consumer', 'todo.claim'], JSON.stringify({ ok: true }));
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /actual|missing/);

  const good = runModule(['assert-schema', '--consumer', 'todo.claim'], JSON.stringify({
    ok: true,
    schema_version: 'loopx_coordination_todo_claim_result_v0'
  }));
  assert.strictEqual(good.status, 0);
  assert.strictEqual(good.stdout.trim(), 'loopx_coordination_todo_claim_result_v0');

  const unknownConsumer = runModule(['assert-schema', '--consumer', 'not.registered'], payload);
  assert.strictEqual(unknownConsumer.status, 1);
  assert.match(unknownConsumer.stderr, /未登记/);
});

test('T3: 第 2 层覆盖 todo.list / agent-directory / task-lease.inspect 真实读取点（review #73 P1）', () => {
  const cases = [
    ['todo.list', { projection_envelope: { schema_version: 'loopx_projection_envelope_v0' } }, 'loopx_projection_envelope_v0'],
    ['agent-directory', { schema_version: 'peer_agent_directory_v0' }, 'peer_agent_directory_v0'],
    ['task-lease.inspect', { schema_version: 'task_lease_v0' }, 'task_lease_v0'],
  ];
  for (const [consumer, payload, expected] of cases) {
    const ok = runModule(['assert-schema', '--consumer', consumer], JSON.stringify({ ok: true, ...payload }));
    assert.strictEqual(ok.status, 0, `${consumer}: ${ok.stderr}`);
    assert.strictEqual(ok.stdout.trim(), expected);
  }
  // `todo list` 的 schema 只在 projection_envelope 内；顶层出现同名字段不得算通过。
  const misplaced = runModule(['assert-schema', '--consumer', 'todo.list'],
    JSON.stringify({ ok: true, schema_version: 'loopx_projection_envelope_v0' }));
  assert.strictEqual(misplaced.status, 1);
  assert.match(misplaced.stderr, /missing/);
  for (const [consumer, drift] of [
    ['todo.list', { projection_envelope: { schema_version: 'loopx_projection_envelope_v9' } }],
    ['agent-directory', { schema_version: 'peer_agent_directory_v9' }],
    ['task-lease.inspect', { schema_version: 'task_lease_v9' }],
  ]) {
    const bad = runModule(['assert-schema', '--consumer', consumer], JSON.stringify({ ok: true, ...drift }));
    assert.strictEqual(bad.status, 1, `${consumer} 未知版本必须阻断`);
    assert.match(bad.stderr, /不在白名单/);
  }
});

test('extractSignature keeps long flags and brace choices apart', () => {
  const signature = probe.extractSignature(ANCHOR_HELP['goal-lifecycle --help']);
  assert.ok(signature.flags.has('--goal-id'));
  assert.ok(signature.flags.has('--operation'));
  assert.ok(signature.words.has('stop'));
  assert.ok(signature.words.has('resume'));
  assert.ok(!signature.words.has('--operation'), 'flags must not leak into the word set');
  // P2：选择集必须绑定到同一行内它前面的 Flag，而不是整段帮助的全局词表。
  assert.deepStrictEqual([...signature.choices.get('--operation')].sort(), ['resume', 'stop']);
});

test('P2 回归：同一行归错 Flag 的 choices 不得冒充目标 Flag 的取值（false pass）', () => {
  // 旧实现把 `{stop,resume}` 塞进全局词表，`signatureHas` 不绑定 Flag，
  // 于是 `--operation` 的取值校验只要「全文出现过 stop」就通过。
  const help = [
    'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID --operation OPERATION',
    '                            --reason {stop,resume}'
  ].join('\n');
  assert.ok(probe.extractSignature(help).words.has('stop'), '前置：旧实现据以误判的全局词确实存在');
  assert.deepStrictEqual([...probe.extractSignature(help).choices.get('--operation') || []], [], 'choices 不得从 --reason 借用');

  const bin = makeFakeCli({ help: withHelp({ 'goal-lifecycle --help': help }) });
  const r = runModule(['require', '--scope', 'merge', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 1, '归错 Flag 的 choices 必须让 merge 阻断');
  assert.match(r.stderr, /--operation 缺少取值 stop/);
  assert.match(r.stderr, /--operation 缺少取值 resume/);
  assert.match(r.stderr, /LoopX 升级契约差异诊断卡/);
});

test('P2 回归：帮助里出现选择词但 Flag 完全缺失时不得放行（false pass）', () => {
  // 更极端的旧实现误判：`--operation` 根本不在帮助里，但正文出现过 stop/resume。
  const help = [
    'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID',
    '  --reason {stop,resume}   Accepted reason tags (not an operation).'
  ].join('\n');
  const bin = makeFakeCli({ help: withHelp({ 'goal-lifecycle --help': help }) });
  const r = runModule(['require', '--scope', 'merge', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /缺少 Flag --operation/);
});

test('real CLI canary: loopx 2.3.x satisfies every BLOCK capability', { skip: (() => {
  const r = spawnSync('loopx', ['--version'], { encoding: 'utf8' });
  const raw = `${r.stdout || ''}${r.stderr || ''}`;
  return r.status === 0 && /2\.3\.\d+/.test(raw) ? false : 'real loopx 2.3.x CLI not available';
})() }, () => {
  const result = probe.probeCapabilities({ loopxBin: 'loopx', scope: 'doctor' });
  const blockRows = result.entries.filter((entry) => entry.tier === 'BLOCK');
  assert.ok(blockRows.length > 0);
  for (const entry of blockRows) assert.strictEqual(entry.status, 'PASS', `${entry.id}: ${entry.detail}`);
});

test('Issue #84：折行的 choices 归属同一 usage 段落的 Flag（80 列 argparse 换行）', () => {
  // argparse 在 80 列下会把取值枚举折到下一行：`--operation` 与 `{stop,resume}` 不再同行。
  const help = [
    'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID --operation',
    '                            {stop,resume} [--reason REASON]',
    '                            [--state-file STATE_FILE]'
  ].join('\n');
  const signature = probe.extractSignature(help);
  assert.deepStrictEqual([...signature.choices.get('--operation')].sort(), ['resume', 'stop']);
  assert.strictEqual(signature.choices.get('--reason'), undefined, 'choices 不得外溢到相邻 Flag');

  const bin = makeFakeCli({ help: withHelp({ 'goal-lifecycle --help': help }) });
  const ok = runModule(['require', '--scope', 'merge', '--loopx-bin', bin]);
  assert.strictEqual(ok.status, 0, `折行 choices 不应阻断 merge：${ok.stderr}`);
});

test('Issue #84：跨空行的 choices 不归属任何 Flag（不退化为全文词表匹配）', () => {
  const help = [
    'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID --operation OPERATION',
    '',
    '{stop,resume}   Subcommands, not an option value.'
  ].join('\n');
  const signature = probe.extractSignature(help);
  assert.ok(signature.words.has('stop'), '前置：词表仍收录该词');
  assert.strictEqual(signature.choices.get('--operation'), undefined, '空行之后不得回填归属');

  const bin = makeFakeCli({ help: withHelp({ 'goal-lifecycle --help': help }) });
  const r = runModule(['require', '--scope', 'merge', '--loopx-bin', bin]);
  assert.strictEqual(r.status, 1, '无归属的 choices 必须继续阻断');
  assert.match(r.stderr, /--operation 缺少取值 stop/);
});

test('Issue #84：折行后相邻 Flag 的 choices 各归其主（同段落内就近归属）', () => {
  const help = [
    'usage: loopx goal-lifecycle [-h] --goal-id GOAL_ID --operation OPERATION',
    '                            --reason',
    '                            {stop,resume,suspend}'
  ].join('\n');
  const signature = probe.extractSignature(help);
  assert.strictEqual(signature.choices.get('--operation'), undefined, '近邻 Flag 是 --reason，不是 --operation');
  assert.deepStrictEqual([...signature.choices.get('--reason')].sort(), ['resume', 'stop', 'suspend']);
});
