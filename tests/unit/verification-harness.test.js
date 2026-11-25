'use strict';
/**
 * W5 / Issue #43 — skills/verification-harness (Pstack R0 reuse + cli-surface Prove)
 *
 * Verifies:
 *   1. Upstream Pstack R0 (`cursor/plugins@fbb86c09bbb4a25e490aaed136899ced1e9140e4`,
 *      `pstack@0.15.46`, MIT License) files exist verbatim with exact SHA-256 digests,
 *      MIT attribution, and zero leftover sparse-clone cache.
 *   2. Skill structure: `SKILL.md`, `references/loopx-adaptation.md`,
 *      `features/README.md`, `features/cli-surface.md`, and executable
 *      `scripts/prove-cli-surface.js` conform to Pstack 5-dimension model
 *      (`Surface/Run/Drive/Observe/Isolate`), 4-H2 Feature Map contract,
 *      `Doc Drift / Harness Gap / Product Bug` triage, and ADR-0011 boundaries.
 *   3. Cold-start Prove execution: running `prove-cli-surface.js` against an
 *      isolated Proof output path succeeds, destroys all temporary sandboxes,
 *      keeps Proof artifacts intact after cleanup, and leaves main repo / host
 *      `~/.loopx` completely untouched.
 *   4. Negative fail-closed behavior: missing `--output-dir`, unknown arguments,
 *      `--output-dir` inside the disposable sandbox, and a dirty source workspace
 *      all exit non-zero without leaving sandbox residue.
 *   5. Proof binding (ADR-0011 decision 5): `source_head` / `source_dirty` /
 *      `diff_fingerprint` / `contract_revision` are present, and `overall_status`
 *      is derived from steps (missing `loopx 2.3.x` can never report `passed`).
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const HARNESS_DIR = path.join(PROJECT_ROOT, 'skills/verification-harness');
const PROVE_SCRIPT = path.join(HARNESS_DIR, 'scripts/prove-cli-surface.js');

const UPSTREAM_EXPECTED_SHA256 = {
  'LICENSE': 'bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e',
  'upstream/pstack-r0/create-verification-skill/SKILL.md': 'd353973547bf8ad8977eca645f4cd4feaed0d32f4b43d1448f906b0a76c4d694',
  'upstream/pstack-r0/create-verification-skill/references/feature-map-example/README.md': 'cb7bd782cf89968a4ba3d58a5151db837430db92d19a6f52a906973b77b516ba',
  'upstream/pstack-r0/create-verification-skill/references/feature-map-example/create-note.md': '644a44c74f35d38c2feb7cd05a0121fdebbb623e8dc376c185b565a581d1ccf7',
  'upstream/pstack-r0/create-verification-skill/references/feature-map-example/search.md': '6e87b9e7f2791a7776ba1bb83f371cd285c306c67f19d245cc4dd6ca3015c823',
  'upstream/pstack-r0/maintain-verification-skill/SKILL.md': '515c0eaa054b3f6be1b1fb06f2c2f173c80fddb58bbcac57576f89c479bc68e8',
  'upstream/pstack-r0/principle-prove-it-works/SKILL.md': '3d6c482e341974cfcb8d19ebf66fb1d4274d8673af35e36d3c231a6aa9e03f25',
};

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileDigestOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256File(filePath);
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function makeScratch(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(root, args) {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

// Copy the harness source into a disposable Git repo so dirty-workspace
// fail-closed behavior can be driven black-box without dirtying PROJECT_ROOT.
function prepareSourceCopy(scratchRoot) {
  const root = path.join(scratchRoot, 'source-repo');
  fs.mkdirSync(root, { recursive: true });
  for (const dir of ['bin', 'lib', 'scripts', 'skills', 'specs']) {
    fs.cpSync(path.join(PROJECT_ROOT, dir), path.join(root, dir), { recursive: true });
  }
  for (const file of ['package.json', '.gitignore']) {
    fs.copyFileSync(path.join(PROJECT_ROOT, file), path.join(root, file));
  }
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'prove-test@example.com']);
  git(root, ['config', 'user.name', 'prove-test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'chore: source copy baseline']);
  return root;
}

test('1. Upstream pstack@0.15.46 R0 files & MIT LICENSE match verbatim SHA-256 with zero git/cache residue', () => {
  for (const [rel, expectedSha] of Object.entries(UPSTREAM_EXPECTED_SHA256)) {
    const abs = path.join(HARNESS_DIR, rel);
    assert.strictEqual(fs.existsSync(abs), true, `Missing upstream file: skills/verification-harness/${rel}`);
    assert.strictEqual(sha256File(abs), expectedSha, `Upstream R0 file modified from verbatim pstack@0.15.46: ${rel}`);
  }

  const licenseText = fs.readFileSync(path.join(HARNESS_DIR, 'LICENSE'), 'utf8');
  assert.match(licenseText, /MIT License/);
  assert.match(licenseText, /Copyright \(c\) 2026 Lauren Tan/);

  // Ensure no nested .git or sparse-checkout clone residue inside skills/verification-harness
  const nestedGit = path.join(HARNESS_DIR, '.git');
  const upstreamGit = path.join(HARNESS_DIR, 'upstream/.git');
  assert.strictEqual(fs.existsSync(nestedGit), false, 'Nested .git must not exist in skills/verification-harness');
  assert.strictEqual(fs.existsSync(upstreamGit), false, 'Nested .git must not exist in upstream/');
});

test('2. SKILL.md, loopx-adaptation.md & Feature Map enforce 5-dim model, 4 H2s, 3-way triage, and ADR-0011 alignment', () => {
  const skillMdPath = path.join(HARNESS_DIR, 'SKILL.md');
  const adaptationPath = path.join(HARNESS_DIR, 'references/loopx-adaptation.md');
  const mapReadmePath = path.join(HARNESS_DIR, 'features/README.md');
  const cliSurfacePath = path.join(HARNESS_DIR, 'features/cli-surface.md');

  for (const p of [skillMdPath, adaptationPath, mapReadmePath, cliSurfacePath, PROVE_SCRIPT]) {
    assert.strictEqual(fs.existsSync(p), true, `Required verification-harness asset missing: ${path.relative(PROJECT_ROOT, p)}`);
  }

  const proveStat = fs.statSync(PROVE_SCRIPT);
  assert.strictEqual(Boolean(proveStat.mode & 0o111), true, 'prove-cli-surface.js must be executable');

  const skillMd = fs.readFileSync(skillMdPath, 'utf8');
  assert.match(skillMd, /^---\n[\s\S]*?name:\s*verification-harness[\s\S]*?description:/, 'SKILL.md must have valid YAML frontmatter');
  for (const section of ['## Launch', '## Doctor', '## Drive', '## Evidence', '## Cleanup', '## Helpers']) {
    assert.strictEqual(skillMd.includes(section), true, `SKILL.md must contain Pstack required section: ${section}`);
  }
  assert.match(skillMd, /pstack@0\.15\.46/, 'SKILL.md must attribute upstream pstack@0.15.46');
  assert.match(skillMd, /MIT/, 'SKILL.md must reference MIT license');
  assert.match(skillMd, /prove-cli-surface\.js/, 'SKILL.md Helpers section must document prove-cli-surface.js invocation');

  const adaptationMd = fs.readFileSync(adaptationPath, 'utf8');
  for (const dim of ['Surface', 'Run', 'Drive', 'Observe', 'Isolate']) {
    assert.strictEqual(adaptationMd.includes(dim), true, `loopx-adaptation.md must cover dimension: ${dim}`);
  }
  for (const triage of ['Doc Drift', 'Harness Gap', 'Product Bug']) {
    assert.strictEqual(adaptationMd.includes(triage), true, `loopx-adaptation.md must define triage class: ${triage}`);
  }
  assert.match(adaptationMd, /ADR-0011/, 'loopx-adaptation.md must map to ADR-0011 evidence contract');
  assert.match(adaptationMd, /04-contract\.md/, 'loopx-adaptation.md must map to 04-contract.md');
  assert.match(adaptationMd, /05-evidence\.md/, 'loopx-adaptation.md must map to 05-evidence.md');

  const mapReadme = fs.readFileSync(mapReadmePath, 'utf8');
  assert.match(mapReadme, /cli-surface\.md/, 'features/README.md must index cli-surface.md');

  const cliSurface = fs.readFileSync(cliSurfacePath, 'utf8');
  const h2Headings = cliSurface
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.trim());
  assert.deepStrictEqual(
    h2Headings,
    [
      '## Sub-features',
      '## How to get to it (user POV)',
      '## Driving it with prove-cli-surface',
      '## Gotchas',
    ],
    'features/cli-surface.md must strictly follow Pstack 4-H2 Feature Map contract in exact order'
  );
  assert.match(cliSurface, /Preconditions:/, 'Driving section must start with Preconditions:');
  for (const term of ['Surface', 'Run', 'Drive', 'Observe', 'Isolate', 'Doc Drift', 'Harness Gap', 'Product Bug']) {
    assert.strictEqual(cliSurface.includes(term), true, `cli-surface.md must include: ${term}`);
  }
});

// Environment-adaptive end-to-end: the same code must pass both on a host with
// `loopx 2.3.x` (overall_status=passed) and on a minimal CI runner without it
// (overall_status=partial + one verified_unreachable harness gap). Expectations
// are derived from `proof.steps`, never hard-coded to one environment.
test('3. Cold-start Prove runs end-to-end, Proof survives sandbox cleanup, and host/repo have zero residue', () => {
  const scratchRoot = makeScratch('vh-prove-test-');

  // Sandbox root inside the caller repo (gitignored `.loopx/tmp`) so the recorded
  // `sandbox_dir` is a reversible relative path that can be re-checked on disk.
  const tmpSandboxRoot = path.join(PROJECT_ROOT, '.loopx', 'tmp', `vh-prove-test-${process.pid}-${Date.now()}`);
  const proofOutDir = path.join(scratchRoot, 'proof-artifacts');
  tempDirs.push(tmpSandboxRoot);

  const repoRegistryPath = path.join(PROJECT_ROOT, '.loopx/registry.json');
  const hostRegistryPath = path.join(os.homedir(), '.loopx/registry.global.json');
  const beforeRepoRegistry = fileDigestOrNull(repoRegistryPath);
  const beforeHostRegistry = fileDigestOrNull(hostRegistryPath);

  const res = spawnSync(process.execPath, [PROVE_SCRIPT, '--output-dir', proofOutDir], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      LOOPX_TMP_DIR: tmpSandboxRoot,
      LOOPX_USAGE_PING: '0',
    },
  });

  assert.strictEqual(
    res.status,
    0,
    `Cold-start Prove failed (status=${res.status}):\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`
  );

  const proofJsonPath = path.join(proofOutDir, 'cli-surface-proof.json');
  const proofMdPath = path.join(proofOutDir, 'cli-surface-proof.md');
  assert.strictEqual(fs.existsSync(proofJsonPath), true, 'Proof JSON must survive cleanup');
  assert.strictEqual(fs.existsSync(proofMdPath), true, 'Proof Markdown report must survive cleanup');

  const proof = JSON.parse(fs.readFileSync(proofJsonPath, 'utf8'));
  assert.strictEqual(proof.schema_version, 'loopx_verification_harness_proof_v1');
  assert.strictEqual(proof.feature_map, 'skills/verification-harness/features/cli-surface.md');
  assert.match(proof.source_head, /^[0-9a-f]{40}$/, 'Proof must bind an exact source_head commit');
  assert.strictEqual(proof.source_head, git(PROJECT_ROOT, ['rev-parse', 'HEAD']), 'source_head must be the real source commit');
  assert.strictEqual(proof.source_dirty, false, 'Proof must record a clean source workspace');
  assert.ok(isHex64(proof.diff_fingerprint), 'diff_fingerprint must be a SHA-256 digest');
  assert.ok(isHex64(proof.contract_revision), 'contract_revision must bind 04-contract.md SHA-256');
  const unreachableSteps = proof.steps.filter((step) => step.status === 'verified_unreachable');
  const expectedOverall = unreachableSteps.length === 0
    ? 'passed'
    : (unreachableSteps.length === proof.steps.length ? 'incomplete' : 'partial');
  assert.strictEqual(
    proof.overall_status,
    expectedOverall,
    `overall_status must be derived from steps (unreachable=${unreachableSteps.map((s) => s.id).join(',') || 'none'})`
  );
  assert.strictEqual(
    proof.triage.outcome,
    unreachableSteps.length === 0 ? 'clean' : 'changed',
    'triage.outcome must follow the derived overall_status'
  );
  assert.strictEqual(
    proof.triage.harness_gap.length,
    unreachableSteps.length,
    'every verified_unreachable step must be recorded exactly once as a harness_gap'
  );
  for (const step of unreachableSteps) {
    assert.ok(
      proof.triage.harness_gap.some((gap) => gap.includes(step.id)),
      `harness_gap must name unreachable step: ${step.id}`
    );
  }
  if (unreachableSteps.length === 0) {
    assert.deepStrictEqual(proof.triage.harness_gap, []);
  }
  assert.strictEqual(proof.cleanup.sandbox_removed, true, 'Prove must verify temporary sandbox was removed');
  assert.strictEqual(proof.cleanup.proof_survived_cleanup, true, 'Prove must confirm proof survived cleanup');
  assert.strictEqual(proof.cleanup.sandbox_dir_kind, 'relative_to_caller_repo');
  assert.match(proof.cleanup.sandbox_dir, /^\.loopx\/tmp\/.*\/prove-cli-surface-/, 'sandbox_dir must be a reversible repo-relative path');
  assert.strictEqual(
    fs.existsSync(path.resolve(PROJECT_ROOT, proof.cleanup.sandbox_dir)),
    false,
    'Recorded sandbox_dir must not exist on disk after cleanup'
  );
  assert.strictEqual(proof.isolation.main_repo_registry_unchanged, true);
  assert.strictEqual(proof.isolation.host_global_registry_unchanged, true);
  assert.strictEqual(proof.isolation.caller_repo_git_status_unchanged, true);
  assert.strictEqual(proof.isolation.caller_repo_loopx_manifest_unchanged, true);

  // Verify tmpSandboxRoot contains zero leftover prove-* directories
  const remainingTmpEntries = fs.readdirSync(tmpSandboxRoot);
  assert.deepStrictEqual(remainingTmpEntries, [], `Temporary sandbox root must have zero residue after cleanup, found: ${remainingTmpEntries.join(', ')}`);

  // Verify all required sub-features were exercised, with honest step status
  const stepIds = proof.steps.map((s) => s.id);
  for (const expectedId of [
    'cli-help-surface',
    'cli-init-and-subdir-anchor',
    'cli-feature-and-gate1-negative',
    'cli-gate1-approve-and-tamper-detect',
    'cli-todo-managed-canary',
  ]) {
    assert.strictEqual(stepIds.includes(expectedId), true, `Proof must cover sub-feature: ${expectedId}`);
  }
  for (const step of proof.steps) {
    assert.strictEqual(['passed', 'verified_unreachable'].includes(step.status), true, `Unexpected step status for ${step.id}: ${step.status}`);
    assert.ok(step.real_vs_mock === 'real' || step.real_vs_mock === 'real+contract_fake', `Step ${step.id} must declare real surface execution`);
    assert.ok(Array.isArray(step.observations) && step.observations.length > 0, `Step ${step.id} must record state/side-effect observations`);
  }

  // Verify main repo & host global registry untouched
  assert.strictEqual(fileDigestOrNull(repoRegistryPath), beforeRepoRegistry, 'Main repo .loopx/registry.json must not be created or mutated');
  assert.strictEqual(fileDigestOrNull(hostRegistryPath), beforeHostRegistry, 'Host ~/.loopx/registry.global.json must not be mutated');
});

test('4. Negative fail-closed: missing --output-dir, unknown flags, and sandbox-internal --output-dir all exit non-zero', () => {
  const scratchRoot = makeScratch('vh-prove-neg-');

  const missing = spawnSync(process.execPath, [PROVE_SCRIPT], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOOPX_TMP_DIR: scratchRoot,
    },
  });
  assert.notStrictEqual(missing.status, 0, 'Missing --output-dir must fail closed with non-zero exit status');
  assert.match(missing.stderr, /--output-dir/, 'Error message must explain required --output-dir flag');

  const unknown = spawnSync(process.execPath, [PROVE_SCRIPT, '--output-dir', path.join(scratchRoot, 'proof'), '--bogus-flag'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOOPX_TMP_DIR: scratchRoot,
    },
  });
  assert.strictEqual(unknown.status, 2, 'Unknown argument must fail closed with exit code 2');
  assert.match(unknown.stderr, /Unknown argument: --bogus-flag/, 'Unknown argument must be reported by name');

  const insideSandbox = spawnSync(
    process.execPath,
    [PROVE_SCRIPT, '--output-dir', path.join(scratchRoot, 'proof-inside-sandbox')],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        LOOPX_TMP_DIR: scratchRoot,
      },
    }
  );
  assert.strictEqual(insideSandbox.status, 2, '--output-dir inside the sandbox root must fail closed with exit code 2');
  assert.match(insideSandbox.stderr, /must point outside the disposable sandbox/, 'Sandbox-internal output dir must be explained');

  assert.deepStrictEqual(fs.readdirSync(scratchRoot), [], 'Failed argument check must leave zero temp directories');
});

test('5. Missing loopx 2.3.x can never report overall_status=passed (harness gap is recorded)', () => {
  const scratchRoot = makeScratch('vh-prove-noloopx-');
  const proofOutDir = path.join(scratchRoot, 'proof-artifacts');

  const res = spawnSync(process.execPath, [PROVE_SCRIPT, '--output-dir', proofOutDir], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      LOOPX_BIN: path.join(scratchRoot, 'missing-loopx'),
      LOOPX_TMP_DIR: path.join(scratchRoot, 'loopx-tmp'),
      LOOPX_USAGE_PING: '0',
    },
  });

  assert.strictEqual(res.status, 0, `Prove with missing loopx must still emit Proof (status=${res.status}):\n${res.stderr}`);
  const proof = JSON.parse(fs.readFileSync(path.join(proofOutDir, 'cli-surface-proof.json'), 'utf8'));
  assert.notStrictEqual(proof.overall_status, 'passed', 'Missing loopx 2.3.x must degrade overall_status away from passed');
  assert.strictEqual(proof.overall_status, 'partial');
  const canary = proof.steps.find((step) => step.id === 'cli-todo-managed-canary');
  assert.strictEqual(canary.status, 'verified_unreachable');
  assert.ok(proof.triage.harness_gap.length >= 1, 'verified_unreachable must be recorded as a harness_gap');
  assert.ok(proof.triage.harness_gap.some((gap) => gap.includes('cli-todo-managed-canary')));
  assert.strictEqual(proof.triage.outcome, 'changed', 'A harness gap must not be triaged as clean');
});

test('6. Dirty source workspace fails closed; source binding matches the exact committed head', () => {
  const scratchRoot = makeScratch('vh-prove-dirty-');
  const sourceRoot = prepareSourceCopy(scratchRoot);
  const sourceScript = path.join(sourceRoot, 'skills/verification-harness/scripts/prove-cli-surface.js');
  const tmpSandboxRoot = path.join(scratchRoot, 'loopx-tmp');
  const env = { ...process.env, LOOPX_TMP_DIR: tmpSandboxRoot, LOOPX_USAGE_PING: '0' };

  const cleanOut = path.join(scratchRoot, 'clean-proof');
  const clean = spawnSync(process.execPath, [sourceScript, '--output-dir', cleanOut], {
    cwd: sourceRoot,
    encoding: 'utf8',
    timeout: 60000,
    env,
  });
  assert.strictEqual(clean.status, 0, `Clean source copy Prove must run (status=${clean.status}):\n${clean.stderr}`);
  const proof = JSON.parse(fs.readFileSync(path.join(cleanOut, 'cli-surface-proof.json'), 'utf8'));
  assert.strictEqual(proof.source_head, git(sourceRoot, ['rev-parse', 'HEAD']));
  assert.strictEqual(proof.source_dirty, false);

  const loopxFlowPath = path.join(sourceRoot, 'bin/loopx-flow');
  fs.appendFileSync(loopxFlowPath, '\n# tampered byte for dirty-workspace guard\n');
  const dirtyOut = path.join(scratchRoot, 'dirty-proof');
  const dirty = spawnSync(process.execPath, [sourceScript, '--output-dir', dirtyOut], {
    cwd: sourceRoot,
    encoding: 'utf8',
    timeout: 60000,
    env,
  });
  assert.notStrictEqual(dirty.status, 0, 'A dirty source workspace must fail closed');
  assert.match(dirty.stderr, /\[FAIL-CLOSED\].*dirty/i, 'Dirty workspace rejection must be explicit');
  assert.strictEqual(fs.existsSync(path.join(dirtyOut, 'cli-surface-proof.json')), false, 'Dirty workspace must not emit a Proof');
  const residue = fs.existsSync(tmpSandboxRoot) ? fs.readdirSync(tmpSandboxRoot) : [];
  assert.deepStrictEqual(residue, [], 'Dirty workspace rejection must not create sandbox residue');
});
