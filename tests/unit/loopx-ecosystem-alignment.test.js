const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const AUTHENTIC_REVIEW_SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js');

test('1. PR #7545 Alignment: buildBody generates bilingual 4-Part structure and verification matrix', () => {
  // Read authentic-review.js to verify buildBody structure
  const scriptContent = fs.readFileSync(AUTHENTIC_REVIEW_SCRIPT, 'utf8');
  assert.strictEqual(scriptContent.includes('## 动机 / Motivation'), true, 'Must include Motivation header');
  assert.strictEqual(scriptContent.includes('## 改动思路 / Approach'), true, 'Must include Approach header');
  assert.strictEqual(scriptContent.includes('## 具体改动 / Changes'), true, 'Must include Changes header');
  assert.strictEqual(scriptContent.includes('## 对主干的风险 / Risks'), true, 'Must include Risks header');
  assert.strictEqual(scriptContent.includes('### 验证矩阵'), true, 'Must include Verification Matrix header');
});

test('2. 3D Model Review: Block 4 renders delivery, long_horizon, user_experience and Verdict', () => {
  const scriptContent = fs.readFileSync(AUTHENTIC_REVIEW_SCRIPT, 'utf8');
  assert.strictEqual(scriptContent.includes('delivery'), true, 'Review prompt/body must evaluate delivery');
  assert.strictEqual(scriptContent.includes('long_horizon'), true, 'Review prompt/body must evaluate long_horizon');
  assert.strictEqual(scriptContent.includes('user_experience'), true, 'Review prompt/body must evaluate user_experience');
  assert.strictEqual(scriptContent.includes('我的整体评价 / Verdict') || scriptContent.includes('Verdict'), true, 'Must include Verdict section');
});

test('3. Registry Boundary: .loopx/registry.json is untracked by Git and ignored in .gitignore', () => {
  const gitignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.loopx\/registry\.json|\.loopx\//, '.gitignore must ignore .loopx registry');

  const lsFiles = execSync('git ls-files .loopx/registry.json', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(lsFiles, '', '.loopx/registry.json must not be tracked in git index');
});

test('4. Goal State Capsule Binding: cmd_feature binds state-file into specs/features/<feat>/ACTIVE_STATE.md', () => {
  const flowCode = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.match(
    flowCode,
    /--state-file\s+.*specs\/features\/\$feature\/ACTIVE_STATE\.md/,
    'cmd_feature must pass capsule-bound --state-file to loopx bootstrap'
  );
});

test('5. Lifecycle Sync & Retirement: cmd_merge triggers retire-global-goal and sync-global', () => {
  const flowCode = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.match(
    flowCode,
    /loopx.*retire-global-goal/,
    'cmd_merge must invoke loopx retire-global-goal upon feature completion'
  );
  assert.match(
    flowCode,
    /loopx.*sync-global/,
    'cmd_merge must invoke loopx sync-global'
  );
});

test('6. loopx-flow respond subcommand exists and displays help', () => {
  const res = spawnSync(LOOPX_FLOW, ['respond', '--help'], { encoding: 'utf8' });
  // Should handle respond or display usage
  assert.match(res.stderr + res.stdout, /respond <pr_id>|针对 Review 意见的更新与验证汇报/, 'Must provide respond subcommand');
});
test("7. Key Code Explanations: buildBody explains changes per file rather than flat paths", () => {
  const scriptContent = fs.readFileSync(AUTHENTIC_REVIEW_SCRIPT, "utf8");
  assert.strictEqual(scriptContent.includes("describeFile"), true, "Must have describeFile helper");
  assert.strictEqual(scriptContent.includes("具体改动 / Changes (关键代码讲解)"), true, "Header must follow PR #7545 format");
  assert.strictEqual(scriptContent.includes("extractMotivation"), true, "Must extract motivation robustly");
  assert.strictEqual(scriptContent.includes("extractApproach"), true, "Must extract approach robustly");
});

test("8. Response Safety & Native Format Reuse: cmd_respond delegates to respond-report.js without leaking raw test logs", () => {
  const flowCode = fs.readFileSync(LOOPX_FLOW, "utf8");
  // 禁止未加引号的 heredoc 命令替换 + 禁止硬编码静态矩阵
  assert.doesNotMatch(flowCode, /cat\s*<<\s*RESPEOF[\s\S]*?npm\s*test/, "cmd_respond must not embed npm test inside unquoted heredoc");
  assert.doesNotMatch(flowCode, /All unit suites passed 100% green/, "cmd_respond must not hardcode a static verification matrix");
  // 必须复用原生评审产物 + 原生五段式报告生成器
  assert.match(flowCode, /respond-report\.js/, "cmd_respond must reuse respond-report.js (LoopX native five-section format)");
  assert.match(flowCode, /\.loopx\/reviews/, "cmd_respond must read native review artifacts from .loopx/reviews");
});

test("9. Cross-Model CLI Adaptation: runReviewAgent supports claude -p vs codex exec and parseArgs handles --agent-bin", () => {
  const scriptContent = fs.readFileSync(AUTHENTIC_REVIEW_SCRIPT, "utf8");
  assert.strictEqual(scriptContent.includes("agentBin.includes('claude') ? ['-p', prompt] : ['exec', prompt]"), true, "Must support claude -p vs codex exec");
  assert.strictEqual(scriptContent.includes("o.agentBin = argv[++i]"), true, "Must parse --agent-bin argument");
  const flowCode = fs.readFileSync(LOOPX_FLOW, "utf8");
  assert.match(flowCode, /--agent-bin/, "cmd_review must forward --agent-bin flag");
});

test("10. Native Formatting & Verdict Visibility: review report is driven by LoopX native pr-review packet, not hand-written 5-Block", () => {
  const scriptContent = fs.readFileSync(AUTHENTIC_REVIEW_SCRIPT, "utf8");
  assert.strictEqual(scriptContent.includes("loopx pr-review"), true, "Must drive review via LoopX native pr-review capability");
  assert.strictEqual(scriptContent.includes("target-exact-head"), true, "Must fetch native packet by exact-head");
  assert.strictEqual(scriptContent.includes("required_final_sections"), true, "Must honor native required_final_sections (动机/改动思路/具体改动/对主干的风险/我的整体评价)");
  assert.strictEqual(scriptContent.includes("English verdict"), true, "Must render native English verdict line");
  assert.strictEqual(scriptContent.includes("fiveBlock"), false, "Must NOT hand-write a 5-Block template");
  assert.strictEqual(scriptContent.includes("buildPrompt"), false, "Must NOT hand-write a custom review prompt schema");
});

test("11. Carryover Isolation: authentic-review filters out review script from code carryover", () => {
  const scriptContent = fs.readFileSync(AUTHENTIC_REVIEW_SCRIPT, "utf8");
  assert.strictEqual(scriptContent.includes("!String(f.file || '').includes('authentic-review.js')"), true, "Must isolate authentic-review.js toolchain checks from code carryover");
});

test("12. Multi-Severity Native Response: respond-report recognizes P0-P3 severities from native review artifacts", () => {
  const helper = fs.readFileSync(path.join(PROJECT_ROOT, 'skills/code-review/scripts/respond-report.js'), "utf8");
  assert.match(helper, /P0|P1|P2|P3/i, "respond-report must map native P0-P3 severities");
  const flowCode = fs.readFileSync(LOOPX_FLOW, "utf8");
  assert.match(flowCode, /respond-report\.js/, "cmd_respond must delegate to respond-report");
});

test("13. PR Submission Generator: loopx-flow pr exists, displays help and enforces fail-closed branch guard", () => {
  const res = spawnSync(LOOPX_FLOW, ["pr", "--help"], { encoding: "utf8" });
  assert.match(res.stderr + res.stdout, /loopx-flow pr <create\|preview\|update>|按照 LoopX PR #7545 官方标准/, "Must provide pr subcommand with actions");

  const flowCode = fs.readFileSync(LOOPX_FLOW, "utf8");
  assert.match(flowCode, /current_branch.*==.*main/, "cmd_pr must fail closed on main branch");
});

test("14. PR #7545 Body Generation: authentic-review --generate-pr-body outputs complete 4-Part structure", () => {
  const res = spawnSync("node", [AUTHENTIC_REVIEW_SCRIPT, "--generate-pr-body", "--feature", "loopx-ecosystem-alignment"], { encoding: "utf8" });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /## 动机 \/ Motivation/, "Must include Motivation header");
  assert.match(res.stdout, /## 改动思路 \/ Approach/, "Must include Approach header");
  assert.match(res.stdout, /## 具体改动 \/ Changes/, "Must include Changes header");
  assert.match(res.stdout, /## 对主干的风险 \/ Risks/, "Must include Risks header");
  assert.match(res.stdout, /### 验证矩阵/, "Must include Verification Matrix");
});
