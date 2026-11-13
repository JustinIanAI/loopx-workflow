'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildEvidenceGraph,
  buildValidationMatrix,
  describeFileFromDiff,
  scanDiff,
} = require('../../skills/code-review/scripts/evidence-builder.js');

const DIFF = [
  'diff --git a/skills/code-review/scripts/authentic-review.js b/skills/code-review/scripts/authentic-review.js',
  '--- a/skills/code-review/scripts/authentic-review.js',
  '+++ b/skills/code-review/scripts/authentic-review.js',
  '@@ -1,2 +1,3 @@',
  '-old line',
  '+new evidence line',
  '+another line',
  'diff --git a/tests/unit/authentic-review-evidence.test.js b/tests/unit/authentic-review-evidence.test.js',
  '--- /dev/null',
  '+++ b/tests/unit/authentic-review-evidence.test.js',
  '@@ -0,0 +1,2 @@',
  '+test one',
  '+test two',
].join('\n');

const CONTRACT = {
  policy_revision: 22,
  evidence_requirements: [
    { evidence_id: 'problem_context', fields: ['goal_basis','author_claim','old_behavior','affected_caller_or_operator','compounding_cost','before_after_scenario','smaller_fix_analysis','observable_outcome','outcome_impact','spec_basis','non_goals'], verdict_values: ['goal_achieved'] },
    { evidence_id: 'architecture_flow', fields: ['entry_point','authoritative_input_or_state','decision_owner','side_effect_or_transition','receipt_or_consumer','failure_or_retry_owner'] },
    { evidence_id: 'semantic_alignment', fields: ['checked_scope','impact_reason','verdict'], verdict_values: ['aligned','not_applicable'] },
    { evidence_id: 'validation_matrix', items_field: 'items', item_fields: ['case_id','invariant_or_case','command_or_check','status','result','required','skip_or_failure_reason'] },
    { evidence_id: 'changed_line_classification', fields: ['files','additions','deletions','behavior_role'] },
    { evidence_id: 'code_volume', fields: ['changed_line_shape','largest_production_hotspots','active_call_site_evidence','compatibility_assessment','verdict','highest_value_simplification','behavior_preserving_validation'], verdict_values: ['necessary'] },
    { evidence_id: 'walkthroughs', positive_field: 'positive', positive_fields: ['trigger','ordered_symbols_or_steps','state_transitions','observable_result'], negative_field: 'negative', negative_fields: ['triggering_input_or_state','ordered_symbols_or_steps','rejection_fallback_or_wrong_outcome','error_or_retry_owner'] },
    { evidence_id: 'symbol_map', items_field: 'items', item_fields: ['path','line','symbol','responsibility','before_after_behavior','input_or_pre_state','critical_branch_or_invariant','callee_or_side_effect','return_or_consumer','failure_fallback_or_retry_owner','caller_evidence'], item_count: { minimum: 2, maximum: 5 } },
    { evidence_id: 'change_proportionality', fields: ['original_problem','frequency_or_severity','affected_users_or_operators','failure_cost_and_recovery','smallest_viable_fix','production_mechanism_cost','new_state_contract_or_cli_surface','maintenance_and_migration_cost','alternatives_considered','scope_growth_since_initial_review','repository_architecture_constraints','strongest_case_against_shipping','why_smaller_or_existing_owner_is_insufficient','architecture_assessment','verdict'], verdict_values: ['proportionate'] },
  ],
};

const PLAN = {
  required_evidence_ids: [
    'problem_context',
    'architecture_flow',
    'semantic_alignment',
    'validation_matrix',
    'changed_line_classification',
    'code_volume',
    'walkthroughs',
    'symbol_map',
    'change_proportionality',
  ],
  result_template: { review_policy_revision: 22, evidence: {} },
};

function build(extra = {}) {
  return buildEvidenceGraph({
    contract: CONTRACT,
    plan: PLAN,
    diff: DIFF,
    headOid: 'a'.repeat(40),
    pr: 3,
    motivation: 'review evidence graph for the combined R4 and issue 25 delivery',
    validation: buildValidationMatrix({ typecheck: 'PASSED', lint: 'PASSED', build: 'PASSED', test: 'PASSED' }, { headOid: 'a'.repeat(40) }),
    modelEvidence: null,
    ...extra,
  });
}

test('without model input, judgment ids stay unverified while host diff/gate facts are verified', () => {
  const ev = build();
  assert.strictEqual(Object.keys(ev).length, PLAN.required_evidence_ids.length);
  for (const id of ['problem_context', 'architecture_flow', 'semantic_alignment', 'walkthroughs', 'change_proportionality']) {
    assert.deepStrictEqual(ev[id], { status: 'unverified' }, id + ' must stay unverified without model input');
  }
  assert.strictEqual(ev.changed_line_classification.status, 'verified');
  assert.strictEqual(ev.code_volume.status, 'verified');
  assert.strictEqual(ev.validation_matrix.status, 'verified');
  assert.strictEqual(ev.symbol_map.status, 'unverified');
});

test('all four gates exiting 0 still leaves changed_invariant_positive and material_negative_or_failure unverified', () => {
  const items = build().validation_matrix.items;
  const byId = new Map(items.map(i => [i.case_id, i]));
  for (const gate of ['typecheck', 'lint', 'build', 'test', 'repository_required_checks']) {
    assert.strictEqual(byId.get(gate).status, 'passed', gate + ' should be passed');
  }
  assert.strictEqual(byId.get('changed_invariant_positive').status, 'unverified');
  assert.strictEqual(byId.get('material_negative_or_failure').status, 'unverified');
});

test('changed_invariant_positive becomes passed only when reviewer supplies an existing repo test path executed via node --test', () => {
  const executed = [];
  const ev = build({
    modelEvidence: {
      validation_matrix: {
        items: [
          { case_id: 'changed_invariant_positive', test_path: 'tests/unit/authentic-review-evidence.test.js' },
          { case_id: 'material_negative_or_failure', command_or_check: 'rm -rf / ; echo pwned' },
        ],
      },
    },
    runNodeTest: (relPath) => {
      executed.push(relPath);
      return { status: 0, stdout: 'ok', stderr: '' };
    },
  });
  assert.deepStrictEqual(executed, ['tests/unit/authentic-review-evidence.test.js']);
  const byId = new Map(ev.validation_matrix.items.map(i => [i.case_id, i]));
  const pos = byId.get('changed_invariant_positive');
  assert.strictEqual(pos.status, 'passed');
  assert.strictEqual(pos.command_or_check, 'node --test tests/unit/authentic-review-evidence.test.js');
  assert.strictEqual(pos.exit_code, 0);
  assert.strictEqual(byId.get('material_negative_or_failure').status, 'unverified');
});

test('changed_line_classification and code_volume omit host judgment placeholders', () => {
  const ev = build();
  assert.deepStrictEqual(ev.changed_line_classification, {
    status: 'verified',
    files: ['skills/code-review/scripts/authentic-review.js', 'tests/unit/authentic-review-evidence.test.js'],
    additions: 4,
    deletions: 1,
  });
  assert.strictEqual('behavior_role' in ev.changed_line_classification, false);
  assert.strictEqual('compatibility_assessment' in ev.code_volume, false);
  assert.strictEqual(ev.code_volume.additions, 4);
  assert.strictEqual(ev.code_volume.deletions, 1);
});

test('symbol_map records only diff path+line without padding duplicates and stays unverified until judgment fields are complete', () => {
  const singleFileDiff = [
    'diff --git a/skills/code-review/scripts/authentic-review.js b/skills/code-review/scripts/authentic-review.js',
    '--- a/skills/code-review/scripts/authentic-review.js',
    '+++ b/skills/code-review/scripts/authentic-review.js',
    '@@ -10,1 +10,2 @@',
    '+const a = 1;',
  ].join('\n');
  const ev = build({ diff: singleFileDiff });
  assert.strictEqual(ev.symbol_map.status, 'unverified');
  assert.deepStrictEqual(ev.symbol_map.items, [
    { path: 'skills/code-review/scripts/authentic-review.js', line: 10 },
  ]);
});

test('model evidence cannot overwrite host validation_matrix exit codes', () => {
  const headOid = 'b'.repeat(40);
  const ev = buildEvidenceGraph({
    contract: CONTRACT,
    plan: PLAN,
    diff: DIFF,
    headOid,
    pr: 3,
    motivation: 'm',
    validation: buildValidationMatrix({ typecheck: 'FAILED (exit 2)', lint: 'PASSED', build: 'PASSED', test: 'PASSED' }, { headOid }),
    modelEvidence: {
      validation_matrix: {
        status: 'verified',
        items: [
          { case_id: 'typecheck', status: 'passed', exit_code: 0 },
          { case_id: 'changed_invariant_positive', status: 'passed' },
        ],
      },
    },
  });
  const byId = new Map(ev.validation_matrix.items.map(i => [i.case_id, i]));
  const tc = byId.get('typecheck');
  assert.strictEqual(tc.status, 'failed');
  assert.strictEqual(tc.exit_code, 2);
  assert.strictEqual(tc.failure_attribution.disposition, 'unresolved');
  assert.strictEqual(tc.failure_attribution.command, 'npm run typecheck');
  assert.strictEqual(tc.failure_attribution.exit_code, 2);
  assert.strictEqual(tc.failure_attribution.head_revision, headOid);
  assert.strictEqual(byId.get('changed_invariant_positive').status, 'unverified');
  assert.strictEqual(byId.get('repository_required_checks').status, 'unverified');
});

test('malformed or incomplete model judgment row stays unverified without host backfill', () => {
  const ev = build({
    modelEvidence: {
      problem_context: { goal_basis: 'only one field without status or nested objects' },
      change_proportionality: { status: 'verified', architecture_assessment: 'not-an-object', verdict: 'proportionate' },
      semantic_alignment: { status: 'verified', checked_scope: 'skills/code-review/scripts', impact_reason: 'none', verdict: 'not_applicable' },
    },
  });
  assert.deepStrictEqual(ev.problem_context, { status: 'unverified' });
  assert.deepStrictEqual(ev.change_proportionality, { status: 'unverified' });
  assert.strictEqual(ev.semantic_alignment.status, 'verified');
  assert.strictEqual(ev.semantic_alignment.verdict, 'not_applicable');
});

test('missing validation gates are not claimed as passed and record unresolved failure attribution', () => {
  const rows = buildValidationMatrix({ typecheck: 'FAILED (exit 1)' }, { headOid: 'c'.repeat(40) });
  const tc = rows.find(r => r.case_id === 'typecheck');
  assert.strictEqual(tc.status, 'failed');
  assert.strictEqual(tc.failure_attribution.disposition, 'unresolved');
  const items = buildValidationMatrix({ typecheck: 'FAILED (exit 1)' }).map(i => i.status);
  assert.ok(items.includes('failed'));
  assert.ok(items.includes('unverified'));
});

test('describeFileFromDiff uses actual diff or NOT_PROVIDED', () => {
  assert.match(describeFileFromDiff('a.js', 'diff --git a/a.js b/a.js\n+const x = 1;'), /实际 diff/);
  assert.match(describeFileFromDiff('a.js', ''), /NOT_PROVIDED/);
  assert.match(describeFileFromDiff('a.bin', 'Binary files a/a.bin and b/a.bin differ'), /二进制/);
});

test('scanDiff finds high-signal additions only', () => {
  const findings = scanDiff('+eval("x")\n-TODO old\n+TODO new\n');
  assert.ok(findings.some(f => f.rule === 'dynamic-eval'));
  assert.ok(findings.some(f => f.rule === 'tracked-todo'));
  assert.strictEqual(findings.filter(f => f.rule === 'tracked-todo').length, 1);
});
