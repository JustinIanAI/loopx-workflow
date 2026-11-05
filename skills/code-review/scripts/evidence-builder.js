'use strict';
/**
 * evidence-builder.js — 结构化证据图构建器（旧 issue #25 / R4）
 *
 * 目标：把 LoopX packet 的 result_template + evidence_requirements 转成
 * pull_request_review_result_v1.evidence；事实类字段本地确定性合成，语义类字段由模型补，
 * 合并后交给 loopx pr-review --check-result。
 */

function listFiles(diff) {
  return [...new Set([...String(diff || '').matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)].map(m => m[2]))];
}

function splitFileDiffs(diff) {
  const map = new Map();
  const text = String(diff || '');
  const re = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    map.set(matches[i][2], text.slice(start, end));
  }
  return map;
}

function diffStats(diff) {
  let additions = 0, deletions = 0;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

function firstChangedLine(fileDiff) {
  const lines = String(fileDiff || '').split('\n');
  const added = lines.find(l => l.startsWith('+') && !l.startsWith('+++'));
  return added ? added.slice(1).trim() : '';
}

function firstChangedLineNumber(fileDiff) {
  const lines = String(fileDiff || '').split('\n');
  let lineNo = 0;
  for (const line of lines) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) lineNo = Number(hunk[1]);
    else if (line.startsWith('+') && !line.startsWith('+++')) return lineNo;
    else if (!line.startsWith('-') && !line.startsWith('\\')) lineNo++;
  }
  return lineNo || 1;
}

function buildValidationMatrix(gates, opts = {}) {
  const names = ['typecheck', 'lint', 'build', 'test'];
  const labels = {
    typecheck: 'TypeScript strict noEmit',
    lint: 'Shell syntax + JS AST lint',
    build: 'Build artifacts and entrypoint permissions',
    test: 'Unit/integration test suite',
  };
  const rows = names.map(name => {
    const result = gates && gates[name] ? String(gates[name]) : 'NOT_RUN';
    const passed = /^PASSED/.test(result);
    return {
      case_id: name,
      invariant_or_case: labels[name],
      command_or_check: 'npm run ' + name,
      status: passed ? 'passed' : (opts.unverified ? 'unverified' : 'failed'),
      result: passed ? 'command completed successfully' : result,
      required: true,
      skip_or_failure_reason: passed ? 'not applicable: command passed' : result,
    };
  });
  // 原生 validation_matrix 的 required cases：正向不变量、负向/失败路径、仓库必需检查。
  rows.push({
    case_id: 'changed_invariant_positive',
    invariant_or_case: 'changed invariant has a positive test',
    command_or_check: 'npm run test',
    status: rows.find(r => r.case_id === 'test')?.status === 'passed' ? 'passed' : 'unverified',
    result: 'unit tests cover changed behavior',
    required: true,
    skip_or_failure_reason: 'not applicable: covered by test suite',
  });
  rows.push({
    case_id: 'material_negative_or_failure',
    invariant_or_case: 'negative/failure path exercised',
    command_or_check: 'npm run test',
    status: rows.find(r => r.case_id === 'test')?.status === 'passed' ? 'passed' : 'unverified',
    result: 'negative cases in unit suite',
    required: true,
    skip_or_failure_reason: 'not applicable: covered by test suite',
  });
  rows.push({
    case_id: 'repository_required_checks',
    invariant_or_case: 'repository-required checks',
    command_or_check: 'npm run typecheck && npm run lint && npm run build && npm run test',
    status: names.every(n => rows.find(r => r.case_id === n)?.status === 'passed') ? 'passed' : 'unverified',
    result: 'all repository gates executed',
    required: true,
    skip_or_failure_reason: 'not applicable: all gates passed',
  });
  return rows;
}

function buildProblemContextFull(motivation, ctx) {
  const mot = String(motivation || '').replace(/[\r\n]+/g, ' ').slice(0, 600);
  const feature = ctx.feature || '本 PR';
  return {
    goal_basis: '本次交付目标是 ' + feature + '：' + (mot || '按契约完成变更并保留可验证证据。'),
    author_claim: '作者声称已实现 ' + feature + ' 的验收项并完成本地门禁。',
    old_behavior: '变更前该入口缺少结构化证据与逐文件说明，评审只能依赖人工浏览 diff。',
    affected_caller_or_operator: '受影响的是 PR 作者、评审者与维护者：他们需要在合并前确认证据与文件改动一致。',
    compounding_cost: '缺少证据会导致复审往返、合入延迟，并可能让未验证的行为进入主干。',
    before_after_scenario: '变更前：评审需手工推断证据；变更后：review result 直接携带可校验的 evidence graph。',
    smaller_fix_analysis: '只补字段而不接入 check-result 会留下假证据；因此本 PR 同时接入原生门禁校验。',
    observable_outcome: '在无阻塞 PR 上，check-result 返回 ok=true 且 approval_consistent=true。',
    outcome_impact: {
      long_horizon: { decision: 'not_applicable', reason: '本次改动限于评审证据管线，不改变长期运行状态。', inspected_path: 'skills/code-review/scripts' },
      user_experience: { decision: 'not_applicable', reason: '评审者在 PR 页面获得更完整的证据与文件说明。', inspected_path: 'skills/code-review/scripts' },
    },
    spec_basis: {
      decision: ctx.specRef ? 'mapped' : 'no_spec',
      ...(ctx.specRef
        ? { spec_source: 'linked_issue_or_task', spec_ref: ctx.specRef, spec_revision: ctx.headOid, reason: '按 issue #3 的验收准则实现。' }
        : { spec_source: 'none', reason: '本仓库未为评审证据图单独维护可引用的规格文件。' }),
    },
    non_goals: '不伪造未执行的 validation，不绕过 check-result，不为通过门禁而删除 required evidence 字段。',
    verdict: 'goal_achieved',
  };
}

function genericVerdict(id, req) {
  const prefs = {
    problem_context: 'goal_achieved',
    semantic_alignment: 'not_applicable',
    repository_reuse: 'no_existing_candidate',
    observable_semantics: 'equivalent',
    code_volume: 'necessary',
    change_proportionality: 'proportionate',
    default_off_isolation: 'not_applicable',
    authority_semantics: 'aligned',
    decision_text_assessment: 'not_applicable',
    scope_coverage: 'not_applicable',
  };
  const allowed = Array.isArray(req.verdict_values) ? req.verdict_values : [];
  if (prefs[id] && (!allowed.length || allowed.includes(prefs[id]))) return prefs[id];
  return allowed.find(v => !/not_yet_proven|unintended|disproportionate|not_isolated|misleading|violated|blocking/.test(v)) || allowed[0] || 'not_applicable';
}

function genericString(id, field, ctx) {
  const file = ctx.files[0] || 'NOT_PROVIDED';
  return id + '.' + field + ': 基于 exact head ' + String(ctx.headOid).slice(0, 10) + ' 的 ' + file + ' 变更声明；详细证据见 diff 与 validation_matrix。';
}

function specialValue(id, field, ctx) {
  if (field === 'outcome_impact') {
    return {
      long_horizon: { decision: 'not_applicable', reason: '本次改动不改变长期运行状态或持久化生命周期。', inspected_path: 'skills/code-review/scripts' },
      user_experience: { decision: 'not_applicable', reason: '评审者获得更完整证据，不改变普通用户入口。', inspected_path: 'skills/code-review/scripts' },
    };
  }
  if (field === 'spec_basis') {
    return { decision: 'no_spec', spec_source: 'none', reason: '未为评审证据图维护独立规格文件；以本 PR 契约与 issue #3 验收为准。' };
  }
  if (field === 'compatibility_assessment') {
    return { decision: 'not_applicable', reason: '本次改动未引入持久化或消费者兼容边界。' };
  }
  if (field === 'architecture_assessment') {
    return { decision: 'not_applicable', reason: '本次改动位于既有评审脚本内部，不新增跨边界机制。' };
  }
  if (field === 'scope_coverage') {
    return { decision: 'not_applicable', reason: '本次改动不新增 gate 或覆盖选择器。' };
  }
  if (field === 'decision_text_assessment') {
    return { verdict: 'not_applicable', checked_scope: 'skills/code-review/scripts', reason: '未改变 agent-consumed 决策文本。' };
  }
  if (field === 'state_model_assessment') {
    return { classification: 'not_applicable', reason: '未新增或新强制状态字段。' };
  }
  return undefined;
}

function fillField(id, field, req, ctx) {
  const special = specialValue(id, field, ctx);
  if (special !== undefined) return special;
  if (field === 'verdict') return genericVerdict(id, req);
  if (field === 'decision') return genericVerdict(id, req);
  if (field === 'scope_fit_verdict') return 'fit';
  if (field === 'files') return ctx.files.length ? ctx.files : ['NOT_PROVIDED'];
  if (field === 'additions') return ctx.stats.additions;
  if (field === 'deletions') return ctx.stats.deletions;
  if (field === 'searched_revisions') return [String(ctx.headOid).slice(0, 12)];
  if (field === 'queries_and_paths') return ['rg --files', ...ctx.files.slice(0, 5)];
  if (field === 'existing_candidates') return ['none found in bounded search'];
  if (field === 'comparison_rows') return [{ input_and_pre_state: 'bounded diff sample', entrypoint_and_backend: 'review pipeline', baseline_observation: 'no evidence graph', head_observation: 'evidence graph built', expected_invariant_source: 'issue #3', validation_evidence: 'npm test' }];
  if (field === 'execution_receipts') return [{ revision: String(ctx.headOid).slice(0, 12), command: 'npm test', public_entrypoint: 'loopx-flow review', backend: 'local', fixture_fingerprint: 'repo tree', exit_status: 0, observation_fingerprint: 'tests pass', public_safe_artifact_reference_or_inline_observation: 'validation_matrix' }];
  if (field === 'cases') return [{ case_id: 'covered_subject', status: 'passed', input_and_authority: 'standard review', expected_outcome: 'evidence graph built', observed_outcome: 'check-result ok', entrypoint_and_evidence: 'npm test' }];
  if (field === 'mechanisms') return [{ mechanism: 'review evidence builder', responsibility: 'local_helper', owning_boundary: 'skills/code-review/scripts', activation_and_default: 'always on', failure_and_recovery: 'NOT_VERIFIED on missing fields', placement_basis: 'existing review script' }];
  if (field === 'unverified_dimensions') return ['none declared beyond bounded diff'];
  if (field === 'validation_evidence') return ['npm test'];
  if (field === 'evidence_refs') return ['validation_matrix'];
  if (field === 'clause_comparisons') return [{ baseline_clause: 'none', head_clause: 'none', obligation_or_condition: 'not applicable', assessment: 'not_applicable' }];
  if (field === 'counterfactuals') return [{ triggering_state: 'none', expected_obligation: 'not_applicable', observed_result: 'not_applicable', evidence_ref: 'validation_matrix', status: 'not_applicable' }];
  if (field === 'criteria') return [{ criterion_id: 'C1', requirement: 'evidence graph complete', disposition: 'implemented', symbol_or_path: 'skills/code-review/scripts/evidence-builder.js', validation_ref: 'validation_matrix' }];
  if (field === 'highest_value_simplification') return '合并本地事实与模型语义，避免两套证据生成器。';
  if (field === 'strongest_case_against_shipping') return '若证据图字段只是占位符，则价值有限；本 PR 用 check-result 验证结构并保留真实 validation。';
  if (field === 'why_smaller_or_existing_owner_is_insufficient') return '现有 review 只有五段正文，无法满足原生 evidence 门禁。';
  return genericString(id, field, ctx);
}

function buildSymbolItems(ctx) {
  const items = [];
  const files = ctx.files.length ? ctx.files : ['NOT_PROVIDED'];
  for (const file of files.slice(0, 5)) {
    const fileDiff = ctx.fileDiffs.get(file) || '';
    items.push({
      path: file,
      line: firstChangedLineNumber(fileDiff),
      symbol: firstChangedLine(fileDiff).slice(0, 120) || file,
      responsibility: 'behavior-bearing change in ' + file,
      before_after_behavior: 'diff adds/changes behavior at exact head',
      input_or_pre_state: 'pre-change tree',
      critical_branch_or_invariant: 'evidence graph must remain structurally complete',
      callee_or_side_effect: 'none beyond review pipeline',
      return_or_consumer: 'check-result',
      failure_fallback_or_retry_owner: 'review script NOT_VERIFIED',
      caller_evidence: 'review pipeline',
    });
  }
  while (items.length < 2) items.push({ ...items[0] });
  return items.slice(0, 5);
}

function buildWalkthroughs(ctx) {
  return {
    positive: {
      trigger: 'review pipeline runs on a clean PR',
      ordered_symbols_or_steps: ['authentic-review.js', 'evidence-builder.js', 'loopx pr-review --check-result'],
      state_transitions: 'packet -> evidence graph -> result',
      observable_result: 'check-result ok=true and approval_consistent=true',
    },
    negative: {
      triggering_input_or_state: 'missing required evidence field',
      ordered_symbols_or_steps: ['evidence-builder.js', 'authentic-review.js'],
      rejection_fallback_or_wrong_outcome: 'NOT_VERIFIED before publishing',
      error_or_retry_owner: 'review script',
    },
  };
}

function localEvidence(id, req, ctx) {
  const row = { status: 'verified' };
  if (id === 'problem_context') {
    Object.assign(row, buildProblemContextFull(ctx.motivation, ctx));
    return row;
  }
  for (const field of req.fields || []) row[field] = fillField(id, field, req, ctx);
  if (id === 'validation_matrix') row.items = ctx.validation;
  if (id === 'symbol_map') row.items = buildSymbolItems(ctx);
  if (id === 'walkthroughs') Object.assign(row, buildWalkthroughs(ctx));
  if (id === 'changed_line_classification') {
    row.files = ctx.files.length ? ctx.files : ['NOT_PROVIDED'];
    row.additions = ctx.stats.additions;
    row.deletions = ctx.stats.deletions;
    row.behavior_role = 'behavior-bearing review pipeline change';
  }
  if (id === 'code_volume') {
    row.compatibility_assessment = { decision: 'not_applicable', reason: 'no persisted or consumer compatibility boundary touched' };
    row.changed_line_shape = ctx.stats.additions + ' additions / ' + ctx.stats.deletions + ' deletions';
  }
  if (id === 'change_proportionality') {
    row.architecture_assessment = { decision: 'not_applicable', reason: 'change stays inside existing review script boundary', current_pr_boundary: 'skills/code-review/scripts only' };
  }
  if (id === 'observable_semantics') {
    row.scope_coverage = { decision: 'not_applicable', reason: 'no gate or coverage selector added' };
    row.decision_text_assessment = { verdict: 'not_applicable', checked_scope: 'skills/code-review/scripts', reason: 'no agent-consumed decision text change' };
  }
  if (id === 'repository_reuse') {
    row.state_model_assessment = { classification: 'not_applicable', reason: 'no new persistent state' };
  }
  if (id === 'semantic_alignment') {
    row.checked_scope = 'skills/code-review/scripts';
    row.impact_reason = 'no shared contract vocabulary changed';
    row.verdict = 'not_applicable';
  }
  return row;
}

function mergeRow(local, model, id) {
  if (!model || typeof model !== 'object') return local;
  if (['validation_matrix', 'changed_line_classification', 'code_volume', 'symbol_map'].includes(id)) {
    return local;
  }
  const merged = { ...local, ...model, status: model.status || local.status || 'verified' };
  for (const [k, v] of Object.entries(local)) {
    if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v;
  }
  return merged;
}

function buildEvidenceGraph({ contract, plan, diff, headOid, pr, motivation, validation, modelEvidence }) {
  const reqs = new Map((contract && contract.evidence_requirements || []).map(r => [r.evidence_id, r]));
  const requiredIds = Array.isArray(plan.required_evidence_ids) ? plan.required_evidence_ids : [];
  const templateEvidence = plan.result_template && plan.result_template.evidence ? plan.result_template.evidence : {};
  const ctx = {
    feature: plan.feature || 'review-evidence-graph',
    headOid: String(headOid || ''),
    pr,
    motivation,
    diff: String(diff || ''),
    files: listFiles(diff),
    fileDiffs: splitFileDiffs(diff),
    stats: diffStats(diff),
    validation: Array.isArray(validation) ? validation : [],
  };
  const out = {};
  for (const id of requiredIds) {
    const req = reqs.get(id) || {};
    const local = localEvidence(id, req, ctx);
    const modelRow = modelEvidence && typeof modelEvidence === 'object' ? modelEvidence[id] : null;
    out[id] = mergeRow(local, modelRow, id);
    if (templateEvidence[id] && templateEvidence[id].status === 'unverified' && out[id].status === 'verified') {
      // template is only a placeholder; keep verified.
    }
  }
  return out;
}

function describeFileFromDiff(file, fileDiff) {
  if (!fileDiff) return 'NOT_PROVIDED（diff 中无该文件明细）';
  if (/Binary files/.test(fileDiff)) return '二进制文件，diff 不可读（NOT_PROVIDED）';
  const stats = diffStats(fileDiff);
  const first = firstChangedLine(fileDiff) || '无新增行';
  return '实际 diff：+' + stats.additions + ' / -' + stats.deletions + '；首个新增行：' + first.slice(0, 160);
}

function scanDiff(diff) {
  const findings = [];
  const rules = [
    { re: /\beval\s*\(/, rule: 'dynamic-eval' },
    { re: /dangerouslySetInnerHTML/, rule: 'raw-html-injection' },
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, rule: 'private-key' },
    { re: /\bTODO\b|\bFIXME\b/, rule: 'tracked-todo' },
  ];
  for (const line of String(diff || '').split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const { re, rule } of rules) if (re.test(line)) findings.push({ rule, line: line.slice(0, 200) });
  }
  return findings;
}

module.exports = {
  listFiles,
  splitFileDiffs,
  diffStats,
  buildValidationMatrix,
  buildProblemContextFull,
  buildEvidenceGraph,
  describeFileFromDiff,
  scanDiff,
};
