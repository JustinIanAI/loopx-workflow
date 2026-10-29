const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = path.join(PROJECT_ROOT, '.tmp-mock-bin-review-lock');

function setupMockGh(options = {}) {
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

if [[ "$cmd" == "pr" && "$subcmd" == "view" ]]; then
  # Output dynamic mock json
  cat << JSONEOF
{
  "number": 123,
  "title": "feat: harden delivery review and merge lock",
  "headRefName": "feature/delivery-review-merge-lock",
  "headRefOid": "abcd1234ef567890",
  "additions": 45,
  "deletions": 12,
  "changedFiles": 3,
  "reviewDecision": "${options.reviewDecision || 'APPROVED'}"
}
JSONEOF
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "comment" ]]; then
  echo "$*" > /tmp/last-mock-pr-comment.txt
  echo "[Mock GH] Comment posted"
  exit 0
fi

if [[ "$cmd" == "pr" && "$subcmd" == "merge" ]]; then
  echo "[Mock GH] Merged"
  exit 0
fi

exit 0
`;

  fs.writeFileSync(mockGhPath, mockGhScript, { mode: 0o755 });
  return mockGhPath;
}

function cleanupMock() {
  if (fs.existsSync(MOCK_BIN_DIR)) {
    fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync('/tmp/last-mock-pr-comment.txt')) {
    fs.unlinkSync('/tmp/last-mock-pr-comment.txt');
  }
}

test('1. Dynamic 5-Block Review: loopx-flow review must render dynamic PR metadata and feature capsule evidence', () => {
  cleanupMock();
  setupMockGh({ reviewDecision: 'APPROVED' });

  const testEnv = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
  };

  try {
    const res = spawnSync(LOOPX_FLOW, ['review', '123'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: testEnv
    });

    assert.strictEqual(res.status, 0, `review command must exit 0: ${res.stderr}`);
    assert.strictEqual(fs.existsSync('/tmp/last-mock-pr-comment.txt'), true, 'Must post comment via gh');
    const comment = fs.readFileSync('/tmp/last-mock-pr-comment.txt', 'utf8');

    // Must contain dynamic metadata, not pure static text
    assert.strictEqual(comment.includes('PR #123'), true, 'Must include dynamic PR number');
    assert.strictEqual(comment.includes('feature/delivery-review-merge-lock'), true, 'Must include dynamic target branch');
    assert.strictEqual(comment.includes('Scope: +45 / -12 lines across 3 files'), true, 'Must include dynamic diff stats');
  } finally {
    cleanupMock();
  }
});

test('2. Merge Readiness Fail-Closed: loopx-flow merge must fail when check-merge-readiness fails', () => {
  cleanupMock();
  setupMockGh({ reviewDecision: 'APPROVED' });

  // In this test, we verify that bin/loopx-flow source code does not contain '2>/dev/null || true' on check-merge-readiness
  const flowCode = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.strictEqual(
    flowCode.includes('--check-merge-readiness "${pr_id}@${head_oid}" 2>/dev/null || true'),
    false,
    'loopx-flow merge must not ignore check-merge-readiness failures with 2>/dev/null || true'
  );
  assert.strictEqual(
    flowCode.includes('LoopX 合入就绪度核验失败'),
    true,
    'loopx-flow merge must include explicit fail-closed message on readiness failure'
  );
});
