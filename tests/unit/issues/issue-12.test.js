const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-mock-bin-issue-12-'));
process.on('exit', () => { try { fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true }); } catch (_) {} });
const CALLS_LOG = path.join(MOCK_BIN_DIR, 'calls.log');
const REGISTRY_FILE = path.join(MOCK_BIN_DIR, 'registry.json');
const LOOPX_TMP = path.join(MOCK_BIN_DIR, 'loopx-tmp');

function setupMocks() {
  fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  fs.mkdirSync(LOOPX_TMP, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'loopx'), `#!/usr/bin/env bash
args="$*"
# 能力探针的第 1 层会真实调用 --version / --help：按 loopx 2.3.0 锚点帮助签名应答，再记录业务调用。
if [[ "$args" == "--version" ]]; then echo "loopx 2.3.0"; exit 0; fi
if [[ "$args" == *"--help"* ]]; then
  case "$args" in
    "todo claim --help") echo "usage: loopx todo claim --goal-id GOAL_ID [options]"; echo "  --goal-id GOAL_ID"; echo "  --todo-id TODO_ID"; echo "  --claim-operation-id CLAIM_OPERATION_ID"; echo "  --claimed-by CLAIMED_BY"; echo "  --agent-id AGENT_ID" ;;
    "todo complete --help") echo "usage: loopx todo [--format {markdown,json}] --goal-id GOAL_ID"; echo "  --claim-operation-id CLAIM_OPERATION_ID"; echo "  --evidence EVIDENCE" ;;
    "todo add --help") echo "usage: loopx todo [--format {markdown,json}] --goal-id GOAL_ID"; echo "  --required-write-scope REQUIRED_WRITE_SCOPES"; echo "  --task-domain TASK_DOMAIN"; echo "  --task-repository TASK_REPOSITORY"; echo "  --validation-command VALIDATION_COMMAND"; echo "  --operation-id OPERATION_ID"; echo "  --claim-operation-id CLAIM_OPERATION_ID"; echo "  --task-class {advancement_task,continuous_monitor,user_gate,user_action,blocker}"; echo "  --decision-scope DECISION_SCOPE"; echo "  --decision-outcome {approve,reject,cancel}"; echo "  --global-gate" ;;
    *) echo "usage: loopx" ;;
  esac
  exit 0
fi
echo "$*" >> ${CALLS_LOG}
goal=""; todo=""
for ((i=1; i<=$#; i++)); do
  case "\${!i}" in
    --goal-id) j=$((i+1)); goal="\${!j}" ;;
    --todo-id) j=$((i+1)); todo="\${!j}" ;;
  esac
done

if [[ "$args" == *"agent-directory"* ]]; then
  mode="\${MOCK_AGENT_DIRECTORY:-one}"
  cursor=""
  if [[ "$args" == *"--cursor "* ]]; then
    cursor="\${args#*--cursor }"
    cursor="\${cursor%% *}"
  fi
  if [[ "$mode" == "none" ]]; then
    printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":0,"rows":[],"next_cursor":null}'
    exit 0
  fi
  if [[ "$mode" == "claimant-only" ]]; then
    printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":0,"rows":[{"agent_id":"old-claimant","registered":false}],"next_cursor":null}'
    exit 0
  fi
  if [[ "$mode" == "many" ]]; then
    printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":2,"rows":[{"agent_id":"alpha-agent","registered":true},{"agent_id":"beta-agent","registered":true}],"next_cursor":null}'
    exit 0
  fi
  if [[ "$mode" == "schema-drift" ]]; then
    printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v9","registered_agent_count":1,"rows":[{"agent_id":"sandbox-analysis-agent","registered":true}],"next_cursor":null}'
    exit 0
  fi
  if [[ "$mode" == "goal-missing" ]]; then
    printf '%s\\n' '{"ok":false,"error_code":"goal_not_registered","reason":"the registry does not know this Goal"}'
    exit 1
  fi
  if [[ "$mode" == "broken" ]]; then
    echo "not-json"
    exit 1
  fi
  if [[ "$mode" == "truncated-no-cursor" ]]; then
    printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":2,"rows":[{"agent_id":"old-claimant","registered":false}],"next_cursor":null,"omitted_row_count":2}'
    exit 0
  fi
  if [[ "$mode" == "paged-one" || "$mode" == "paged-env" || "$mode" == "paged-many" ]]; then
    if [[ -z "$cursor" ]]; then
      if [[ "$mode" == "paged-one" ]]; then
        printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":1,"rows":[{"agent_id":"old-claimant","registered":false},{"agent_id":"diag-holder","registered":false}],"next_cursor":"diag-holder","omitted_row_count":1}'
      else
        printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":2,"rows":[{"agent_id":"alpha-agent","registered":true},{"agent_id":"old-claimant","registered":false}],"next_cursor":"old-claimant","omitted_row_count":1}'
      fi
      exit 0
    fi
    if [[ "$cursor" == "diag-holder" ]]; then
      printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":1,"rows":[{"agent_id":"later-agent","registered":true}],"next_cursor":null}'
      exit 0
    fi
    if [[ "$cursor" == "old-claimant" ]]; then
      printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":2,"rows":[{"agent_id":"later-agent","registered":true}],"next_cursor":null}'
      exit 0
    fi
    printf '%s\\n' '{"ok":false,"error_code":"bad_cursor"}'
    exit 1
  fi
  if [[ "$mode" == "paged-cycle" ]]; then
    printf '%s\\n' '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":2,"rows":[{"agent_id":"old-claimant","registered":false}],"next_cursor":"stuck-cursor"}'
    exit 0
  fi
  owner="\${MOCK_REGISTERED_AGENT:-sandbox-analysis-agent}"
  printf '{"ok":true,"schema_version":"peer_agent_directory_v0","registered_agent_count":1,"rows":[{"agent_id":"%s","registered":true},{"agent_id":"old-claimant","registered":false}],"next_cursor":null}\\n' "$owner"
  exit 0
fi

if [[ "$args" == *"todo claim"* ]]; then
  case "\${MOCK_CLAIM_BAD:-}" in
    schema)
      echo '{"ok":true,"schema_version":"loopx_coordination_todo_claim_result_v9","claim_operation_id":"op","handoff_mode":"hard_lease"}'
      exit 0
      ;;
    missing-op)
      echo '{"ok":true,"schema_version":"loopx_coordination_todo_claim_result_v0","handoff_mode":"hard_lease"}'
      exit 0
      ;;
    mode)
      echo '{"ok":true,"schema_version":"loopx_coordination_todo_claim_result_v0","claim_operation_id":"op","handoff_mode":"legacy"}'
      exit 0
      ;;
    reject)
      echo '{"ok":false,"schema_version":"loopx_coordination_todo_claim_result_v0","error_code":"idempotency_key_reuse","error":"retired generation"}'
      exit 1
      ;;
  esac
  echo "{\\"ok\\":true,\\"schema_version\\":\\"loopx_coordination_todo_claim_result_v0\\",\\"claim_operation_id\\":\\"todo-claim:\${goal}:\${todo}:mock\\",\\"handoff_mode\\":\\"hard_lease\\",\\"execution_managed\\":true,\\"status\\":\\"applied\\"}"
  exit 0
fi

echo "[Mock LoopX] $args"
exit 0
`, { mode: 0o755 });
}

function runFlow(args, extraEnv = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
      LOOPX_AGENT_ID: '',
      LOOPX_REGISTRY: REGISTRY_FILE,
      LOOPX_TMP_DIR: LOOPX_TMP,
      ...extraEnv
    }
  });
}

function callsText() {
  return fs.existsSync(CALLS_LOG) ? fs.readFileSync(CALLS_LOG, 'utf8') : '';
}

function claimLine(goalId, todoId) {
  return callsText().split('\n').find((line) => line.includes(`todo claim --goal-id ${goalId} --todo-id ${todoId}`)) || '';
}

test('issue 12: managed todo claim passes the registered owner and caches a five-tuple receipt', () => {
  setupMocks();
  const goalId = '国标信息维护-goal';
  const todoId = 'todo_5592c127df1e84dbd49b679c';
  const res = runFlow(['todo', 'claim', todoId, '--goal-id', goalId]);
  assert.strictEqual(res.status, 0, `claim must succeed: ${res.stderr}`);
  const line = claimLine(goalId, todoId);
  assert.ok(line.includes('--agent-id sandbox-analysis-agent'), line);
  assert.ok(line.includes('--claimed-by sandbox-analysis-agent'), line);
  assert.doesNotMatch(callsText(), /task-lease acquire/);

  const cacheFile = path.join(LOOPX_TMP, 'claims', `${goalId}--${todoId}.json`);
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.strictEqual(cache.claim_operation_id, `todo-claim:${goalId}:${todoId}:mock`);
  assert.strictEqual(cache.goal_id, goalId);
  assert.strictEqual(cache.todo_id, todoId);
  assert.strictEqual(cache.agent_id, 'sandbox-analysis-agent');
  assert.strictEqual(cache.handoff_mode, 'hard_lease');
});

test('issue 12: LOOPX_AGENT_ID selects among registered agents and folds the registered spelling', () => {
  setupMocks();
  const goalId = 'multi-goal';
  const todoId = 'todo_ab12cd34ef56';
  const res = runFlow(
    ['todo', 'claim', todoId, '--goal-id', goalId],
    { MOCK_AGENT_DIRECTORY: 'many', LOOPX_AGENT_ID: 'Beta-Agent' }
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const line = claimLine(goalId, todoId);
  assert.ok(line.includes('--agent-id beta-agent'), line);
  assert.ok(line.includes('--claimed-by beta-agent'), line);
});

test('issue 12: missing registered agent fails closed with an executable register-agent repair', () => {
  for (const mode of ['none', 'claimant-only']) {
    setupMocks();
    const blocked = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'empty-goal'], { MOCK_AGENT_DIRECTORY: mode });
    const output = `${blocked.stderr}${blocked.stdout}`;
    assert.strictEqual(blocked.status, 1, `${mode} must exit 1, got: ${output}`);
    assert.match(output, /FAIL-CLOSED/);
    assert.match(output, /register-agent/);
    assert.match(output, /--agent-id <registered-agent-id>/);
    assert.doesNotMatch(output, /\\<registered-agent-id\\>/);
    assert.doesNotMatch(callsText(), /todo claim/);
  }
});

test('issue 12: ambiguous, unregistered, missing or corrupt agent-directory fails closed before claim', () => {
  setupMocks();
  const ambiguous = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'], { MOCK_AGENT_DIRECTORY: 'many' });
  assert.strictEqual(ambiguous.status, 1);
  assert.match(`${ambiguous.stderr}${ambiguous.stdout}`, /alpha-agent/);
  assert.match(`${ambiguous.stderr}${ambiguous.stdout}`, /beta-agent/);
  assert.doesNotMatch(callsText(), /todo claim/);

  setupMocks();
  const unregistered = runFlow(
    ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'],
    { MOCK_AGENT_DIRECTORY: 'many', LOOPX_AGENT_ID: 'missing-agent' }
  );
  assert.strictEqual(unregistered.status, 1);
  assert.match(`${unregistered.stderr}${unregistered.stdout}`, /register-agent/);
  assert.doesNotMatch(callsText(), /todo claim/);

  setupMocks();
  const missingGoal = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'absent-goal'], { MOCK_AGENT_DIRECTORY: 'goal-missing' });
  assert.strictEqual(missingGoal.status, 1);
  assert.match(`${missingGoal.stderr}${missingGoal.stdout}`, /FAIL-CLOSED/);
  assert.doesNotMatch(callsText(), /todo claim/);

  setupMocks();
  const broken = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'broken-goal'], { MOCK_AGENT_DIRECTORY: 'broken' });
  assert.strictEqual(broken.status, 1);
  assert.doesNotMatch(callsText(), /todo claim/);
});

test('issue 12: agent-directory schema_version 漂移必须在申领前 fail-closed', () => {
  setupMocks();
  const drift = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'], { MOCK_AGENT_DIRECTORY: 'schema-drift' });
  assert.strictEqual(drift.status, 1, drift.stdout + drift.stderr);
  assert.match(`${drift.stderr}${drift.stdout}`, /FAIL-CLOSED/);
  assert.match(`${drift.stderr}${drift.stdout}`, /peer_agent_directory_v9/);
  assert.match(`${drift.stderr}${drift.stdout}`, /升级契约差异诊断卡/);
  assert.doesNotMatch(callsText(), /todo claim/);
});

test('issue 12: agent-directory follows next_cursor and rejects duplicate or truncated pages', () => {
  setupMocks();
  const later = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'], { MOCK_AGENT_DIRECTORY: 'paged-one' });
  assert.strictEqual(later.status, 0, later.stderr);
  assert.ok(claimLine('paged-goal', 'todo_ab12cd34ef56').includes('--agent-id later-agent'));
  assert.match(callsText(), /--cursor diag-holder/);

  setupMocks();
  const ambiguous = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'], { MOCK_AGENT_DIRECTORY: 'paged-many' });
  assert.strictEqual(ambiguous.status, 1);
  assert.match(`${ambiguous.stderr}${ambiguous.stdout}`, /alpha-agent/);
  assert.match(`${ambiguous.stderr}${ambiguous.stdout}`, /later-agent/);
  assert.doesNotMatch(callsText(), /todo claim/);

  setupMocks();
  const diagnostics = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'], { MOCK_AGENT_DIRECTORY: 'truncated-no-cursor' });
  assert.strictEqual(diagnostics.status, 1);
  assert.match(`${diagnostics.stderr}${diagnostics.stdout}`, /registered_agent_count/);
  assert.doesNotMatch(callsText(), /todo claim/);

  setupMocks();
  const cycle = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'], { MOCK_AGENT_DIRECTORY: 'paged-cycle' });
  assert.strictEqual(cycle.status, 1);
  assert.match(`${cycle.stderr}${cycle.stdout}`, /游标重复/);
  assert.doesNotMatch(callsText(), /todo claim/);
});

test('issue 12: malformed managed claim payloads fail closed instead of caching a bad receipt', () => {
  for (const mode of ['schema', 'missing-op', 'mode']) {
    setupMocks();
    const res = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'strict-goal'], { MOCK_CLAIM_BAD: mode });
    assert.strictEqual(res.status, 1, `${mode} must fail closed`);
    assert.match(`${res.stderr}${res.stdout}`, /FAIL-CLOSED/);
    assert.strictEqual(fs.existsSync(path.join(LOOPX_TMP, 'claims', 'strict-goal--todo_ab12cd34ef56.json')), false);
  }
});

test('issue 12: LoopX claim rejection keeps the original error semantics and does not retry', () => {
  setupMocks();
  const res = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'strict-goal'], { MOCK_CLAIM_BAD: 'reject' });
  assert.strictEqual(res.status, 1);
  assert.match(`${res.stderr}${res.stdout}`, /idempotency_key_reuse/);
  assert.doesNotMatch(`${res.stderr}${res.stdout}`, /可能已被其他 Agent 持有/);
  assert.strictEqual((callsText().match(/todo claim /g) || []).length, 1, 'must not retry claim');
});
