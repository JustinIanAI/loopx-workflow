const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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
  const res = spawnSync(process.execPath, [
    INGEST_SCRIPT,
    '--feature', 'change-quality-failclosed'
  ], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });

  if (res.status !== 0) {
    console.error('Test 2 failed stdout:', res.stdout);
    console.error('Test 2 failed stderr:', res.stderr);
  }
  assert.strictEqual(res.status, 0, `Clean ingest must exit 0: ${res.stderr}`);

  const evidenceFile = path.join(PROJECT_ROOT, 'specs/features/change-quality-failclosed/05-evidence.md');
  assert.strictEqual(fs.existsSync(evidenceFile), true, '05-evidence.md must exist');
  const content = fs.readFileSync(evidenceFile, 'utf8');
  assert.strictEqual(content.includes('Diff SHA256'), true, 'Evidence must record exact Diff SHA256');
  assert.strictEqual(content.includes('PASSING'), true);
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
