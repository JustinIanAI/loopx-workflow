'use strict';

// ADR-0009 的参考实现（research only）：只验证契约可执行性，不接入 bin/loopx-flow。
const fs = require('node:fs');
const path = require('node:path');

const MODES = new Set(['independent', 'single_owner']);
const SHA64 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const KEYS = [
  'authorization_mode',
  'contract_sha',
  'spec_commit',
  'feature',
  'principal',
  'risk_acceptance',
];

function loadConfig(repoRoot) {
  const file = path.join(repoRoot, 'loopx-workflow.config.json');
  if (!fs.existsSync(file)) throw new Error('config_missing');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    throw new Error('config_invalid_json');
  }
  if (raw.schema_version !== 'loopx_workflow_config_v0') throw new Error('config_schema_invalid');
  if (!MODES.has(raw.authorization_mode)) throw new Error('config_mode_invalid');
  if (raw.authorization_mode === 'single_owner') {
    const risk = raw.single_owner_risk_acceptance;
    if (!risk || typeof risk.accepted_by !== 'string' || !risk.accepted_by ||
        typeof risk.accepted_at !== 'string' || !risk.accepted_at) {
      throw new Error('risk_acceptance_missing');
    }
  }
  return raw;
}

function assertInteractive(input) {
  if (input.yes) throw new Error('yes_not_allowed');
  if (!input.isTTY) throw new Error('non_interactive');
}

function buildEvidence(input) {
  if (!MODES.has(input.mode)) throw new Error('mode_invalid');
  if (!SHA64.test(input.contractSha)) throw new Error('contract_sha_invalid');
  if (!SHA40.test(input.specCommit)) throw new Error('spec_commit_invalid');
  if (!input.feature) throw new Error('feature_missing');
  if (!input.principal) throw new Error('principal_missing');
  const base = [
    'authorization_mode=' + input.mode,
    'contract_sha=' + input.contractSha,
    'spec_commit=' + input.specCommit,
    'feature=' + input.feature,
    'principal=' + input.principal,
  ];
  if (input.mode === 'single_owner') {
    const risk = input.risk;
    if (!risk || !risk.accepted_by || !risk.accepted_at) throw new Error('risk_acceptance_missing');
    base.push('risk_acceptance=' + risk.accepted_by + '@' + risk.accepted_at);
  }
  return base.join(';');
}

function parseEvidence(text) {
  const out = {};
  const parts = String(text || '').split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) throw new Error('evidence_malformed');
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (!KEYS.includes(key)) throw new Error('evidence_unknown_key:' + key);
    if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error('evidence_duplicate_key:' + key);
    if (value === '') throw new Error('evidence_empty_value:' + key);
    out[key] = value;
  }
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) throw new Error('evidence_missing_key:' + key);
  }
  return out;
}

function authorize(input) {
  const config = loadConfig(input.repoRoot);
  assertInteractive({ isTTY: input.isTTY, yes: input.yes });
  if (config.authorization_mode !== 'single_owner') throw new Error('independent_unsupported');
  const evidence = buildEvidence({
    mode: config.authorization_mode,
    contractSha: input.contractSha,
    specCommit: input.specCommit,
    feature: input.feature,
    principal: input.principal,
    risk: config.single_owner_risk_acceptance,
  });
  return { config, evidence, marker: 'FROZEN & APPROVED' };
}

function verifyAuthorization(input) {
  const evidence = parseEvidence(input.evidenceText);
  const config = input.config;
  if (input.record.decisionScope !== 'other:goal:' + input.currentContractSha) {
    throw new Error('decision_scope_mismatch');
  }
  if (input.record.decisionOutcome !== 'approve') throw new Error('decision_outcome_not_approve');
  if (input.record.superseded) throw new Error('authorization_superseded');
  if (evidence.contract_sha !== input.currentContractSha) throw new Error('contract_sha_mismatch');
  if (evidence.authorization_mode !== config.authorization_mode) throw new Error('authorization_mode_mismatch');
  if (config.authorization_mode !== 'single_owner') throw new Error('independent_unsupported');
  const risk = config.single_owner_risk_acceptance;
  if (evidence.principal !== risk.accepted_by) throw new Error('principal_mismatch');
  if (evidence.risk_acceptance !== risk.accepted_by + '@' + risk.accepted_at) {
    throw new Error('risk_acceptance_mismatch');
  }
  return { ok: true };
}

module.exports = {
  MODES,
  loadConfig,
  assertInteractive,
  buildEvidence,
  parseEvidence,
  authorize,
  verifyAuthorization,
};
