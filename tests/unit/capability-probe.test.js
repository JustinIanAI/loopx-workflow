const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const PROBE = path.join(ROOT, 'lib/loopx-capability-probe.js');
const FLOW = path.join(ROOT, 'bin/loopx-flow');
const dirs = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeCli(mode = 'healthy') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-w4-probe-'));
  dirs.push(dir);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ schema_version: '0.1', goals: [] }));
  fs.writeFileSync(path.join(bin, 'loopx'), `#!/usr/bin/env bash
mode="\${LOOPX_PROBE_MODE:-${mode}}"
version="\${LOOPX_PROBE_VERSION:-2.3.0}"
args="$*"
if [[ "$args" == "--version" ]]; then echo "loopx $version"; exit 0; fi
if [[ "$args" == *"doctor"* && "$args" == *"--format json"* ]]; then
  echo '{"ok":true,"checks":[{"id":"installed_required_skills","required":false,"ok":true,"applicable":true},{"id":"installed_required_skill_routes","required":false,"ok":true,"applicable":true}],"skills":{"loopx-project":{"exists":true,"required_phrases":true,"route_conflict":false}},"install_freshness":{"status":"fresh","requires_upgrade":false},"skill_delivery":{"status":"ready"}}'
  exit 0
fi
if [[ "$args" == *"--help"* ]]; then
  case "$args" in
    *"todo claim"*)
      if [[ "$mode" == "missing-flag" ]]; then echo "--goal-id --todo-id --agent-id --claimed-by"; else echo "--goal-id --todo-id --agent-id --claimed-by --claim-operation-id"; fi
      exit 0;;
    *"todo complete"*)
      echo "--required-write-scope --task-domain --task-repository --validation-command --operation-id --claim-operation-id --task-class --decision-scope --decision-outcome --global-gate"
      exit 0;;
    *"change-quality"*)
      echo "--goal-id --result-json --execute --base-ref --strict"
      exit 0;;
    *"pr-review"*)
      echo "--check-merge-readiness --check-result"
      exit 0;;
    *"goal-lifecycle"*)
      echo "stop sync-global --goal-id --state-file"
      exit 0;;
    *"bootstrap"*)
      echo "--goal-id --state-file"
      exit 0;;
    *"issue-fix"*)
      if [[ "$mode" == "unknown-help" ]]; then exit 3; fi
      if [[ "$mode" == "missing-issue-fix" ]]; then echo "usage: loopx issue-fix"; exit 0; fi
      echo "feasibility"
      exit 0;;
    *"integration-branch"*)
      if [[ "$mode" == "unknown-help" ]]; then exit 3; fi
      if [[ "$mode" == "missing-issue-fix" ]]; then echo "usage: loopx integration-branch"; exit 0; fi
      echo "configure status sync"
      exit 0;;
    *"goal-acceptance"*)
      if [[ "$mode" == "warn-missing" ]]; then echo "usage: loopx goal-acceptance"; else echo "verify --format"; fi
      exit 0;;
  esac
fi
echo '{"ok":true,"goals":[]}'
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
if [[ "$1" == "issue" ]]; then echo '{"number":123,"title":"probe fixture","state":"OPEN"}'; exit 0; fi
if [[ "$1" == "repo" ]]; then echo '{"nameWithOwner":"o/r"}'; exit 0; fi
exit 0
`, { mode: 0o755 });
  return { bin, registry, dir };
}

function envFor(cli, extra = {}) {
  return {
    ...process.env,
    PATH: `${cli.bin}:${process.env.PATH}`,
    LOOPX_USAGE_PING: '0',
    LOOPX_REGISTRY: cli.registry,
    LOOPX_TMP_DIR: path.join(cli.dir, 'tmp'),
    HOME: cli.dir,
    ...extra,
  };
}

function runProbe(cli, args, extra = {}) {
  return spawnSync(process.execPath, [PROBE, ...args], {
    cwd: ROOT, encoding: 'utf8', env: envFor(cli, extra),
  });
}

function runFlow(cli, args) {
  return spawnSync(FLOW, args, { cwd: ROOT, encoding: 'utf8', env: envFor(cli) });
}

function payloadFile(cli, payload) {
  const file = path.join(cli.dir, `payload-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

test('1. healthy CLI: matrix reports PASS for every BLOCK capability and version anchor', () => {
  const cli = makeCli();
  const res = runProbe(cli, ['--command', 'doctor', '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'PASS');
  for (const id of ['todo.claim', 'change-quality.strict-receipt', 'issue-fix.feasibility', 'integration-branch', 'schema.version']) {
    const row = result.capabilities.find((item) => item.id === id);
    assert.ok(row, `missing capability row ${id}`);
    assert.strictEqual(row.status, 'PASS', `${id}: ${JSON.stringify(row)}`);
  }
  assert.strictEqual(result.advisory.status, 'PASS');
});

test('2. missing required flag on a BLOCK capability fails closed with an upgrade diff card', () => {
  const cli = makeCli('missing-flag');
  const res = runProbe(cli, ['--command', 'doctor', '--format', 'json']);
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'BLOCK');
  const row = result.capabilities.find((item) => item.id === 'todo.claim');
  assert.strictEqual(row.status, 'BLOCK');
  assert.ok(row.missing.includes('--claim-operation-id'));
  assert.match(result.card, /LoopX 升级契约差异诊断卡/);
  assert.match(result.card, /--claim-operation-id/);
  assert.match(result.card, /todo\.claim/);
  assert.match(result.card, /当前 loopx 版本: 2\.3\.0/);
});

test('3. UNKNOWN help probe on a BLOCK capability fails closed for the bound L0 command', () => {
  const cli = makeCli('unknown-help');
  const res = runProbe(cli, ['--command', 'issue', '--format', 'json']);
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'BLOCK');
  assert.match(result.card, /issue-fix\.feasibility/);
  assert.match(result.card, /UNKNOWN/);
});

test('4. doctor downgrades issue-fix/integration-branch gaps to WARN', () => {
  const cli = makeCli('missing-issue-fix');
  const res = runProbe(cli, ['--command', 'doctor', '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'WARN');
  assert.strictEqual(result.card, null);
  for (const id of ['issue-fix.feasibility', 'integration-branch']) {
    assert.strictEqual(result.capabilities.find((item) => item.id === id).status, 'WARN');
  }
});

test('5. unknown schema_version payload fails closed with expected and actual values', () => {
  const cli = makeCli();
  const file = payloadFile(cli, { schema_version: 'loopx_coordination_todo_claim_result_v9' });
  const res = runProbe(cli, ['--command', 'doctor', '--payload-file', file, '--format', 'json']);
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'BLOCK');
  assert.match(result.card, /loopx_coordination_todo_claim_result_v9/);
  assert.match(result.card, /loopx_coordination_todo_claim_result_v0/);
  assert.match(result.card, /schema_version/);
});

test('6. missing schema_version payload fails closed (fail-closed on malformed JSON)', () => {
  const cli = makeCli();
  const file = payloadFile(cli, { ok: true });
  const res = runProbe(cli, ['--payload-file', file, '--format', 'json']);
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.match(JSON.parse(res.stdout).card, /schema_version/);
});

test('7. whitelisted schema_version payload passes', () => {
  const cli = makeCli();
  const file = payloadFile(cli, { schema_version: 'change_quality_receipt_v2' });
  const res = runProbe(cli, ['--payload-file', file, '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const row = JSON.parse(res.stdout).capabilities.find((item) => item.id === 'schema.version');
  assert.strictEqual(row.status, 'PASS');
});

test('8. version drift alone is a non-blocking soft advisory', () => {
  const cli = makeCli();
  const res = runProbe(cli, ['--command', 'doctor', '--format', 'json'], { LOOPX_PROBE_VERSION: '2.4.0' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'WARN');
  assert.strictEqual(result.advisory.status, 'WARN');
  const text = runProbe(cli, ['--command', 'doctor'], { LOOPX_PROBE_VERSION: '2.4.0' });
  assert.match(text.stdout, /软提示/);
});

test('9. WARN-tier capability gap discloses degradation without blocking', () => {
  const cli = makeCli('warn-missing');
  const res = runProbe(cli, ['--command', 'doctor', '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.status, 'WARN');
  assert.strictEqual(result.capabilities.find((item) => item.id === 'goal.acceptance').status, 'WARN');
});

test('10. doctor prints the capability matrix with textual status tokens', () => {
  const cli = makeCli('missing-issue-fix');
  const res = runFlow(cli, ['doctor']);
  const output = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0, output);
  assert.match(output, /能力矩阵/);
  assert.match(output, /PASS/);
  assert.match(output, /WARN/);
});

test('11. issue command fails closed when issue-fix feasibility capability is missing', () => {
  const cli = makeCli('missing-issue-fix');
  const res = runFlow(cli, ['issue', '123']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /LoopX 升级契约差异诊断卡/);
  assert.match(res.stdout + res.stderr, /issue-fix\.feasibility/);
});

test('12. integrate command fails closed when integration-branch capability is missing', () => {
  const cli = makeCli('missing-issue-fix');
  const res = runFlow(cli, ['integrate']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /LoopX 升级契约差异诊断卡/);
  assert.match(res.stdout + res.stderr, /integration-branch/);
});
