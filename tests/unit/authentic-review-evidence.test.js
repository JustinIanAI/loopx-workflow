'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildEvidenceGraph,
  buildValidationMatrix,
  buildProblemContextFull,
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
    { evidence_id: 'validation_matrix', items_field: 'items', item_fields: ['case_id','invariant_or_case','command_or_check','status','result','required','skip_or_failure_reason'] },
    { evidence_id: 'changed_line_classification', fields: ['files','additions','deletions','behavior_role'] },
    { evidence_id: 'walkthroughs', positive_field: 'positive', positive_fields: ['trigger','ordered_symbols_or_steps','state_transitions','observable_result'], negative_field: 'negative', negative_fields: ['triggering_input_or_state','ordered_symbols_or_steps','rejection_fallback_or_wrong_outcome','error_or_retry_owner'] },
    { evidence_id: 'symbol_map', items_field: 'items', item_fields: ['path','line','symbol','responsibility','before_after_behavior','input_or_pre_state','critical_branch_or_invariant','callee_or_side_effect','return_or_consumer','failure_fallback_or_retry_owner','caller_evidence'], item_count: { minimum: 2, maximum: 5 } },
    { evidence_id: 'change_proportionality', fields: ['original_problem','frequency_or_severity','affected_users_or_operators','failure_cost_and_recovery','smallest_viable_fix','production_mechanism_cost','new_state_contract_or_cli_surface','maintenance_and_migration_cost','alternatives_considered','scope_growth_since_initial_review','repository_architecture_constraints','strongest_case_against_shipping','why_smaller_or_existing_owner_is_insufficient','architecture_assessment','verdict'], verdict_values: ['proportionate'] },
  ],
};

const PLAN = {
  required_evidence_ids: ['problem_context','architecture_flow','validation_matrix','changed_line_classification','walkthroughs','symbol_map','change_proportionality'],
  result_template: { review_policy_revision: 22, evidence: {} },
};

function build() {
  return buildEvidenceGraph({
    contract: CONTRACT,
    plan: PLAN,
    diff: DIFF,
    headOid: 'a'.repeat(40),
    pr: 3,
    motivation: 'review evidence graph for the combined R4 and issue 25 delivery',
    validation: buildValidationMatrix({ typecheck: 'PASSED', lint: 'PASSED', build: 'PASSED', test: 'PASSED' }),
    modelEvidence: null,
  });
}

test('builds all required evidence ids with verified status', () => {
  const ev = build();
  assert.strictEqual(Object.keys(ev).length, PLAN.required_evidence_ids.length);
  for (const id of PLAN.required_evidence_ids) {
    assert.strictEqual(ev[id].status, 'verified', id + ' must be verified');
  }
});

test('problem_context contains all required fields and valid outcome impact', () => {
  const pc = build().problem_context;
  for (const field of CONTRACT.evidence_requirements[0].fields) {
    assert.ok(pc[field] !== undefined && pc[field] !== '', 'missing ' + field);
  }
  assert.strictEqual(pc.outcome_impact.long_horizon.decision, 'not_applicable');
  assert.strictEqual(pc.outcome_impact.user_experience.decision, 'not_applicable');
  assert.strictEqual(pc.spec_basis.decision, 'no_spec');
});

test('validation matrix contains required cases and reasons for every row', () => {
  const items = build().validation_matrix.items;
  const ids = items.map(i => i.case_id);
  for (const required of ['typecheck','lint','build','test','changed_invariant_positive','material_negative_or_failure','repository_required_checks']) {
    assert.ok(ids.includes(required), 'missing case ' + required);
  }
  for (const item of items) {
    assert.strictEqual(typeof item.required, 'boolean');
    assert.ok(typeof item.skip_or_failure_reason === 'string' && item.skip_or_failure_reason.length > 0);
  }
});

test('changed_line_classification reflects the real diff, not a hardcoded template', () => {
  const row = build().changed_line_classification;
  assert.deepStrictEqual(row.files, ['skills/code-review/scripts/authentic-review.js','tests/unit/authentic-review-evidence.test.js']);
  assert.strictEqual(row.additions, 4);
  assert.strictEqual(row.deletions, 1);
});

test('symbol_map and walkthroughs satisfy native item/field shapes', () => {
  const ev = build();
  assert.ok(ev.symbol_map.items.length >= 2 && ev.symbol_map.items.length <= 5);
  for (const item of ev.symbol_map.items) {
    assert.ok(item.path && item.line && item.symbol && item.responsibility);
  }
  assert.ok(ev.walkthroughs.positive.trigger);
  assert.ok(ev.walkthroughs.negative.triggering_input_or_state);
});

test('model evidence cannot overwrite local validation_matrix', () => {
  const ev = buildEvidenceGraph({
    contract: CONTRACT,
    plan: PLAN,
    diff: DIFF,
    headOid: 'a'.repeat(40),
    pr: 3,
    motivation: 'm',
    validation: buildValidationMatrix({ typecheck: 'PASSED', lint: 'PASSED', build: 'PASSED', test: 'PASSED' }),
    modelEvidence: { validation_matrix: { status: 'verified', items: [{ case_id: 'fake' }] } },
  });
  assert.notDeepStrictEqual(ev.validation_matrix.items, [{ case_id: 'fake' }]);
  assert.ok(ev.validation_matrix.items.some(i => i.case_id === 'test'));
});

test('missing validation gates are not claimed as passed', () => {
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

test('problem context builder is deterministic and non-empty', () => {
  const a = buildProblemContextFull('motivation text', { feature: 'review-evidence-graph', headOid: 'b'.repeat(40) });
  const b = buildProblemContextFull('motivation text', { feature: 'review-evidence-graph', headOid: 'b'.repeat(40) });
  assert.deepStrictEqual(a, b);
  assert.ok(a.observable_outcome.length > 0);
});
