'use strict';
/**
 * Issue #49 复现用例：`loopx-flow issue` 必须把 LoopX 2.3.0 的 fix_pr 前置条件
 * 显式传给 feasibility —— 复现标签、具名验证面，以及 workflow-plan 的真实 repo/issue。
 *
 * 修复前：confirmed/planned 会被 LoopX 以 "reproduction_label must be a compact
 * public-safe label" 拒绝；缺 validation_label 时即使复现确认也只能 triage_only；
 * workflow-plan 不带 --repo/--issue-ref 时计划落到 public_repo_fixture 上。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sandbox = require('../helpers/m0-sandbox');

const LOOPX_BODY = [
  'echo "$*" >> loopx-calls.log',
  'if [[ "$*" == *"issue-fix feasibility"* ]]; then',
  '  echo \'{"decision":{"route":"fix_pr","reason_codes":["reproduction_confirmed","bounded_scope","validation_surface_named"]}}\'',
  '  exit 0',
  'fi',
  'if [[ "$*" == *"issue-fix workflow-plan"* ]]; then',
  '  echo \'{"branch_plan":{},"validation_plan":[],"next_safe_action":"implement_fix"}\'',
  '  exit 0',
  'fi',
  'echo \'{"ok":true}\'',
  'exit 0'
].join('\n');

const GH_BODY = [
  'if [[ "${1:-}" == "--version" ]]; then echo "gh version 2.0.0"; exit 0; fi',
  'if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then',
  '  cat "$SANDBOX_ISSUE_JSON"; exit 0',
  'fi',
  'if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then echo "owner/repo"; exit 0; fi',
  'echo "[mock gh] $*"; exit 0'
].join('\n');

function setup() {
  const dir = sandbox.makeSandbox('issue-49-');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.loopx/\nloopx-calls.log\n');
  const issue = sandbox.write(dir, 'issue.json', JSON.stringify({
    number: 49, title: 'Issue pipeline end-to-end', state: 'OPEN', body: '- **Impact**: R2\n', labels: []
  }));
  sandbox.mockLoopx(dir, LOOPX_BODY);
  sandbox.mockGh(dir, GH_BODY);
  return { dir, issue };
}

function calls(dir) {
  const file = path.join(dir, 'loopx-calls.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('issue-49: feasibility 收到复现标签与具名验证面，workflow-plan 带真实 repo/issue', () => {
  const { dir, issue } = setup();
  try {
    const res = sandbox.run(dir, ['issue', '49', '--reproduction', 'confirmed', '--scope', 'bounded'], {
      SANDBOX_ISSUE_JSON: issue
    });
    assert.strictEqual(res.status, 0, `${res.stdout}${res.stderr}`);
    const log = calls(dir);
    assert.match(log, /feasibility .*--reproduction-label issue-49-repro/);
    assert.match(log, /feasibility .*--validation-label npm-run-test/);
    assert.match(log, /workflow-plan .*--repo owner\/repo --issue-ref 49/);
    assert.match(res.stdout, /fix_pr/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('issue-49: 非法观察量在本地 fail-closed，绝不把坏值透传给 LoopX', () => {
  const { dir, issue } = setup();
  try {
    const res = sandbox.run(dir, ['issue', '49', '--reproduction', 'maybe'], {
      SANDBOX_ISSUE_JSON: issue
    });
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /FAIL-CLOSED/);
    assert.doesNotMatch(calls(dir), /feasibility/);
  } finally {
    sandbox.cleanup(dir);
  }
});
