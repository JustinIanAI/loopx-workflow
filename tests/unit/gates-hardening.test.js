const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

test('1. Hardened Gate Assets: scripts and tsconfig must exist and be executable', () => {
  const tsconfig = path.join(PROJECT_ROOT, 'tsconfig.json');
  assert.strictEqual(fs.existsSync(tsconfig), true, 'tsconfig.json must exist');

  const gateLint = path.join(PROJECT_ROOT, 'scripts/gate-lint.sh');
  assert.strictEqual(fs.existsSync(gateLint), true, 'scripts/gate-lint.sh must exist');
  const lintStat = fs.statSync(gateLint);
  assert.strictEqual(Boolean(lintStat.mode & 0o111), true, 'scripts/gate-lint.sh must be executable');

  const gateBuild = path.join(PROJECT_ROOT, 'scripts/gate-build.sh');
  assert.strictEqual(fs.existsSync(gateBuild), true, 'scripts/gate-build.sh must exist');
  const buildStat = fs.statSync(gateBuild);
  assert.strictEqual(Boolean(buildStat.mode & 0o111), true, 'scripts/gate-build.sh must be executable');
});

test('2. Real Typecheck Gate: package.json script must invoke tsc with --noEmit', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(
    pkg.scripts.typecheck.includes('tsc'),
    true,
    'npm run typecheck must invoke tsc'
  );
  assert.strictEqual(
    pkg.scripts.typecheck.includes('--noEmit'),
    true,
    'npm run typecheck must specify --noEmit'
  );
});

test('3. Real Lint Gate: gate-lint.sh must execute cleanly and intercept syntax errors', () => {
  const gateLint = path.join(PROJECT_ROOT, 'scripts/gate-lint.sh');
  // Positive run
  const resPass = spawnSync(gateLint, [], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });
  assert.strictEqual(resPass.status, 0, `gate-lint.sh must pass on valid project files: ${resPass.stderr}`);
  assert.strictEqual(resPass.stdout.includes('Lint verification passed'), true);

  // Negative run: test temporary broken script
  const tmpBrokenScript = path.join(PROJECT_ROOT, 'scripts/.tmp-broken-lint-test.sh');
  try {
    fs.writeFileSync(tmpBrokenScript, '#!/bin/bash\nif [ a == b then\n', { mode: 0o755 });
    const resFail = spawnSync(gateLint, [], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    assert.strictEqual(resFail.status, 1, 'gate-lint.sh must fail when broken shell script is detected');
  } finally {
    if (fs.existsSync(tmpBrokenScript)) fs.unlinkSync(tmpBrokenScript);
  }
});

test('4. Real Build Gate: gate-build.sh must verify bin entrypoint and executable permissions', () => {
  const gateBuild = path.join(PROJECT_ROOT, 'scripts/gate-build.sh');
  const res = spawnSync(gateBuild, [], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 0, `gate-build.sh must pass: ${res.stderr}`);
  assert.strictEqual(res.stdout.includes('Build verification passed'), true);
});
