const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const h = require('./helpers/m0-sandbox');
const { detachRepoConfig } = require('./helpers/repo-isolation');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = path.join(PROJECT_ROOT, '.tmp-mock-bin');
const REG_PATH = path.join(PROJECT_ROOT, '.loopx/registry.json');

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

  const mockLoopxPath = path.join(MOCK_BIN_DIR, 'loopx');
  const mockLoopxScript = `#!/usr/bin/env bash
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
{"schema_version":"pull_request_review_packet_v0","repository":"local/sim","reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"pull_requests":[{"number":101,"head_oid":"\${headSha}","headRefOid":"\${headSha}","headRefName":"feature/e2e-pipeline-demo","title":"t","review_action_kind":"review","review_template":{"schema":"pr_review_five_block_template_v0","sections":[{"label":"动机","minimum_prose_characters":40,"agent_instruction":"x"},{"label":"改动思路","minimum_prose_characters":80,"agent_instruction":"x"},{"label":"具体改动","minimum_prose_characters":180,"agent_instruction":"x"},{"label":"对主干的风险","minimum_prose_characters":120,"agent_instruction":"x"},{"label":"我的整体评价","minimum_prose_characters":60,"agent_instruction":"x"}],"output_hint":"x"},"review_plan":{"required_evidence_ids":[],"applicability":{"behavior_bearing_change":true}},"evidence_commands":[],"motivation":"m1。m2。m3。m4。"}]}
JSON
  exit 0
fi

if [[ "$args" == *"change-quality verify"* ]]; then
  echo '{"ok": true, "enabled": false, "status": "receipt_valid", "receipt_state": "recorded"}'
  exit 0
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
  const hadReg = fs.existsSync(REG_PATH);
  const originalReg = hadReg ? fs.readFileSync(REG_PATH, 'utf8') : null;

  // Clean before test
  if (fs.existsSync(featureDir)) fs.rmSync(featureDir, { recursive: true, force: true });
  if (fs.existsSync(archiveDir)) fs.rmSync(archiveDir, { recursive: true, force: true });
  try { execSync("git branch -D feature/" + featureName, { stdio: "ignore" }); } catch (_) {}

  const currentHeadSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  setupMockGh(currentHeadSha);
  setupMockLoopx();
  // e2e 覆盖 feature/check/review/legacy merge 接线；临时移开仓库级授权配置，
  // Gate1/Gate2 模式行为由 adr-0009 / adr-0012 专项测试覆盖。
  const restoreConfig = detachRepoConfig();

  const testEnv = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
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
    const mergeRes = spawnSync(LOOPX_FLOW, ['merge', '101', featureName], {
      encoding: 'utf8',
      env: testEnv
    });
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
    restoreConfig();
    if (hadReg && originalReg !== null) fs.writeFileSync(REG_PATH, originalReg);
    else if (!hadReg && fs.existsSync(REG_PATH)) fs.unlinkSync(REG_PATH);
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