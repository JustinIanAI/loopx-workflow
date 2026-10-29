const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = path.join(PROJECT_ROOT, '.tmp-mock-bin-dispatch');
const CALLS_LOG = '/tmp/native-dispatch-mock-calls.log';

function setupMocks() {
  if (!fs.existsSync(MOCK_BIN_DIR)) {
    fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  }

  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'loopx'), `#!/usr/bin/env bash
echo "$*" >> ${CALLS_LOG}
args="$*"

if [[ "$args" == *"task-lease acquire"* ]]; then
  if [[ "\${MOCK_TASK_LEASE_FAIL:-}" == "1" ]]; then
    echo "[Mock LoopX] lease conflict: held by another agent" >&2
    exit 1
  fi
  echo "[Mock LoopX] lease acquired"
  exit 0
fi

if [[ "$args" == *"task-lease release"* ]]; then
  echo "[Mock LoopX] lease released"
  exit 0
fi

if [[ "$args" == *"issue-fix feasibility"* ]]; then
  if [[ "\${MOCK_FEASIBILITY_FAIL:-}" == "1" ]]; then
    echo "[Mock LoopX] feasibility engine error" >&2
    exit 1
  fi
  echo '{"route": "fix_pr", "rationale": "bounded scope with confirmed reproduction"}'
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
  echo '{"nameWithOwner": "JustinIan-AI/loopx-workflow"}'
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
  if (fs.existsSync(MOCK_BIN_DIR)) {
    fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(CALLS_LOG)) {
    fs.unlinkSync(CALLS_LOG);
  }
}

function runFlow(args, extraEnv = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
      ...extraEnv
    }
  });
}

test('1. Todo lease claim: must acquire exclusive lease via task-lease acquire and fail closed on conflict', () => {
  cleanupMocks();
  setupMocks();

  try {
    const res = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'native-dispatch-deep-integration-goal']);
    assert.strictEqual(res.status, 0, `claim must succeed: ${res.stderr}`);
    const calls = fs.readFileSync(CALLS_LOG, 'utf8');
    assert.strictEqual(
      calls.includes('task-lease acquire --goal-id native-dispatch-deep-integration-goal --todo-id todo_ab12cd34ef56'),
      true,
      `must call task-lease acquire with goal-id and todo-id, got: ${calls}`
    );

    // Negative: lease conflict must fail closed with exit 1
    fs.unlinkSync(CALLS_LOG);
    const blocked = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'native-dispatch-deep-integration-goal'], { MOCK_TASK_LEASE_FAIL: '1' });
    assert.strictEqual(blocked.status, 1, 'claim must exit 1 when lease acquire fails');
    assert.strictEqual(
      `${blocked.stderr}${blocked.stdout}`.includes('租约'),
      true,
      'claim must print explicit lease fail-closed message'
    );
  } finally {
    cleanupMocks();
  }
});

test('2. Todo lease done: must complete todo then release the lease', () => {
  cleanupMocks();
  setupMocks();

  try {
    const res = runFlow(['todo', 'done', 'todo_ab12cd34ef56', '--goal-id', 'native-dispatch-deep-integration-goal']);
    assert.strictEqual(res.status, 0, `done must succeed: ${res.stderr}`);
    const calls = fs.readFileSync(CALLS_LOG, 'utf8').trim().split('\n');
    const completeCall = calls.find(c => c.includes('--status done'));
    const releaseCall = calls.find(c => c.includes('task-lease release'));
    assert.ok(completeCall, `must call todo --status done, got: ${calls.join(' | ')}`);
    assert.ok(releaseCall, `must call task-lease release, got: ${calls.join(' | ')}`);
    assert.strictEqual(completeCall.includes('--todo-id todo_ab12cd34ef56'), true, 'complete must target the todo');
    assert.strictEqual(releaseCall.includes('--todo-id todo_ab12cd34ef56'), true, 'release must target the todo');
  } finally {
    cleanupMocks();
  }
});

test('3. Issue feasibility routing: must consult loopx issue-fix feasibility and honor its route verdict', () => {
  cleanupMocks();
  setupMocks();

  try {
    const res = runFlow(['issue', '123', '--reproduction', 'confirmed', '--scope', 'bounded']);
    assert.strictEqual(res.status, 0, `issue must succeed: ${res.stderr}`);
    const calls = fs.readFileSync(CALLS_LOG, 'utf8');
    assert.strictEqual(calls.includes('issue-fix feasibility'), true, 'must invoke issue-fix feasibility');
    assert.strictEqual(calls.includes('--reproduction-status confirmed'), true, 'must pass reproduction observation');
    assert.strictEqual(calls.includes('--scope-class bounded'), true, 'must pass scope observation');
    assert.strictEqual(calls.includes('--issue-ref 123'), true, 'must pass issue ref');
    assert.strictEqual(res.stdout.includes('fix_pr'), true, `must honor feasibility route verdict, got: ${res.stdout}`);

    // Negative: feasibility failure must fail closed
    fs.unlinkSync(CALLS_LOG);
    const blocked = runFlow(['issue', '123'], { MOCK_FEASIBILITY_FAIL: '1' });
    assert.strictEqual(blocked.status, 1, 'issue must exit 1 when feasibility fails');
    assert.strictEqual(
      `${blocked.stderr}${blocked.stdout}`.includes('可行性'),
      true,
      'issue must print explicit feasibility fail-closed message'
    );
  } finally {
    cleanupMocks();
  }
});

test('4. Integrate: preview by default, --execute only when explicit, --status passthrough', () => {
  cleanupMocks();
  setupMocks();

  try {
    const preview = runFlow(['integrate']);
    assert.strictEqual(preview.status, 0, `integrate preview must succeed: ${preview.stderr}`);
    let calls = fs.readFileSync(CALLS_LOG, 'utf8');
    assert.strictEqual(calls.includes('integration-branch sync'), true, 'must call integration-branch sync');
    assert.strictEqual(
      /(^|\s)--execute(\s|$)/.test(calls.split('integration-branch sync')[1] || ''),
      false,
      'preview must NOT pass --execute'
    );

    fs.unlinkSync(CALLS_LOG);
    const exec = runFlow(['integrate', '--execute']);
    assert.strictEqual(exec.status, 0, `integrate --execute must succeed: ${exec.stderr}`);
    calls = fs.readFileSync(CALLS_LOG, 'utf8');
    assert.strictEqual(calls.includes('integration-branch sync'), true, 'must call integration-branch sync');
    assert.strictEqual(
      /(^|\s)--execute(\s|$)/.test(calls.split('integration-branch sync')[1] || ''),
      true,
      'explicit execute must pass --execute'
    );

    fs.unlinkSync(CALLS_LOG);
    const status = runFlow(['integrate', '--status']);
    assert.strictEqual(status.status, 0, `integrate --status must succeed: ${status.stderr}`);
    calls = fs.readFileSync(CALLS_LOG, 'utf8');
    assert.strictEqual(calls.includes('integration-branch status'), true, 'must passthrough integration-branch status');
  } finally {
    cleanupMocks();
  }
});

test('5. Source invariants: no silent escape on lease/feasibility/integration native calls', () => {
  const flowCode = fs.readFileSync(LOOPX_FLOW, 'utf8');
  // claim/done/issue/integrate paths must not swallow native failures with || true
  const claimDoneSection = flowCode.slice(flowCode.indexOf('cmd_todo()'));
  const issueSection = flowCode.slice(flowCode.indexOf('cmd_issue()'));
  const integrateSection = flowCode.slice(flowCode.indexOf('cmd_integrate()'));
  for (const [name, section] of [['cmd_todo', claimDoneSection], ['cmd_issue', issueSection], ['cmd_integrate', integrateSection]]) {
    assert.strictEqual(
      /loopx [^|]*\|\| true/.test(section.split('\n\n')[0] || section),
      false,
      `${name} native dispatch must not use "|| true" escape hatch`
    );
  }
});
