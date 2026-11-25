const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const h = require('./helpers/m0-sandbox');
const { detachRepoConfig, withoutRepoConfig } = require('./helpers/repo-isolation');
const {
  diffStats,
  buildEvidenceGraph,
  scanDiff,
} = require('../../skills/code-review/scripts/evidence-builder.js');
const {
  buildNativePrompt,
  materializeReviewSandbox,
  formatArtifactManifest,
  stdinByteLimit,
} = require('../../skills/code-review/scripts/authentic-review.js');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-mock-bin-pr-'));
process.on('exit', () => { try { fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true }); } catch (_) {} });
const REG_PATH = path.join(MOCK_BIN_DIR, 'registry.json');

function registerE2eGoal(featureDir) {
  const contract = path.join(featureDir, '04-contract.md');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(contract)).digest('hex');
  let reg = { schema_version: '0.1', goals: [] };
  try { reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8')); } catch (_) {}
  if (!Array.isArray(reg.goals)) reg.goals = [];
  let g = reg.goals.find(x => (x.id || x.goal_id) === 'e2e-pipeline-demo-goal');
  if (!g) { g = { id: 'e2e-pipeline-demo-goal', control_plane: {} }; reg.goals.push(g); }
  if (!g.control_plane) g.control_plane = {};
  if (!g.control_plane.progress_review) g.control_plane.progress_review = {};
  g.control_plane.progress_review.contract_revision = sha;
  fs.mkdirSync(path.dirname(REG_PATH), { recursive: true });
  fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2));
}


// Set up mock gh binary to simulate GitHub PR responses
function setupMockGh(currentHeadSha) {
  if (!fs.existsSync(MOCK_BIN_DIR)) {
    fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  }

  const mockGhPath = path.join(MOCK_BIN_DIR, 'gh');
  const mockGhScript = `#!/usr/bin/env bash
cmd="$1"
subcmd="\${2:-}"

if [[ "$cmd" == "repo" && "$subcmd" == "view" ]]; then
  echo '{"nameWithOwner": "JustinIanAI/loopx-workflow"}'
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "comment" ]]; then
  echo "[Mock GH] Comment successfully posted to PR"
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "view" ]]; then
  # Compound PR state view used by merge compensation
  if [[ "$*" == *"state,mergedAt,reviewDecision"* ]]; then
    echo "OPEN%%APPROVED%${currentHeadSha}%feature/e2e-pipeline-demo%main"
    exit 0
  fi
  # Check which field was requested
  if [[ "$*" == *"--jq .reviewDecision"* ]]; then
    echo "APPROVED"
    exit 0
  fi
  if [[ "$*" == *"--jq .headRefOid"* ]]; then
    echo "${currentHeadSha}"
    exit 0
  fi
  if [[ "$*" == *"--jq .headRefName"* ]]; then
    echo "feature/e2e-pipeline-demo"
    exit 0
  fi
  echo '{"reviewDecision": "APPROVED", "headRefOid": "${currentHeadSha}", "headRefName": "feature/e2e-pipeline-demo"}'
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "merge" ]]; then
  echo "[Mock GH] PR successfully squashed and merged, branch deleted"
  exit 0
fi

echo "Mock GH unhandled: $*"
exit 0
`;

  fs.writeFileSync(mockGhPath, mockGhScript, { mode: 0o755 });
  return mockGhPath;
}

// Set up mock loopx binary to simulate LoopX control-plane readiness lock
function setupMockLoopx() {
  if (!fs.existsSync(MOCK_BIN_DIR)) {
    fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });
  }
  fs.writeFileSync(REG_PATH, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));

  const mockLoopxPath = path.join(MOCK_BIN_DIR, 'loopx');
  const mockLoopxScript = `#!/usr/bin/env bash
${require('./helpers/capability-stub').HELP_PRELUDE}
args="$*"

if [[ "$args" == *"--check-merge-readiness"* ]]; then
  if [[ "\${MOCK_LOOPX_READINESS_FAIL:-}" == "1" ]]; then
    echo "[Mock LoopX] Merge readiness check FAILED (simulated)" >&2
    exit 1
  fi
  echo "[Mock LoopX] Merge readiness check PASSED: $args"
  exit 0
fi

if [[ "$args" == *"--check-result"* ]]; then
  echo '{"ok": true, "status": "consistent"}'
  exit 0
fi

if [[ "$args" == *"pr-review"* && "$args" == *"--format json"* ]]; then
  headSha="$(git rev-parse HEAD 2>/dev/null || echo localhead)"
  cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"local/sim","reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"agent_response_contract":{"review_execution_contract":{"policy_revision":26}},"pull_requests":[{"number":101,"head_oid":"\${headSha}","headRefOid":"\${headSha}","headRefName":"feature/e2e-pipeline-demo","title":"t","review_action_kind":"review","review_template":{"schema":"pr_review_five_block_template_v0","sections":[{"label":"动机","minimum_prose_characters":40,"agent_instruction":"x"},{"label":"改动思路","minimum_prose_characters":80,"agent_instruction":"x"},{"label":"具体改动","minimum_prose_characters":180,"agent_instruction":"x"},{"label":"对主干的风险","minimum_prose_characters":120,"agent_instruction":"x"},{"label":"我的整体评价","minimum_prose_characters":60,"agent_instruction":"x"}],"output_hint":"x"},"review_plan":{"required_evidence_ids":[],"applicability":{"behavior_bearing_change":true}},"evidence_commands":[],"motivation":"m1。m2。m3。m4。"}]}
JSON
  exit 0
fi

if [[ "$args" == *"change-quality prepare"* ]]; then
  echo '{"schema_version":"change_quality_prepare_packet_v2","ok": true, "status": "review_required", "policy": {"enabled": true, "safe_fix": false, "strict_receipt": true}, "scope": {"scope_fingerprint": "abcdef123456", "base_commit": "HEAD", "base_ref": "origin/HEAD"}}'
  exit 0
fi

if [[ "$args" == *"change-quality verify"* ]]; then
  echo '{"schema_version":"change_quality_receipt_verification_v2","ok": true, "enabled": false, "status": "receipt_valid", "receipt_state": "recorded"}'
  exit 0
fi

if [[ "$args" == *"todo list"* ]]; then
  if [[ -f "${MOCK_BIN_DIR}/user-gate-todos.json" ]]; then
    cat "${MOCK_BIN_DIR}/user-gate-todos.json"
    exit 0
  fi
fi

echo "[Mock LoopX] $args"
exit 0
`;

  fs.writeFileSync(mockLoopxPath, mockLoopxScript, { mode: 0o755 });

  // Feature 5: authentic review pipeline stubs (codex default-model agent + npm gates)
  const codexStub = `#!/usr/bin/env bash
headSha="$(git rev-parse HEAD 2>/dev/null || echo localhead)"
cat <<JSON
\\\`\\\`\\\`json
{"review_body":"Reviewer: model_agent\\n## 动机\\n动机内容足够长以通过字数下限约束，说明本次改造的必要性与用户价值，并覆盖问题背景与目标。\\n## 改动思路\\n改动思路段落说明架构与实现路径，足以通过字数下限并解释方案取舍与边界。\\n## 具体改动\\n### 关键代码讲解\\n- bin/loopx-flow — 命令编排调整\\n## 对主干的风险\\n风险段落说明触发条件、影响面与最小修复方向，满足字数下限要求并给出复现路径。\\n## 我的整体评价\\n评价段落给出交付、长程与体验判断，并说明残余风险。\\nEnglish verdict: APPROVE","verdict":"APPROVE","findings":[],"reviewer":{"actor_kind":"model_agent","declaration_source":"self_reported","declared_model":"codex","declared_provider":"openai"},"headOid":"\${headSha}"}
JSON
exit 0
`;
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'codex'), codexStub, { mode: 0o755 });

  const npmStub = `#!/usr/bin/env bash
echo "mock gate OK"
exit 0
`;
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'npm'), npmStub, { mode: 0o755 });

  return mockLoopxPath;
}

function cleanupMockGh() {
  if (fs.existsSync(MOCK_BIN_DIR)) {
    fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  }
}

test('PR Pipeline End-to-End Simulation: Feature -> Approval -> Review -> Merge -> Archival', (t) => {
  const featureName = 'e2e-pipeline-demo';
  const featureDir = path.join(PROJECT_ROOT, 'specs/features', featureName);
  const archiveDir = path.join(PROJECT_ROOT, 'specs/archive', featureName);
  const originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

  // Clean before test
  if (fs.existsSync(featureDir)) fs.rmSync(featureDir, { recursive: true, force: true });
  if (fs.existsSync(archiveDir)) fs.rmSync(archiveDir, { recursive: true, force: true });
  try { execSync("git branch -D feature/" + featureName, { stdio: "ignore" }); } catch (_) {}

  const currentHeadSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const reviewCacheFile = path.join(PROJECT_ROOT, '.loopx/cache/reviews', `101@${currentHeadSha}.json`);
  const hadReviewCache = fs.existsSync(reviewCacheFile);
  setupMockGh(currentHeadSha);
  setupMockLoopx();

  const testEnv = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    LOOPX_REGISTRY: REG_PATH,
    LOOPX_FLOW_MERGE_SKIP_GIT_SYNC: '1'
  };

  try {
    // 1. Step 1: Initialize Feature Capsule
    console.log('[Test E2E] 1. Initializing Feature Capsule...');
    const initRes = spawnSync(LOOPX_FLOW, ['feature', featureName], {
      encoding: 'utf8',
      env: testEnv
    });
    assert.strictEqual(initRes.status, 0, `Feature init must succeed: ${initRes.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(featureDir, '00-INDEX.md')), true);
    assert.strictEqual(fs.existsSync(path.join(featureDir, '04-contract.md')), true);

    // 2. Step 2：构造已锁定的契约状态。
    //    approve 命令本身由 adr-0009-gate1-auth / fail-closed-remediation 在各自独立 git 沙箱里覆盖；
    //    本 e2e 不依赖开发工作区是否干净，因此这里只注入等价 fixture。
    console.log('[Test E2E] 2. Preparing approved contract fixture...');
    const contractPath = path.join(featureDir, '04-contract.md');
    let contractText = fs.readFileSync(contractPath, 'utf8');
    if (!/\bAC\b/.test(contractText)) contractText += '\n## AC\n- AC-1: e2e pipeline demo\n';
    if (!/Scope/.test(contractText)) contractText += '\n## Scope\n- e2e pipeline demo only\n';
    if (!/Verification/.test(contractText)) contractText += '\n## Verification Plan\n- npm run test\n';
    if (!/依赖|Dependency|Order/.test(contractText)) contractText += '\n## 依赖顺序\n- Story-1\n';
    if (!/REQ-|ADR-/.test(contractText)) contractText += '\n引用: REQ-CHECKPOINT-1\n';
    fs.writeFileSync(contractPath, h.lockedContractText(contractText));
    fs.writeFileSync(path.join(featureDir, '01-decisions.md'), '# Decisions\n\n- **Status**: APPROVED\n');
    fs.writeFileSync(path.join(featureDir, '03-stories.md'), '# Stories\n\n- Story-1: e2e pipeline demo\n  - AC: 命令链路可跑通\n');
    const contractContent = fs.readFileSync(contractPath, 'utf8');
    assert.strictEqual(contractContent.includes('FROZEN & APPROVED'), true);

    // 3. Step 3: Run Quality Gate Check and Review Ingestion
    registerE2eGoal(featureDir);
    const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'loopx-workflow.config.json'), 'utf8'));
    const acc = cfg.single_owner_risk_acceptance || { accepted_by: 'JustinIanAI', accepted_at: '2026-11-12T09:43:44Z' };
    const contractSha = crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex');
    const gate1Ev = cfg.authorization_mode === 'single_owner'
      ? `authorization_mode=single_owner;contract_sha=${contractSha};spec_commit=${currentHeadSha};feature=${featureName};principal=${acc.accepted_by};risk_acceptance=${acc.accepted_by}@${acc.accepted_at}`
      : `authorization_mode=${cfg.authorization_mode};contract_sha=${contractSha};spec_commit=${currentHeadSha};feature=${featureName};principal=reviewer`;
    fs.writeFileSync(path.join(MOCK_BIN_DIR, 'user-gate-todos.json'), JSON.stringify({
      todos: [{
        task_class: 'user_gate',
        decision_outcome: 'approve',
        decision_scope: { scope_key: contractSha },
        superseded_by: null,
        evidence: gate1Ev
      }]
    }));
    console.log('[Test E2E] 3. Running loopx-flow check...');
    const checkRes = spawnSync(LOOPX_FLOW, ['check', featureName], {
      encoding: 'utf8',
      env: testEnv
    });
    assert.strictEqual(checkRes.status, 0, `Check must succeed: ${checkRes.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(featureDir, '05-evidence.md')), true);

    // 4. Step 4: Run L2 Review Report Generation
    console.log('[Test E2E] 4. Running loopx-flow review for PR #101...');
    const reviewRes = spawnSync(LOOPX_FLOW, ['review', '101'], {
      encoding: 'utf8',
      env: testEnv
    });
    assert.strictEqual(reviewRes.status, 0, `Review must succeed: ${reviewRes.stderr}`);
    assert.strictEqual(reviewRes.stdout.includes('Authentic 审查管线完成'), true);

    // 5. Step 5: Checkpoint 2 Merge Verification & Atomic Archival
    console.log('[Test E2E] 5. Running loopx-flow merge for PR #101...');
    const mergeRes = withoutRepoConfig(() => spawnSync(LOOPX_FLOW, ['merge', '101', featureName], {
      encoding: 'utf8',
      env: testEnv
    }));
    assert.strictEqual(mergeRes.status, 0, `Merge must succeed: ${mergeRes.stderr}`);
    assert.strictEqual(mergeRes.stdout.includes('GitHub 审查决议确认: APPROVED'), true);
    assert.strictEqual(mergeRes.stdout.includes('GitHub PR 已成功 Squash 合入主干'), true);

    // Verify atomic archival: feature moved from specs/features/ to specs/archive/
    assert.strictEqual(fs.existsSync(featureDir), false, 'Feature directory must be moved away from specs/features/');
    assert.strictEqual(fs.existsSync(archiveDir), true, 'Feature directory must be archived into specs/archive/');
    assert.strictEqual(fs.existsSync(path.join(archiveDir, '00-INDEX.md')), true, 'Archived capsule must be complete');

    console.log('[Test E2E] 6. End-to-end PR Review & Merge pipeline simulation completed successfully!');
  } finally {
    cleanupMockGh();
    if (!hadReviewCache && fs.existsSync(reviewCacheFile)) fs.unlinkSync(reviewCacheFile);
    if (fs.existsSync(featureDir)) fs.rmSync(featureDir, { recursive: true, force: true });
    if (fs.existsSync(archiveDir)) fs.rmSync(archiveDir, { recursive: true, force: true });
    // Restore the developer's original branch: `loopx-flow feature` switches branches as a side effect
    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      if (currentBranch !== originalBranch) {
        execSync(`git checkout ${originalBranch}`, { encoding: 'utf8' });
      }
      try { execSync("git branch -D feature/" + featureName, { stdio: "ignore" }); } catch (_) {}
    } catch (_) {}
  }
});

test('Merge Readiness Fail-Closed: loopx-flow merge must block when LoopX readiness lock fails', (t) => {
  const currentHeadSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  setupMockGh(currentHeadSha);
  setupMockLoopx();
  const restoreConfig = detachRepoConfig();

  const testEnv = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    LOOPX_REGISTRY: REG_PATH,
    MOCK_LOOPX_READINESS_FAIL: '1'
  };

  try {
    const mergeRes = spawnSync(LOOPX_FLOW, ['merge', '101', 'failclosed-demo'], {
      encoding: 'utf8',
      env: testEnv
    });

    assert.strictEqual(mergeRes.status, 1, `Merge must exit 1 on readiness lock failure: ${mergeRes.stdout}`);
    assert.strictEqual(
      `${mergeRes.stderr}${mergeRes.stdout}`.includes('LoopX 合入就绪度核验失败'),
      true,
      'Merge must print explicit fail-closed message when readiness lock fails'
    );
    assert.strictEqual(
      `${mergeRes.stderr}${mergeRes.stdout}`.includes('GitHub PR 已成功 Squash 合入主干'),
      false,
      'Merge must never proceed to squash merge when readiness lock fails'
    );
    console.log('[Test E2E] Fail-closed merge readiness lock verification completed successfully!');
  } finally {
    cleanupMockGh();
    restoreConfig();
  }
});

test('LoopX PR Admission Paradigm: removes 500-line hard limit and enforces Outcome + Spec + Boundary criteria', () => {
  const prTemplate = fs.readFileSync(path.join(PROJECT_ROOT, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');
  assert.doesNotMatch(
    prTemplate,
    /(?:建议\s*)?[≤<=]\s*500\s*行/,
    '.github/PULL_REQUEST_TEMPLATE.md must not prescribe a <= 500-line PR limit'
  );
  assert.match(prTemplate, /结果锚定/, 'PR template must require Outcome Anchoring (结果锚定)');
  assert.match(prTemplate, /before\s*->\s*after/i, 'PR template must require observable before -> after');
  for (const statusToken of ['implemented', 'deferred', 'out_of_scope', 'not_met']) {
    assert.strictEqual(
      prTemplate.includes(statusToken),
      true,
      `PR template must declare spec alignment status token: ${statusToken}`
    );
  }
  assert.match(prTemplate, /边界声明/, 'PR template must require Scope & Boundary Declaration (边界声明)');
  assert.match(prTemplate, /gap/i, 'PR template must require remaining gap declaration for incremental PRs');
  assert.match(prTemplate, /owner/i, 'PR template must require next owner declaration for incremental PRs');
  assert.match(prTemplate, /独立可测/, 'PR template must require independent testability for incremental PRs');
  assert.match(prTemplate, /<!--\s*loopx-meta:/, 'PR template must preserve loopx-meta machine metadata');

  const normativeDocs = [
    'docs/guides/reviewer-inspection-guide.md',
    'AGENTS.md',
    'README.md',
    'skills/README.md',
    'docs/design/loopx-workflow-design.md',
    'skills/code-review/SKILL.md',
  ];
  for (const rel of normativeDocs) {
    const text = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
    assert.doesNotMatch(
      text,
      /(?:Diff|改动行数|单\s*(?:PR|Feature)\s*Diff|单次\s*diff)[^。\n]*(?:≤|<=|不超过)\s*500\s*行/i,
      `${rel} must not contain PR/Feature diff <= 500 lines limit`
    );
  }

  const reviewerGuide = fs.readFileSync(path.join(PROJECT_ROOT, 'docs/guides/reviewer-inspection-guide.md'), 'utf8');
  assert.match(reviewerGuide, /结果锚定/, 'reviewer-inspection-guide.md must include 结果锚定');
  assert.match(reviewerGuide, /边界/, 'reviewer-inspection-guide.md must include 边界 declaration');
  assert.match(reviewerGuide, /not_met/, 'reviewer-inspection-guide.md must prohibit not_met');
  assert.match(reviewerGuide, /Review Prompt/i, 'reviewer-inspection-guide.md must clarify >500-line test file note is Review Prompt only');

  // Ensure toolchain & CI contain no automated PR 500-line diff blocking logic
  const gateScripts = [
    '.github/workflows/ci.yml',
    'scripts/gate-lint.sh',
    'scripts/gate-build.sh',
    'bin/loopx-flow',
    'skills/code-review/scripts/authentic-review.js',
    'skills/code-review/scripts/evidence-builder.js',
    'skills/code-review/scripts/ingest-to-loopx-quality.js',
  ];
  for (const rel of gateScripts) {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
    assert.doesNotMatch(
      content,
      /(?:diff|pr).*(?:lines?|additions).*(?:>|>=|-gt|-ge)\s*500/i,
      `${rel} must not enforce an automated 500-line PR diff block`
    );
  }

  // Review prompt must calibrate review agents against LOC-based rejection
  const prompt = buildNativePrompt({
    pr: 122,
    headOid: 'b'.repeat(40),
    branch: 'feat/pr-admission-align-loopx',
    motivation: 'Align PR admission with LoopX',
    reviewTemplate: { sections: [{ label: '动机', minimum_prose_characters: 1, agent_instruction: 'check' }] },
    reviewPlan: { required_evidence_ids: [] },
    evidenceCommands: [],
    evidenceText: '',
    diff: '',
    priorFindings: [],
    evidenceContract: {},
    artifactManifest: '- `pr.diff`: 10 bytes',
  });
  assert.match(prompt, /禁止按代码行数|禁止以代码行数/, 'Review prompt must forbid rejecting PRs by LOC');
  assert.match(prompt, /Review Prompt/i, 'Review prompt must clarify >500-line test reminder is Review Prompt only');
});

test('Large Diff (>500 lines) Compatibility: PR body rendering, evidence graph, review sandbox and lint/build gates pass without blocking', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-large-diff-'));
  const featureName = 'large-protocol-contract-compat';
  const featureDir = path.join(PROJECT_ROOT, 'specs/features', featureName);
  const hadFeatureDir = fs.existsSync(featureDir);

  // Construct a realistic >500-line multi-file diff (contract + implementation + >500-line test file)
  const contractLines = Array.from({ length: 180 }, (_, i) => `+export interface ProtocolRule_${i} { id: string; enabled: boolean; }`);
  const implLines = Array.from({ length: 160 }, (_, i) => `+function validateRule_${i}(rule) { return Boolean(rule && rule.id); }`);
  const testLines = Array.from({ length: 520 }, (_, i) => `+test('protocol rule ${i} invariant holds', () => { assert.strictEqual(${i} >= 0, true); });`);
  const largeDiff = [
    'diff --git a/specs/features/large-protocol-contract-compat/04-contract.md b/specs/features/large-protocol-contract-compat/04-contract.md',
    '--- a/specs/features/large-protocol-contract-compat/04-contract.md',
    '+++ b/specs/features/large-protocol-contract-compat/04-contract.md',
    '@@ -1,2 +1,182 @@',
    ' # Protocol Contract',
    '-legacy_line',
    ...contractLines,
    'diff --git a/lib/protocol-contract.js b/lib/protocol-contract.js',
    '--- a/lib/protocol-contract.js',
    '+++ b/lib/protocol-contract.js',
    '@@ -1,2 +1,162 @@',
    ' "use strict";',
    '-module.exports = {};',
    ...implLines,
    'diff --git a/tests/unit/protocol-contract.test.js b/tests/unit/protocol-contract.test.js',
    '--- a/tests/unit/protocol-contract.test.js',
    '+++ b/tests/unit/protocol-contract.test.js',
    '@@ -1,1 +1,521 @@',
    ' const assert = require("node:assert");',
    ...testLines,
    '',
  ].join('\n');

  const stats = diffStats(largeDiff);
  assert.strictEqual(stats.additions, 860, 'diffStats must accurately count >500 additions without capping');
  assert.strictEqual(stats.deletions, 2, 'diffStats must accurately count deletions');
  assert.deepStrictEqual(scanDiff(largeDiff), [], 'Clean >500-line diff must produce zero false-positive scan findings');

  try {
    // 1. PR body rendering via authentic-review.js --generate-pr-body --diff-file
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, '02-prd.md'), '# PRD\n- Outcome: large protocol contract\n');
    fs.writeFileSync(path.join(featureDir, '01-decisions.md'), '# Decisions\n- Single coherent PR without artificial LOC splitting\n');
    fs.writeFileSync(path.join(featureDir, '05-evidence.md'), [
      '# Evidence',
      '### 验证矩阵',
      '| Check | Result | Details |',
      '|---|---|---|',
      '| `npm run typecheck` | PASSED | exit 0 |',
      '| `npm run lint` | PASSED | exit 0 |',
      '| `npm run build` | PASSED | exit 0 |',
      '| `npm run test` | PASSED | exit 0 |',
    ].join('\n'));

    const diffFile = path.join(tmpDir, 'large-pr.diff');
    fs.writeFileSync(diffFile, largeDiff, 'utf8');

    const genRes = spawnSync(
      process.execPath,
      [path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js'), '--generate-pr-body', '--feature', featureName, '--diff-file', diffFile],
      { encoding: 'utf8', cwd: PROJECT_ROOT }
    );
    assert.strictEqual(genRes.status, 0, `PR body rendering must succeed for >500-line diff: ${genRes.stderr}`);
    assert.match(genRes.stdout, /## 动机 \/ Motivation/);
    assert.match(genRes.stdout, /## 具体改动 \/ Changes/);
    assert.match(genRes.stdout, /lib\/protocol-contract\.js/);
    assert.match(genRes.stdout, /\+160 \/ -1/);
    assert.match(genRes.stdout, /tests\/unit\/protocol-contract\.test\.js/);
    assert.match(genRes.stdout, /\+520 \/ -0/);

    // 2. Evidence graph code_volume accepts >500 additions as verified (no line-count penalty/block)
    const graph = buildEvidenceGraph({
      plan: { feature: featureName, required_evidence_ids: ['code_volume'] },
      contract: {
        evidence_requirements: [{
          evidence_id: 'code_volume',
          required_fields: ['additions', 'deletions', 'changed_line_shape', 'verdict'],
        }],
      },
      modelEvidence: {
        code_volume: { verdict: 'justified_coherent_contract' },
      },
      diff: largeDiff,
      headOid: 'c'.repeat(40),
      pr: 122,
      motivation: 'Large protocol contract delivery',
      validation: [],
      repoRoot: PROJECT_ROOT,
    });
    assert.strictEqual(graph.code_volume.additions, 860);
    assert.strictEqual(graph.code_volume.status, 'verified', 'code_volume must reach verified for >500-line diffs');

    // 3. Sandbox materialization & compact stdin prompt handle >500-line diff without truncation
    const runDir = { dir: tmpDir, file: (name) => path.join(tmpDir, name) };
    const entries = materializeReviewSandbox(runDir, {
      'packet.json': JSON.stringify({ pr: 122 }),
      'pr.diff': largeDiff,
      'evidence-output.md': 'all gates passed',
    });
    const prompt = buildNativePrompt({
      pr: 122,
      headOid: 'c'.repeat(40),
      branch: 'feat/large-protocol-contract-compat',
      motivation: 'Deliver coherent 860-line protocol contract',
      reviewTemplate: { sections: [{ label: '动机', minimum_prose_characters: 1, agent_instruction: 'review outcome' }] },
      reviewPlan: { required_evidence_ids: ['code_volume'] },
      evidenceCommands: [],
      evidenceText: 'all gates passed',
      diff: largeDiff,
      priorFindings: [],
      evidenceContract: {},
      artifactManifest: formatArtifactManifest(entries),
    });
    assert.ok(Buffer.byteLength(prompt, 'utf8') <= stdinByteLimit(), 'Prompt stdin must stay within compact byte limit for >500-line diff');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'pr.diff'), 'utf8'), largeDiff, 'Full >500-line diff must be preserved in sandbox');

    // 4. Local lint & build gates do not block when a large feature capsule exists
    const lintRes = spawnSync(path.join(PROJECT_ROOT, 'scripts/gate-lint.sh'), [], { encoding: 'utf8', cwd: PROJECT_ROOT });
    assert.strictEqual(lintRes.status, 0, `gate-lint.sh must pass: ${lintRes.stderr}${lintRes.stdout}`);
    const buildRes = spawnSync(path.join(PROJECT_ROOT, 'scripts/gate-build.sh'), [], { encoding: 'utf8', cwd: PROJECT_ROOT });
    assert.strictEqual(buildRes.status, 0, `gate-build.sh must pass: ${buildRes.stderr}${buildRes.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (!hadFeatureDir && fs.existsSync(featureDir)) {
      fs.rmSync(featureDir, { recursive: true, force: true });
    }
  }
});
