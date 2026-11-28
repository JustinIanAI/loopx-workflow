'use strict';
/**
 * Issue 修复管线（管线 B）端到端：`loopx-flow issue <id>` 的 dry-run / Goal 初始化 / --execute。
 * 覆盖 ADR-0023 的 impact 解析与 fail-closed 边界；修复执行本身仍由 Agent 完成。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sandbox = require('./helpers/m0-sandbox');

const LOOPX_BODY = [
  'args="$*"',
  'if [[ "$args" == *"issue-fix feasibility"* ]]; then',
  '  if [[ "${MOCK_ROUTE:-fix_pr}" == "comment_only" ]]; then',
  '    echo \'{"decision":{"route":"comment_only","reason_codes":["needs_more_info"]}}\'',
  '  elif [[ "${MOCK_ROUTE:-fix_pr}" == "triage_only" ]]; then',
  '    echo \'{"decision":{"route":"triage_only","reason_codes":["needs_triage"]}}\'',
  '  else',
  '    echo \'{"decision":{"route":"fix_pr","reason_codes":["bounded_scope","reproduction_confirmed"]}}\'',
  '  fi',
  '  exit 0',
  'fi',
  'if [[ "$args" == *"issue-fix workflow-plan"* ]]; then',
  '  echo \'{"branch_plan":{"base":"main","issue_branch":"fix/issue-123"},"validation_plan":["npm run test"],"next_safe_action":"implement_fix","ordered_loopx_todo_writeback_preview":[{"command_preview":"loopx todo add","would_write":false}]}\'',
  '  exit 0',
  'fi',
  'if [[ "$args" == *"issue-fix caller-repo-branch"* ]]; then',
  '  echo \'{"branch_action":"created","issue_branch":"fix/issue-123"}\'',
  '  exit 0',
  'fi',
  'if [[ "$args" == *"bootstrap"* ]]; then',
  '  goal=""',
  '  for ((i=1; i<=$#; i++)); do case "${!i}" in --goal-id) j=$((i+1)); goal="${!j}" ;; esac; done',
  '  node -e \'const fs=require("fs");const p=process.argv[1];const gid=process.argv[2];let d={schema_version:"0.1",goals:[]};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){};if(!Array.isArray(d.goals))d.goals=[];if(!d.goals.some(g=>g&&g.id===gid))d.goals.push({id:gid,state_file:".loopx/goals/"+gid+"/ACTIVE_GOAL_STATE.md"});fs.writeFileSync(p,JSON.stringify(d,null,2));\' "$LOOPX_REGISTRY" "$goal"',
  '  echo \'{"ok":true}\'',
  '  exit 0',
  'fi',
  'if [[ "$args" == *"configure-goal"* ]]; then echo \'{"ok":true}\'; exit 0; fi',
  'echo "[mock loopx] $args"',
  'exit 0'
].join('\n');

const GH_BODY = [
  'if [[ "${1:-}" == "--version" ]]; then echo "gh version 2.0.0"; exit 0; fi',
  'if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then',
  '  if [[ "${MOCK_ISSUE_FAIL:-}" == "1" ]]; then exit 1; fi',
  '  cat "$SANDBOX_ISSUE_JSON"',
  '  exit 0',
  'fi',
  'if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then echo "owner/repo"; exit 0; fi',
  'echo "[mock gh] $*"',
  'exit 0'
].join('\n');

function writeIssue(dir, { title = 'Bug: gate flaky on reruns', body = '- **Impact**: R2\n' } = {}) {
  return sandbox.write(dir, 'issue.json', JSON.stringify({ number: 123, title, state: 'OPEN', body, labels: [] }));
}

function setup(options = {}) {
  const dir = sandbox.makeSandbox('issue-pipeline-');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.loopx/\nloopx-calls.log\n');
  writeIssue(dir, options.issue || {});
  sandbox.mockLoopx(dir, LOOPX_BODY);
  sandbox.mockGh(dir, GH_BODY);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'sandbox mocks'], { cwd: dir });
  return dir;
}

function calls(dir) {
  const file = path.join(dir, 'loopx-calls.log');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line && !line.includes('--help') && !line.includes('--version'))
    .join('\n');
}

function run(dir, args, envExtra = {}) {
  return sandbox.run(dir, args, { SANDBOX_ISSUE_JSON: path.join(dir, 'issue.json'), ...envExtra });
}

test('1. dry-run issue: feasibility + workflow-plan without goal, branch, or domain-state writes', () => {
  const dir = setup();
  try {
    const res = run(dir, ['issue', '123']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /impact:R2/, 'impact from Issue body must be printed');
    assert.match(res.stdout, /bounded_scope/, 'decision.reason_codes must be printed');
    const log = calls(dir);
    assert.match(log, /issue-fix feasibility/);
    assert.match(log, /issue-fix workflow-plan/);
    assert.match(log, /--no-write-domain-state/);
    assert.doesNotMatch(log, /caller-repo-branch/);
    assert.match(res.stdout, /--init-goal/, 'dry-run must guide the operator to bind a Goal');
  } finally {
    sandbox.cleanup(dir);
  }
});

test('2. dry-run with --goal-id forwards the goal and project into workflow-plan', () => {
  const dir = setup();
  try {
    const res = run(dir, ['issue', '123', '--goal-id', 'issue-123-goal']);
    assert.strictEqual(res.status, 0, res.stderr);
    const log = calls(dir);
    assert.match(log, /workflow-plan .*--goal-id issue-123-goal --project /);
    assert.doesNotMatch(log, /bootstrap/);
    assert.match(res.stdout, /loopx-flow check --goal-id issue-123-goal/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('2b. feasibility 收到公开安全的复现/验证标签，并透传 comment-value 与仓库上下文', () => {
  const dir = setup();
  const ctx = path.join(dir, 'ctx.json');
  fs.writeFileSync(ctx, '{"schema_version":"issue_fix_repository_context_input_v0","sources":[]}');
  try {
    const res = run(dir, [
      'issue', '123', '--reproduction', 'confirmed', '--scope', 'bounded',
      '--comment-value', 'diagnosis', '--repository-context-json', ctx
    ]);
    assert.strictEqual(res.status, 0, res.stderr);
    const log = calls(dir);
    assert.match(log, /issue-fix feasibility .*--reproduction-label issue-123-repro/,
      'fix_pr 要求 compact public-safe 的 reproduction-label');
    assert.match(log, /--validation-label npm-run-test/, 'fix_pr 要求具名验证面');
    assert.match(log, /--comment-value diagnosis/);
    assert.match(log, /--repository-context-json .*ctx\.json/);
    assert.match(log, /workflow-plan .*--validation-label npm-run-test/);
    assert.match(log, /workflow-plan .*--repo owner\/repo --issue-ref 123/,
      'workflow-plan 必须带真实 repo/issue，避免落到 fixture');
  } finally {
    sandbox.cleanup(dir);
  }
});

test('2c. 非法 --reproduction / --scope / --comment-value 本地 fail-closed，不调用 loopx', () => {
  const dir = setup();
  try {
    for (const args of [
      ['issue', '123', '--reproduction', 'maybe'],
      ['issue', '123', '--scope', 'huge'],
      ['issue', '123', '--comment-value', 'rant']
    ]) {
      const res = run(dir, args);
      assert.strictEqual(res.status, 1, `${args.join(' ')} 必须非 0`);
      assert.match(res.stderr, /FAIL-CLOSED/);
    }
    assert.doesNotMatch(calls(dir), /issue-fix feasibility/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('2d. impact:R0 不允许 --init-goal / --execute（ADR-0023：R0 0 Goal、不建分支）', () => {
  const dir = setup();
  try {
    for (const args of [
      ['issue', '123', '--impact', 'R0', '--init-goal'],
      ['issue', '123', '--impact', 'R0', '--execute']
    ]) {
      const res = run(dir, args);
      assert.strictEqual(res.status, 1, `${args.join(' ')} 必须非 0`);
      assert.match(res.stderr, /impact:R0 不建 Goal/);
    }
    assert.doesNotMatch(calls(dir), /bootstrap/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('3. invalid impact fails closed (CLI value and Issue body value)', () => {
  const cliDir = setup();
  try {
    const cli = run(cliDir, ['issue', '123', '--impact', 'R9']);
    assert.strictEqual(cli.status, 1);
    assert.match(cli.stderr, /非法影响分级/);
    assert.strictEqual(calls(cliDir), '', 'invalid impact must fail before calling LoopX');
  } finally {
    sandbox.cleanup(cliDir);
  }

  const bodyDir = setup({ issue: { body: '- **Impact**: R7\n' } });
  try {
    const body = run(bodyDir, ['issue', '123']);
    assert.strictEqual(body.status, 1);
    assert.match(body.stderr, /影响分级非法/);
  } finally {
    sandbox.cleanup(bodyDir);
  }
});

test('4. --execute without a Goal fails closed and never creates a branch', () => {
  const dir = setup();
  try {
    const res = run(dir, ['issue', '123', '--execute']);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /--execute 需要 --goal-id/);
    const log = calls(dir);
    assert.match(log, /issue-fix feasibility/);
    assert.doesNotMatch(log, /workflow-plan/);
    assert.doesNotMatch(log, /caller-repo-branch/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('5. --init-goal bootstraps once, enables strict change-quality, and is idempotent', () => {
  const dir = setup();
  try {
    const first = run(dir, ['issue', '123', '--init-goal']);
    assert.strictEqual(first.status, 0, first.stderr);
    let log = calls(dir);
    assert.match(log, /bootstrap .*--goal-id issue-123-goal/);
    assert.match(log, /configure-goal --goal-id issue-123-goal --change-quality-enabled --change-quality-strict-receipt --execute/);
    assert.match(log, /workflow-plan .*--goal-id issue-123-goal/);

    fs.rmSync(path.join(dir, 'loopx-calls.log'), { force: true });
    const second = run(dir, ['issue', '123', '--init-goal']);
    assert.strictEqual(second.status, 0, second.stderr);
    log = calls(dir);
    assert.doesNotMatch(log, /bootstrap/, 'a registered Goal must be reused, not bootstrapped again');
    assert.match(log, /configure-goal --goal-id issue-123-goal/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('6. --execute creates the fix/issue-<id> branch through caller-repo-branch', () => {
  const dir = setup();
  try {
    const res = run(dir, ['issue', '123', '--execute', '--goal-id', 'issue-123-goal', '--impact', 'R1']);
    assert.strictEqual(res.status, 0, res.stderr);
    const log = calls(dir);
    assert.match(log, /caller-repo-branch --repo-path .* --repo owner\/repo --issue-ref 123 --base-branch main --issue-branch fix\/issue-123 --validation-command npm run test --execute --format json/);
    assert.match(res.stdout, /修复分支已就绪/);
    assert.doesNotMatch(log, /bootstrap/, '--goal-id must not trigger a Goal bootstrap');
  } finally {
    sandbox.cleanup(dir);
  }
});

test('7. --execute refuses a dirty worktree before creating the branch', () => {
  const dir = setup();
  try {
    sandbox.write(dir, 'dirty.txt', 'uncommitted\n');
    const res = run(dir, ['issue', '123', '--execute', '--goal-id', 'issue-123-goal']);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /工作区干净/);
    assert.doesNotMatch(calls(dir), /caller-repo-branch/);
  } finally {
    sandbox.cleanup(dir);
  }
});

test('8. comment_only and triage_only never plan or create a branch', () => {
  for (const route of ['comment_only', 'triage_only']) {
    const dir = setup();
    try {
      const res = run(dir, ['issue', '123', '--init-goal'], { MOCK_ROUTE: route });
      assert.strictEqual(res.status, 0, res.stderr);
      const log = calls(dir);
      assert.match(log, /issue-fix feasibility/);
      assert.doesNotMatch(log, /workflow-plan/);
      assert.doesNotMatch(log, /bootstrap/);
      assert.doesNotMatch(log, /caller-repo-branch/);
      assert.match(res.stdout, route === 'comment_only' ? /仅评论响应/ : /仅分诊处理/);
    } finally {
      sandbox.cleanup(dir);
    }
  }
});

test('9. an unreadable Issue fails closed before feasibility', () => {
  const dir = setup();
  try {
    const res = run(dir, ['issue', '123'], { MOCK_ISSUE_FAIL: '1' });
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /无法读取 Issue #123 元数据/);
    assert.strictEqual(calls(dir), '');
  } finally {
    sandbox.cleanup(dir);
  }
});

test('10. issue --help documents the new Issue pipeline flags', () => {
  const dir = setup();
  try {
    const res = run(dir, ['issue', '--help']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /--init-goal/);
    assert.match(res.stdout, /--impact R0\|R1\|R2/);
    assert.match(res.stdout, /fix\/issue-<id>/);
  } finally {
    sandbox.cleanup(dir);
  }
});
