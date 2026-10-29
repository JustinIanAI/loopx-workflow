'use strict';
/**
 * Feature 5: authentic-review-pipeline — TDD acceptance tests
 * Verifies: S1 codex invocation (default model), S2 5-Block solidification,
 * S3 PR body assembler, S4 carryover verdict capping, Fail-Closed invariants.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js');

function makeSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-review-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });

  const legits = { gh: 1, codex: 1, loopx: 1, npm: 1, claude: 1 };
  const { mockHeadOid = '1111111111111111111111111111111111111111', codexExit = 0, codexStdoutFile = '', verdict = 'request_changes', reviewHeadOid = '1111111111111111111111111111111111111111', claudeStdoutFile = '', loopxCheckResult = 'ok', gatesExit = 0 } = opts;
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
    if [[ -n "${codexStdoutFile}" ]]; then cat "${codexStdoutFile}"; else
      cat <<'JSON'
\`\`\`json
{"schemaVersion":"authentic_review_result_v1","verdict":"${verdict}","findings":[{"file":"src/app.js","line":1,"severity":"blocker","summary":"hardcoded credential pattern","repro":"grep token src/app.js"}],"declaration":{"reviewer":"codex","model":"codex-default","declaration":"runtime_reported"},"headOid":"${reviewHeadOid}"}
\`\`\`
JSON
    fi
    exit 0 ;;
  *claude)
    if [[ -n "${claudeStdoutFile}" ]]; then cat "${claudeStdoutFile}"; else
      echo '{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"claude","model":"claude-default","declaration":"runtime_reported"}}'
    fi
    exit 0 ;;
  *loopx)
    if [[ "$args" == *"pr-review"* && "$args" == *"--format json"* ]]; then
      cat <<JSON
{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"pull_requests":[{"number":7,"headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review"}]}
JSON
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
      if [[ -n "$result_file" && -f "$result_file" ]] && grep -q '"target_exact_head": "7@'"${mockHeadOid}"'"' "$result_file"; then
        echo "TARGET_EXACT_HEAD_MATCHES" >> ${JSON.stringify(logs)}/calls.log
      fi
      if [[ "${loopxCheckResult}" == "fail" ]]; then echo "inconsistent" >&2; exit 1; fi
      echo '{"ok": true, "status": "consistent"}'
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
    AUTHENTIC_REVIEW_HEAD_OID: '1111111111111111111111111111111111111111',
  };
  if (envExtra) Object.assign(env, envExtra);
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { env, encoding: 'utf8', cwd: PROJECT_ROOT, timeout: 120000 });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const HEAD = '1111111111111111111111111111111111111111';

describe('S1 invocation: codex exec with default model', () => {
  test('prompt carries head oid, remote diff and JSON protocol; no model flag', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /codex exec/);
    assert.doesNotMatch(calls, /codex exec .*-m |codex exec .*--model /);
  });
});

describe('S2 solidification: findings land in 5-Block', () => {
  test('block 4 contains real finding and verdict; comment posted', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /hardcoded credential pattern/);
    assert.match(r.out, /request_changes/);
    assert.match(r.out, /runtime_reported/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /gh .*comment/);
    assert.doesNotMatch(r.out, /fresh execution via npm run gates/);
  });
});

describe('INV1 fail-closed', () => {
  test('unparseable codex output -> exit 1, NOT_VERIFIED, no comment', () => {
    const f = path.join(os.tmpdir(), `codex-garbage-${Date.now()}.txt`);
    fs.writeFileSync(f, 'I could not review this PR, sorry.');
    const sbx = makeSandbox({ codexStdoutFile: f });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /NOT_VERIFIED/);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.doesNotMatch(calls, /\/gh pr comment/);
  });
  test('missing model declaration -> rejected', () => {
    const f = path.join(os.tmpdir(), `codex-nodecl-${Date.now()}.json`);
    fs.writeFileSync(f, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"headOid":"' + HEAD + '"}\n```');
    const sbx = makeSandbox({ codexStdoutFile: f });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /declaration|DECLARATION/i);
  });
});

describe('INV2 head drift', () => {
  test('head changed between review and publish -> exit 1', () => {
    const f = path.join(os.tmpdir(), `codex-drift-${Date.now()}.json`);
    fs.writeFileSync(f, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"codex","model":"d","declaration":"runtime_reported"},"headOid":"' + HEAD + '"}\n```');
    const sbx = makeSandbox({ codexStdoutFile: f, mockHeadOid: '2222222222222222222222222222222222222222' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /drift|DRIFT|head/i);
  });
});

describe('S4 carryover verdict capping', () => {
  test('unresolved reproducible finding caps verdict at request_changes', () => {
    const f = path.join(os.tmpdir(), `codex-ok-${Date.now()}.json`);
    fs.writeFileSync(f, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"codex","model":"d","declaration":"runtime_reported"},"headOid":"' + HEAD + '"}\n```');
    const sbx = makeSandbox({ codexStdoutFile: f, verdict: 'approve' });
    const carry = path.join(sbx.dir, 'carryover.json');
    fs.writeFileSync(carry, JSON.stringify({ findings: [{ file: 'src/app.js', line: 9, severity: 'blocker', summary: 'injected injection' }] }));
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration', '--carryover-file', carry]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /request_changes/);
    assert.match(r.out, /injected injection/);
  });
});

describe('S3 body assembler', () => {
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

describe('INV3 check-result gate', () => {
  test('check-result rejection -> integrity gap published honestly, verdict capped', () => {
    const sbx = makeSandbox({ loopxCheckResult: 'fail' });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /CHECK_RESULT_INTEGRITY_GAP/);
    assert.match(r.out, /request_changes/);
  });
});

describe('INV3 check-result protocol alignment', () => {
  test('result file written BEFORE --check-result call (no timing inversion)', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(calls, /RESULT_FILE_PRESENT_AT_CALL_TIME/);
    assert.doesNotMatch(calls, /RESULT_FILE_MISSING_AT_CALL_TIME/);
  });
  test('packet is pull_request_review_packet_v0 with pull_requests; result binds pr@head', () => {
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration']);
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
    fs.writeFileSync(cf, '```json\n{"schemaVersion":"authentic_review_result_v1","verdict":"approve","findings":[],"declaration":{"reviewer":"claude","model":"c","declaration":"runtime_reported"}}\n```');
    const sbx = makeSandbox({ claudeStdoutFile: cf });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', 'native-dispatch-deep-integration', '--cross-validate']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /DISPUTED|cross|CROSS/i);
  });
});
