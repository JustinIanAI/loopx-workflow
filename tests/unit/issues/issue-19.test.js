'use strict';
/**
 * Issue #19: authentic-review must load loopx and policy_revision from the
 * local runtime. A hardcoded LOOPX_POLICY_REVISION fallback is a defect.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js');
const {
  parsePolicyRevision,
  resolveLoopxExecutable,
  resolveReviewPolicyRevision,
} = require(SCRIPT);

const HEAD = 'abc';

function writeExe(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function isolatedEnv(extra = {}) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-home-')),
    LOOPX_BIN: '',
    CONDA_PREFIX: '',
    CONDA_EXE: '',
    VIRTUAL_ENV: '',
    MAMBA_ROOT_PREFIX: '',
    ...extra,
  };
}

test('source does not hardcode LOOPX_POLICY_REVISION or a silent 22 fallback', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(src, /LOOPX_POLICY_REVISION/);
  assert.doesNotMatch(src, /review_policy_revision:[^\n]*\|\|\s*22/);
});

test('parsePolicyRevision accepts a positive integer and rejects stale sentinels', () => {
  assert.strictEqual(parsePolicyRevision(26), 26);
  assert.strictEqual(parsePolicyRevision('26'), 26);
  assert.strictEqual(parsePolicyRevision(22), 22);
  assert.strictEqual(parsePolicyRevision(0), null);
  assert.strictEqual(parsePolicyRevision(-1), null);
  assert.strictEqual(parsePolicyRevision(26.5), null);
  assert.strictEqual(parsePolicyRevision('22.0'), null);
  assert.strictEqual(parsePolicyRevision(''), null);
  assert.strictEqual(parsePolicyRevision(null), null);
  assert.strictEqual(parsePolicyRevision(false), null);
});

test('LOOPX_BIN absolute executable wins over PATH and an active conda prefix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-bin-'));
  const chosen = path.join(root, 'chosen', 'loopx');
  const other = path.join(root, 'other', 'loopx');
  writeExe(chosen, '#!/bin/bash\nexit 0\n');
  writeExe(other, '#!/bin/bash\nexit 0\n');
  const env = isolatedEnv({
    LOOPX_BIN: chosen,
    PATH: path.dirname(other),
    CONDA_PREFIX: path.dirname(path.dirname(other)),
  });
  const got = resolveLoopxExecutable(env);
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.bin, chosen);
  assert.strictEqual(got.source, 'LOOPX_BIN');
});

test('a missing LOOPX_BIN fails closed and does not fall back to PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-miss-'));
  const onPath = path.join(root, 'bin', 'loopx');
  writeExe(onPath, '#!/bin/bash\nexit 0\n');
  const missing = path.join(root, 'missing-loopx');
  const got = resolveLoopxExecutable(isolatedEnv({
    LOOPX_BIN: missing,
    PATH: path.dirname(onPath),
  }));
  assert.strictEqual(got.ok, false);
  assert.match(got.error, /LOOPX_BIN/);
  assert.match(got.error, /fail-closed/);
});

test('PATH is used when LOOPX_BIN is unset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-path-'));
  const bin = path.join(root, 'bin', 'loopx');
  writeExe(bin, '#!/bin/bash\nexit 0\n');
  const got = resolveLoopxExecutable(isolatedEnv({ PATH: `${path.dirname(bin)}:/usr/bin:/bin` }));
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.bin, bin);
  assert.strictEqual(got.source, 'PATH');
});

test('an active CONDA_PREFIX supplies loopx when PATH does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-conda-'));
  const bin = path.join(root, 'bin', 'loopx');
  writeExe(bin, '#!/bin/bash\nexit 0\n');
  const got = resolveLoopxExecutable(isolatedEnv({ CONDA_PREFIX: root }));
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.bin, bin);
  assert.strictEqual(got.source, 'CONDA_PREFIX');
});

test('no resolvable loopx fails closed with a diagnostic', () => {
  const got = resolveLoopxExecutable(isolatedEnv());
  assert.strictEqual(got.ok, false);
  assert.match(got.error, /No executable loopx/);
  assert.match(got.error, /fail-closed/);
});

test('packet review_execution_contract.policy_revision is used as-is, including a non-22 value', () => {
  const got = resolveReviewPolicyRevision({
    packet: {
      agent_response_contract: { review_execution_contract: { policy_revision: 26 } },
      pull_requests: [{ number: 7, head_oid: HEAD, result_template: { review_policy_revision: 22 } }],
    },
    pr: 7,
    headOid: HEAD,
    loopxBin: '/nonexistent',
    probe: () => { throw new Error('probe must not run when the packet revision is valid'); },
  });
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.revision, 26);
  assert.match(got.source, /review_execution_contract\.policy_revision/);
});

test('result_template.review_policy_revision is used when the execution contract omits it', () => {
  const got = resolveReviewPolicyRevision({
    packet: {
      pull_requests: [{
        number: 7,
        head_oid: HEAD,
        review_plan: { result_template: { review_policy_revision: 9 } },
        result_template: { review_policy_revision: 26 },
      }],
    },
    pr: 7,
    headOid: HEAD,
    loopxBin: '/nonexistent',
    probe: () => { throw new Error('probe must not run when result_template is valid'); },
  });
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.revision, 26);
  assert.match(got.source, /result_template\.review_policy_revision/);
});

test('a local loopx probe supplies policy_revision when the packet has none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-probe-'));
  const bin = path.join(root, 'loopx');
  writeExe(bin, '#!/bin/bash\nif [[ "$*" == *"--print-policy-revision"* ]]; then echo 26; exit 0; fi\necho unsupported >&2\nexit 1\n');
  const got = resolveReviewPolicyRevision({
    packet: { pull_requests: [{ number: 7, head_oid: HEAD, review_template: { sections: [{}] } }] },
    pr: 7,
    headOid: HEAD,
    loopxBin: bin,
    env: isolatedEnv(),
  });
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.revision, 26);
  assert.match(got.source, /print-policy-revision/);
});

test('missing policy_revision fails closed when the runtime probe cannot supply one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-noprobe-'));
  const bin = path.join(root, 'loopx');
  writeExe(bin, '#!/bin/bash\necho "policy_revision unavailable" >&2\nexit 1\n');
  const got = resolveReviewPolicyRevision({
    packet: {
      agent_response_contract: { review_execution_contract: { policy_revision: 0 } },
      pull_requests: [{ number: 7, head_oid: HEAD, result_template: { review_policy_revision: 'nope' } }],
    },
    pr: 7,
    headOid: HEAD,
    loopxBin: bin,
    env: isolatedEnv(),
  });
  assert.strictEqual(got.ok, false);
  assert.match(got.error, /policy_revision/);
  assert.match(got.error, /fail-closed/);
});

test('env shebang python probe prefers sibling python next to CONDA_PREFIX loopx over PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue19-sibling-py-'));
  const condaBin = path.join(root, 'conda', 'bin');
  const loopxBin = path.join(condaBin, 'loopx');
  const siblingPy = path.join(condaBin, 'python3');
  const pathBin = path.join(root, 'sysbin');
  const sysPy = path.join(pathBin, 'python3');

  writeExe(loopxBin, '#!/usr/bin/env -S python3\nimport sys\nsys.exit(1)\n');
  writeExe(siblingPy, '#!/bin/bash\necho 26\nexit 0\n');
  writeExe(sysPy, '#!/bin/bash\necho "wrong python" >&2\nexit 1\n');

  const got = resolveReviewPolicyRevision({
    packet: { pull_requests: [{ number: 7, head_oid: HEAD }] },
    pr: 7,
    headOid: HEAD,
    loopxBin,
    env: isolatedEnv({ PATH: pathBin, CONDA_PREFIX: path.join(root, 'conda') }),
  });
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.revision, 26);
  assert.match(got.source, /REVIEW_POLICY_REVISION/);
});

test('policyRevisionFromPacket ignores mismatched PRs in pull_requests instead of falling back to prs[0]', () => {
  const got = resolveReviewPolicyRevision({
    packet: {
      pull_requests: [{ number: 1, head_oid: 'other', result_template: { review_policy_revision: 22 } }],
    },
    pr: 7,
    headOid: HEAD,
    loopxBin: '/nonexistent',
    probe: () => ({ ok: true, revision: 26, source: 'probe' }),
  });
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(got.revision, 26);
  assert.strictEqual(got.source, 'probe');
});
