'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const INGEST = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const MOCK_BIN = path.join(PROJECT_ROOT, '.tmp-mock-bin-fc');

function resetMock() {
  fs.rmSync(MOCK_BIN, { recursive: true, force: true });
  fs.mkdirSync(MOCK_BIN, { recursive: true });
}

function writeScript(name, content) {
  const p = path.join(MOCK_BIN, name);
  fs.writeFileSync(p, content, { mode: 0o755 });
  return p;
}

function runFlow(args, envExtra = {}, cwd = PROJECT_ROOT) {
  return spawnSync(LOOPX_FLOW, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, PATH: `${MOCK_BIN}:${process.env.PATH}`, ...envExtra },
  });
}

function makeCapsule(feature) {
  const dir = path.join(PROJECT_ROOT, 'specs/features', feature);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '04-contract.md'), '# Contract\n\n- **Contract-Status**: DRAFT (Pending Approval)\n');
  fs.writeFileSync(path.join(dir, '01-decisions.md'), '# Decisions\n\n- **Status**: PROPOSED\n');
  fs.writeFileSync(path.join(dir, '00-INDEX.md'), '# Index\n\n- **Current Status**: `Proposed`\n- **Contract Status**: `DRAFT`\n');
  return dir;
}

function cleanupCapsule(feature) {
  fs.rmSync(path.join(PROJECT_ROOT, 'specs/features', feature), { recursive: true, force: true });
  fs.rmSync(MOCK_BIN, { recursive: true, force: true });
}

test('1. feature does not pre-create ACTIVE_STATE.md before bootstrap (#17)', () => {
  const feature = 'fc-boot-test';
  const originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
  resetMock();
  writeScript('loopx', `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"bootstrap"* ]]; then
  state=""; prev=""
  for a in "$@"; do
    if [[ "$prev" == "--state-file" ]]; then state="$a"; fi
    prev="$a"
  done
  if [[ -n "$state" && -f "$state" ]]; then
    echo "canonical_authority_required: state_file existed before bootstrap" >&2
    exit 1
  fi
  if [[ -n "$state" ]]; then mkdir -p "$(dirname "$state")"; echo "# state" > "$state"; fi
  exit 0
fi
if [[ "$args" == *"sync-global"* ]]; then exit 0; fi
exit 0
`);
  try {
    const r = runFlow(['feature', feature]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(fs.existsSync(path.join(PROJECT_ROOT, 'specs/features', feature, 'ACTIVE_STATE.md')), true);
  } finally {
    try { execSync(`git checkout ${originalBranch}`, { cwd: PROJECT_ROOT, stdio: 'ignore' }); } catch (_) {}
    try { execSync(`git branch -D feature/${feature}`, { cwd: PROJECT_ROOT, stdio: 'ignore' }); } catch (_) {}
    cleanupCapsule(feature);
  }
});

test('2. approve without loopx exits 1 and leaves contract unchanged', () => {
  const feature = 'fc-approve-noloopx';
  makeCapsule(feature);
  const contract = path.join(PROJECT_ROOT, 'specs/features', feature, '04-contract.md');
  const before = fs.readFileSync(contract, 'utf8');
  const onlyNode = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-node-'));
  try {
    fs.symlinkSync(process.execPath, path.join(onlyNode, 'node'));
    const r = spawnSync(LOOPX_FLOW, ['approve', 'contract', feature], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${onlyNode}:/usr/bin:/bin:/usr/sbin:/sbin` },
    });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /未检测到 loopx/);
    assert.strictEqual(fs.readFileSync(contract, 'utf8'), before);
  } finally {
    fs.rmSync(onlyNode, { recursive: true, force: true });
    cleanupCapsule(feature);
  }
});

test('3. approve configure-goal failure rolls back approval marker', () => {
  const feature = 'fc-approve-fail';
  makeCapsule(feature);
  resetMock();
  writeScript('loopx', `#!/usr/bin/env bash
if [[ "$*" == *"configure-goal"* ]]; then echo "configure boom" >&2; exit 1; fi
if [[ "$*" == *"sync-global"* ]]; then exit 0; fi
exit 0
`);
  const contract = path.join(PROJECT_ROOT, 'specs/features', feature, '04-contract.md');
  const before = fs.readFileSync(contract, 'utf8');
  try {
    const r = runFlow(['approve', 'contract', feature]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.strictEqual(fs.readFileSync(contract, 'utf8'), before);
    assert.doesNotMatch(fs.readFileSync(contract, 'utf8'), /FROZEN & APPROVED/);
  } finally { cleanupCapsule(feature); }
});

test('4. ingest without feature or goal exits 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-ingest-'));
  try {
    const r = spawnSync(process.execPath, [INGEST], { cwd: tmp, encoding: 'utf8', env: { ...process.env } });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /无法解析 feature|no feature|BLOCKED/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('5. check without feature/goal exits 1 before gates', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-check-'));
  try {
    resetMock();
    writeScript('loopx', '#!/usr/bin/env bash\nexit 0\n');
    const r = runFlow(['check'], {}, tmp);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /无法解析 Goal 身份|--goal-id/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); cleanupCapsule('unused'); }
});

test('6. sync-global failure after successful lock keeps the locked approval', () => {
  const feature = 'fc-approve-syncfail';
  makeCapsule(feature);
  resetMock();
  writeScript('loopx', `#!/usr/bin/env bash
if [[ "$*" == *"configure-goal"* ]]; then exit 0; fi
if [[ "$*" == *"sync-global"* ]]; then echo "sync boom" >&2; exit 1; fi
exit 0
`);
  try {
    const r = runFlow(['approve', 'contract', feature]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /契约已锁定成功/);
    assert.match(fs.readFileSync(path.join(PROJECT_ROOT, 'specs/features', feature, '04-contract.md'), 'utf8'), /FROZEN & APPROVED/);
  } finally { cleanupCapsule(feature); }
});

test('7. approve passes --registry to configure-goal', () => {
  const feature = 'fc-approve-registry';
  makeCapsule(feature);
  resetMock();
  const calls = path.join(MOCK_BIN, 'calls.log');
  writeScript('loopx', '#!/usr/bin/env bash\necho "$*" >> ' + JSON.stringify(calls) + '\nexit 0\n');
  try {
    const r = runFlow(['approve', 'contract', feature]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const log = fs.readFileSync(calls, 'utf8');
    assert.match(log, /--registry .*configure-goal/);
  } finally { cleanupCapsule(feature); }
});

test('8. approve feature name cannot inject shell through cleanup trap', () => {
  const feature = "fc-trap'inject; touch /tmp/loopx-pwn; '";
  const payload = '/tmp/loopx-pwn';
  try { fs.unlinkSync(payload); } catch (_) {}
  makeCapsule(feature);
  resetMock();
  writeScript('loopx', '#!/usr/bin/env bash\nexit 0\n');
  try {
    const r = runFlow(['approve', 'contract', feature]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(fs.existsSync(payload), false, 'trap must not execute injected shell');
  } finally {
    cleanupCapsule(feature);
    try { fs.unlinkSync(payload); } catch (_) {}
  }
});
