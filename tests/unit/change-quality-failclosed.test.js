const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INGEST_SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');

test('1. Fail-Closed on Blocker: ingest-to-loopx-quality must exit 1 when defects are present', () => {
  const tmpReviewJson = '/tmp/test-blocker-review.json';
  try {
    fs.writeFileSync(tmpReviewJson, JSON.stringify({
      defects: [
        {
          lens: 'security',
          severity: 'blocker',
          summary: 'Injected fatal blocker defect for testing',
          file: 'bin/loopx-flow',
          line: 10
        }
      ]
    }));

    const res = spawnSync(process.execPath, [
      INGEST_SCRIPT,
      '--review-json', tmpReviewJson,
      '--feature', 'change-quality-failclosed'
    ], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });

    assert.strictEqual(res.status, 1, 'Script must exit with code 1 when blocker defect is present');
    assert.strictEqual(res.stderr.includes('[BLOCKED]') || res.stdout.includes('[BLOCKED]'), true);
  } finally {
    if (fs.existsSync(tmpReviewJson)) fs.unlinkSync(tmpReviewJson);
  }
});

test('2. Diff SHA256 Binding: 05-evidence.md must contain exact diff fingerprint', () => {
  const tmpFeature = `cq-isolated-${Date.now()}`;
  const tmpFeatureDir = path.join(PROJECT_ROOT, 'specs/features', tmpFeature);
  fs.mkdirSync(tmpFeatureDir, { recursive: true });
  const evidenceFile = path.join(tmpFeatureDir, '05-evidence.md');

  // ingest 不重跑四门禁：必须提供 check 落盘的全绿 gate-results（含真实退出码 0）。
  const tmpGateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-gate-results-'));
  const gateResultsFile = path.join(tmpGateDir, 'gate-results.json');
  fs.writeFileSync(gateResultsFile, JSON.stringify({
    schema_version: 'loopx_flow_gate_results_v0',
    gates: [
      { name: 'typecheck', command: 'npm run typecheck', exit_code: 0, status: 'passed' },
      { name: 'lint', command: 'npm run lint', exit_code: 0, status: 'passed' },
      { name: 'build', command: 'npm run build', exit_code: 0, status: 'passed' },
      { name: 'test', command: 'npm run test', exit_code: 0, status: 'passed' }
    ]
  }));

  // Isolate from host loopx daemon / network using mock binary in temporary PATH
  const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-loopx-bin-'));
  const mockLoopx = path.join(tmpBin, 'loopx');
  fs.writeFileSync(mockLoopx, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const env = {
    ...process.env,
    PATH: `${tmpBin}:${process.env.PATH || ''}`
  };

  try {
    const res = spawnSync(process.execPath, [
      INGEST_SCRIPT,
      '--feature', tmpFeature,
      '--gate-results', gateResultsFile
    ], {
      cwd: PROJECT_ROOT,
      env,
      encoding: 'utf8'
    });

    if (res.status !== 0) {
      console.error('Test 2 failed stdout:', res.stdout);
      console.error('Test 2 failed stderr:', res.stderr);
    }
    assert.strictEqual(res.status, 0, `Clean ingest must exit 0: ${res.stderr}`);

    assert.strictEqual(fs.existsSync(evidenceFile), true, '05-evidence.md must exist in feature capsule');
    const text = fs.readFileSync(evidenceFile, 'utf8');
    assert.strictEqual(text.includes('Diff SHA256'), true, 'Evidence must record exact Diff SHA256');
    assert.strictEqual(text.includes('PASSING'), true);
    assert.strictEqual(text.includes('Gate Results Source'), true, 'Evidence must name gate-results source');
    assert.strictEqual(text.includes('loopx_flow_gate_results_v0'), true, 'Evidence source must be the stable schema id');
    assert.strictEqual(text.includes(gateResultsFile), false, 'Evidence must not embed the host temp path');
  } finally {
    fs.rmSync(tmpFeatureDir, { recursive: true, force: true });
    fs.rmSync(tmpBin, { recursive: true, force: true });
    fs.rmSync(tmpGateDir, { recursive: true, force: true });
  }
});

test('3. LoopX-Flow Check Fail-Closed: loopx-flow check must propagate non-zero exit codes', () => {
  // Read bin/loopx-flow to ensure no '|| true' exists on change-quality verify
  const flowScript = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.strictEqual(
    flowScript.includes('loopx change-quality verify --goal-id "${feature}-goal" --repo-path . || true'),
    false,
    'loopx-flow check must not use || true on change-quality verify'
  );
});
