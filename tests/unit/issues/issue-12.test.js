const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = path.join(PROJECT_ROOT, '.tmp-mock-bin-issue-12');
const CALLS_LOG = path.join(MOCK_BIN_DIR, 'calls.log');

function expectedKey(goalId, todoId, owner) {
  const hex = crypto.createHash('sha256').update(`${goalId}\n${todoId}\n${owner}`, 'utf8').digest('hex');
  return `loopx-flow:claim:${hex}`;
}

function setupMocks() {
  fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'loopx'), `#!/usr/bin/env bash
echo "$*" >> ${CALLS_LOG}
args="$*"

if [[ "$args" == *"agent-directory"* ]]; then
  mode="\${MOCK_AGENT_DIRECTORY:-one}"
  if [[ "$mode" == "none" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":0,"rows":[]}'
    exit 0
  fi
  if [[ "$mode" == "claimant-only" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":0,"rows":[{"agent_id":"old-claimant","registered":false}]}'
    exit 0
  fi
  if [[ "$mode" == "many" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":2,"rows":[{"agent_id":"alpha-agent","registered":true},{"agent_id":"beta-agent","registered":true}]}'
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
  owner="\${MOCK_REGISTERED_AGENT:-sandbox-analysis-agent}"
  printf '{"ok":true,"registered_agent_count":1,"rows":[{"agent_id":"%s","registered":true},{"agent_id":"old-claimant","registered":false}]}\\n' "$owner"
  exit 0
fi

if [[ "$args" == *"task-lease acquire"* ]]; then
  if [[ "\${MOCK_TASK_LEASE_FAIL:-}" == "1" ]]; then
    echo "task-lease arguments requires --owner, --idempotency-key" >&2
    exit 1
  fi
  echo "[Mock LoopX] lease acquired"
  exit 0
fi

echo "[Mock LoopX] $args"
exit 0
`, { mode: 0o755 });
}

function cleanupMocks() {
  fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
}

function runFlow(args, extraEnv = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
      LOOPX_AGENT_ID: '',
      ...extraEnv
    }
  });
}

function callsText() {
  return fs.existsSync(CALLS_LOG) ? fs.readFileSync(CALLS_LOG, 'utf8') : '';
}

function acquireLine(calls) {
  return calls.split('\n').find(line => line.includes('task-lease acquire')) || '';
}

function flag(line, name) {
  const matched = line.match(new RegExp(`${name} (\\S+)`));
  return matched ? matched[1] : '';
}

test('issue 12: todo claim passes the registered owner and a stable idempotency key', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goalId = '国标信息维护-goal';
    const todoId = 'todo_5592c127df1e84dbd49b679c';
    const first = runFlow(['todo', 'claim', todoId, '--goal-id', goalId]);
    assert.strictEqual(first.status, 0, `claim must succeed: ${first.stderr}`);
    const firstCalls = callsText();
    const firstAcquire = acquireLine(firstCalls);
    assert.ok(firstCalls.includes(`agent-directory --goal-id ${goalId}`), `must read agent-directory, got: ${firstCalls}`);
    assert.strictEqual(flag(firstAcquire, '--owner'), 'sandbox-analysis-agent', firstAcquire);
    assert.strictEqual(flag(firstAcquire, '--idempotency-key'), expectedKey(goalId, todoId, 'sandbox-analysis-agent'), firstAcquire);
    assert.strictEqual(firstAcquire.includes('--todo-id ' + todoId), true, firstAcquire);
    assert.strictEqual(firstAcquire.includes('old-claimant'), false, 'unregistered claimant must not become owner');

    fs.rmSync(CALLS_LOG, { force: true });
    const second = runFlow(['todo', 'claim', todoId, '--goal-id', goalId]);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(
      flag(acquireLine(callsText()), '--idempotency-key'),
      expectedKey(goalId, todoId, 'sandbox-analysis-agent'),
      'retry must reuse the same public-safe key'
    );

    fs.rmSync(CALLS_LOG, { force: true });
    const other = runFlow(['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', goalId]);
    assert.strictEqual(other.status, 0, other.stderr);
    assert.notStrictEqual(
      flag(acquireLine(callsText()), '--idempotency-key'),
      expectedKey(goalId, todoId, 'sandbox-analysis-agent'),
      'a different todo must not reuse the key'
    );
  } finally {
    cleanupMocks();
  }
});

test('issue 12: LOOPX_AGENT_ID selects among registered agents', () => {
  cleanupMocks();
  setupMocks();
  try {
    const res = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'],
      { MOCK_AGENT_DIRECTORY: 'many', LOOPX_AGENT_ID: 'beta-agent' }
    );
    assert.strictEqual(res.status, 0, res.stderr);
    const line = acquireLine(callsText());
    assert.strictEqual(flag(line, '--owner'), 'beta-agent', line);
    assert.strictEqual(flag(line, '--idempotency-key'), expectedKey('multi-goal', 'todo_ab12cd34ef56', 'beta-agent'), line);

    fs.rmSync(CALLS_LOG, { force: true });
    const folded = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'],
      { MOCK_AGENT_DIRECTORY: 'many', LOOPX_AGENT_ID: 'Beta-Agent' }
    );
    assert.strictEqual(folded.status, 0, folded.stderr);
    assert.strictEqual(flag(acquireLine(callsText()), '--owner'), 'beta-agent', 'folded env id must use the registered spelling');
  } finally {
    cleanupMocks();
  }
});

test('issue 12: missing registered agent fails closed with an executable register-agent repair', () => {
  cleanupMocks();
  setupMocks();
  try {
    for (const mode of ['none', 'claimant-only']) {
      fs.rmSync(CALLS_LOG, { force: true });
      const blocked = runFlow(
        ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'empty-goal'],
        { MOCK_AGENT_DIRECTORY: mode }
      );
      const output = `${blocked.stderr}${blocked.stdout}`;
      assert.strictEqual(blocked.status, 1, `${mode} must exit 1, got: ${output}`);
      assert.match(output, /FAIL-CLOSED/);
      assert.match(output, /register-agent/);
      assert.match(output, /--goal-id/);
      assert.match(output, /empty-goal/);
      assert.match(output, /--agent-id/);
      assert.match(output, /--execute/);
      assert.doesNotMatch(callsText(), /task-lease acquire/, `${mode} must not acquire`);
      assert.doesNotMatch(output, /task-lease arguments requires/);
      assert.doesNotMatch(output, /owner_not_registered/);
    }
  } finally {
    cleanupMocks();
  }
});

test('issue 12: ambiguous or unregistered current identity fails closed before acquire', () => {
  cleanupMocks();
  setupMocks();
  try {
    const ambiguous = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'],
      { MOCK_AGENT_DIRECTORY: 'many' }
    );
    const ambiguousOut = `${ambiguous.stderr}${ambiguous.stdout}`;
    assert.strictEqual(ambiguous.status, 1, ambiguousOut);
    assert.match(ambiguousOut, /FAIL-CLOSED/);
    assert.match(ambiguousOut, /alpha-agent/);
    assert.match(ambiguousOut, /beta-agent/);
    assert.match(ambiguousOut, /LOOPX_AGENT_ID/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const unregistered = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'],
      { MOCK_AGENT_DIRECTORY: 'many', LOOPX_AGENT_ID: 'missing-agent' }
    );
    const unregisteredOut = `${unregistered.stderr}${unregistered.stdout}`;
    assert.strictEqual(unregistered.status, 1, unregisteredOut);
    assert.match(unregisteredOut, /register-agent/);
    assert.match(unregisteredOut, /missing-agent/);
    assert.match(unregisteredOut, /--execute/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const missingGoal = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'absent-goal'],
      { MOCK_AGENT_DIRECTORY: 'goal-missing' }
    );
    assert.strictEqual(missingGoal.status, 1, missingGoal.stderr);
    assert.match(`${missingGoal.stderr}${missingGoal.stdout}`, /FAIL-CLOSED/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const broken = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'broken-goal'],
      { MOCK_AGENT_DIRECTORY: 'broken' }
    );
    assert.strictEqual(broken.status, 1, broken.stderr);
    assert.match(`${broken.stderr}${broken.stdout}`, /FAIL-CLOSED/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);
  } finally {
    cleanupMocks();
  }
});

test('issue 12: lease rejection after a valid identity still fails closed', () => {
  cleanupMocks();
  setupMocks();
  try {
    const blocked = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'native-goal'],
      { MOCK_TASK_LEASE_FAIL: '1' }
    );
    assert.strictEqual(blocked.status, 1, blocked.stderr);
    assert.match(`${blocked.stderr}${blocked.stdout}`, /租约/);
    const line = acquireLine(callsText());
    assert.strictEqual(flag(line, '--owner'), 'sandbox-analysis-agent', line);
    assert.ok(flag(line, '--idempotency-key').startsWith('loopx-flow:claim:'), line);
  } finally {
    cleanupMocks();
  }
});
