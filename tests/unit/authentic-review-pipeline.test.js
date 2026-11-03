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

function nativeModelOut({ verdict = 'request_changes', headOid = HEAD, findings = [{ file: 'src/app.js', line: 1, severity: 'blocker', summary: 'hardcoded credential pattern', repro: 'grep token src/app.js' }], extra = '' } = {}) {
  return '```json\n' + JSON.stringify({
    review_body: nativeReviewBody(verdict, extra),
    verdict,
    findings,
    reviewer: { actor_kind: 'model_agent', declaration_source: 'self_reported', declared_model: 'codex', declared_provider: 'openai' },
    headOid,
  }) + '\n```';
}

function makeSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-review-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });

  const legits = { gh: 1, codex: 1, loopx: 1, npm: 1, claude: 1 };
  let {
    mockHeadOid = HEAD,
    codexExit = 0, codexStdoutFile = '', verdict = 'request_changes',
    reviewHeadOid = HEAD,
    claudeStdoutFile = '', loopxCheckResult = 'ok', gatesExit = 0,
    reviewTemplate = 1, codexMode = 'native',
  } = opts;

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
      echo 'diff --git a/src/app.js b/src/app.js'
      echo '--- a/src/app.js'
      echo '+++ b/src/app.js'
      echo '+const token = "placeholder";'
      exit 0
    fi
    if [[ "$args" == *"comment"* ]]; then exit 0; fi
    if [[ "$args" == *"edit"* ]]; then exit 0; fi
    exit 0 ;;
  *codex)
    if [[ "${codexExit}" != "0" ]]; then exit ${codexExit}; fi
    cat "${codexStdoutFile}"
    exit 0 ;;
  *claude)
    if [[ -n "${claudeStdoutFile}" ]]; then cat "${claudeStdoutFile}"; else
      echo '{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"claude","model":"claude-default","declaration":"self_reported"}}'
    fi
    exit 0 ;;
  *loopx)
    if [[ "$args" == *"pr-review"* && "$args" == *"--format json"* ]]; then
      if [[ "${reviewTemplate}" == "1" ]]; then
        cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"pull_requests":[{"number":7,"head_oid":"${mockHeadOid}","headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review","review_template":{"schema":"pr_review_five_block_template_v0","sections":[{"label":"动机","minimum_prose_characters":40,"agent_instruction":"NATIVE_AGENT_INSTRUCTION_XYZ 动机约束"},{"label":"改动思路","minimum_prose_characters":80,"agent_instruction":"改动思路约束"},{"label":"具体改动","minimum_prose_characters":180,"agent_instruction":"具体改动约束；代码类变更必须包含 ### 关键代码讲解"},{"label":"对主干的风险","minimum_prose_characters":120,"agent_instruction":"风险约束"},{"label":"我的整体评价","minimum_prose_characters":60,"agent_instruction":"评价约束"}],"output_hint":"NATIVE_OUTPUT_HINT_XYZ"},"review_plan":{"required_evidence_ids":["e1"],"applicability":{"behavior_bearing_change":true}},"evidence_commands":["echo evidence-ok"],"motivation":"LoopX extracted motivation text."}]}
JSON
      else
        cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"pull_requests":[{"number":7,"head_oid":"${mockHeadOid}","headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review"}]}
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
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  fs.chmodSync(path.join(bin, 'loopx'), 0o755);
  fs.chmodSync(path.join(bin, 'npm'), 0o755);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  return { dir, bin, logs: path.join(logs, 'calls.log') };
}

function run(sbx, args, envExtra) {
  const env = {
    ...process.env,
    PATH: `${sbx.bin}:${process.env.PATH}`,
    AUTHENTIC_REVIEW_HEAD_OID: HEAD,
  };
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
    assert.match(calls, /codex exec/);
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
    const artifact = path.join(PROJECT_ROOT, '.loopx', 'reviews', `7@${HEAD}.json`);
    assert.strictEqual(fs.existsSync(artifact), true, 'review artifact must be persisted under .loopx/reviews');
    const data = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    assert.strictEqual(data.schema_version, 'loopx_flow_review_artifact_v0');
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
    fs.writeFileSync(f, nativeModelOut({ verdict: 'approve', headOid: HEAD, findings: [] }));
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
