const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
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

function expectedKey(goalId, todoId, owner) {
  const hex = crypto.createHash('sha256').update(`${goalId}\n${todoId}\n${owner}`, 'utf8').digest('hex');
  return `loopx-flow:claim:${hex}`;
}

function generationKey(goalId, todoId, owner, epoch, version) {
  const hex = crypto.createHash('sha256')
    .update(`${goalId}\n${todoId}\n${owner}\n${epoch}\n${version}\nnext`, 'utf8')
    .digest('hex');
  return `loopx-flow:claim:${hex}`;
}

function setupMocks() {
  fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'loopx'), `#!/usr/bin/env bash
echo "$*" >> ${CALLS_LOG}
args="$*"

if [[ "$args" == *"agent-directory"* ]]; then
  mode="\${MOCK_AGENT_DIRECTORY:-one}"
  cursor=""
  if [[ "$args" == *"--cursor "* ]]; then
    cursor="\${args#*--cursor }"
    cursor="\${cursor%% *}"
  fi
  if [[ "$mode" == "none" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":0,"rows":[],"next_cursor":null}'
    exit 0
  fi
  if [[ "$mode" == "claimant-only" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":0,"rows":[{"agent_id":"old-claimant","registered":false}],"next_cursor":null}'
    exit 0
  fi
  if [[ "$mode" == "many" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":2,"rows":[{"agent_id":"alpha-agent","registered":true},{"agent_id":"beta-agent","registered":true}],"next_cursor":null}'
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
    printf '%s\\n' '{"ok":true,"registered_agent_count":2,"rows":[{"agent_id":"old-claimant","registered":false}],"next_cursor":null,"omitted_row_count":2}'
    exit 0
  fi
  if [[ "$mode" == "paged-one" || "$mode" == "paged-env" || "$mode" == "paged-many" ]]; then
    if [[ -z "$cursor" ]]; then
      if [[ "$mode" == "paged-one" ]]; then
        printf '%s\\n' '{"ok":true,"registered_agent_count":1,"rows":[{"agent_id":"old-claimant","registered":false},{"agent_id":"diag-holder","registered":false}],"next_cursor":"diag-holder","omitted_row_count":1}'
      else
        printf '%s\\n' '{"ok":true,"registered_agent_count":2,"rows":[{"agent_id":"alpha-agent","registered":true},{"agent_id":"old-claimant","registered":false}],"next_cursor":"old-claimant","omitted_row_count":1}'
      fi
      exit 0
    fi
    if [[ "$cursor" == "diag-holder" ]]; then
      printf '%s\\n' '{"ok":true,"registered_agent_count":1,"rows":[{"agent_id":"later-agent","registered":true}],"next_cursor":null}'
      exit 0
    fi
    if [[ "$cursor" == "old-claimant" ]]; then
      printf '%s\\n' '{"ok":true,"registered_agent_count":2,"rows":[{"agent_id":"later-agent","registered":true}],"next_cursor":null}'
      exit 0
    fi
    printf '%s\\n' '{"ok":false,"error_code":"bad_cursor"}'
    exit 1
  fi
  if [[ "$mode" == "paged-cycle" ]]; then
    printf '%s\\n' '{"ok":true,"registered_agent_count":2,"rows":[{"agent_id":"old-claimant","registered":false}],"next_cursor":"stuck-cursor"}'
    exit 0
  fi
  owner="\${MOCK_REGISTERED_AGENT:-sandbox-analysis-agent}"
  printf '{"ok":true,"registered_agent_count":1,"rows":[{"agent_id":"%s","registered":true},{"agent_id":"old-claimant","registered":false}],"next_cursor":null}\\n' "$owner"
  exit 0
fi

if [[ "$args" == *"task-lease inspect"* ]]; then
  if [[ "\${MOCK_LEASE_INSPECT_FAIL:-}" == "1" ]]; then
    echo '{"ok":false,"error_code":"task_lease_inspection_unavailable","error":"inspect failed"}' >&2
    exit 1
  fi
  if [[ -n "\${MOCK_LEASE_FILE:-}" ]]; then
    cat "\${MOCK_LEASE_FILE}"
    exit 0
  fi
  printf '%s\\n' '{"ok":true,"action":"inspect","active":false,"lease":null}'
  exit 0
fi

if [[ "$args" == *"task-lease acquire"* ]]; then
  case "\${MOCK_TASK_LEASE_FAIL:-}" in
    1)
      echo "task-lease arguments requires --owner, --idempotency-key" >&2
      exit 1
      ;;
    reuse)
      echo '{"ok":false,"error_code":"idempotency_key_reuse","error":"acquire receipt belongs to a retired execution"}' >&2
      exit 1
      ;;
    conflict)
      echo '{"ok":false,"error_code":"todo_lease_conflict","error":"todo lease is held"}' >&2
      exit 1
      ;;
  esac
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
      LOOPX_REGISTRY: REGISTRY_FILE,
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
    assert.ok(firstCalls.includes('task-lease inspect'), `must inspect before acquire, got: ${firstCalls}`);
    assert.ok(firstCalls.indexOf('task-lease inspect') < firstCalls.indexOf('task-lease acquire'), firstCalls);
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
      assert.match(output, /--agent-id <registered-agent-id>/);
      assert.doesNotMatch(output, /\\<registered-agent-id\\>/);
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
    assert.doesNotMatch(`${blocked.stderr}${blocked.stdout}`, /可能已被其他 Agent 持有/);
  } finally {
    cleanupMocks();
  }
});

function writeLease(lease) {
  const file = path.join(MOCK_BIN_DIR, 'lease.json');
  fs.writeFileSync(file, JSON.stringify({ ok: true, action: 'inspect', active: false, lease }));
  return file;
}

test('issue 12: an active lease for the same owner replays that generation key', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goalId = 'native-goal';
    const todoId = 'todo_ab12cd34ef56';
    const owner = 'sandbox-analysis-agent';
    const liveKey = 'loopx-flow:claim:already-live';
    const leaseFile = writeLease({
      schema_version: 'task_lease_v0',
      status: 'active',
      owner,
      idempotency_key: liveKey,
      lease_epoch: 2,
      version: 4,
      expires_at: '2099-01-01T00:00:00Z'
    });
    const res = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId],
      { MOCK_LEASE_FILE: leaseFile }
    );
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(flag(acquireLine(callsText()), '--idempotency-key'), liveKey);
    assert.notStrictEqual(flag(acquireLine(callsText()), '--idempotency-key'), expectedKey(goalId, todoId, owner));
  } finally {
    cleanupMocks();
  }
});

test('issue 12: expired and released leases claim with a new generation key', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goalId = 'native-goal';
    const todoId = 'todo_ab12cd34ef56';
    const owner = 'sandbox-analysis-agent';
    const retired = expectedKey(goalId, todoId, owner);
    const expiredFile = writeLease({
      schema_version: 'task_lease_v0',
      status: 'active',
      owner,
      idempotency_key: retired,
      lease_epoch: 2,
      version: 4,
      expires_at: '2000-01-01T00:00:00Z'
    });
    const expired = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId],
      { MOCK_LEASE_FILE: expiredFile }
    );
    assert.strictEqual(expired.status, 0, expired.stderr);
    const expiredKey = flag(acquireLine(callsText()), '--idempotency-key');
    assert.strictEqual(expiredKey, generationKey(goalId, todoId, owner, 2, 4), expiredKey);
    assert.notStrictEqual(expiredKey, retired);

    fs.rmSync(CALLS_LOG, { force: true });
    const expiredAgain = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId],
      { MOCK_LEASE_FILE: expiredFile }
    );
    assert.strictEqual(expiredAgain.status, 0, expiredAgain.stderr);
    assert.strictEqual(flag(acquireLine(callsText()), '--idempotency-key'), expiredKey, 'same retired generation retries the same next key');

    fs.rmSync(CALLS_LOG, { force: true });
    const releasedFile = writeLease({
      schema_version: 'task_lease_v0',
      status: 'released',
      owner,
      idempotency_key: retired,
      lease_epoch: 3,
      version: 5,
      expires_at: '2099-01-01T00:00:00Z'
    });
    const released = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId],
      { MOCK_LEASE_FILE: releasedFile }
    );
    assert.strictEqual(released.status, 0, released.stderr);
    const releasedKey = flag(acquireLine(callsText()), '--idempotency-key');
    assert.strictEqual(releasedKey, generationKey(goalId, todoId, owner, 3, 5), releasedKey);
    assert.notStrictEqual(releasedKey, retired);
    assert.notStrictEqual(releasedKey, expiredKey);
  } finally {
    cleanupMocks();
  }
});

test('issue 12: explicit idempotency key is passed through and reuse errors stay specific', () => {
  cleanupMocks();
  setupMocks();
  try {
    const goalId = 'native-goal';
    const todoId = 'todo_ab12cd34ef56';
    const supplied = 'loopx-flow:claim:caller-supplied';
    const releasedFile = writeLease({
      schema_version: 'task_lease_v0',
      status: 'released',
      owner: 'sandbox-analysis-agent',
      idempotency_key: 'loopx-flow:claim:retired',
      lease_epoch: 3,
      version: 5,
      expires_at: '2099-01-01T00:00:00Z'
    });
    const passed = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId, '--idempotency-key', supplied],
      { MOCK_LEASE_FILE: releasedFile }
    );
    assert.strictEqual(passed.status, 0, passed.stderr);
    const calls = callsText();
    assert.strictEqual(flag(acquireLine(calls), '--idempotency-key'), supplied);
    assert.doesNotMatch(calls, /task-lease inspect/);

    fs.rmSync(CALLS_LOG, { force: true });
    const invalid = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId, '--idempotency-key', 'not a key'],
      {}
    );
    assert.strictEqual(invalid.status, 1, invalid.stderr);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const reuse = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId],
      { MOCK_TASK_LEASE_FAIL: 'reuse' }
    );
    const reuseOut = `${reuse.stderr}${reuse.stdout}`;
    assert.strictEqual(reuse.status, 1, reuseOut);
    assert.match(reuseOut, /idempotency_key_reuse/);
    assert.doesNotMatch(reuseOut, /可能已被其他 Agent 持有/);

    fs.rmSync(CALLS_LOG, { force: true });
    const conflict = runFlow(
      ['todo', 'claim', todoId, '--goal-id', goalId],
      { MOCK_TASK_LEASE_FAIL: 'conflict' }
    );
    const conflictOut = `${conflict.stderr}${conflict.stdout}`;
    assert.strictEqual(conflict.status, 1, conflictOut);
    assert.match(conflictOut, /todo_lease_conflict/);
    assert.match(conflictOut, /可能已被其他 Agent 持有/);
  } finally {
    cleanupMocks();
  }
});

test('issue 12: agent-directory follows next_cursor before owner verdicts', () => {
  cleanupMocks();
  setupMocks();
  try {
    const later = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'],
      { MOCK_AGENT_DIRECTORY: 'paged-one' }
    );
    const laterOut = `${later.stderr}${later.stdout}`;
    assert.strictEqual(later.status, 0, laterOut);
    assert.strictEqual(flag(acquireLine(callsText()), '--owner'), 'later-agent');
    assert.match(callsText(), /--cursor diag-holder/);
    assert.doesNotMatch(laterOut, /多个已注册/);
    assert.doesNotMatch(laterOut, /尚未注册/);

    fs.rmSync(CALLS_LOG, { force: true });
    const selected = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'],
      { MOCK_AGENT_DIRECTORY: 'paged-env', LOOPX_AGENT_ID: 'later-agent' }
    );
    assert.strictEqual(selected.status, 0, selected.stderr);
    assert.strictEqual(flag(acquireLine(callsText()), '--owner'), 'later-agent');
    assert.doesNotMatch(`${selected.stderr}${selected.stdout}`, /尚未在 Goal/);

    fs.rmSync(CALLS_LOG, { force: true });
    const ambiguous = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'],
      { MOCK_AGENT_DIRECTORY: 'paged-many' }
    );
    const ambiguousOut = `${ambiguous.stderr}${ambiguous.stdout}`;
    assert.strictEqual(ambiguous.status, 1, ambiguousOut);
    assert.match(ambiguousOut, /alpha-agent/);
    assert.match(ambiguousOut, /later-agent/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const diagnostics = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'],
      { MOCK_AGENT_DIRECTORY: 'truncated-no-cursor' }
    );
    const diagnosticsOut = `${diagnostics.stderr}${diagnostics.stdout}`;
    assert.strictEqual(diagnostics.status, 1, diagnosticsOut);
    assert.doesNotMatch(diagnosticsOut, /多个已注册/);
    assert.doesNotMatch(diagnosticsOut, /--agent-id <registered-agent-id>/);
    assert.match(diagnosticsOut, /registered_agent_count/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const cycle = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'paged-goal'],
      { MOCK_AGENT_DIRECTORY: 'paged-cycle' }
    );
    const cycleOut = `${cycle.stderr}${cycle.stdout}`;
    assert.strictEqual(cycle.status, 1, cycleOut);
    assert.match(cycleOut, /游标重复/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);

    fs.rmSync(CALLS_LOG, { force: true });
    const spaced = runFlow(
      ['todo', 'claim', 'todo_ab12cd34ef56', '--goal-id', 'multi-goal'],
      { MOCK_AGENT_DIRECTORY: 'many', LOOPX_AGENT_ID: 'missing agent' }
    );
    const spacedOut = `${spaced.stderr}${spaced.stdout}`;
    assert.strictEqual(spaced.status, 1, spacedOut);
    assert.match(spacedOut, /当前 Agent 身份 missing agent 尚未/);
    assert.match(spacedOut, /--agent-id (?:missing\\ agent|'missing agent'|\$'missing agent')/);
    assert.doesNotMatch(spacedOut, /--agent-id missing --execute/);
    assert.doesNotMatch(callsText(), /task-lease acquire/);
  } finally {
    cleanupMocks();
  }
});
