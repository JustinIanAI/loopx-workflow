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
 *   4. Negative fail-closed behavior: missing `--output-dir` or broken CLI
 *      surface fails with non-zero exit code without leaving sandbox residue.
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

test('3. Cold-start Prove runs end-to-end, Proof survives sandbox cleanup, and host/repo have zero residue', () => {
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-prove-test-'));
  tempDirs.push(scratchRoot);

  const tmpSandboxRoot = path.join(scratchRoot, 'loopx-tmp');
  const proofOutDir = path.join(scratchRoot, 'proof-artifacts');
  fs.mkdirSync(tmpSandboxRoot, { recursive: true });

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
  assert.strictEqual(proof.overall_status, 'passed');
  assert.strictEqual(proof.cleanup.sandbox_removed, true, 'Prove must verify temporary sandbox was removed');
  assert.strictEqual(proof.cleanup.proof_survived_cleanup, true, 'Prove must confirm proof survived cleanup');
  assert.strictEqual(fs.existsSync(proof.cleanup.sandbox_dir), false, 'Recorded sandbox_dir must not exist on disk after cleanup');

  // Verify tmpSandboxRoot contains zero leftover prove-* directories
  const remainingTmpEntries = fs.readdirSync(tmpSandboxRoot);
  assert.deepStrictEqual(remainingTmpEntries, [], `Temporary sandbox root must have zero residue after cleanup, found: ${remainingTmpEntries.join(', ')}`);

  // Verify all required sub-features were exercised and passed
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

test('4. Negative fail-closed: missing --output-dir or invalid arguments exits non-zero cleanly', () => {
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-prove-neg-'));
  tempDirs.push(scratchRoot);

  const res = spawnSync(process.execPath, [PROVE_SCRIPT], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOOPX_TMP_DIR: scratchRoot,
    },
  });

  assert.notStrictEqual(res.status, 0, 'Missing --output-dir must fail closed with non-zero exit status');
  assert.match(res.stderr, /--output-dir/, 'Error message must explain required --output-dir flag');
  assert.deepStrictEqual(fs.readdirSync(scratchRoot), [], 'Failed argument check must leave zero temp directories');
});
