'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildNativePrompt,
  materializeReviewSandbox,
  formatArtifactManifest,
  hostOutputTruncated,
  runReviewAgent,
  reviewAgentArgs,
  stdinByteLimit,
} = require('../../skills/code-review/scripts/authentic-review.js');

function makeRunDir(dir) {
  return { dir, file: (name) => path.join(dir, name) };
}

test('>80KB diff stays on disk and stdin stays compact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-diff-'));
  const runDir = makeRunDir(dir);
  const marker = 'TAIL_SENTINEL_UNIQUE';
  const full = `diff --git a/a.js b/a.js\n${'x'.repeat(80 * 1024)}\n${marker}\n`;
  assert.ok(Buffer.byteLength(full) > 80 * 1024);
  const entries = materializeReviewSandbox(runDir, {
    'packet.json': '{"n":1}',
    'pr.diff': full,
    'evidence-output.md': 'EVIDENCE_BODY',
    'remote-checks.txt': 'check=pass',
  });
  const prompt = buildNativePrompt({
    pr: 57,
    headOid: 'a'.repeat(40),
    branch: 'fix/review-sandbox-file-input',
    motivation: 'm',
    reviewTemplate: { sections: [{ label: '动机', minimum_prose_characters: 1, agent_instruction: 'do' }], output_hint: 'hint' },
    reviewPlan: { required_evidence_ids: [] },
    evidenceCommands: [],
    evidenceText: 'EVIDENCE_BODY',
    diff: full,
    priorFindings: [],
    evidenceContract: {},
    artifactManifest: formatArtifactManifest(entries),
  });
  assert.ok(Buffer.byteLength(prompt) <= stdinByteLimit());
  assert.doesNotMatch(prompt, /TAIL_SENTINEL_UNIQUE|EVIDENCE_BODY/);
  assert.match(prompt, /pr\.diff/);
  assert.match(fs.readFileSync(path.join(dir, 'pr.diff'), 'utf8'), /TAIL_SENTINEL_UNIQUE/);
  assert.match(fs.readFileSync(path.join(dir, 'evidence-output.md'), 'utf8'), /EVIDENCE_BODY/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('host truncation marker matches only the bracketed byte form', () => {
  assert.strictEqual(hostOutputTruncated('see [... 44229 bytes omitted ...] here'), true);
  assert.strictEqual(hostOutputTruncated('err', '[... 10 bytes omitted ...]'), true);
  assert.strictEqual(hostOutputTruncated('the review discusses bytes omitted as a mechanism'), false);
  assert.strictEqual(hostOutputTruncated('no numeric [... bytes omitted ...] form'), false);
});

test('oversized stdin is rejected before the agent process starts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-bin-'));
  const log = path.join(dir, 'spawned');
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\necho spawned > ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
  const prev = process.env.REVIEW_STDIN_BYTE_LIMIT;
  const prevPath = process.env.PATH;
  process.env.REVIEW_STDIN_BYTE_LIMIT = '1024';
  process.env.PATH = `${dir}:${prevPath}`;
  try {
    const result = runReviewAgent('codex', 'y'.repeat(2048), 5000, makeRunDir(dir));
    assert.strictEqual(result.stdinRejected, true);
    assert.strictEqual(fs.existsSync(log), false);
  } finally {
    if (prev === undefined) delete process.env.REVIEW_STDIN_BYTE_LIMIT;
    else process.env.REVIEW_STDIN_BYTE_LIMIT = prev;
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('codex stays read-only and claude is limited to Read on the sandbox', () => {
  const runDir = { dir: '/sandbox/review-pr57-abc' };
  const codex = reviewAgentArgs('codex', runDir, '/sandbox/review-pr57-abc/out.txt');
  assert.deepStrictEqual(codex.slice(0, 7), ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', runDir.dir]);
  assert.ok(codex.includes('-o'));
  assert.strictEqual(codex.at(-1), '-');
  assert.ok(!codex.includes('--add-dir'));
  const claude = reviewAgentArgs('claude', runDir, null);
  assert.deepStrictEqual(claude, ['-p', '--tools', 'Read', '--permission-mode', 'dontAsk', '--add-dir', runDir.dir]);
});

test('runReviewAgent spawns both backends with the read-only argv and flags truncation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-args-'));
  const writeBin = (name, body) => {
    fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
  };
  writeBin('codex', `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(path.join(dir, 'codex.args'))}\nprintf 'ok'\nexit 0\n`);
  writeBin('claude', `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(path.join(dir, 'claude.args'))}\nprintf '[... 8 bytes omitted ...]'\nexit 0\n`);
  const prevPath = process.env.PATH;
  process.env.PATH = `${dir}:${prevPath}`;
  const runDir = makeRunDir(path.join(dir, 'run'));
  fs.mkdirSync(runDir.dir, { recursive: true });
  try {
    const codexRun = runReviewAgent('codex', 'compact prompt', 5000, runDir);
    assert.strictEqual(codexRun.stdout.trim(), 'ok');
    const codexArgs = fs.readFileSync(path.join(dir, 'codex.args'), 'utf8');
    assert.match(codexArgs, /exec --sandbox read-only/);
    assert.match(codexArgs, /-C /);
    assert.doesNotMatch(codexArgs, /--add-dir/);
    const claudeRun = runReviewAgent('claude', 'compact prompt', 5000, runDir);
    assert.strictEqual(claudeRun.truncated, true);
    const claudeArgs = fs.readFileSync(path.join(dir, 'claude.args'), 'utf8');
    assert.match(claudeArgs, /-p --tools Read --permission-mode dontAsk --add-dir /);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
