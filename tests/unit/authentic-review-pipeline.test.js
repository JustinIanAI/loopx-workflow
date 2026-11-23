'use strict';
/**
 * Feature 5: authentic-review-pipeline — TDD acceptance tests
 *
 * 验证第三方评审报告严格由 LoopX 原生 `pr-review` 能力驱动（复用 review_template 五段式，不手写 Block 模板）：
 *   - S1 codex 调用（默认模型，无 -m/--model）
 *   - S2 fail-closed：原生 review_template 不可用 -> NOT_VERIFIED，不发布
 *   - S2b 原生 review_template 驱动提示词：agent_instruction / output_hint 透传
 *   - S2c Reviewer 行发布 declaration=self_reported，并落盘原生评审产物
 *   - S3 PR body 组装器（--rebuild-body）
 *   - INV1 fail-closed：未核验/缺声明 -> 拒绝发布
 *   - INV2 head 漂移：模型自报 head 与当前 PR head 不一致 -> 拒绝发布
 *   - S4 carryover 裁决封顶
 *   - INV3 原生 check-result 硬门禁（ok=true 才允许发布）与协议对齐
 *   - S5 交叉核验
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js');

const HEAD = '1111111111111111111111111111111111111111';

function nativeReviewBody(verdict, extra = '') {
  return [
    'Reviewer: model_agent',
    '## 动机',
    `native motivation content ${extra}`,
    '## 改动思路',
    'native approach',
    '## 具体改动',
    '### 关键代码讲解',
    '- `src/app.js` — hardcoded credential pattern at exact head',
    '## 对主干的风险',
    'native risks',
    '## 我的整体评价',
    'native verdict',
    `English verdict: ${verdict}`,
  ].join('\n');
}

function nativeModelOut({ verdict = 'request_changes', headOid = HEAD, findings = [{ file: 'src/app.js', line: 1, severity: 'blocker', summary: 'hardcoded credential pattern', repro: 'grep token src/app.js' }], extra = '', carryover } = {}) {
  const payload = {
    review_body: nativeReviewBody(verdict, extra),
    verdict,
    findings,
    reviewer: { actor_kind: 'model_agent', declaration_source: 'self_reported', declared_model: 'codex', declared_provider: 'openai' },
    headOid,
  };
  if (carryover) payload.carryover = carryover;
  return '```json\n' + JSON.stringify(payload) + '\n```';
}

function makeSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-review-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });

  const diffFile = path.join(dir, 'fixture.diff');
  fs.writeFileSync(diffFile, opts.diffText || 'diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n+const token = "placeholder";\n');
  const legits = { gh: 1, codex: 1, loopx: 1, npm: 1, claude: 1 };
  if (opts.omitCodex) delete legits.codex;
  let {
    mockHeadOid = HEAD,
    codexExit = 0, codexStdoutFile = '', verdict = 'request_changes',
    reviewHeadOid = HEAD,
    claudeStdoutFile = '', loopxCheckResult = 'ok', gatesExit = 0,
    reviewTemplate = 1, codexMode = 'native',
    policyMode = 'contract', policyRevision = 26,
  } = opts;
  const contractFragment = policyMode === 'contract'
    ? `,"agent_response_contract":{"review_execution_contract":{"policy_revision":${policyRevision}}}`
    : '';
  const templateFragment = policyMode === 'result_template'
    ? `,"result_template":{"review_policy_revision":${policyRevision}}`
    : '';
  const probeValue = policyMode === 'probe' ? String(policyRevision) : '';

  // 默认模型输出：原生 schema（review_body + verdict + findings + reviewer）
  if (!codexStdoutFile) {
    codexStdoutFile = path.join(dir, 'codex-default.json');
    fs.writeFileSync(codexStdoutFile, nativeModelOut({ verdict, headOid: reviewHeadOid }));
  }

  for (const name of Object.keys(legits)) {
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash
echo "$0 $*" >> ${JSON.stringify(logs)}/calls.log
args="$*"
case "$0" in
  *gh)
    if [[ "$args" == *"view"* ]]; then
      echo '{"headRefOid": "${mockHeadOid}", "headRefName": "feature/x", "changedFiles": 2}'
      exit 0
    fi
    if [[ "$args" == *"diff"* ]]; then
      cat ${JSON.stringify(diffFile)}
      exit 0
    fi
    if [[ "$args" == *"comment"* ]]; then exit 0; fi
    if [[ "$args" == *"edit"* ]]; then exit 0; fi
    exit 0 ;;
  *codex)
    if [[ ! -t 0 ]]; then
      cat >> ${JSON.stringify(logs)}/calls.log
      printf '\n' >> ${JSON.stringify(logs)}/calls.log
    fi
    if [[ "${codexExit}" != "0" ]]; then exit ${codexExit}; fi
    cat "${codexStdoutFile}"
    exit 0 ;;
  *claude)
    if [[ ! -t 0 ]]; then
      cat >> ${JSON.stringify(logs)}/calls.log
      printf '\n' >> ${JSON.stringify(logs)}/calls.log
    fi
    if [[ -n "${claudeStdoutFile}" ]]; then cat "${claudeStdoutFile}"; else
      echo '{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"claude","model":"claude-default","declaration":"self_reported"}}'
    fi
    exit 0 ;;
  *loopx)
    if [[ "$args" == *"--print-policy-revision"* ]]; then
      if [[ -n "${probeValue}" ]]; then
        echo "${probeValue}"
        exit 0
      fi
      echo "policy_revision unavailable" >&2
      exit 1
    fi
    if [[ "$args" == *"pr-review"* && "$args" == *"--format json"* ]]; then
      if [[ "${reviewTemplate}" == "1" ]]; then
        cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"reviewer_execution":{"status":"unavailable","reason":"session_not_bound"}${contractFragment},"pull_requests":[{"number":7,"head_oid":"${mockHeadOid}","headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review","review_template":{"schema":"pr_review_five_block_template_v0","sections":[{"label":"动机","minimum_prose_characters":40,"agent_instruction":"NATIVE_AGENT_INSTRUCTION_XYZ 动机约束"},{"label":"改动思路","minimum_prose_characters":80,"agent_instruction":"改动思路约束"},{"label":"具体改动","minimum_prose_characters":180,"agent_instruction":"具体改动约束；代码类变更必须包含 ### 关键代码讲解"},{"label":"对主干的风险","minimum_prose_characters":120,"agent_instruction":"风险约束"},{"label":"我的整体评价","minimum_prose_characters":60,"agent_instruction":"评价约束"}],"output_hint":"NATIVE_OUTPUT_HINT_XYZ"},"review_plan":{"required_evidence_ids":["e1"],"applicability":{"behavior_bearing_change":true}},"evidence_commands":["echo evidence-ok"],"motivation":"LoopX extracted motivation text."${templateFragment}}]}
JSON
      else
        cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"reviewer_execution":{"status":"unavailable","reason":"session_not_bound"}${contractFragment},"pull_requests":[{"number":7,"head_oid":"${mockHeadOid}","headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review"${templateFragment}}]}
JSON
      fi
      exit 0
    fi
    if [[ "$args" == *"--check-result"* ]]; then
      result_file=""; packet_file=""; prev=""
      for a in $args; do
        if [[ "$prev" == "--check-result" ]]; then result_file="$a"; fi
        if [[ "$prev" == "--packet" ]]; then packet_file="$a"; fi
        prev="$a"
      done
      if [[ -n "$result_file" && ! -f "$result_file" ]]; then
        echo "RESULT_FILE_MISSING_AT_CALL_TIME $result_file" >> ${JSON.stringify(logs)}/calls.log
      else
        echo "RESULT_FILE_PRESENT_AT_CALL_TIME" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ -n "$packet_file" && -f "$packet_file" ]] && grep -q '"pull_requests"' "$packet_file"; then
        echo "PACKET_HAS_PULL_REQUESTS" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ -n "$result_file" && -f "$result_file" ]] && grep -q '"pull_request_review_result_v1"' "$result_file"; then
        echo "RESULT_SCHEMA_V1" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ -n "$result_file" && -f "$result_file" ]] && grep -q "7@${mockHeadOid}" "$result_file"; then
        echo "TARGET_EXACT_HEAD_MATCHES" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ -n "$result_file" && -f "$result_file" ]] && grep -Eq '"review_policy_revision": *${policyRevision}(,|})' "$result_file"; then
        echo "RESULT_POLICY_REVISION_${policyRevision}" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ -n "$result_file" && -f "$result_file" ]] && grep -q '"declaration_source": *"self_reported"' "$result_file"; then
        echo "RESULT_DECLARATION_SELF_REPORTED" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ "${loopxCheckResult}" == "fail" ]]; then
        echo '{"ok":false,"review_body_check":{"valid":false,"invalid_reasons":["五段式版式未通过"]},"errors":["review_body:missing_section"]}'
        exit 1
      fi
      if [[ "${loopxCheckResult}" == "approval_gap" ]]; then
        if grep -q '"verdict": *"APPROVE"' "$result_file"; then
          echo '{"ok":false,"errors":["approval_contradicts_evidence"],"approval_blockers":["walkthroughs:missing"],"review_body_check":{"valid":true}}'
          exit 1
        fi
        echo '{"ok":true,"review_body_check":{"valid":true},"errors":[],"approval_consistent":false,"approval_blockers":["walkthroughs:missing"]}'
        exit 0
      fi
      echo '{"ok":true,"review_body_check":{"valid":true},"errors":[],"approval_consistent":true}'
      exit 0
    fi
    echo "[mock loopx] $args"; exit 0 ;;
  *npm)
    echo "stub gate OK"; exit ${gatesExit} ;;
esac
exit 0
`);
  }
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  if (fs.existsSync(path.join(bin, 'codex'))) fs.chmodSync(path.join(bin, 'codex'), 0o755);
  fs.chmodSync(path.join(bin, 'loopx'), 0o755);
  fs.chmodSync(path.join(bin, 'npm'), 0o755);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const tmpDir = path.join(dir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  return { dir, bin, logs: path.join(logs, 'calls.log'), tmpDir };
}

function run(sbx, args, envExtra) {
  const env = {
    ...process.env,
    PATH: `${sbx.bin}:${process.env.PATH}`,
    AUTHENTIC_REVIEW_HEAD_OID: HEAD,
    REVIEW_MODEL: 'codex',
    LOOPX_TMP_DIR: sbx.tmpDir,
  };
  delete env.REVIEW_SHORTCIRCUIT;
  delete env.REVIEW_DEBOUNCE_SECONDS;
  delete env.REVIEW_UPSERT_PUBLISH;
  delete env.REVIEW_KEEP_PROMPT;
  delete env.REVIEW_TWO_STAGE_ALIGNMENT;
  delete env.REVIEW_STDIN_BYTE_LIMIT;
  if (envExtra) Object.assign(env, envExtra);
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { env, encoding: 'utf8', cwd: PROJECT_ROOT, timeout: 120000 });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const FEATURE = 'native-dispatch-deep-integration';

describe('S1 invocation: codex exec with default model', () => {
  test('prompt carries head oid, remote diff and JSON protocol; no model flag', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /codex exec --sandbox read-only/);
    assert.match(calls, /-C \S+/);
    assert.match(calls, /-o \S+ -$/m);
    assert.doesNotMatch(calls, /--add-dir/);
    assert.doesNotMatch(calls, /codex exec .*-m |codex exec .*--model /);
  });
});

describe('S2 fail-closed: native review_template unavailable', () => {
  test('no review_template -> NOT_VERIFIED, exit nonzero, no publish (禁止自造降级报告)', () => {
    const sbx = makeSandbox({ reviewTemplate: 0 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /NOT_VERIFIED|review_template/i);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.doesNotMatch(calls, /\/gh pr comment/);
  });

  test('legacy model schema without review_body -> NOT_VERIFIED (不再降级渲染)', () => {
    const legacy = path.join(os.tmpdir(), `codex-legacy-${Date.now()}.json`);
    fs.writeFileSync(legacy, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"codex","model":"codex-default","declaration":"self_reported"},"headOid":"' + HEAD + '"}\n```');
    const sbx = makeSandbox({ codexStdoutFile: legacy });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /review_body|NOT_VERIFIED/i);
  });
});

describe('S2b native review_template drives the prompt (LoopX packet)', () => {
  test('native agent_instruction / output_hint are passed through into the prompt', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /NATIVE_AGENT_INSTRUCTION_XYZ/);
    assert.match(calls, /NATIVE_OUTPUT_HINT_XYZ/);
    assert.match(r.out, /## 动机/);
    assert.match(r.out, /## 我的整体评价/);
    assert.match(r.out, /English verdict/i);
  });

  test('native mode + model native schema -> exactly one Reviewer line and one English verdict line', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const reviewerLines = (r.out.match(/^Reviewer:/gm) || []).length;
    assert.strictEqual(reviewerLines, 1, `expected exactly 1 Reviewer line, got ${reviewerLines}`);
    const verdictLines = (r.out.match(/^English verdict:/gm) || []).length;
    assert.strictEqual(verdictLines, 1, `expected exactly 1 English verdict line, got ${verdictLines}`);
    // 真实评审包 reviewer_execution=unavailable -> 必须如实声明 self_reported，并发布 token
    assert.match(r.out, /Reviewer: model_agent .*declaration=self_reported/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /RESULT_DECLARATION_SELF_REPORTED/);
  });

  test('review artifact is persisted for loopx-flow respond reuse', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const artifact = path.join(PROJECT_ROOT, '.loopx', 'cache', 'reviews', `7@${HEAD}.json`);
    assert.strictEqual(fs.existsSync(artifact), true, 'review artifact must be persisted under .loopx/cache/reviews');
    const data = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    assert.strictEqual(data.schema_version, 'loopx_flow_review_cache_v1');
    assert.strictEqual(data.result_payload.schema_version, 'pull_request_review_result_v1');
    assert.strictEqual(data.reviewer.declaration_source, 'self_reported');
    assert.strictEqual(Array.isArray(data.findings), true);
    fs.rmSync(artifact, { force: true });
  });
});

describe('S3 PR body assembler', () => {
  test('five sections present; missing capsule asset marked NOT_PROVIDED', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', '__nonexistent_capsule__', '--rebuild-body']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /## 动机|## Motivation/i);
    assert.match(r.out, /NOT_PROVIDED/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /gh .*edit/);
  });
});

describe('INV1 fail-closed', () => {
  test('unparseable codex output -> exit 1, NOT_VERIFIED, no comment', () => {
    const f = path.join(os.tmpdir(), `codex-garbage-${Date.now()}.txt`);
    fs.writeFileSync(f, 'I could not review this PR, sorry.');
    const sbx = makeSandbox({ codexStdoutFile: f });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /NOT_VERIFIED/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.doesNotMatch(calls, /\/gh pr comment/);
  });

  test('missing model declaration -> rejected', () => {
    const f = path.join(os.tmpdir(), `codex-nodecl-${Date.now()}.json`);
    fs.writeFileSync(f, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"headOid":"' + HEAD + '"}\n```');
    const sbx = makeSandbox({ codexStdoutFile: f });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /declaration|DECLARATION/i);
  });
});

describe('INV2 head drift', () => {
  test('model-reported head differs from current PR head -> exit 1', () => {
    const f = path.join(os.tmpdir(), `codex-drift-${Date.now()}.json`);
    fs.writeFileSync(f, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"codex","model":"codex-default","declaration":"self_reported"},"headOid":"' + HEAD + '"}\n```');
    const sbx = makeSandbox({
      codexStdoutFile: f,
      mockHeadOid: '2222222222222222222222222222222222222222',
    });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /drift|DRIFT|head/i);
  });
});

describe('S4 carryover verdict capping', () => {
  test('unresolved reproducible finding caps verdict at request_changes', () => {
    const f = path.join(os.tmpdir(), `codex-ok-${Date.now()}.json`);
    fs.writeFileSync(f, nativeModelOut({ verdict: 'approve', headOid: HEAD, findings: [], carryover: [{ finding_index: 1, status: 'reproducible', evidence: 'still present in diff' }] }));
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'approve' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [{ file: 'src/app.js', line: 9, severity: 'blocker', summary: 'injected injection' }] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--carryover-file', carry]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /request_changes/i);
    assert.match(r.out, /injected injection/);
    assert.match(r.out, /Carryover|待闭环/i);
  });
});

describe('INV3 native check-result gate', () => {
  test('native mode: check-result returns ok=false -> NOT_VERIFIED, no publish', () => {
    const sbx = makeSandbox({ loopxCheckResult: 'fail' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /NOT_VERIFIED|check-result/i);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.doesNotMatch(calls, /\/gh pr comment/);
    assert.match(calls, /RESULT_FILE_PRESENT_AT_CALL_TIME/);
  });
});

describe('INV3 verdict policy: contradictory APPROVE is capped, not published as approval', () => {
  test('native approval_contradicts_evidence -> verdict capped to REQUEST_CHANGES and re-checked', () => {
    const sbx = makeSandbox({ loopxCheckResult: 'approval_gap', verdict: 'APPROVE' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /VERDICT CAPPED|approval_contradicts_evidence/);
    assert.match(r.out, /English verdict: REQUEST_CHANGES/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /gh .*comment/);
  });
});

describe('INV3 native check-result protocol alignment', () => {
  test('result file written BEFORE --check-result call (no timing inversion)', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /RESULT_FILE_PRESENT_AT_CALL_TIME/);
    assert.doesNotMatch(calls, /RESULT_FILE_MISSING_AT_CALL_TIME/);
  });
  test('packet is pull_request_review_packet_v0 with pull_requests; result binds pr@head', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /PACKET_HAS_PULL_REQUESTS/);
    assert.match(calls, /RESULT_SCHEMA_V1/);
    assert.match(calls, /TARGET_EXACT_HEAD_MATCHES/);
    assert.match(calls, /RESULT_POLICY_REVISION_26/);
    assert.match(r.out, /review_policy_revision: 26/);
    assert.match(r.out, /loopx executable:/);
  });
});

describe('issue #19 dynamic loopx and policy_revision', () => {
  test('a non-default packet revision is written through, not a hardcoded constant', () => {
    const sbx = makeSandbox({ policyRevision: 31 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /RESULT_POLICY_REVISION_31/);
    assert.doesNotMatch(calls, /RESULT_POLICY_REVISION_22/);
  });

  test('result_template.review_policy_revision is accepted when the execution contract omits it', () => {
    const sbx = makeSandbox({ policyMode: 'result_template', policyRevision: 26 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /RESULT_POLICY_REVISION_26/);
    assert.match(r.out, /result_template\.review_policy_revision/);
  });

  test('runtime probe supplies policy_revision when the packet does not', () => {
    const sbx = makeSandbox({ policyMode: 'probe', policyRevision: 26 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /RESULT_POLICY_REVISION_26/);
    assert.match(r.out, /print-policy-revision|REVIEW_POLICY_REVISION/);
  });

  test('missing policy_revision fails closed and does not publish', () => {
    const sbx = makeSandbox({ policyMode: 'none' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /policy_revision/);
    assert.match(r.out, /fail-closed/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.doesNotMatch(calls, /\/gh pr comment/);
  });

  test('LOOPX_BIN pointing at a missing file fails closed before pr-review', () => {
    const sbx = makeSandbox();
    const missing = path.join(sbx.dir, 'missing-loopx');
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], { LOOPX_BIN: missing });
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /LOOPX_BIN/);
    assert.match(r.out, /fail-closed/);
    const calls = fs.existsSync(sbx.logs) ? fs.readFileSync(sbx.logs, 'utf8') : '';
    assert.doesNotMatch(calls, /pr-review/);
  });

  test('an active CONDA_PREFIX is used when PATH and LOOPX_BIN do not provide loopx', () => {
    const sbx = makeSandbox();
    const pathDir = path.join(sbx.dir, 'pathbin');
    fs.mkdirSync(pathDir);
    for (const name of ['gh', 'codex', 'claude', 'npm']) {
      fs.symlinkSync(path.join(sbx.bin, name), path.join(pathDir, name));
    }
    fs.symlinkSync(process.execPath, path.join(pathDir, 'node'));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {
      LOOPX_BIN: '',
      PATH: `${pathDir}:/usr/bin:/bin`,
      CONDA_PREFIX: sbx.dir,
      CONDA_EXE: '',
      VIRTUAL_ENV: '',
      MAMBA_ROOT_PREFIX: '',
    });
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /loopx executable:.*\(CONDA_PREFIX\)/);
  });
});

describe('S5 cross validation', () => {
  test('disputed findings annotated when claude disagrees', () => {
    const cf = path.join(os.tmpdir(), `claude-disagree-${Date.now()}.json`);
    fs.writeFileSync(cf, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"claude","model":"claude-default","declaration":"self_reported"}}\n```');
    const sbx = makeSandbox({ claudeStdoutFile: cf });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--cross-validate']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /DISPUTED|cross|CROSS/i);
  });
});
describe('R3 carryover adjudication', () => {
  test('fixed/obsolete carryover allows APPROVE and publishes per-item status', () => {
    const f = path.join(os.tmpdir(), 'codex-carry-ok-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'approve', findings: [], carryover: [
      { finding_index: 1, status: 'fixed', evidence: 'grep no longer matches' },
      { finding_index: 2, status: 'obsolete', evidence: 'code path removed' },
    ] }));
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'approve' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [
      { file: 'src/a.js', severity: 'P1', summary: 'first' },
      { file: 'src/b.js', severity: 'P2', summary: 'second' },
    ] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--carryover-file', carry]);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.out.includes('上轮 findings 裁决'));
    assert.ok(r.out.includes('fixed'));
    assert.ok(r.out.includes('obsolete'));
  });

  test('missing carryover status with prior findings -> NOT_VERIFIED', () => {
    const f = path.join(os.tmpdir(), 'codex-carry-missing-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'approve', findings: [] }));
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'approve' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [{ file: 'src/a.js', severity: 'P1', summary: 'still here' }] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--carryover-file', carry]);
    assert.notStrictEqual(r.code, 0);
    assert.ok(r.out.includes('NOT_VERIFIED') || r.out.includes('carryover status'));
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.ok(!calls.includes('gh pr comment'));
  });

  test('invalid carryover status -> NOT_VERIFIED', () => {
    const f = path.join(os.tmpdir(), 'codex-carry-invalid-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'request_changes', findings: [], carryover: [
      { finding_index: 1, status: 'wontfix', evidence: 'bad status' },
    ] }));
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'request_changes' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [{ file: 'src/a.js', severity: 'P1', summary: 'still here' }] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--carryover-file', carry]);
    assert.notStrictEqual(r.code, 0);
    assert.ok(r.out.includes('NOT_VERIFIED') || r.out.includes('carryover status'));
  });

  test('carryover section is present in the checked result body before English verdict', () => {
    const f = path.join(os.tmpdir(), 'codex-carry-result-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'request_changes', findings: [], carryover: [
      { finding_index: 1, status: 'reproducible', evidence: 'still present' },
    ] }));
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'request_changes' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [{ file: 'src/a.js', severity: 'P1', summary: 'still here' }] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--carryover-file', carry]);
    assert.strictEqual(r.code, 0, r.out);
    const cacheFile = path.join(PROJECT_ROOT, '.loopx', 'cache', 'reviews', `7@${HEAD}.json`);
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const result = cache.result_payload;
    assert.ok(result.review_body.includes('上轮 findings 裁决'));
    assert.ok(result.review_body.indexOf('上轮 findings 裁决') < result.review_body.indexOf('English verdict'));
    assert.deepStrictEqual(fs.readdirSync(sbx.tmpDir), [], '成功路径必须清理本次运行临时目录');
    fs.rmSync(cacheFile, { force: true });
  });

  test('no prior findings does not require carryover adjudication', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!r.out.includes('上轮 findings 裁决'));
  });
});

describe('R3 agent policy and model declaration', () => {
  test('codex unavailable does not fall back to claude', () => {
    const f = path.join(os.tmpdir(), 'codex-unused-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'approve', findings: [] }));
    const sbx = makeSandbox({ omitCodex: true, codexStdoutFile: f, verdict: 'approve' });
    const nodeDir = path.dirname(process.execPath);
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], { PATH: `${sbx.bin}:${nodeDir}:/usr/bin:/bin` });
    assert.notStrictEqual(r.code, 0);
    assert.ok(r.out.includes('NOT_VERIFIED') || r.out.includes('codex CLI unavailable'));
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.ok(!calls.includes('claude'));
  });

  test('explicit --agent-bin claude is allowed', () => {
    const f = path.join(os.tmpdir(), 'claude-explicit-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'request_changes', findings: [] }));
    const sbx = makeSandbox({ omitCodex: true, claudeStdoutFile: f, verdict: 'request_changes' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--agent-bin', 'claude']);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.ok(calls.includes('claude -p'));
  });

  test('Reviewer line records configured default model instead of codex', () => {
    const f = path.join(os.tmpdir(), 'model-decl-' + Date.now() + '.json');
    const payload = {
      review_body: nativeReviewBody('request_changes'),
      verdict: 'request_changes',
      findings: [],
      reviewer: { actor_kind: 'model_agent', declaration_source: 'self_reported', declared_provider: 'openai' },
      headOid: HEAD,
    };
    fs.writeFileSync(f, '```json' + JSON.stringify(payload) + '```');
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'request_changes' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], { REVIEW_MODEL: 'gemini-3.8-flash-high' });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.out.includes('model=gemini-3.8-flash-high'));
  });

  test('3D evaluation is injected into the native prompt', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.ok(calls.includes('delivery / long_horizon / user_experience'));
  });
});

describe('R3 carryover integrity', () => {
  test('fixed/obsolete without evidence -> NOT_VERIFIED', () => {
    const f = path.join(os.tmpdir(), 'codex-carry-noev-' + Date.now() + '.json');
    fs.writeFileSync(f, nativeModelOut({ verdict: 'approve', findings: [], carryover: [
      { finding_index: 1, status: 'fixed', evidence: '' },
    ] }));
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'approve' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [{ file: 'src/a.js', severity: 'P1', summary: 'still here' }] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--carryover-file', carry]);
    assert.notStrictEqual(r.code, 0);
    assert.ok(r.out.includes('NOT_VERIFIED') || r.out.includes('carryover status'));
  });
});

describe('P0-A1 gates env isolation', () => {
  test('gates() strips cmd_review REVIEW_* throttle vars before spawning npm', () => {
    const { isolatedGateEnv, gates } = require(SCRIPT);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-gates-env-'));
    const dumpFile = path.join(dir, 'env.log');
    const mockNpm = path.join(dir, 'npm');
    fs.writeFileSync(mockNpm, [
      '#!/usr/bin/env bash',
      'printf "%s:%s:%s:%s\\n" "${REVIEW_SHORTCIRCUIT:-UNSET}" "${REVIEW_DEBOUNCE_SECONDS:-UNSET}" "${REVIEW_UPSERT_PUBLISH:-UNSET}" "$*" >> ' + JSON.stringify(dumpFile),
      'exit 0',
    ].join('\n'), { mode: 0o755 });

    const prevBin = process.env.AUTHENTIC_REVIEW_GATES_BIN;
    process.env.AUTHENTIC_REVIEW_GATES_BIN = mockNpm;
    try {
      const clean = isolatedGateEnv({
        PATH: process.env.PATH,
        REVIEW_SHORTCIRCUIT: '1',
        REVIEW_DEBOUNCE_SECONDS: '60',
        REVIEW_UPSERT_PUBLISH: '1',
        REVIEW_BACKOFF_BASE_MS: '1000',
        REVIEW_MAX_RETRIES: '3',
      });
      assert.strictEqual(clean.REVIEW_SHORTCIRCUIT, undefined);
      assert.strictEqual(clean.REVIEW_DEBOUNCE_SECONDS, undefined);
      assert.strictEqual(clean.REVIEW_UPSERT_PUBLISH, undefined);
      const res = gates({
        noCache: true,
        env: {
          ...process.env,
          REVIEW_SHORTCIRCUIT: '1',
          REVIEW_DEBOUNCE_SECONDS: '60',
          REVIEW_UPSERT_PUBLISH: '1',
        },
      });
      assert.strictEqual(res.test, 'PASSED');
      const lines = fs.readFileSync(dumpFile, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 4);
      for (const line of lines) {
        assert.match(line, /^UNSET:UNSET:UNSET:run (typecheck|lint|build|test)$/);
      }
    } finally {
      if (prevBin === undefined) delete process.env.AUTHENTIC_REVIEW_GATES_BIN;
      else process.env.AUTHENTIC_REVIEW_GATES_BIN = prevBin;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ADR-0013 stdin streaming, sandbox prompt artifact, two-stage alignment & PATCH arg fix', () => {
  test('two-stage alignment resolves missing evidence on APPROVE and stores prompt in LOOPX_TMP_DIR', () => {
    const sbx = makeSandbox({ verdict: 'approve' });
    const stage1File = path.join(sbx.dir, 'stage1.json');
    const stage2File = path.join(sbx.dir, 'stage2.json');
    fs.writeFileSync(stage1File, nativeModelOut({ verdict: 'approve', findings: [] }));
    fs.writeFileSync(stage2File, '```json\n{"evidence":{"e1":{"status":"verified","summary":"aligned in stage 2"}}}\n```');
    // Override mock codex to emit stage1 on first call and stage2 on second call
    const counterFile = path.join(sbx.dir, 'codex-count');
    fs.writeFileSync(path.join(sbx.bin, 'codex'), `#!/usr/bin/env bash
echo "$0 $*" >> ${JSON.stringify(sbx.logs)}
if [[ ! -t 0 ]]; then cat >> ${JSON.stringify(sbx.logs)}; printf '\\n' >> ${JSON.stringify(sbx.logs)}; fi
n=0
if [[ -f ${JSON.stringify(counterFile)} ]]; then n=$(cat ${JSON.stringify(counterFile)}); fi
n=$((n+1))
echo "$n" > ${JSON.stringify(counterFile)}
if [[ "$n" == "1" ]]; then cat ${JSON.stringify(stage1File)}; else cat ${JSON.stringify(stage2File)}; fi
exit 0
`, { mode: 0o755 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], { REVIEW_KEEP_PROMPT: '1' });
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /阶段 2 证据对齐/);
    const runDirs = fs.readdirSync(sbx.tmpDir).filter((d) => d.startsWith('review-pr7-'));
    assert.strictEqual(runDirs.length, 1, 'REVIEW_KEEP_PROMPT=1 应保留本次唯一运行目录');
    const runPath = path.join(sbx.tmpDir, runDirs[0]);
    assert.strictEqual(fs.existsSync(path.join(runPath, `review-prompt-7-${HEAD.slice(0, 10)}.md`)), true);
    assert.strictEqual(fs.existsSync(path.join(runPath, `review-prompt-7-${HEAD.slice(0, 10)}-stage2.md`)), true);
    assert.match(fs.readFileSync(path.join(runPath, 'pr.diff'), 'utf8'), /const token = "placeholder"/);
    assert.match(fs.readFileSync(path.join(runPath, 'evidence-output.md'), 'utf8'), /evidence-ok/);
    assert.ok(fs.existsSync(path.join(runPath, 'packet.json')));
    assert.ok(fs.existsSync(path.join(runPath, 'remote-checks.txt')));
    assert.ok(fs.existsSync(path.join(runPath, 'stage1-review.md')));
    const stage1Prompt = fs.readFileSync(path.join(runPath, `review-prompt-7-${HEAD.slice(0, 10)}.md`), 'utf8');
    assert.doesNotMatch(stage1Prompt, /const token = "placeholder"/);
    const resultJson = JSON.parse(fs.readFileSync(path.join(runPath, 'result.json'), 'utf8'));
    assert.strictEqual(resultJson.evidence.e1.status, 'verified');
    fs.rmSync(path.join(PROJECT_ROOT, '.loopx', 'cache', 'reviews', `7@${HEAD}.json`), { force: true });
  });

  test('ghApiWithBackoff PATCH passes separate -X and PATCH tokens (no leading space method)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.strictEqual(src.includes("'-X', 'PATCH'"), true, 'must pass -X and PATCH as separate args');
    assert.strictEqual(src.includes('`-X PATCH`'), false, 'must not embed space in -X PATCH single arg');
  });

  test('architecture_assessment boundary note is inserted before English verdict line', () => {
    const sbx = makeSandbox({ verdict: 'approve' });
    const packetFile = path.join(sbx.dir, 'packet.json');
    fs.writeFileSync(packetFile, JSON.stringify({
      schema_version: 'pull_request_review_packet_v0',
      repository: 'o/r',
      reviewer_execution: { status: 'unavailable', reason: 'session_not_bound' },
      agent_response_contract: {
        review_execution_contract: {
          policy_revision: 26,
          evidence_requirements: [
            {
              evidence_id: 'change_proportionality',
              fields: ['architecture_assessment', 'verdict'],
              verdict_values: ['proportionate'],
            },
          ],
        },
      },
      pull_requests: [{
        number: 7,
        head_oid: HEAD,
        headRefOid: HEAD,
        headRefName: 'feature/x',
        title: 't',
        review_action_kind: 'review',
        review_template: {
          schema: 'pr_review_five_block_template_v0',
          sections: [
            { label: '动机', minimum_prose_characters: 5, agent_instruction: 'm' },
            { label: '改动思路', minimum_prose_characters: 5, agent_instruction: 'a' },
            { label: '具体改动', minimum_prose_characters: 5, agent_instruction: 'c' },
            { label: '对主干的风险', minimum_prose_characters: 5, agent_instruction: 'r' },
            { label: '我的整体评价', minimum_prose_characters: 5, agent_instruction: 'v' },
          ],
          output_hint: 'ok',
        },
        review_plan: { required_evidence_ids: ['change_proportionality'], applicability: { behavior_bearing_change: true } },
        evidence_commands: [],
        motivation: '',
      }],
    }));
    const stage1File = path.join(sbx.dir, 'stage1-arch.json');
    const stage2File = path.join(sbx.dir, 'stage2-arch.json');
    fs.writeFileSync(stage1File, nativeModelOut({ verdict: 'approve', findings: [] }));
    fs.writeFileSync(stage2File, '```json\n' + JSON.stringify({
      evidence: {
        change_proportionality: {
          status: 'verified',
          verdict: 'proportionate',
          architecture_assessment: {
            decision: 'retain',
            reason: 'arch boundary reason xyz',
            current_pr_boundary: 'skills/code-review/ only',
            validation_evidence: ['tests/unit/a.test.js', 'tests/unit/b.test.js'],
            mechanisms: [{
              mechanism: 'stdin',
              responsibility: 'provider_io',
              owning_boundary: 'authentic-review.js',
              activation_and_default: 'always',
              failure_and_recovery: 'exit 1',
              placement_basis: 'ADR-0013',
            }],
          },
        },
      },
    }) + '\n```');
    const counterFile = path.join(sbx.dir, 'codex-count-arch');
    fs.writeFileSync(path.join(sbx.bin, 'codex'), `#!/usr/bin/env bash
if [[ ! -t 0 ]]; then cat >/dev/null; fi
n=0
if [[ -f ${JSON.stringify(counterFile)} ]]; then n=$(cat ${JSON.stringify(counterFile)}); fi
n=$((n+1))
echo "$n" > ${JSON.stringify(counterFile)}
if [[ "$n" == "1" ]]; then cat ${JSON.stringify(stage1File)}; else cat ${JSON.stringify(stage2File)}; fi
exit 0
`, { mode: 0o755 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--packet-file', packetFile]);
    assert.strictEqual(r.code, 0, r.out);
    const cacheFile = path.join(PROJECT_ROOT, '.loopx', 'cache', 'reviews', `7@${HEAD}.json`);
    const resultJson = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).result_payload;
    assert.strictEqual(resultJson.evidence.change_proportionality.status, 'verified');
    assert.strictEqual(
      resultJson.evidence.change_proportionality.architecture_assessment.validation_evidence,
      'tests/unit/a.test.js；tests/unit/b.test.js',
    );
    const boundaryIdx = resultJson.review_body.indexOf('> 当前 PR 边界：skills/code-review/ only');
    const verdictIdx = resultJson.review_body.indexOf('English verdict:');
    assert.ok(boundaryIdx > 0 && verdictIdx > boundaryIdx, 'boundary note must appear before English verdict');
    assert.deepStrictEqual(fs.readdirSync(sbx.tmpDir), [], '成功路径必须清理本次运行临时目录');
    fs.rmSync(cacheFile, { force: true });
  });
});

describe('host truncation fail-closed guard', () => {
  test('bracketed bytes-omitted marker exits nonzero, prints NOT_VERIFIED, and does not publish', () => {
    const pre = fs.mkdtempSync(path.join(os.tmpdir(), 'trunc-marker-'));
    const file = path.join(pre, 'out.json');
    fs.writeFileSync(file, nativeModelOut({ extra: '[... 44229 bytes omitted ...]' }));
    const sbx = makeSandbox({ codexStdoutFile: file });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /\[NOT_VERIFIED\]/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.doesNotMatch(calls, /pr comment/);
    const runDirs = fs.readdirSync(sbx.tmpDir).filter((d) => d.startsWith('review-pr7-'));
    assert.strictEqual(runDirs.length, 1, 'failed run must keep the sandbox');
    fs.rmSync(pre, { recursive: true, force: true });
  });

  test('quoting a pr.diff truncation literal is not a host truncation', () => {
    const marker = '[... 44229 bytes omitted ...]';
    const pre = fs.mkdtempSync(path.join(os.tmpdir(), 'trunc-literal-'));
    const file = path.join(pre, 'out.json');
    fs.writeFileSync(file, nativeModelOut({ extra: `fixture quotes ${marker}` }));
    const sbx = makeSandbox({ codexStdoutFile: file, diffText: `+const fixture = "${marker}";\n` });
    fs.writeFileSync(path.join(sbx.bin, 'codex'), `#!/bin/sh\nout=""; p=""\nfor a in "$@"; do [ "\$p" = "-o" ] && out="\$a"; p="\$a"; done\ncat >/dev/null\ncat ${JSON.stringify(file)} > "\$out"\necho ${JSON.stringify(marker)} >&2\nexit 0\n`, { mode: 0o755 });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(fs.readFileSync(sbx.logs, 'utf8'), /pr comment/);
    fs.rmSync(pre, { recursive: true, force: true });
  });

  test('prose that discusses bytes omitted does not trip the guard', () => {
    const pre = fs.mkdtempSync(path.join(os.tmpdir(), 'trunc-prose-'));
    const file = path.join(pre, 'out.json');
    fs.writeFileSync(file, nativeModelOut({ extra: 'This review discusses the bytes omitted mechanism without a host marker.' }));
    const sbx = makeSandbox({ codexStdoutFile: file });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(fs.readFileSync(sbx.logs, 'utf8'), /pr comment/);
    fs.rmSync(pre, { recursive: true, force: true });
  });
});
