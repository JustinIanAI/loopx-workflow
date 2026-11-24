'use strict';
/**
 * W4 (#42)：三层 LoopX 能力探针 + doctor 能力矩阵 + ADR-0010 T2/T3 负向测试。
 * 全部通过 PATH 注入的 Contract Fake CLI 模拟，不依赖本机真实 loopx（ADR-0010 T2）。
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const PROBE = path.join(PROJECT_ROOT, 'lib/capability-probe.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-capability-probe-'));
const MOCK_BIN = path.join(SANDBOX, 'bin');
const CALLS_LOG = path.join(SANDBOX, 'calls.log');
const REGISTRY = path.join(SANDBOX, 'registry.json');
const LOOPX_TMP = path.join(SANDBOX, 'tmp');
const DOCTOR_JSON = JSON.stringify({
  checks: [{ id: 'installed_required_skills', ok: true }, { id: 'installed_required_skill_routes', ok: true }],
  skills: { 'loopx-flow': { exists: true, required_phrases: true } },
  install_freshness: { status: 'fresh' }
});
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

fs.mkdirSync(MOCK_BIN, { recursive: true });
fs.mkdirSync(LOOPX_TMP, { recursive: true });
fs.writeFileSync(REGISTRY, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));
fs.writeFileSync(path.join(MOCK_BIN, 'loopx'), `#!/usr/bin/env bash
args="$*"
if [[ "$args" == "--version" ]]; then echo "\${MOCK_LOOPX_VERSION:-loopx 2.3.0}"; exit 0; fi
if [[ "$args" == *"--help"* ]]; then
  if [[ -n "\${MOCK_HELP_FAIL_ARGS:-}" && "$args" == *"\${MOCK_HELP_FAIL_ARGS}"* ]]; then echo "help unavailable by contract fake" >&2; exit 3; fi
  out="--goal-id --state-file --todo-id --agent-id --claimed-by --claim-operation-id --evidence --required-write-scope --task-domain --task-repository --validation-command --operation-id --task-class --decision-scope --decision-outcome --global-gate --result-json --execute --base-ref --check-merge-readiness --check-result stop sync-global feasibility configure status"
  if [[ -n "\${MOCK_MISSING_FLAG:-}" ]]; then out="\${out//\${MOCK_MISSING_FLAG}/}"; fi
  echo "$out"; exit 0
fi
if [[ "$args" == *"doctor"* ]]; then
  if [[ "$args" == *"--format json"* ]]; then printf '%s' '${DOCTOR_JSON}'; fi
  exit 0
fi
if [[ "$args" == *"--format json status"* ]]; then echo '{"schema_version":"task_graph_projection_v0","runtime_root":""}'; exit 0; fi
echo "$*" >> ${JSON.stringify(CALLS_LOG)}
case "$args" in
  *agent-directory*) echo '{"ok":true,"registered_agent_count":1,"rows":[{"agent_id":"probe-agent","registered":true}]}' ;;
  *"todo claim"*) printf '%s' "{\\"ok\\":true,\\"schema_version\\":\\"\${MOCK_CLAIM_SCHEMA:-loopx_coordination_todo_claim_result_v0}\\",\\"claim_operation_id\\":\\"todo-claim:mock\\",\\"handoff_mode\\":\\"hard_lease\\",\\"execution_managed\\":true}" ;;
  *"todo complete"*) echo '{"ok":true,"schema_version":"loopx_coordination_todo_terminal_lifecycle_result_v0","completed":true,"status":"done","changed":true}' ;;
  *"issue-fix feasibility"*) echo '{"decision":{"route":"fix_pr","rationale":"contract fake"}}' ;;
  *"integration-branch"*) echo "[contract-fake] integration ok" ;;
  *) echo "[contract-fake] $args" ;;
esac
exit 0
`, { mode: 0o755 });
fs.writeFileSync(path.join(MOCK_BIN, 'gh'), `#!/usr/bin/env bash
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1" == "repo" ]]; then echo '{"nameWithOwner":"JustinIanAI/loopx-workflow"}'; exit 0; fi
if [[ "$1" == "issue" ]]; then echo '{"number":42,"title":"mock issue","state":"OPEN"}'; exit 0; fi
exit 0
`, { mode: 0o755 });

function runFlow(args, env = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: `${MOCK_BIN}:${process.env.PATH}`, LOOPX_REGISTRY: REGISTRY, LOOPX_TMP_DIR: LOOPX_TMP, LOOPX_AGENT_ID: 'probe-agent', ...env }
  });
}
function runProbe(args, env = {}) {
  return spawnSync(process.execPath, [PROBE, ...args], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: `${MOCK_BIN}:${process.env.PATH}`, ...env }
  });
}
function readCalls() { return fs.existsSync(CALLS_LOG) ? fs.readFileSync(CALLS_LOG, 'utf8') : ''; }

test('T2: todo claim blocks non-zero with a diagnostic card when a required flag is missing', () => {
  const r = runFlow(['todo', 'claim', 'todo_x', '--goal-id', 'cap-goal'], { MOCK_MISSING_FLAG: '--claim-operation-id' });
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /LoopX 升级契约差异诊断卡/);
  assert.match(out, /--claim-operation-id/);
  assert.match(out, /FAIL-CLOSED/);
  assert.strictEqual(/todo claim --goal-id/.test(readCalls()), false, '能力探针失败后不得调用真实认领');
});

test('T2: issue blocks non-zero when issue-fix.feasibility is missing', () => {
  const r = runFlow(['issue', '42'], { MOCK_MISSING_FLAG: 'feasibility' });
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /LoopX 升级契约差异诊断卡/);
  assert.strictEqual(readCalls().includes('issue-fix feasibility'), false);
});

test('T2: integrate blocks non-zero when integration-branch help is UNKNOWN', () => {
  const r = runFlow(['integrate'], { MOCK_HELP_FAIL_ARGS: 'integration-branch' });
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /LoopX 升级契约差异诊断卡/);
  assert.match(out, /UNKNOWN/);
  assert.strictEqual(readCalls().includes('integration-branch sync'), false);
});

test('T2: unknown schema_version fails closed with a diagnostic card', () => {
  const r = runFlow(['todo', 'claim', 'todo_x', '--goal-id', 'cap-goal'], { MOCK_CLAIM_SCHEMA: 'loopx_coordination_todo_claim_result_v9' });
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /LoopX 升级契约差异诊断卡/);
  assert.match(out, /schema_version 不在白名单/);
  assert.match(out, /loopx_coordination_todo_claim_result_v9/);
});

test('T3: non-critical capability missing yields WARN and does not block', () => {
  const r = runProbe(['matrix', '--scope', 'doctor', '--loopx-bin', path.join(MOCK_BIN, 'loopx')], { MOCK_HELP_FAIL_ARGS: 'goal-acceptance' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const row = r.stdout.split('\n').find((line) => line.startsWith('goal.acceptance'));
  assert.ok(row, r.stdout);
  assert.match(row, /WARN/);
  assert.doesNotMatch(row, /BLOCK/);
});

test('T3: issue-fix/integration-branch are WARN under doctor but BLOCK under their own scope', () => {
  const doctor = runProbe(['matrix', '--scope', 'doctor', '--loopx-bin', path.join(MOCK_BIN, 'loopx')], { MOCK_HELP_FAIL_ARGS: 'issue-fix' });
  assert.strictEqual(doctor.status, 0, doctor.stdout + doctor.stderr);
  const row = doctor.stdout.split('\n').find((line) => line.startsWith('issue-fix.feasibility'));
  assert.ok(row, doctor.stdout);
  assert.match(row, /WARN/);
  const scoped = runProbe(['require', '--scope', 'issue', '--loopx-bin', path.join(MOCK_BIN, 'loopx')], { MOCK_HELP_FAIL_ARGS: 'issue-fix' });
  assert.notStrictEqual(scoped.status, 0, 'issue scope must BLOCK when issue-fix help is unavailable');
  assert.match(scoped.stderr, /LoopX 升级契约差异诊断卡/);
});

test('doctor prints the full capability matrix with PASS/WARN semantics and stays non-blocking', () => {
  const r = runFlow(['doctor'], { MOCK_HELP_FAIL_ARGS: 'goal-acceptance' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /Required Capability Set 能力矩阵/);
  for (const id of ['goal.bootstrap', 'todo.lease', 'change-quality.strict-receipt', 'pr-review.merge-readiness', 'goal.lifecycle', 'issue-fix.feasibility']) {
    assert.match(out, new RegExp(`^${id.replace(/\./g, '\\.')}\\s+.*PASS`, 'm'), `matrix must show PASS for ${id}: ${out}`);
  }
  assert.match(out, /^goal\.acceptance\s+.*WARN/m);
});

test('version drift only emits a soft advisory and does not block', () => {
  const r = runProbe(['require', '--scope', 'todo', '--loopx-bin', path.join(MOCK_BIN, 'loopx')], { MOCK_LOOPX_VERSION: 'loopx 2.4.0' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /版本软提示/);
  assert.match(r.stdout, /2\.4\.0/);
});

test('static: L0 commands and doctor share the centralized probe', () => {
  const flow = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.match(flow, /probe_loopx_capabilities\(\)/);
  for (const scope of ['issue', 'integrate', 'todo']) assert.match(flow, new RegExp(`require_loopx_capabilities ${scope}`));
  const doctor = flow.slice(flow.indexOf('cmd_doctor()'), flow.indexOf('ensure_loopx_tmp_dir'));
  assert.match(doctor, /probe_loopx_capabilities --scope doctor/);
  assert.doesNotMatch(flow, /--help \| grep/, 'probe logic must not be scattered as ad-hoc grep');
});
