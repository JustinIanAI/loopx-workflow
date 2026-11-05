'use strict';
/**
 * Issue #7 regression: `loopx-flow feature` must never hand a non-authoritative
 * ACTIVE_STATE.md to `loopx bootstrap`, and must recover environments poisoned by
 * a stale state file left behind by the legacy pre-create behaviour.
 *
 * Root cause chain:
 *   L1 canonical_authority_required on `loopx-flow feature <new>`
 *   L2 loopx bootstrap treats an existing --state-file for a new goal as
 *      non-canonical (bootstrap.py: storage_target only generated when the
 *      state file does not yet exist)
 *   L3 legacy orchestrator pre-created the file before bootstrap; PR #22 removed
 *      the pre-create but did not clean/recover already-poisoned workspaces
 *   L4 orchestrator had no notion of "is this goal registered?" before deciding
 *      whether an existing state file is authoritative
 *   L7 spec gap: state-file creation authority belongs exclusively to LoopX
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const FEATURES_ROOT = path.join(PROJECT_ROOT, 'specs/features');

function uniqueFeature(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${process.pid}`;
}

function currentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).trim();
}

function makeSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue7-'));
}

// Mock loopx: mirrors the authority rule that broke issue #7 — a new goal whose
// --state-file already exists is rejected with canonical_authority_required.
function writeMockLoopx(sandbox, { allowExistingState = false } = {}) {
  const binDir = path.join(sandbox, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const rejectExisting = allowExistingState
    ? '    exit 0'
    : '    echo "loopx bootstrap failed: canonical_authority_required (existing state file is not managed or authoritative)" >&2\n    exit 1';
  const script = `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"bootstrap"* ]]; then
  state=""; prev=""
  for a in "$@"; do
    if [[ "$prev" == "--state-file" ]]; then state="$a"; fi
    prev="$a"
  done
  if [[ -n "$state" && -f "$state" ]]; then
${rejectExisting}
  fi
  if [[ -n "$state" ]]; then
    mkdir -p "$(dirname "$state")"
    printf '%s\\n' "---" "state_version: 1" "goal_id: mock-canonical-authority" "---" > "$state"
  fi
  exit 0
fi
if [[ "$args" == *"sync-global"* ]]; then exit 0; fi
exit 0
`;
  const loopxPath = path.join(binDir, 'loopx');
  fs.writeFileSync(loopxPath, script, { mode: 0o755 });
  return binDir;
}

function writeRegistry(sandbox, goals) {
  const registryPath = path.join(sandbox, 'registry.json');
  fs.writeFileSync(
    registryPath,
    JSON.stringify({ schema_version: '0.1', goals }, null, 2),
    'utf8'
  );
  return registryPath;
}

function runFlow(args, { binDir, registryPath } = {}) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      LOOPX_REGISTRY: registryPath,
    },
  });
}

function stateFile(feature) {
  return path.join(FEATURES_ROOT, feature, 'ACTIVE_STATE.md');
}

function staleBackups(feature) {
  const dir = path.join(FEATURES_ROOT, feature);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith('ACTIVE_STATE.md.stale-'));
}

function cleanup(feature, originalBranch, sandbox) {
  try {
    execSync(`git checkout ${originalBranch}`, { cwd: PROJECT_ROOT, stdio: 'ignore' });
  } catch (_) {}
  try {
    execSync(`git branch -D feature/${feature}`, { cwd: PROJECT_ROOT, stdio: 'ignore' });
  } catch (_) {}
  fs.rmSync(path.join(FEATURES_ROOT, feature), { recursive: true, force: true });
  fs.rmSync(sandbox, { recursive: true, force: true });
}

test('1. fresh feature lets loopx bootstrap own ACTIVE_STATE.md creation', () => {
  const feature = uniqueFeature('i7-fresh');
  const sandbox = makeSandbox();
  const originalBranch = currentBranch();
  try {
    const binDir = writeMockLoopx(sandbox);
    const registryPath = writeRegistry(sandbox, []);
    const result = runFlow(['feature', feature], { binDir, registryPath });

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(fs.existsSync(stateFile(feature)), 'bootstrap must create the canonical state file');
    assert.deepStrictEqual(staleBackups(feature), [], 'no stale quarantine should happen on a fresh feature');
    assert.match(fs.readFileSync(stateFile(feature), 'utf8'), /mock-canonical-authority/);
  } finally {
    cleanup(feature, originalBranch, sandbox);
  }
});

test('2. stale unregistered ACTIVE_STATE.md is quarantined before bootstrap (issue #7 repro)', () => {
  const feature = uniqueFeature('i7-stale');
  const sandbox = makeSandbox();
  const originalBranch = currentBranch();
  try {
    const binDir = writeMockLoopx(sandbox);
    const registryPath = writeRegistry(sandbox, []);
    const targetState = stateFile(feature);
    const legacyContent = '---\nstate_version: 0\ngoal_id: legacy-precreate\n---\n# leftover from failed bootstrap\n';
    fs.mkdirSync(path.dirname(targetState), { recursive: true });
    fs.writeFileSync(targetState, legacyContent, 'utf8');

    // Before the fix this run exits 1 with canonical_authority_required.
    const result = runFlow(['feature', feature], { binDir, registryPath });

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    const backups = staleBackups(feature);
    assert.strictEqual(backups.length, 1, 'legacy non-authoritative state must be quarantined once');
    assert.strictEqual(
      fs.readFileSync(path.join(FEATURES_ROOT, feature, backups[0]), 'utf8'),
      legacyContent,
      'quarantine must preserve the legacy content for human recovery'
    );
    assert.match(fs.readFileSync(targetState, 'utf8'), /mock-canonical-authority/);
    assert.match(result.stderr, /已隔离/);
  } finally {
    cleanup(feature, originalBranch, sandbox);
  }
});

test('3. registered goal state file is never quarantined', () => {
  const feature = uniqueFeature('i7-registered');
  const sandbox = makeSandbox();
  const originalBranch = currentBranch();
  try {
    const binDir = writeMockLoopx(sandbox, { allowExistingState: true });
    const registryPath = writeRegistry(sandbox, [{ id: `${feature}-goal` }]);
    const targetState = stateFile(feature);
    const authoritativeContent = '---\nstate_version: 1\ngoal_id: authoritative\n---\n';
    fs.mkdirSync(path.dirname(targetState), { recursive: true });
    fs.writeFileSync(targetState, authoritativeContent, 'utf8');

    const result = runFlow(['feature', feature], { binDir, registryPath });

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepStrictEqual(staleBackups(feature), [], 'registered goal state must be left untouched');
    assert.strictEqual(fs.readFileSync(targetState, 'utf8'), authoritativeContent);
  } finally {
    cleanup(feature, originalBranch, sandbox);
  }
});
