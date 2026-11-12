'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withoutRepoConfig } = require('./helpers/repo-isolation');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN = path.join(PROJECT_ROOT, '.tmp-mock-bin-merge-comp');
const CALLS = path.join(MOCK_BIN, 'calls.log');

function setupMocks() {
  fs.rmSync(MOCK_BIN, { recursive: true, force: true });
  fs.mkdirSync(MOCK_BIN, { recursive: true });
  fs.writeFileSync(path.join(MOCK_BIN, 'gh'), `#!/usr/bin/env bash
echo "gh $*" >> "\${CALLS}"
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ "$*" == *"state,mergedAt,reviewDecision"* ]]; then
    printf '%s\n' "\${PR_STATE:-OPEN}%\${PR_MERGED_AT:-}%\${PR_DECISION:-APPROVED}%\${PR_HEAD:-abc123}%\${PR_HEAD_REF:-feature/merge-comp-test}%\${PR_BASE:-main}"
    exit 0
  fi
  if [[ "$*" == *"--jq .headRefOid"* ]]; then echo "\${PR_HEAD:-abc123}"; exit 0; fi
  if [[ "$*" == *"--jq .headRefName"* ]]; then echo "\${PR_HEAD_REF:-feature/merge-comp-test}"; exit 0; fi
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then echo "[Mock] merged"; exit 0; fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(MOCK_BIN, 'loopx'), `#!/usr/bin/env bash
echo "loopx $*" >> "\${CALLS}"
args="$*"
if [[ "$args" == *"goal-lifecycle"* ]]; then
  if [[ "\${MOCK_STOP_FAIL:-}" == "1" ]]; then echo "stop failed boom" >&2; exit 1; fi
  if [[ "\${MOCK_STOP_ALREADY:-}" == "1" ]]; then echo "goal id not found in registry" >&2; exit 1; fi
  exit 0
fi
if [[ "$args" == *"retire-global-goal"* ]]; then
  if [[ "\${MOCK_RETIRE_FAIL:-}" == "1" ]]; then echo "retire failed boom" >&2; exit 1; fi
  echo "refusing to retire goal(s) with a live source_registry or state_file" >&2; exit 1
fi
if [[ "$args" == *"sync-global"* ]]; then
  if [[ "\${MOCK_SYNC_FAIL:-}" == "1" ]]; then echo "sync failed boom" >&2; exit 1; fi
  exit 0
fi
exit 0
`, { mode: 0o755 });
}

function cleanup(feature) {
  fs.rmSync(path.join(PROJECT_ROOT, 'specs/features', feature), { recursive: true, force: true });
  fs.rmSync(path.join(PROJECT_ROOT, 'specs/archive', feature), { recursive: true, force: true });
  fs.rmSync(MOCK_BIN, { recursive: true, force: true });
}

function runMerge(pr, feature, envExtra = {}) {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN}:${process.env.PATH}`,
    CALLS,
    LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1',
    ...envExtra,
  };
  return spawnSync(LOOPX_FLOW, ['merge', String(pr), feature], { cwd: PROJECT_ROOT, env, encoding: 'utf8', timeout: 60000 });
}

function makeFeature(feature) {
  const d = path.join(PROJECT_ROOT, 'specs/features', feature);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '00-INDEX.md'), '# test capsule\n');
}

test('1. already MERGED: skip merge/readiness, compensate stop/retire/sync/archive', () => {
  const feature = 'merge-comp-test-a';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = runMerge(501, feature, { PR_STATE: 'MERGED', PR_MERGED_AT: '2026-11-04T00:00:00Z' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(CALLS, 'utf8');
    assert.doesNotMatch(calls, /pr merge/);
    assert.doesNotMatch(calls, /check-merge-readiness/);
    assert.match(calls, /goal-lifecycle/);
    assert.match(calls, /retire-global-goal/);
    assert.match(calls, /sync-global/);
    assert.match(r.stdout, /已处于 MERGED/);
    assert.match(r.stdout, /闭环完成/);
    assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, 'specs/archive', feature)), true);
  } finally { cleanup(feature); }
});

test('2. OPEN + APPROVED: normal merge then archive', () => {
  const feature = 'merge-comp-test-b';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = withoutRepoConfig(() => runMerge(502, feature, { PR_STATE: 'OPEN', PR_DECISION: 'APPROVED' }));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(CALLS, 'utf8');
    assert.match(calls, /pr merge/);
    assert.match(calls, /check-merge-readiness/);
    assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, 'specs/archive', feature)), true);
  } finally { cleanup(feature); }
});

test('3. sync-global failure: nonzero, no archive, explicit not-closed message', () => {
  const feature = 'merge-comp-test-c';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = runMerge(503, feature, { PR_STATE: 'MERGED', MOCK_SYNC_FAIL: '1' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /未闭环/);
    assert.match(r.stdout, /sync: failed/);
    assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, 'specs/features', feature)), true);
  } finally { cleanup(feature); }
});

test('4. stop already executed: treated as skipped and merge still succeeds', () => {
  const feature = 'merge-comp-test-d';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = runMerge(504, feature, { PR_STATE: 'MERGED', MOCK_STOP_ALREADY: '1' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /stop: skipped/);
    assert.match(r.stdout, /retire: skipped/);
  } finally { cleanup(feature); }
});

test('5. retire refused by live source registry: skipped, merge succeeds', () => {
  const feature = 'merge-comp-test-e';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = runMerge(505, feature, { PR_STATE: 'MERGED' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /retire: skipped/);
    assert.match(r.stdout, /闭环完成/);
  } finally { cleanup(feature); }
});

test('6. stop real failure: nonzero, no archive', () => {
  const feature = 'merge-comp-test-f';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = runMerge(506, feature, { PR_STATE: 'MERGED', MOCK_STOP_FAIL: '1' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /stop: failed/);
    assert.match(r.stdout + r.stderr, /未闭环/);
    assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, 'specs/features', feature)), true);
  } finally { cleanup(feature); }
});

test('7. OPEN without APPROVED: fail before merge', () => {
  const feature = 'merge-comp-test-g';
  cleanup(feature); setupMocks(); makeFeature(feature);
  try {
    const r = withoutRepoConfig(() => runMerge(507, feature, { PR_STATE: 'OPEN', PR_DECISION: 'CHANGES_REQUESTED' }));
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /尚未在 GitHub 获得人类 APPROVED/);
    const calls = fs.readFileSync(CALLS, 'utf8');
    assert.doesNotMatch(calls, /pr merge/);
  } finally { cleanup(feature); }
});
