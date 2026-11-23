const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const LOOPX_BIN = process.env.LOOPX_BIN || 'loopx';
const probe = spawnSync(LOOPX_BIN, ['--version'], { encoding: 'utf8' });
const LOOPX_AVAILABLE = probe.status === 0 && /^loopx\s+2\.3\.\d+/.test(`${probe.stdout}${probe.stderr}`.trim());
const SKIP = LOOPX_AVAILABLE ? false : 'real loopx 2.3.x CLI not available (set LOOPX_BIN or PATH)';

const sandboxes = [];
after(() => {
  for (const dir of sandboxes) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function loopxEnv() {
  return { ...process.env, LOOPX_USAGE_PING: '0' };
}

function runLoopx(args, sandbox) {
  return spawnSync(LOOPX_BIN, ['--format', 'json', '--registry', sandbox.registry, '--runtime-root', sandbox.runtime, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: loopxEnv()
  });
}

function runFlow(args, sandbox, extraEnv = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...loopxEnv(),
      LOOPX_REGISTRY: sandbox.registry,
      LOOPX_TMP_DIR: sandbox.tmp,
      LOOPX_AGENT_ID: 'agent-a',
      ...extraEnv
    }
  });
}

function makeSandbox({ soft = false, agents = ['agent-a'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-managed-canary-'));
  sandboxes.push(dir);
  const project = path.join(dir, 'project');
  const runtime = path.join(dir, 'runtime');
  fs.mkdirSync(project, { recursive: true });
  if (soft) {
    fs.mkdirSync(path.join(runtime, 'machine'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'machine', 'configuration.json'), JSON.stringify({
      schema_version: 'loopx_machine_configuration_v0',
      namespaces: {
        goal_storage: {
          schema_version: 'loopx_goal_storage_defaults_v1',
          new_goal_provider: 'sqlite',
          canonical_creation: true,
          new_goal_handoff_mode: 'soft_claim'
        }
      }
    }, null, 2) + '\n');
  }
  const sandbox = {
    dir,
    project,
    runtime,
    registry: path.join(dir, 'registry.json'),
    tmp: path.join(dir, 'loopx-tmp'),
    goal: soft ? 'soft-canary-goal' : 'hard-canary-goal'
  };
  fs.mkdirSync(sandbox.tmp, { recursive: true });
  const bootstrap = runLoopx([
    'bootstrap', '--project', project, '--goal-id', sandbox.goal,
    '--objective', 'managed todo canary', '--state-file', '.loopx/state.md'
  ], sandbox);
  assert.strictEqual(bootstrap.status, 0, `bootstrap failed: ${bootstrap.stdout}\n${bootstrap.stderr}`);
  for (const agent of agents) {
    const registered = runLoopx(['register-agent', '--goal-id', sandbox.goal, '--agent-id', agent, '--execute'], sandbox);
    assert.strictEqual(registered.status, 0, `register-agent failed: ${registered.stdout}\n${registered.stderr}`);
  }
  return sandbox;
}

function addTodo(sandbox, text, claimedBy = 'agent-a') {
  const args = ['todo', 'add', '--goal-id', sandbox.goal, '--role', 'agent', '--text', text];
  if (claimedBy) args.push('--claimed-by', claimedBy);
  const added = runLoopx(args, sandbox);
  assert.strictEqual(added.status, 0, `todo add failed: ${added.stdout}\n${added.stderr}`);
  const listed = runLoopx(['todo', 'list', '--goal-id', sandbox.goal, '--role', 'agent'], sandbox);
  assert.strictEqual(listed.status, 0, `todo list failed: ${listed.stdout}\n${listed.stderr}`);
  const payload = extractJson(listed.stdout);
  const todo = payload.todos.find((item) => item.text.includes(text));
  assert.ok(todo, `todo ${text} not found: ${listed.stdout}`);
  return todo.todo_id;
}

function readTodo(sandbox, todoId) {
  const listed = runLoopx(['todo', 'list', '--goal-id', sandbox.goal, '--todo-id', todoId], sandbox);
  assert.strictEqual(listed.status, 0, listed.stdout + listed.stderr);
  return extractJson(listed.stdout).todo;
}

function cachePath(sandbox, todoId) {
  return path.join(sandbox.tmp, 'claims', `${sandbox.goal}--${todoId}.json`);
}

test('managed execution: hard_lease claim caches the five-tuple receipt and done releases atomically', { skip: SKIP }, () => {
  const sb = makeSandbox();
  const todoId = addTodo(sb, 'hard lease canary');
  const claimed = runFlow(['todo', 'claim', todoId, '--goal-id', sb.goal], sb);
  assert.strictEqual(claimed.status, 0, claimed.stdout + claimed.stderr);
  const claimPayload = extractJson(claimed.stdout);
  assert.strictEqual(claimPayload.ok, true);
  assert.strictEqual(claimPayload.execution_managed, true);
  assert.strictEqual(claimPayload.handoff_mode, 'hard_lease');

  const cache = JSON.parse(fs.readFileSync(cachePath(sb, todoId), 'utf8'));
  assert.strictEqual(cache.claim_operation_id, claimPayload.claim_operation_id);
  assert.strictEqual(cache.goal_id, sb.goal);
  assert.strictEqual(cache.todo_id, todoId);
  assert.strictEqual(cache.agent_id, 'agent-a');
  assert.strictEqual(cache.handoff_mode, 'hard_lease');
  assert.strictEqual(cache.registry_path, fs.realpathSync(sb.registry));

  const done = runFlow(['todo', 'done', todoId, '--goal-id', sb.goal, '--evidence', 'canary ok'], sb);
  assert.strictEqual(done.status, 0, done.stdout + done.stderr);
  const donePayload = extractJson(done.stdout);
  assert.strictEqual(donePayload.ok, true);
  assert.strictEqual(donePayload.completed, true);
  assert.strictEqual(donePayload.status, 'done');
  assert.strictEqual(fs.existsSync(cachePath(sb, todoId)), false, 'successful done must remove the cache');
  assert.strictEqual(readTodo(sb, todoId).status, 'done');
  assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, '.loopx', 'registry.json')), false, 'main repo registry must stay untouched');
});

test('managed execution: soft_claim works through the same managed claim/complete delegation', { skip: SKIP }, () => {
  const sb = makeSandbox({ soft: true });
  const todoId = addTodo(sb, 'soft claim canary');
  const claimed = runFlow(['todo', 'claim', todoId, '--goal-id', sb.goal], sb);
  assert.strictEqual(claimed.status, 0, claimed.stdout + claimed.stderr);
  const claimPayload = extractJson(claimed.stdout);
  assert.strictEqual(claimPayload.handoff_mode, 'soft_claim');
  assert.strictEqual(JSON.parse(fs.readFileSync(cachePath(sb, todoId), 'utf8')).handoff_mode, 'soft_claim');

  const done = runFlow(['todo', 'done', todoId, '--goal-id', sb.goal], sb);
  assert.strictEqual(done.status, 0, done.stdout + done.stderr);
  assert.strictEqual(extractJson(done.stdout).status, 'done');
  assert.strictEqual(fs.existsSync(cachePath(sb, todoId)), false);
});

test('Q1 split A: missing cache auto-reclaims only for an active same-owner lease', { skip: SKIP }, () => {
  const sb = makeSandbox();
  const todoId = addTodo(sb, 'reclaim receipt canary');
  assert.strictEqual(runFlow(['todo', 'claim', todoId, '--goal-id', sb.goal], sb).status, 0);
  fs.rmSync(cachePath(sb, todoId));
  const done = runFlow(['todo', 'done', todoId, '--goal-id', sb.goal], sb);
  assert.strictEqual(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stderr, /自动补领/);
  assert.strictEqual(readTodo(sb, todoId).status, 'done');
});

test('Q1 split B: expired, released, other-owner and deferred states fail closed with recovery', { skip: SKIP }, () => {
  const expiredSb = makeSandbox();
  const expiredTodo = addTodo(expiredSb, 'expired canary');
  const acquired = runLoopx([
    'task-lease', 'acquire', '--goal-id', expiredSb.goal, '--todo-id', expiredTodo,
    '--owner', 'agent-a', '--idempotency-key', 'canary-expired', '--ttl-seconds', '1'
  ], expiredSb);
  assert.strictEqual(acquired.status, 0, acquired.stdout + acquired.stderr);
  spawnSync('sleep', ['1.2']);
  const expired = runFlow(['todo', 'done', expiredTodo, '--goal-id', expiredSb.goal], expiredSb);
  assert.strictEqual(expired.status, 1);
  const expiredPayload = extractJson(expired.stdout);
  assert.strictEqual(expiredPayload.error_code, 'lease_expired');
  assert.strictEqual(expiredPayload.recovery.action, 'claim_task');
  assert.strictEqual(readTodo(expiredSb, expiredTodo).status, 'open', 'expired path must not mutate the todo');

  const releasedSb = makeSandbox();
  const releasedTodo = addTodo(releasedSb, 'released canary');
  assert.strictEqual(runFlow(['todo', 'claim', releasedTodo, '--goal-id', releasedSb.goal], releasedSb).status, 0);
  const inspect = extractJson(runLoopx(['task-lease', 'inspect', '--goal-id', releasedSb.goal, '--todo-id', releasedTodo], releasedSb).stdout).lease;
  const released = runLoopx([
    'task-lease', 'release', '--goal-id', releasedSb.goal, '--todo-id', releasedTodo,
    '--owner', inspect.owner, '--idempotency-key', inspect.idempotency_key,
    '--expected-version', String(inspect.version)
  ], releasedSb);
  assert.strictEqual(released.status, 0, released.stdout + released.stderr);
  fs.rmSync(cachePath(releasedSb, releasedTodo));
  const releasedDone = runFlow(['todo', 'done', releasedTodo, '--goal-id', releasedSb.goal], releasedSb);
  assert.strictEqual(releasedDone.status, 1);
  assert.strictEqual(extractJson(releasedDone.stdout).error_code, 'lease_released');

  const otherSb = makeSandbox({ agents: ['agent-a', 'agent-b'] });
  const otherTodo = addTodo(otherSb, 'other owner canary', 'agent-b');
  const otherClaim = runLoopx([
    'todo', 'claim', '--goal-id', otherSb.goal, '--todo-id', otherTodo,
    '--agent-id', 'agent-b', '--claimed-by', 'agent-b'
  ], otherSb);
  assert.strictEqual(otherClaim.status, 0, otherClaim.stdout + otherClaim.stderr);
  const otherDone = runFlow(['todo', 'done', otherTodo, '--goal-id', otherSb.goal], otherSb);
  assert.strictEqual(otherDone.status, 1);
  const otherPayload = extractJson(otherDone.stdout);
  assert.strictEqual(otherPayload.error_code, 'owner_conflicts_with_claim');
  assert.strictEqual(otherPayload.recovery.action, 'reconcile_lease_owner');

  const deferredSb = makeSandbox({ soft: true });
  const deferredTodo = addTodo(deferredSb, 'deferred canary', null);
  const deferredUpdate = runLoopx([
    'todo', 'update', '--goal-id', deferredSb.goal, '--todo-id', deferredTodo,
    '--status', 'deferred', '--resume-when', 'capacity_available:model', '--agent-id', 'agent-a'
  ], deferredSb);
  assert.strictEqual(deferredUpdate.status, 0, deferredUpdate.stdout + deferredUpdate.stderr);
  const deferred = runFlow(['todo', 'done', deferredTodo, '--goal-id', deferredSb.goal], deferredSb);
  assert.strictEqual(deferred.status, 1);
  const deferredPayload = extractJson(deferred.stdout);
  assert.strictEqual(deferredPayload.error_code, 'todo_not_open');
  assert.strictEqual(deferredPayload.recovery.action, 'reopen_todo');
});

test('T4 five-tuple guard: tampered or corrupt cache is never reused directly', { skip: SKIP }, () => {
  const sb = makeSandbox();
  const tamperedTodo = addTodo(sb, 'tampered cache canary');
  assert.strictEqual(runFlow(['todo', 'claim', tamperedTodo, '--goal-id', sb.goal], sb).status, 0);
  const tampered = JSON.parse(fs.readFileSync(cachePath(sb, tamperedTodo), 'utf8'));
  tampered.goal_id = 'some-other-goal';
  fs.writeFileSync(cachePath(sb, tamperedTodo), JSON.stringify(tampered, null, 2) + '\n');
  const tamperedDone = runFlow(['todo', 'done', tamperedTodo, '--goal-id', sb.goal], sb);
  assert.strictEqual(tamperedDone.status, 0, tamperedDone.stdout + tamperedDone.stderr);
  assert.match(tamperedDone.stderr, /自动补领/);
  assert.strictEqual(readTodo(sb, tamperedTodo).status, 'done');

  const corruptTodo = addTodo(sb, 'corrupt cache canary');
  assert.strictEqual(runFlow(['todo', 'claim', corruptTodo, '--goal-id', sb.goal], sb).status, 0);
  fs.writeFileSync(cachePath(sb, corruptTodo), '{not json');
  const corruptDone = runFlow(['todo', 'done', corruptTodo, '--goal-id', sb.goal], sb);
  assert.strictEqual(corruptDone.status, 0, corruptDone.stdout + corruptDone.stderr);
  assert.match(corruptDone.stderr, /自动补领/);

  const registryTodo = addTodo(sb, 'registry cache canary');
  assert.strictEqual(runFlow(['todo', 'claim', registryTodo, '--goal-id', sb.goal], sb).status, 0);
  const registryCache = JSON.parse(fs.readFileSync(cachePath(sb, registryTodo), 'utf8'));
  registryCache.registry_path = path.join(sb.dir, 'other-registry.json');
  fs.writeFileSync(cachePath(sb, registryTodo), JSON.stringify(registryCache, null, 2) + '\n');
  const registryDone = runFlow(['todo', 'done', registryTodo, '--goal-id', sb.goal], sb);
  assert.strictEqual(registryDone.status, 0, registryDone.stdout + registryDone.stderr);
  assert.match(registryDone.stderr, /自动补领/);
});

test('canary leaves the main repo and host registry clean', { skip: SKIP }, () => {
  assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, '.loopx', 'registry.json')), false);
  assert.strictEqual(fs.existsSync(path.join(os.homedir(), '.loopx', 'registry.json')), false);
});
