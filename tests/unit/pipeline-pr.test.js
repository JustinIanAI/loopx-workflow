const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = path.join(PROJECT_ROOT, '.tmp-mock-bin');

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
  echo '{"nameWithOwner": "JustinIan-AI/loopx-workflow"}'
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "comment" ]]; then
  echo "[Mock GH] Comment successfully posted to PR"
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "view" ]]; then
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
  echo '{"schema_version":"pull_request_review_packet_v0","repository":"local/sim","pull_requests":[]}'
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
{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"codex","model":"codex-default","declaration":"runtime_reported"},"headOid":"\${headSha}"}
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
  setupMockGh(currentHeadSha);
  setupMockLoopx();

  const testEnv = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
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

    // 2. Step 2: Checkpoint 1 Approval (Contract Freeze)
    console.log('[Test E2E] 2. Approving contract at Checkpoint 1...');
    const approveRes = spawnSync(LOOPX_FLOW, ['approve', 'contract', featureName], {
      encoding: 'utf8',
      env: testEnv
    });
    assert.strictEqual(approveRes.status, 0, `Contract approve must succeed: ${approveRes.stderr}`);
    const contractContent = fs.readFileSync(path.join(featureDir, '04-contract.md'), 'utf8');
    assert.strictEqual(contractContent.includes('FROZEN & APPROVED'), true);

    // 3. Step 3: Run Quality Gate Check and Review Ingestion
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
  }
});
