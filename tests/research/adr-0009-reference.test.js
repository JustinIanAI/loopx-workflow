'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ref = require('./adr-0009-reference.js');

const SHA = 'a'.repeat(64);
const SPEC = 'b'.repeat(40);
const RISK = { accepted_by: 'owner', accepted_at: '2026-11-12' };

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adr9-'));
}

function writeConfig(dir, mode, risk) {
  const body = {
    schema_version: 'loopx_workflow_config_v0',
    authorization_mode: mode,
  };
  if (risk) body.single_owner_risk_acceptance = risk;
  fs.writeFileSync(path.join(dir, 'loopx-workflow.config.json'), JSON.stringify(body));
}

function evidence(overrides) {
  const data = Object.assign({
    mode: 'single_owner',
    contractSha: SHA,
    specCommit: SPEC,
    feature: 'feat-a',
    principal: 'owner',
    risk: RISK,
  }, overrides || {});
  return ref.buildEvidence(data);
}

function record(overrides) {
  return Object.assign({
    decisionScope: 'other:goal:' + SHA,
    decisionOutcome: 'approve',
    superseded: false,
  }, overrides || {});
}

test('T0 happy path: single_owner config + matching evidence verifies', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  const auth = ref.authorize({
    repoRoot: dir, isTTY: true, yes: false,
    contractSha: SHA, specCommit: SPEC, feature: 'feat-a', principal: 'owner',
  });
  assert.equal(auth.marker, 'FROZEN & APPROVED');
  const result = ref.verifyAuthorization({
    config: auth.config, evidenceText: auth.evidence,
    record: record(), currentContractSha: SHA,
  });
  assert.equal(result.ok, true);
});

test('T1 non-TTY approve must fail and write no marker', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  let marker = null;
  assert.throws(() => {
    const auth = ref.authorize({
      repoRoot: dir, isTTY: false, yes: false,
      contractSha: SHA, specCommit: SPEC, feature: 'feat-a', principal: 'owner',
    });
    marker = auth.marker;
  }, /non_interactive/);
  assert.equal(marker, null);
});

test('T2 --yes approve must fail', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  assert.throws(() => ref.authorize({
    repoRoot: dir, isTTY: true, yes: true,
    contractSha: SHA, specCommit: SPEC, feature: 'feat-a', principal: 'owner',
  }), /yes_not_allowed/);
});

test('T3 missing config must fail', () => {
  const dir = tempRepo();
  assert.throws(() => ref.loadConfig(dir), /config_missing/);
});

test('T4 single_owner missing risk acceptance must fail', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', null);
  assert.throws(() => ref.loadConfig(dir), /risk_acceptance_missing/);
});

test('T5 independent Gate1 must fail until ADR-0012 proof exists', () => {
  const dir = tempRepo();
  writeConfig(dir, 'independent', null);
  assert.throws(() => ref.authorize({
    repoRoot: dir, isTTY: true, yes: false,
    contractSha: SHA, specCommit: SPEC, feature: 'feat-a', principal: 'owner',
  }), /independent_unsupported/);
});

test('T6 gate verify rejects evidence with a missing key', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  const broken = evidence().replace(';spec_commit=' + SPEC, '');
  assert.throws(() => ref.parseEvidence(broken), /evidence_missing_key:spec_commit/);
});

test('T7 gate verify rejects decision_outcome=reject', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  const config = ref.loadConfig(dir);
  assert.throws(() => ref.verifyAuthorization({
    config, evidenceText: evidence(), record: record({ decisionOutcome: 'reject' }),
    currentContractSha: SHA,
  }), /decision_outcome_not_approve/);
});

test('T8 gate verify rejects changed contract SHA', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  const config = ref.loadConfig(dir);
  assert.throws(() => ref.verifyAuthorization({
    config, evidenceText: evidence(), record: record(),
    currentContractSha: 'c'.repeat(64),
  }), /decision_scope_mismatch/);
});

test('T9 gate verify rejects mode mismatch between config and evidence', () => {
  const dir = tempRepo();
  writeConfig(dir, 'single_owner', RISK);
  const config = ref.loadConfig(dir);
  const mismatched = evidence().replace('authorization_mode=single_owner', 'authorization_mode=independent');
  assert.throws(() => ref.verifyAuthorization({
    config, evidenceText: mismatched, record: record(), currentContractSha: SHA,
  }), /authorization_mode_mismatch/);
});
