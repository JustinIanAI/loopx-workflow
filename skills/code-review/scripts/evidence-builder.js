'use strict';
/**
 * evidence-builder.js — 结构化证据图装配器（issue #15）
 *
 * 原则：
 *   - verified 只授予本次审查进程自己量到的事实（changed_line_classification / code_volume /
 *     validation_matrix 的四门禁与 repository_required_checks / symbol_map 的 path+line）。
 *   - changed_invariant_positive 与 material_negative_or_failure 默认 unverified，只能由审查者指定
 *     仓库内已存在的测试文件路径并由主机执行 `node --test <path>` 退出码 0 后写 passed。
 *   - 判断类 evidence id 由审查者填写，主机绝不预填或回填占位句；缺失或形状不合法保持 unverified。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isMissingValue(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
}

function parseGateOutcome(raw) {
  if (typeof raw === 'number') {
    return {
      ran: true,
      passed: raw === 0,
      exitCode: raw,
      detail: raw === 0 ? 'command completed successfully (exit 0)' : `FAILED (exit ${raw})`,
    };
  }
  if (isPlainObject(raw)) {
    const statusStr = String(raw.status || '');
    const ran = statusStr !== 'not_run' && statusStr !== 'unverified';
    const code = typeof raw.exit_code === 'number'
      ? raw.exit_code
      : (typeof raw.exitCode === 'number' ? raw.exitCode : (/^passed$/i.test(statusStr) ? 0 : 1));
    const passed = ran && code === 0;
    return {
      ran,
      passed,
      exitCode: ran ? code : null,
      detail: passed ? 'command completed successfully (exit 0)' : String(raw.result || statusStr || `FAILED (exit ${code})`),
    };
  }
  if (typeof raw === 'string' && raw.trim() && raw !== 'NOT_RUN' && !/^unverified$/i.test(raw.trim())) {
    const passed = /^PASSED\b/i.test(raw) || raw.trim() === '0';
    const m = raw.match(/exit\s+(-?\d+)/i);
    const exitCode = passed ? 0 : (m ? Number(m[1]) : 1);
    return {
      ran: true,
      passed,
      exitCode,
      detail: passed ? 'command completed successfully' : raw,
    };
  }
  return { ran: false, passed: false, exitCode: null, detail: 'NOT_RUN' };
}

function buildUnresolvedAttribution(command, exitCode, headOid, label) {
  const head = String(headOid || '');
  return {
    disposition: 'unresolved',
    command,
    exit_code: exitCode,
    head,
    head_revision: head,
    causal_scope_analysis: `${command} exited with code ${exitCode} at head ${head || 'unknown'} without base comparison`,
    affected_invariant_evidence: `${label} (${command}, exit_code=${exitCode}, head=${head || 'unknown'})`,
  };
}

const REPO_TEST_FILE = /^(?:\.\/)?tests\/.+\.test\.(?:js|mjs|cjs|ts)$/;

function resolveRepoTestPath(candidate, repoRoot) {
  let raw = '';
  if (typeof candidate === 'string') {
    raw = candidate.trim();
  } else if (isPlainObject(candidate)) {
    raw = String(candidate.test_path || candidate.path || candidate.file || candidate.command_or_check || '').trim();
  }
  if (!raw) return null;
  if (/^node\s+--test\s+/.test(raw)) {
    raw = raw.replace(/^node\s+--test\s+/, '').trim();
  }
  if (!raw || /^npm\b/i.test(raw) || /^NOT_RUN$/i.test(raw) || raw.startsWith('-')) return null;
  if (!/^[A-Za-z0-9_./-]+$/.test(raw)) return null;
  if (!REPO_TEST_FILE.test(raw.replace(/\\/g, '/'))) return null;
  const root = path.resolve(repoRoot || process.cwd());
  const abs = path.resolve(root, raw);
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !REPO_TEST_FILE.test(rel)) return null;
  let realRoot;
  let realAbs;
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    realRoot = fs.realpathSync(root);
    realAbs = fs.realpathSync(abs);
  } catch (_) {
    return null;
  }
  const realRel = path.relative(realRoot, realAbs).replace(/\\/g, '/');
  if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel) || !REPO_TEST_FILE.test(realRel)) return null;
  return { abs: realAbs, rel: realRel, root: realRoot };
}

const REVIEW_THROTTLE_ENV_KEYS = [
  'REVIEW_SHORTCIRCUIT',
  'REVIEW_DEBOUNCE_SECONDS',
  'REVIEW_UPSERT_PUBLISH',
  'REVIEW_BACKOFF_BASE_MS',
  'REVIEW_MAX_RETRIES',
  'REVIEW_KEEP_PROMPT',
  'REVIEW_TWO_STAGE_ALIGNMENT',
];

function isolatedNodeTestEnv(baseEnv) {
  const src = baseEnv || process.env;
  const out = {};
  for (const k of Object.keys(src)) {
    if (!REVIEW_THROTTLE_ENV_KEYS.includes(k)) out[k] = src[k];
  }
  return out;
}

function defaultRunNodeTest(relPath, cwd) {
  return spawnSync(process.execPath, ['--test', relPath], { cwd, env: isolatedNodeTestEnv(process.env), encoding: 'utf8', timeout: 120000 });
}

function resolveRepoTestPaths(candidate, repoRoot) {
  let arr = null;
  if (Array.isArray(candidate)) {
    arr = candidate;
  } else if (isPlainObject(candidate)) {
    const field = candidate.test_path ?? candidate.path ?? candidate.file ?? candidate.command_or_check;
    if (Array.isArray(field)) arr = field;
  }
  if (arr) {
    if (!arr.length) return null;
    const list = [];
    for (const item of arr) {
      const r = resolveRepoTestPath(item, repoRoot);
      if (!r) return null;
      list.push(r);
    }
    return list;
  }
  const single = resolveRepoTestPath(candidate, repoRoot);
  return single ? [single] : null;
}

function buildInvariantRow(caseId, label, candidate, opts = {}) {
  const resolvedList = resolveRepoTestPaths(candidate, opts.repoRoot);
  if (!resolvedList || !resolvedList.length) {
    return {
      case_id: caseId,
      invariant_or_case: label,
      command_or_check: 'NOT_RUN',
      status: 'unverified',
      result: 'unverified: requires reviewer-designated repository test path',
      required: true,
      skip_or_failure_reason: 'unverified: npm run test passing does not prove this invariant',
    };
  }
  const runner = typeof opts.runNodeTest === 'function'
    ? opts.runNodeTest
    : defaultRunNodeTest;
  for (const resolved of resolvedList) {
    const res = runner(resolved.rel, resolved.root);
    const exitCode = res && typeof res.status === 'number' ? res.status : 1;
    if (exitCode !== 0) {
      const failCmd = `node --test ${resolved.rel}`;
      return {
        case_id: caseId,
        invariant_or_case: label,
        command_or_check: failCmd,
        exit_code: exitCode,
        status: 'failed',
        result: `${failCmd} failed (exit ${exitCode})`,
        required: true,
        skip_or_failure_reason: `${failCmd} exited with code ${exitCode}`,
        failure_attribution: buildUnresolvedAttribution(failCmd, exitCode, opts.headOid, label),
      };
    }
  }
  const cmd = `node --test ${resolvedList.map(r => r.rel).join(' ')}`;
  return {
    case_id: caseId,
    invariant_or_case: label,
    command_or_check: cmd,
    exit_code: 0,
    status: 'passed',
    result: `${cmd} (exit 0)`,
    required: true,
    skip_or_failure_reason: 'not applicable: command passed',
  };
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
    const hasKey = Boolean(gates) && Object.prototype.hasOwnProperty.call(gates, name);
    const outcome = parseGateOutcome(hasKey ? gates[name] : undefined);
    const cmd = 'npm run ' + name;
    if (outcome.passed) {
      return {
        case_id: name,
        invariant_or_case: labels[name],
        command_or_check: cmd,
        exit_code: 0,
        status: 'passed',
        result: outcome.detail,
        required: true,
        skip_or_failure_reason: 'not applicable: command passed',
      };
    }
    if (!outcome.ran && opts.unverified) {
      return {
        case_id: name,
        invariant_or_case: labels[name],
        command_or_check: cmd,
        status: 'unverified',
        result: 'NOT_RUN',
        required: true,
        skip_or_failure_reason: 'NOT_RUN',
      };
    }
    const exitCode = outcome.exitCode == null ? 1 : outcome.exitCode;
    return {
      case_id: name,
      invariant_or_case: labels[name],
      command_or_check: cmd,
      exit_code: exitCode,
      status: 'failed',
      result: outcome.detail,
      required: true,
      skip_or_failure_reason: outcome.detail,
      failure_attribution: buildUnresolvedAttribution(cmd, exitCode, opts.headOid, labels[name]),
    };
  });
  const inv = isPlainObject(opts.invariantTests) ? opts.invariantTests : {};
  rows.push(buildInvariantRow(
    'changed_invariant_positive',
    'changed invariant has a positive test',
    inv.changed_invariant_positive,
    opts,
  ));
  rows.push(buildInvariantRow(
    'material_negative_or_failure',
    'negative/failure path exercised',
    inv.material_negative_or_failure,
    opts,
  ));
  const allFourPassed = names.every(n => rows.find(r => r.case_id === n)?.status === 'passed');
  const remoteChecks = Array.isArray(opts.remoteChecks) ? opts.remoteChecks.filter(isPlainObject) : [];
  const remoteSummary = remoteChecks.length
    ? remoteChecks.map(c => `${c.name || 'check'}=${c.bucket || c.state || 'unknown'}`).join(', ')
    : '';
  rows.push({
    case_id: 'repository_required_checks',
    invariant_or_case: 'repository-required checks',
    command_or_check: remoteChecks.length
      ? 'npm run typecheck && npm run lint && npm run build && npm run test ; gh pr checks'
      : 'npm run typecheck && npm run lint && npm run build && npm run test',
    status: allFourPassed ? 'passed' : 'unverified',
    result: allFourPassed
      ? (remoteSummary ? `all repository gates executed; remote checks: ${remoteSummary}` : 'all repository gates executed')
      : (remoteSummary ? `not all repository gates passed; remote checks: ${remoteSummary}` : 'not all repository gates passed'),
    required: true,
    skip_or_failure_reason: allFourPassed ? 'not applicable: all gates passed' : 'unverified: not all repository gates exited 0',
  });
  for (const rc of remoteChecks) {
    const bucket = String(rc.bucket || '').toLowerCase();
    if (bucket === 'pass') continue;
    const slug = String(rc.name || 'check').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'check';
    const status = bucket === 'fail'
      ? 'failed'
      : (bucket === 'pending' ? 'pending' : ((bucket === 'skipping' || bucket === 'cancel') ? 'skipped' : 'unverified'));
    rows.push({
      case_id: `remote_check_${slug}`,
      invariant_or_case: `remote CI check: ${rc.name || slug}`,
      command_or_check: `gh pr checks (${rc.name || slug})`,
      status,
      result: `${rc.name || slug}: ${rc.state || rc.bucket || 'unknown'}`,
      required: false,
      skip_or_failure_reason: `diagnostic remote CI observation (${rc.state || rc.bucket || 'unknown'})`,
    });
  }
  return rows;
}

function extractModelInvariantCandidate(modelValidation, caseId) {
  if (!isPlainObject(modelValidation)) return null;
  if (modelValidation[caseId] !== undefined) return modelValidation[caseId];
  if (Array.isArray(modelValidation.items)) {
    const found = modelValidation.items.find(it => isPlainObject(it) && it.case_id === caseId);
    if (found) return found;
  }
  return null;
}

function buildHostValidationRow(ctx, modelValidation) {
  const baseItems = Array.isArray(ctx.validation) && ctx.validation.length
    ? ctx.validation.map(item => ({ ...item }))
    : buildValidationMatrix({}, { unverified: true, headOid: ctx.headOid, repoRoot: ctx.repoRoot, runNodeTest: ctx.runNodeTest });
  const labels = {
    changed_invariant_positive: 'changed invariant has a positive test',
    material_negative_or_failure: 'negative/failure path exercised',
  };
  for (const caseId of ['changed_invariant_positive', 'material_negative_or_failure']) {
    const candidate = extractModelInvariantCandidate(modelValidation, caseId);
    if (!candidate) continue;
    const evaluated = buildInvariantRow(caseId, labels[caseId], candidate, {
      headOid: ctx.headOid,
      repoRoot: ctx.repoRoot,
      runNodeTest: ctx.runNodeTest,
    });
    const idx = baseItems.findIndex(item => item && item.case_id === caseId);
    if (idx >= 0) baseItems[idx] = evaluated;
    else baseItems.push(evaluated);
  }
  return {
    status: 'verified',
    items: baseItems,
  };
}

const OBJECT_FACT_FIELDS = new Set(['compatibility_assessment']);

function copyReviewerFactField(modelRow, key) {
  if (!isPlainObject(modelRow) || isMissingValue(modelRow[key])) return undefined;
  if (OBJECT_FACT_FIELDS.has(key) && !isPlainObject(modelRow[key])) return undefined;
  return modelRow[key];
}

function factRowStatus(req, row) {
  const fields = Array.isArray(req && req.fields) ? req.fields : [];
  if (fields.some(field => isMissingValue(row[field]))) return 'unverified';
  if (Array.isArray(req && req.verdict_values) && req.verdict_values.length && !req.verdict_values.includes(row.verdict)) {
    return 'unverified';
  }
  return 'verified';
}

function buildChangedLineClassificationRow(ctx, req, modelRow) {
  const row = {
    files: ctx.files.slice(),
    additions: ctx.stats.additions,
    deletions: ctx.stats.deletions,
  };
  const behaviorRole = copyReviewerFactField(modelRow, 'behavior_role');
  if (behaviorRole !== undefined) row.behavior_role = behaviorRole;
  row.status = factRowStatus(req, row);
  return row;
}

function buildCodeVolumeRow(ctx, req, modelRow) {
  const row = {
    additions: ctx.stats.additions,
    deletions: ctx.stats.deletions,
    changed_line_shape: `${ctx.stats.additions} additions / ${ctx.stats.deletions} deletions`,
  };
  for (const key of [
    'largest_production_hotspots',
    'active_call_site_evidence',
    'compatibility_assessment',
    'verdict',
    'highest_value_simplification',
    'behavior_preserving_validation',
  ]) {
    const value = copyReviewerFactField(modelRow, key);
    if (value !== undefined) row[key] = value;
  }
  row.additions = ctx.stats.additions;
  row.deletions = ctx.stats.deletions;
  row.changed_line_shape = `${ctx.stats.additions} additions / ${ctx.stats.deletions} deletions`;
  row.status = factRowStatus(req, row);
  return row;
}

function buildSymbolMapRow(req, ctx, modelRow) {
  const anchors = ctx.files.map(file => ({
    path: file,
    line: firstChangedLineNumber(ctx.fileDiffs.get(file) || ''),
  }));
  const byPath = new Map(anchors.map(item => [item.path, item]));
  const itemFields = Array.isArray(req.item_fields) && req.item_fields.length
    ? req.item_fields
    : [
        'path',
        'line',
        'symbol',
        'responsibility',
        'before_after_behavior',
        'input_or_pre_state',
        'critical_branch_or_invariant',
        'callee_or_side_effect',
        'return_or_consumer',
        'failure_fallback_or_retry_owner',
        'caller_evidence',
      ];
  const minItems = req.item_count && typeof req.item_count.minimum === 'number' ? req.item_count.minimum : 2;
  const maxItems = req.item_count && typeof req.item_count.maximum === 'number' ? req.item_count.maximum : 5;
  const hostItems = anchors.slice(0, maxItems);
  const unverified = { status: 'unverified', items: hostItems };
  if (!isPlainObject(modelRow) || modelRow.status !== 'verified' || !Array.isArray(modelRow.items)) {
    return unverified;
  }
  const candidateItems = modelRow.items.slice(0, maxItems);
  if (candidateItems.length < minItems || candidateItems.some(it => !isPlainObject(it))) {
    return unverified;
  }
  if (candidateItems.some(it => !byPath.has(it.path))) return unverified;
  const mergedItems = candidateItems.map(it => {
    const anchor = byPath.get(it.path);
    return { ...it, path: anchor.path, line: anchor.line };
  });
  const complete = mergedItems.every(it => itemFields.every(f => !isMissingValue(it[f])));
  if (!complete) return unverified;
  return { status: 'verified', items: mergedItems };
}

function extractNotApplicableReason(modelRow) {
  if (!isPlainObject(modelRow)) return '';
  if (typeof modelRow.reason === 'string' && modelRow.reason.trim()) return modelRow.reason.trim();
  for (const [k, v] of Object.entries(modelRow)) {
    if (k === 'status' || k === 'verdict') continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function isNotApplicableDeclaration(id, modelRow, req) {
  if (!isPlainObject(modelRow)) return false;
  if (id === 'problem_context' || id === 'walkthroughs') return false;
  if (Array.isArray(req && req.verdict_values) && req.verdict_values.length && !req.verdict_values.includes('not_applicable')) {
    return false;
  }
  const hasNaTag = modelRow.status === 'not_applicable'
    || (modelRow.verdict === 'not_applicable' && (!Array.isArray(req.verdict_values) || req.verdict_values.includes('not_applicable')));
  if (!hasNaTag) return false;
  return Boolean(extractNotApplicableReason(modelRow));
}

function coerceScalarText(val) {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && val.length && val.every(item => typeof item === 'string')) {
    const joined = val.map(s => s.trim()).filter(Boolean).join('；');
    if (joined) return joined;
  }
  return val;
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

const PROBLEM_CONTEXT_TEXT_FIELDS = [
  'goal_basis',
  'author_claim',
  'old_behavior',
  'affected_caller_or_operator',
  'compounding_cost',
  'before_after_scenario',
  'smaller_fix_analysis',
  'observable_outcome',
  'non_goals',
  'remaining_gap',
  'next_step',
  'boundary_reason',
  'reason',
  'minimum_repair',
];

const PROBLEM_PUBLICATION_FIELDS = [
  'affected_caller_or_operator',
  'before_after_scenario',
  'observable_outcome',
  'non_goals',
];

const ARCH_MECHANISM_FIELDS = [
  'mechanism',
  'responsibility',
  'owning_boundary',
  'activation_and_default',
  'failure_and_recovery',
  'placement_basis',
];

const ARCH_RESPONSIBILITIES = new Set(['invariant', 'policy', 'provider_io', 'projection', 'local_helper']);

function normalizeJudgmentInput(id, modelRow) {
  if (!isPlainObject(modelRow)) return modelRow;
  const copy = { ...modelRow };
  if (id === 'problem_context') {
    for (const f of PROBLEM_CONTEXT_TEXT_FIELDS) {
      if (copy[f] !== undefined) copy[f] = coerceScalarText(copy[f]);
    }
  } else if (id === 'change_proportionality' && isPlainObject(copy.architecture_assessment)) {
    const aa = { ...copy.architecture_assessment };
    for (const f of ['decision', 'reason', 'current_pr_boundary', 'validation_evidence']) {
      if (aa[f] !== undefined) aa[f] = coerceScalarText(aa[f]);
    }
    if (Array.isArray(aa.mechanisms)) {
      aa.mechanisms = aa.mechanisms.map(m => {
        if (!isPlainObject(m)) return m;
        const nm = { ...m };
        for (const mf of ARCH_MECHANISM_FIELDS) {
          if (nm[mf] !== undefined) nm[mf] = coerceScalarText(nm[mf]);
        }
        return nm;
      });
    }
    copy.architecture_assessment = aa;
  }
  return copy;
}

function isValidJudgmentRow(id, modelRow, req, plan) {
  if (!isPlainObject(modelRow)) return false;
  if (isNotApplicableDeclaration(id, modelRow, req)) {
    return true;
  }
  const effectiveStatus = modelRow.status === undefined ? 'verified' : modelRow.status;
  if (effectiveStatus !== 'verified') return false;
  for (const field of req.fields || []) {
    if (isMissingValue(modelRow[field])) return false;
  }
  if (Array.isArray(req.verdict_values) && req.verdict_values.length) {
    if (!req.verdict_values.includes(modelRow.verdict)) return false;
  }
  if (isPlainObject(req.fields_by_verdict) && typeof modelRow.verdict === 'string') {
    for (const field of req.fields_by_verdict[modelRow.verdict] || []) {
      if (isMissingValue(modelRow[field])) return false;
    }
  }
  if (typeof req.positive_field === 'string') {
    const pos = modelRow[req.positive_field];
    if (!isPlainObject(pos)) return false;
    for (const f of req.positive_fields || []) {
      if (isMissingValue(pos[f])) return false;
    }
  }
  const negRequired = !plan || !plan.applicability || plan.applicability.negative_walkthrough_required !== false;
  if (typeof req.negative_field === 'string' && negRequired) {
    const neg = modelRow[req.negative_field];
    if (!isPlainObject(neg)) return false;
    for (const f of req.negative_fields || []) {
      if (isMissingValue(neg[f])) return false;
    }
  }
  if (id === 'problem_context') {
    for (const f of PROBLEM_PUBLICATION_FIELDS) {
      if ((req.fields || []).includes(f) && !isNonEmptyString(modelRow[f])) return false;
    }
    if (modelRow.verdict === 'justified_increment' && !isNonEmptyString(modelRow.remaining_gap)) return false;
    const oi = modelRow.outcome_impact;
    if (!isPlainObject(oi) || !isPlainObject(oi.long_horizon) || !isPlainObject(oi.user_experience)) return false;
    if (isMissingValue(oi.long_horizon.decision) || isMissingValue(oi.long_horizon.reason)) return false;
    if (isMissingValue(oi.user_experience.decision) || isMissingValue(oi.user_experience.reason)) return false;
    const vr = oi.user_experience.visual_review;
    if (!isPlainObject(vr) || isMissingValue(vr.decision) || isMissingValue(vr.reason)) return false;
    const sb = modelRow.spec_basis;
    if (!isPlainObject(sb) || isMissingValue(sb.decision) || isMissingValue(sb.spec_source) || isMissingValue(sb.reason)) return false;
    if (sb.decision === 'mapped') {
      if (isMissingValue(sb.spec_ref) || isMissingValue(sb.spec_revision) || !Array.isArray(sb.criteria) || !sb.criteria.length) return false;
    }
  }
  if (id === 'change_proportionality') {
    const aa = modelRow.architecture_assessment;
    if (!isPlainObject(aa) || !isNonEmptyString(aa.decision) || !isNonEmptyString(aa.reason)) return false;
    if (aa.decision !== 'not_applicable') {
      if (!Array.isArray(aa.mechanisms) || !aa.mechanisms.length || !isNonEmptyString(aa.current_pr_boundary) || !isNonEmptyString(aa.validation_evidence)) {
        return false;
      }
      for (const m of aa.mechanisms) {
        if (!isPlainObject(m)) return false;
        if (ARCH_MECHANISM_FIELDS.some(mf => !isNonEmptyString(m[mf]))) return false;
        if (!ARCH_RESPONSIBILITIES.has(m.responsibility)) return false;
      }
    }
  }
  if (id === 'observable_semantics') {
    if ((req.fields || []).includes('scope_coverage')) {
      const sc = modelRow.scope_coverage;
      if (!isPlainObject(sc) || !isNonEmptyString(sc.decision) || !isNonEmptyString(sc.reason)) return false;
      if (sc.decision !== 'not_applicable') {
        for (const f of ['authorized_scope', 'scope_source', 'enforcement_selector', 'recovery_owner']) {
          if (isMissingValue(sc[f])) return false;
        }
        if (!Array.isArray(sc.cases) || sc.cases.length < 5) return false;
      }
    }
    if ((req.fields || []).includes('decision_text_assessment')) {
      const dt = modelRow.decision_text_assessment;
      if (!isPlainObject(dt) || !isNonEmptyString(dt.verdict) || !isNonEmptyString(dt.checked_scope) || !isNonEmptyString(dt.reason)) return false;
      if (dt.verdict !== 'not_applicable') {
        if (isMissingValue(dt.consumer) || !Array.isArray(dt.clause_comparisons) || !dt.clause_comparisons.length
            || !Array.isArray(dt.counterfactuals) || !dt.counterfactuals.length || isMissingValue(dt.evidence_refs)) {
          return false;
        }
        if (dt.verdict === 'intentional_change_validated' && isMissingValue(dt.authorization_basis)) return false;
      }
    }
  }
  if (id === 'repository_reuse' && (req.fields || []).includes('state_model_assessment')) {
    const sm = modelRow.state_model_assessment;
    if (!isPlainObject(sm) || isMissingValue(sm.classification) || isMissingValue(sm.reason)) return false;
  }
  return true;
}

function buildJudgmentRow(id, req, plan, modelRow) {
  if (!isPlainObject(modelRow)) return { status: 'unverified' };
  const normalized = normalizeJudgmentInput(id, modelRow);
  if (!isValidJudgmentRow(id, normalized, req, plan)) {
    if (id === 'problem_context') {
      const out = { status: 'unverified' };
      for (const k of ['affected_caller_or_operator', 'before_after_scenario', 'observable_outcome', 'non_goals', 'remaining_gap']) {
        if (typeof normalized[k] === 'string' && normalized[k].trim()) out[k] = normalized[k].trim();
      }
      return out;
    }
    return { status: 'unverified' };
  }
  const out = { ...normalized };
  if (isNotApplicableDeclaration(id, normalized, req)) {
    const reason = extractNotApplicableReason(normalized);
    // LoopX result_check.py requires status === 'verified' for all approval-consistent rows,
    // while using verdict === 'not_applicable' (when in verdict_values) and non-empty fields.
    out.status = 'verified';
    if (Array.isArray(req.verdict_values) && req.verdict_values.includes('not_applicable')) {
      out.verdict = 'not_applicable';
    }
    for (const field of req.fields || []) {
      if (isMissingValue(out[field])) {
        out[field] = `not_applicable: ${reason}`;
      }
    }
    if (id === 'semantic_alignment' && out.verdict === 'not_applicable') {
      const allowedCandidates = Array.isArray(req.candidate_decisions) ? req.candidate_decisions : [];
      if (!allowedCandidates.includes(out.candidate_decision)
          || ['extend_vocabulary', 'create_vocabulary', 'compatibility_only'].includes(out.candidate_decision)) {
        delete out.candidate_decision;
      }
    }
    return out;
  }
  if (out.status === undefined) out.status = 'verified';
  return out;
}

function buildEvidenceGraph({ contract, plan, diff, headOid, pr, motivation, validation, modelEvidence, repoRoot, runNodeTest }) {
  const reqs = new Map((contract && contract.evidence_requirements || []).map(r => [r.evidence_id, r]));
  const requiredIds = Array.isArray(plan && plan.required_evidence_ids) ? plan.required_evidence_ids : [];
  const ctx = {
    feature: (plan && plan.feature) || 'review-evidence-graph',
    headOid: String(headOid || ''),
    pr,
    motivation,
    diff: String(diff || ''),
    files: listFiles(diff),
    fileDiffs: splitFileDiffs(diff),
    stats: diffStats(diff),
    validation: Array.isArray(validation) ? validation : [],
    repoRoot,
    runNodeTest,
  };
  const out = {};
  for (const id of requiredIds) {
    const req = reqs.get(id) || {};
    const modelRow = isPlainObject(modelEvidence) ? modelEvidence[id] : null;
    if (id === 'validation_matrix') {
      out[id] = buildHostValidationRow(ctx, modelRow);
    } else if (id === 'changed_line_classification') {
      out[id] = buildChangedLineClassificationRow(ctx, req, modelRow);
    } else if (id === 'code_volume') {
      out[id] = buildCodeVolumeRow(ctx, req, modelRow);
    } else if (id === 'symbol_map') {
      out[id] = buildSymbolMapRow(req, ctx, modelRow);
    } else {
      out[id] = buildJudgmentRow(id, req, plan, modelRow);
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
  buildEvidenceGraph,
  describeFileFromDiff,
  scanDiff,
  isolatedNodeTestEnv,
};
