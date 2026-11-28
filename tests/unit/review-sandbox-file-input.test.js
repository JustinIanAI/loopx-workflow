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

test('oversized stdin is rejected before the agent process starts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-bin-'));
  const log = path.join(dir, 'spawned');
  fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\necho spawned > ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
  const prev = process.env.REVIEW_STDIN_BYTE_LIMIT;
  const prevPath = process.env.PATH;
  process.env.REVIEW_STDIN_BYTE_LIMIT = '1024';
  process.env.PATH = `${dir}:${prevPath}`;
  try {
    const result = await runReviewAgent('codex', 'y'.repeat(2048), 5000, makeRunDir(dir));
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
  const off = { env: {} };
  const codex = reviewAgentArgs('codex', runDir, '/sandbox/review-pr57-abc/out.txt', off);
  assert.deepStrictEqual(codex.slice(0, 7), ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', runDir.dir]);
  assert.ok(codex.includes('-o'));
  assert.strictEqual(codex.at(-1), '-');
  assert.ok(!codex.includes('--add-dir'));
  assert.ok(!codex.includes('-m'));
  const claude = reviewAgentArgs('claude', runDir, null, off);
  assert.deepStrictEqual(claude, ['-p', '--tools', 'Read', '--permission-mode', 'dontAsk', '--add-dir', runDir.dir]);
});

test('runReviewAgent spawns both backends with the read-only argv and flags truncation', async () => {
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
    const codexRun = await runReviewAgent('codex', 'compact prompt', 5000, runDir, undefined, { env: {} });
    assert.strictEqual(codexRun.stdout.trim(), 'ok');
    const codexArgs = fs.readFileSync(path.join(dir, 'codex.args'), 'utf8');
    assert.match(codexArgs, /exec --sandbox read-only/);
    assert.match(codexArgs, /-C /);
    assert.doesNotMatch(codexArgs, /--add-dir/);
    assert.doesNotMatch(codexArgs, /(^| )-m /);
    const claudeRun = await runReviewAgent('claude', 'compact prompt', 5000, runDir, undefined, { env: {} });
    assert.strictEqual(claudeRun.truncated, true);
    const claudeArgs = fs.readFileSync(path.join(dir, 'claude.args'), 'utf8');
    assert.match(claudeArgs, /-p --tools Read --permission-mode dontAsk --add-dir /);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('codex -o keeps stdout diagnostics and does not treat diff literals as truncation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-codex-'));
  const runDir = makeRunDir(path.join(dir, 'run'));
  fs.mkdirSync(runDir.dir, { recursive: true });
  const prevPath = process.env.PATH;
  process.env.PATH = `${dir}:${prevPath}`;
  const marker = '[... 44229 bytes omitted ...]';
  const novel = '[... 99999 bytes omitted ...]';
  const diff = `+const s = "${marker}";`;
  const write = (body) => fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\nout=""; p=""\nfor a in "$@"; do [ "$p" = "-o" ] && out="$a"; p="$a"; done\ncat >/dev/null\n${body}\n`, { mode: 0o755 });
  try {
    write(`printf '%s' '{"ok":1}' > "$out"; echo '${marker}' >&2; exit 0`);
    const echo = await runReviewAgent('codex', 'p', 5000, runDir, diff);
    assert.notStrictEqual(echo.truncated, true);
    assert.match(echo.stdout, /\{"ok":1\}/);
    write(`printf '%s' '{"b":"${novel}"}' > "$out"; exit 0`);
    assert.notStrictEqual((await runReviewAgent('codex', 'p', 5000, runDir, novel)).truncated, true);
    assert.strictEqual((await runReviewAgent('codex', 'p', 5000, runDir, diff)).truncated, true);
    write(`printf '%s' '{"ok":1}' > "$out"; echo '${novel}'; exit 0`);
    assert.strictEqual((await runReviewAgent('codex', 'p', 5000, runDir, diff)).truncated, true);
    write(`: > "$out"; echo stdout-error-token; exit 3`);
    assert.match((await runReviewAgent('codex', 'p', 5000, runDir)).error, /stdout-error-token/);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('realistic packet stays inside 64KB without inlining checks or prior findings', () => {
  const prev = process.env.REVIEW_STDIN_BYTE_LIMIT;
  delete process.env.REVIEW_STDIN_BYTE_LIMIT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-volume-'));
  try {
    assert.strictEqual(stdinByteLimit(), 64 * 1024);
    const ids = Array.from({ length: 14 }, (_, i) => `ev_${i}`);
    const checks = Array.from({ length: 40 }, (_, i) => ({ name: `g${i}`, state: 'SUCCESS', bucket: 'pass', link: `https://example.invalid/CHECK_LINK_SENTINEL_${i}` }));
    const prior = Array.from({ length: 20 }, (_, i) => ({ index: i + 1, severity: 'P1', file: `f${i}.js`, line: i, summary: `FINDING_SUMMARY_SENTINEL_${i}` }));
    const entries = materializeReviewSandbox(makeRunDir(dir), {
      'remote-checks.txt': checks.map(c => c.link).join('\n'),
      'prior-findings.md': prior.map(f => f.summary).join('\n'),
    });
    const prompt = buildNativePrompt({
      pr: 59, headOid: 'c'.repeat(40), branch: 'fix/x', motivation: 'm',
      reviewTemplate: {
        sections: ['动机', '改动思路', '具体改动', '对主干的风险', '我的整体评价'].map(label => ({ label, minimum_prose_characters: 180, agent_instruction: '约束'.repeat(200) })),
        output_hint: '输出'.repeat(400),
      },
      reviewPlan: { required_evidence_ids: ids },
      evidenceCommands: ['echo evidence-ok'],
      evidenceText: 'EVIDENCE_SHOULD_NOT_INLINE', diff: 'DIFF_SHOULD_NOT_INLINE', priorFindings: prior,
      evidenceContract: { evidence_requirements: ids.map(id => ({ evidence_id: id, fields: ['status', 'reason', 'inspected_path', 'before_after', 'evidence_refs'], verdict_values: ['verified', 'not_applicable'] })) },
      remoteChecks: checks, artifactManifest: formatArtifactManifest(entries),
    });
    assert.ok(Buffer.byteLength(prompt) <= stdinByteLimit());
    assert.match(prompt, /证据采集命令（运行结果见沙箱文件 evidence-output.md）/);
    assert.doesNotMatch(prompt, /下方已附运行结果/);
    assert.match(prompt, /40 项（通过 40）/);
    assert.match(prompt, /prior-findings\.md/);
    assert.doesNotMatch(prompt, /CHECK_LINK_SENTINEL_|FINDING_SUMMARY_SENTINEL_|EVIDENCE_SHOULD_NOT_INLINE|state=SUCCESS/);
    assert.match(fs.readFileSync(path.join(dir, 'prior-findings.md'), 'utf8'), /FINDING_SUMMARY_SENTINEL_19/);

    const unmanifested = buildNativePrompt({
      pr: 59, headOid: 'c'.repeat(40), branch: 'fix/x', motivation: 'm',
      reviewTemplate: { sections: [], output_hint: '' },
      reviewPlan: { required_evidence_ids: [] },
      evidenceCommands: ['echo evidence-ok'],
      evidenceText: 'EVIDENCE_SHOULD_NOT_INLINE',
      diff: 'DIFF_SHOULD_NOT_INLINE',
      priorFindings: [],
      evidenceContract: {},
      remoteChecks: [],
    });
    assert.match(unmanifested, /## 证据采集命令（运行结果不内联进 stdin）/);
    assert.doesNotMatch(unmanifested, /下方已附运行结果/);
    assert.doesNotMatch(unmanifested, /EVIDENCE_SHOULD_NOT_INLINE/);
    assert.doesNotMatch(unmanifested, /DIFF_SHOULD_NOT_INLINE/);
  } finally {
    if (prev === undefined) delete process.env.REVIEW_STDIN_BYTE_LIMIT;
    else process.env.REVIEW_STDIN_BYTE_LIMIT = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
