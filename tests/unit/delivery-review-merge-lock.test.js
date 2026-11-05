const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const MOCK_BIN_DIR = path.join(PROJECT_ROOT, '.tmp-mock-bin-review-lock');

// issue #8：测试临时工件必须隔离在 os.tmpdir()+mkdtemp，禁止共享 /tmp 固定文件名。
const TEST_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-review-lock-'));
const MOCK_COMMENT_LOG = path.join(TEST_TMP_DIR, 'last-mock-pr-comment.txt');
after(() => fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true }));

function setupMockGh(options = {}) {
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
  echo "$*" > ${JSON.stringify(MOCK_COMMENT_LOG)}
  prev=""
  for a in "$@"; do
    if [[ "$prev" == "--body-file" ]]; then cat "$a" >> ${JSON.stringify(MOCK_COMMENT_LOG)}; fi
    prev="$a"
  done
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

  // Feature 5: authentic review pipeline requires codex (default model), loopx check-result, npm gates stubs
  const codexStub = `#!/usr/bin/env bash
cat <<'JSON'
\`\`\`json
{"review_body":"Reviewer: model_agent\\n## 动机\\nPR #123 · 分支 feature/delivery-review-merge-lock · 3 files changed。动机段落说明本次交付审查的必要性与动态元数据来源。\\n## 改动思路\\n按 LoopX 原生 review_template 五段式组织审查证据，说明实现路径与取舍，并覆盖动态证据来源。\\n## 具体改动\\n### 关键代码讲解\\n- bin/loopx-flow — dynamic review verified by mock agent\\n## 对主干的风险\\n风险段落说明触发条件与最小修复方向，并要求精确 head 复核。\\n## 我的整体评价\\n评价段落给出交付、长程与体验判断，并说明复审所需证据。\\nEnglish verdict: APPROVE","verdict":"APPROVE","findings":[{"file":"bin/loopx-flow","line":3,"severity":"minor","summary":"dynamic review verified by mock agent"}],"reviewer":{"actor_kind":"model_agent","declaration_source":"self_reported","declared_model":"codex","declared_provider":"openai"},"headOid":"abcd1234ef567890"}
\`\`\`
JSON
exit 0
`;
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'codex'), codexStub, { mode: 0o755 });

  const loopxStub = `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"--check-result"* ]]; then
  echo '{"ok": true, "review_body_check": {"valid": true}, "errors": [], "approval_consistent": true}'
  exit 0
fi
if [[ "$args" == *"pr-review"* && "$args" == *"--format json"* ]]; then
  cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"local/sim","reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"pull_requests":[{"number":123,"head_oid":"abcd1234ef567890","headRefOid":"abcd1234ef567890","headRefName":"feature/delivery-review-merge-lock","title":"t","review_action_kind":"review","review_template":{"schema":"pr_review_five_block_template_v0","sections":[{"label":"动机","minimum_prose_characters":40,"agent_instruction":"x"},{"label":"改动思路","minimum_prose_characters":80,"agent_instruction":"x"},{"label":"具体改动","minimum_prose_characters":180,"agent_instruction":"x"},{"label":"对主干的风险","minimum_prose_characters":120,"agent_instruction":"x"},{"label":"我的整体评价","minimum_prose_characters":60,"agent_instruction":"x"}],"output_hint":"x"},"review_plan":{"required_evidence_ids":[],"applicability":{"behavior_bearing_change":true}},"evidence_commands":[],"motivation":"m1。m2。m3。m4。"}]}
JSON
  exit 0
fi
if [[ "$args" == *"--check-merge-readiness"* ]]; then
  if [[ "\${MOCK_LOOPX_READINESS_FAIL:-}" == "1" ]]; then exit 1; fi
  exit 0
fi
exit 0
`;
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'loopx'), loopxStub, { mode: 0o755 });

  const npmStub = `#!/usr/bin/env bash
echo "mock gate OK"
exit 0
`;
  fs.writeFileSync(path.join(MOCK_BIN_DIR, 'npm'), npmStub, { mode: 0o755 });

  return mockGhPath;
}

function cleanupMock() {
  if (fs.existsSync(MOCK_BIN_DIR)) {
    fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(MOCK_COMMENT_LOG)) {
    fs.unlinkSync(MOCK_COMMENT_LOG);
  }
}

test('1. Native Five-Section Review: loopx-flow review must render loopx pr-review review_template format with dynamic metadata', () => {
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
    assert.strictEqual(fs.existsSync(MOCK_COMMENT_LOG), true, 'Must post comment via gh');
    const comment = fs.readFileSync(MOCK_COMMENT_LOG, 'utf8');

    // 原生五段式章节齐备，且必须携带动态元数据/声明/关键代码讲解
    for (const label of ['动机', '改动思路', '具体改动', '对主干的风险', '我的整体评价']) {
      assert.strictEqual(comment.includes(`## ${label}`), true, `Must include native section: ${label}`);
    }
    assert.strictEqual(comment.includes('### 关键代码讲解'), true, 'Code changes must include key code walkthrough');
    assert.strictEqual(comment.includes('#123'), true, 'Must include dynamic PR number');
    assert.strictEqual(comment.includes('feature/delivery-review-merge-lock'), true, 'Must include dynamic target branch');
    assert.strictEqual(comment.includes('3 files changed'), true, 'Must include dynamic diff stats');
    assert.strictEqual(comment.includes('declaration=self_reported'), true, 'Must publish reviewer declaration source token');
    assert.strictEqual(comment.includes('dynamic review verified by mock agent'), true, 'Must carry agent finding');
    // 严禁自造 Block 版式
    assert.doesNotMatch(comment, /5-Block|Block\s*[1-5]\b|fiveBlock/i);
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
