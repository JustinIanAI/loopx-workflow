const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
// issue #8：测试临时工件隔离在 os.tmpdir()+mkdtemp，禁止共享 /tmp 固定文件名。
const TEST_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-native-dispatch-'));
const MOCK_BIN_DIR = path.join(TEST_TMP_DIR, 'mock-bin');
const CALLS_LOG = path.join(TEST_TMP_DIR, 'native-dispatch-mock-calls.log');
const TEST_REGISTRY = path.join(TEST_TMP_DIR, 'registry.json');
const TEST_LOOPX_TMP = path.join(TEST_TMP_DIR, 'loopx-tmp');
after(() => fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true }));

function setupMocks() {
  fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  fs.mkdirSync(TEST_LOOPX_TMP, { recursive: true });
  fs.writeFileSync(TEST_REGISTRY, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));

  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'loopx'), `#!/usr/bin/env bash
args="$*"
if [[ "$args" == "--version" ]]; then echo "loopx 2.3.0"; exit 0; fi
if [[ "$args" == *"--help"* ]]; then
  case "$args" in
    *"todo claim"*) echo "usage: loopx todo claim --goal-id <id> --todo-id <id> --agent-id <a> --claimed-by <a>" ;;
    *"todo complete"*) echo "usage: loopx todo complete --claim-operation-id <op> --evidence <ev>" ;;
    *"todo add"*) echo "usage: loopx todo add --required-write-scope --task-domain --task-repository --validation-command --operation-id --claim-operation-id --task-class --decision-scope --decision-outcome --global-gate" ;;
    *"integration-branch"*) echo "usage: loopx integration-branch configure status sync" ;;
    *"issue-fix"*) echo "usage: loopx issue-fix feasibility" ;;
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
  echo '{"ok":true,"registered_agent_count":1,"rows":[{"agent_id":"native-dispatch-agent","registered":true}]}'
  exit 0
fi

if [[ "$args" == *"todo claim"* ]]; then
  if [[ "\${MOCK_CLAIM_FAIL:-}" == "1" ]]; then
    echo '{"ok":false,"schema_version":"loopx_coordination_todo_claim_result_v0","error_code":"todo_lease_conflict","error":"held"}'
    exit 1
  fi
  echo "{\\"ok\\":true,\\"schema_version\\":\\"loopx_coordination_todo_claim_result_v0\\",\\"claim_operation_id\\":\\"todo-claim:\${goal}:\${todo}:mock\\",\\"handoff_mode\\":\\"hard_lease\\",\\"execution_managed\\":true,\\"status\\":\\"applied\\"}"
  exit 0
fi

if [[ "$args" == *"task-lease inspect"* ]]; then
  case "\${MOCK_LEASE_MODE:-active}" in
    released)
      echo '{"ok":true,"schema_version":"task_lease_v0","active":false,"handoff_mode":"hard_lease","lease":{"status":"released","owner":"native-dispatch-agent","expires_at":"2099-01-01T00:00:00Z"}}'
      ;;
    expired)
      echo '{"ok":true,"schema_version":"task_lease_v0","active":false,"handoff_mode":"hard_lease","lease":{"status":"active","owner":"native-dispatch-agent","expires_at":"2000-01-01T00:00:00Z"}}'
      ;;
    other)
      echo '{"ok":true,"schema_version":"task_lease_v0","active":true,"handoff_mode":"hard_lease","lease":{"status":"active","owner":"other-agent","expires_at":"2099-01-01T00:00:00Z"}}'
      ;;
    *)
      echo '{"ok":true,"schema_version":"task_lease_v0","active":true,"handoff_mode":"hard_lease","lease":{"status":"active","owner":"native-dispatch-agent","expires_at":"2099-01-01T00:00:00Z"}}'
      ;;
  esac
  exit 0
fi

if [[ "$args" == *"todo list"* ]]; then
  echo "{\\"ok\\":true,\\"todo\\":{\\"todo_id\\":\\"\${todo}\\",\\"status\\":\\"\${MOCK_TODO_STATUS:-open}\\",\\"claimed_by\\":\\"native-dispatch-agent\\",\\"done\\":false}}"
  exit 0
fi

if [[ "$args" == *"todo complete"* ]]; then
  if [[ "\${MOCK_COMPLETE_FAIL:-}" == "1" ]]; then
    echo '{"ok":false,"schema_version":"loopx_coordination_todo_terminal_lifecycle_result_v0","error_code":"claim_execution_unavailable","status":"failed","changed":false,"recovery":{"action":"reconcile_lease_owner","execution_authority_granted":false}}'
    exit 1
  fi
  echo '{"ok":true,"schema_version":"loopx_coordination_todo_terminal_lifecycle_result_v0","completed":true,"status":"done","changed":true}'
  exit 0
fi

if [[ "$args" == *"issue-fix feasibility"* ]]; then
  if [[ "\${MOCK_FEASIBILITY_FAIL:-}" == "1" ]]; then
    echo "[Mock LoopX] feasibility engine error" >&2
    exit 1
  fi
  echo '{"decision": {"route": "fix_pr", "rationale": "bounded scope with confirmed reproduction"}}'
  exit 0
fi

if [[ "$args" == *"integration-branch"* ]]; then
  if [[ "\${MOCK_INTEGRATION_FAIL:-}" == "1" ]]; then
    echo "[Mock LoopX] integration sync conflict" >&2
    exit 1
  fi
  echo "[Mock LoopX] integration ok"
  exit 0
fi

echo "[Mock LoopX] $args"
exit 0
`, { mode: 0o755 });

  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'gh'), `#!/usr/bin/env bash
cmd="$1"
subcmd="\${2:-}"

if [[ "$cmd" == "repo" && "$subcmd" == "view" ]]; then
  echo '{"nameWithOwner": "JustinIanAI/loopx-workflow"}'
  exit 0
fi

if [[ "$cmd" == "issue" && "$subcmd" == "view" ]]; then
  echo '{"number": 123, "title": "Bug: gate flaky on reruns", "state": "OPEN"}'
  exit 0
fi

echo "Mock GH unhandled: $*"
exit 0
`, { mode: 0o755 });
}

function cleanupMocks() {
  fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  fs.rmSync(CALLS_LOG, { force: true });
  fs.rmSync(TEST_REGISTRY, { force: true });
  fs.rmSync(TEST_LOOPX_TMP, { recursive: true, force: true });
}

function runFlow(args, extraEnv = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
      LOOPX_AGENT_ID: '',
      LOOPX_REGISTRY: TEST_REGISTRY,
      LOOPX_TMP_DIR: TEST_LOOPX_TMP,
      ...extraEnv
    }
  });
}

function callsText() {
  return fs.existsSync(CALLS_LOG) ? fs.readFileSync(CALLS_LOG, 'utf8') : '';
}

function claimCachePath(goal, todo) {
  return path.join(TEST_LOOPX_TMP, 'claims', `${goal}--${todo}.json`);
}

test('1. Todo claim delegates to managed loopx todo claim and caches the five-tuple receipt', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goal = 'native-dispatch-deep-integration-goal';
    const todo = 'todo_ab12cd34ef56';
    const res = runFlow(['todo', 'claim', todo, '--goal-id', goal]);
    assert.strictEqual(res.status, 0, `claim must succeed: ${res.stderr}`);
    const calls = callsText();
    assert.match(calls, /todo claim --goal-id native-dispatch-deep-integration-goal --todo-id todo_ab12cd34ef56 --agent-id native-dispatch-agent --claimed-by native-dispatch-agent/);
    assert.doesNotMatch(calls, /task-lease acquire/);

    const cache = JSON.parse(fs.readFileSync(claimCachePath(goal, todo), 'utf8'));
    assert.strictEqual(cache.claim_operation_id, `todo-claim:${goal}:${todo}:mock`);
    assert.strictEqual(cache.goal_id, goal);
    assert.strictEqual(cache.todo_id, todo);
    assert.strictEqual(cache.agent_id, 'native-dispatch-agent');
    assert.strictEqual(cache.handoff_mode, 'hard_lease');
    assert.strictEqual(cache.registry_path, fs.realpathSync(TEST_REGISTRY));

    fs.rmSync(CALLS_LOG, { force: true });
    const blocked = runFlow(['todo', 'claim', todo, '--goal-id', goal], { MOCK_CLAIM_FAIL: '1' });
    assert.strictEqual(blocked.status, 1, 'claim must exit 1 when managed claim fails');
    assert.match(`${blocked.stderr}${blocked.stdout}`, /todo_lease_conflict/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);
  } finally {
    cleanupMocks();
  }
});

test('2. Todo done reuses the cached claim_operation_id and cleans the cache after managed complete', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goal = 'native-dispatch-deep-integration-goal';
    const todo = 'todo_ab12cd34ef56';
    assert.strictEqual(runFlow(['todo', 'claim', todo, '--goal-id', goal]).status, 0);
    fs.rmSync(CALLS_LOG, { force: true });

    const res = runFlow(['todo', 'done', todo, '--goal-id', goal, '--evidence', 'green']);
    assert.strictEqual(res.status, 0, `done must succeed: ${res.stderr}`);
    const calls = callsText();
    assert.match(calls, /todo complete --goal-id native-dispatch-deep-integration-goal --todo-id todo_ab12cd34ef56 --agent-id native-dispatch-agent --claim-operation-id todo-claim:native-dispatch-deep-integration-goal:todo_ab12cd34ef56:mock --evidence green/);
    assert.doesNotMatch(calls, /task-lease release/);
    assert.strictEqual(fs.existsSync(claimCachePath(goal, todo)), false, 'successful complete must clean the claim cache');
  } finally {
    cleanupMocks();
  }
});

test('3. Todo done auto-reclaims only when the lease is active and owned by the same agent', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goal = 'native-dispatch-deep-integration-goal';
    const todo = 'todo_ab12cd34ef56';
    assert.strictEqual(runFlow(['todo', 'claim', todo, '--goal-id', goal]).status, 0);
    fs.rmSync(claimCachePath(goal, todo), { force: true });
    fs.rmSync(CALLS_LOG, { force: true });

    const res = runFlow(['todo', 'done', todo, '--goal-id', goal]);
    assert.strictEqual(res.status, 0, res.stderr);
    const calls = callsText();
    assert.strictEqual((calls.match(/todo claim /g) || []).length, 1, 'must re-claim once');
    assert.strictEqual((calls.match(/todo complete /g) || []).length, 1, 'must complete once');
  } finally {
    cleanupMocks();
  }
});

test('4. Todo done fails closed with LoopX recovery when the lease is expired or owned by another agent', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goal = 'native-dispatch-deep-integration-goal';
    const todo = 'todo_ab12cd34ef56';
    for (const mode of ['expired', 'released', 'other']) {
      fs.rmSync(CALLS_LOG, { force: true });
      const res = runFlow(['todo', 'done', todo, '--goal-id', goal], { MOCK_LEASE_MODE: mode });
      assert.strictEqual(res.status, 1, `${mode} must fail closed`);
      const output = `${res.stdout}${res.stderr}`;
      assert.match(output, /recovery/);
      assert.match(output, /claim_task|reconcile_lease_owner/);
      assert.doesNotMatch(callsText(), /todo claim /, `${mode} must not silently re-claim`);
    }
  } finally {
    cleanupMocks();
  }
});

test('5. Issue feasibility routing: must consult loopx issue-fix feasibility and honor its route verdict', () => {
  cleanupMocks();
  setupMocks();
  try {
    const res = runFlow(['issue', '123', '--reproduction', 'confirmed', '--scope', 'bounded']);
    assert.strictEqual(res.status, 0, `issue must succeed: ${res.stderr}`);
    const calls = callsText();
    assert.strictEqual(calls.includes('issue-fix feasibility'), true, 'must invoke issue-fix feasibility');
    assert.strictEqual(calls.includes('--reproduction-status confirmed'), true, 'must pass reproduction observation');
    assert.strictEqual(calls.includes('--scope-class bounded'), true, 'must pass scope observation');
    assert.strictEqual(calls.includes('--issue-ref 123'), true, 'must pass issue ref');
    assert.strictEqual(res.stdout.includes('fix_pr'), true, `must honor feasibility route verdict, got: ${res.stdout}`);

    fs.rmSync(CALLS_LOG, { force: true });
    const blocked = runFlow(['issue', '123'], { MOCK_FEASIBILITY_FAIL: '1' });
    assert.strictEqual(blocked.status, 1, 'issue must exit 1 when feasibility fails');
    assert.match(`${blocked.stderr}${blocked.stdout}`, /可行性/);
  } finally {
    cleanupMocks();
  }
});

test('6. Integrate: preview by default, --execute only when explicit, --status passthrough', () => {
  cleanupMocks();
  setupMocks();
  try {
    const preview = runFlow(['integrate']);
    assert.strictEqual(preview.status, 0, `integrate preview must succeed: ${preview.stderr}`);
    let calls = callsText();
    assert.strictEqual(calls.includes('integration-branch sync'), true, 'must call integration-branch sync');
    assert.strictEqual(
      /(^|\s)--execute(\s|$)/.test(calls.split('integration-branch sync')[1] || ''),
      false,
      'preview must NOT pass --execute'
    );

    fs.rmSync(CALLS_LOG, { force: true });
    const exec = runFlow(['integrate', '--execute']);
    assert.strictEqual(exec.status, 0, `integrate --execute must succeed: ${exec.stderr}`);
    calls = callsText();
    assert.strictEqual(calls.includes('integration-branch sync'), true, 'must call integration-branch sync');
    assert.strictEqual(
      /(^|\s)--execute(\s|$)/.test(calls.split('integration-branch sync')[1] || ''),
      true,
      'explicit execute must pass --execute'
    );

    fs.rmSync(CALLS_LOG, { force: true });
    const status = runFlow(['integrate', '--status']);
    assert.strictEqual(status.status, 0, `integrate --status must succeed: ${status.stderr}`);
    calls = callsText();
    assert.strictEqual(calls.includes('integration-branch status'), true, 'must passthrough integration-branch status');
  } finally {
    cleanupMocks();
  }
});

test('7. Source invariants: todo claim/done never calls the low-level task-lease primitives', () => {
  const flowCode = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.doesNotMatch(flowCode, /loopx[^\n]*task-lease\s+(acquire|release|renew)/);
  assert.doesNotMatch(flowCode, /loopx-flow:claim:/);
  assert.doesNotMatch(flowCode, /loopx-flow:release:/);
  const claimDoneSection = flowCode.slice(flowCode.indexOf('cmd_todo_lease()'));
  assert.doesNotMatch(claimDoneSection, /run_loopx[^\n]*\|\| true/, 'todo claim/done must not swallow native failures');
});
