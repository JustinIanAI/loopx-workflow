'use strict';
/**
 * Feature: review-pipeline-throttle — TDD 验收测试
 *
 * 验证三项降载改动：
 *   T1 head-oid 幂等：同一 pr@head 已存在 native_check.ok=true 的 artifact 时，
 *      第二次执行短路复用，不再调用 gh pr view / gh pr diff / loopx pr-review（模型执行）。
 *   T2 comment upsert：发布阶段先 GET 检索带标记的 comment；命中 → PATCH，未命中 → POST。
 *   T3 客户端节流：进程内同 head 两次完整执行间隔 < debounceSeconds 时短路。
 *
 * 契约: specs/features/review-pipeline-throttle/04-contract.md
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

// 复用 authentic-review-pipeline.test.js 的 sandbox 构造（独立复制，避免跨文件依赖）
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

function nativeModelOut({ verdict = 'request_changes', headOid = HEAD, findings = [{ file: 'src/app.js', line: 1, severity: 'blocker', summary: 'hardcoded credential pattern', repro: 'grep token src/app.js' }] } = {}) {
  const payload = {
    review_body: nativeReviewBody(verdict),
    verdict,
    findings,
    reviewer: { actor_kind: 'model_agent', declaration_source: 'self_reported', declared_model: 'codex', declared_provider: 'openai' },
    headOid,
  };
  return '```json\n' + JSON.stringify(payload) + '\n```';
}

function makeSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-review-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });

  let {
    mockHeadOid = HEAD,
    reviewTemplate = 1,
    commentExisting = null, // 预置 comment 标记 → 第二次发布走 PATCH
  } = opts;

  const codexStdoutFile = path.join(dir, 'codex-default.json');
  fs.writeFileSync(codexStdoutFile, nativeModelOut({}));

  const logLine = `echo "$0 $*" >> ${JSON.stringify(logs)}/calls.log`;

  // 每个 bin 生成独立、语法正确的 bash shim（按二进制名 case 路由）
  const ghShim = [
    '#!/usr/bin/env bash',
    logLine,
    'args="$*"',
    'case "$0" in',
    '  *gh)',
    '    if [[ "$args" == *"view"* ]]; then',
    `      echo '{"headRefOid": "${mockHeadOid}", "headRefName": "feature/x", "changedFiles": 2}'`,
    '      exit 0',
    '    fi',
    '    if [[ "$args" == *"diff"* ]]; then',
    "      echo 'diff --git a/src/app.js b/src/app.js'",
    "      echo '+const token = \"placeholder\";'",
    '      exit 0',
    '    fi',
    '    if [[ "$args" == *"comment"* && "$args" == *"--body-file"* ]]; then',
    '      echo \'{"node_id":"CM-NEW","id":901,"url":"https://api.github.com/repos/o/r/issues/7/comments/901"}\'',
    '      exit 0',
    '    fi',
    '    if [[ "$args" == *"api"* && "$args" == *"comments"* ]]; then',
    `      echo ${JSON.stringify(Array.isArray(commentExisting) ? commentExisting : '[]')}`,
    '      exit 0',
    '    fi',
    '    if [[ "$args" == *"api"* && "$args" == *"PATCH"* ]]; then',
    "      echo '{\"id\":902}'",
    '      exit 0',
    '    fi',
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n');

  const loopxShim = [
    '#!/usr/bin/env bash',
    logLine,
    'args="$*"',
    'case "$0" in',
    '  *loopx)',
    '    if [[ "$args" == *"pr-review"* && "$args" == *"--format json"* ]]; then',
    `      if [[ "${reviewTemplate}" == "1" ]]; then`,
    '        cat <<JSON',
    `{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"pull_requests":[{"number":7,"head_oid":"${mockHeadOid}","headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review","review_template":{"schema":"pr_review_five_block_template_v0","sections":[{"label":"动机","minimum_prose_characters":40,"agent_instruction":"NATIVE_AGENT_INSTRUCTION_XYZ 动机约束"},{"label":"改动思路","minimum_prose_characters":80,"agent_instruction":"改动思路约束"},{"label":"具体改动","minimum_prose_characters":180,"agent_instruction":"改动思路约束；代码类变更必须包含 ### 关键代码讲解"},{"label":"对主干的风险","minimum_prose_characters":120,"agent_instruction":"风险约束"},{"label":"我的整体评价","minimum_prose_characters":60,"agent_instruction":"评价约束"}],"output_hint":"NATIVE_OUTPUT_HINT_XYZ"},"review_plan":{"required_evidence_ids":["e1"],"applicability":{"behavior_bearing_change":true}},"evidence_commands":["echo evidence-ok"],"motivation":"LoopX extracted motivation text."}]}`,
    'JSON',
    '      else',
    '        cat <<JSON',
    `{"schema_version":"pull_request_review_packet_v0","repository":"o/r","request":{"source":"github_cli"},"reviewer_execution":{"status":"unavailable","reason":"session_not_bound"},"pull_requests":[{"number":7,"head_oid":"${mockHeadOid}","headRefOid":"${mockHeadOid}","headRefName":"feature/x","title":"t","review_action_kind":"review"}]}`,
    'JSON',
    '      fi',
    '      exit 0',
    '    fi',
    '    if [[ "$args" == *"--check-result"* ]]; then',
    "      echo '{\"ok\":true,\"review_body_check\":{\"valid\":true},\"errors\":[],\"approval_consistent\":true}'",
    '      exit 0',
    '    fi',
    '    echo "[mock loopx] $args"; exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n');

  const codexShim = [
    '#!/usr/bin/env bash',
    logLine,
    'args="$*"',
    'case "$0" in',
    '  *codex)',
    `    cat "${codexStdoutFile}"`,
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n');

  const claudeShim = [
    '#!/usr/bin/env bash',
    logLine,
    'args="$*"',
    'case "$0" in',
    '  *claude)',
    "    echo '{\"schemaVersion\":\"authentic_review_result_v1\",\"verdict\":\"approve\",\"findings\":[],\"declaration\":{\"reviewer\":\"claude\",\"model\":\"claude-default\",\"declaration\":\"self_reported\"}}'",
    '    exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n');

  const npmShim = [
    '#!/usr/bin/env bash',
    logLine,
    'args="$*"',
    'case "$0" in',
    '  *npm)',
    '    echo "stub gate OK"; exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n');

  fs.writeFileSync(path.join(bin, 'gh'), ghShim);
  fs.writeFileSync(path.join(bin, 'loopx'), loopxShim);
  fs.writeFileSync(path.join(bin, 'codex'), codexShim);
  fs.writeFileSync(path.join(bin, 'claude'), claudeShim);
  fs.writeFileSync(path.join(bin, 'npm'), npmShim);
  for (const f of fs.readdirSync(bin)) fs.chmodSync(path.join(bin, f), 0o755);
  return { dir, bin, logs: path.join(logs, 'calls.log') };
}

function run(sbx, args, envExtra, cwd, debounceSeconds) {
  const env = {
    ...process.env,
    PATH: `${sbx.bin}:${process.env.PATH}`,
    AUTHENTIC_REVIEW_HEAD_OID: HEAD,
    REVIEW_MODEL: 'codex',
    REVIEW_SHORTCIRCUIT: '1', // 显式开启短路/节流（契约要求编排器 opt-in）
    REVIEW_DEBOUNCE_SECONDS: String(debounceSeconds == null ? 0 : debounceSeconds), // 默认禁用时间窗口（T3 单独验证）
  };
  if (envExtra) Object.assign(env, envExtra);
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      env, encoding: 'utf8', cwd: cwd || PROJECT_ROOT, timeout: 120000,
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function seedArtifact(repo, pr, headOid) {
  // 预置一个 native_check.ok=true 的评审 artifact，模拟「同一 head 已完成一次完整评审」
  const dir = path.join(repo, '.loopx', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${pr}@${headOid.toLowerCase()}.json`);
  fs.writeFileSync(p, JSON.stringify({
    schema_version: 'loopx_flow_review_artifact_v0',
    pr: Number(pr),
    head_oid: headOid.toLowerCase(),
    reviewed_at: new Date().toISOString(),
    verdict: 'REQUEST_CHANGES',
    reviewer: { actor_kind: 'model_agent', declaration_source: 'self_reported', declared_model: 'codex', declared_provider: 'openai' },
    findings: [{ file: 'src/app.js', line: 1, severity: 'blocker', summary: 'seeded' }],
    native_check: { ok: true, approval_consistent: true },
    review_body: nativeReviewBody('request_changes', 'seeded'),
    published: { commentId: 901, headOid: headOid.toLowerCase() },
  }, null, 2));
  return p;
}

const FEATURE = 'native-dispatch-deep-integration';

describe('T1 head-oid 幂等短路', () => {
  test('同一 head 已有 ok artifact 时，第二次执行短路：不再调 gh pr view/diff 与 loopx 模型执行', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    const sbx = makeSandbox();
    // 第一次：REVIEW_SHORTCIRCUIT=1 但无既有 artifact → 完整管线（正常落盘 .loopx/reviews/7@head.json）
    const r1 = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 60);
    assert.strictEqual(r1.code, 0, r1.out);
    // 第二次：T1 幂等 + T3 节流（debounce 窗口内）→ 零 API 短路
    const r2 = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 60);
    assert.strictEqual(r2.code, 0, r2.out);
    assert.match(r2.out, /THROTTLE\] 短路|复用既有/i, '应提示短路复用');
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    // 第一次完整管线: 起始 prView + INV2 复核 prView + diff + 模型执行
    // 零 API 短路后第二次: 0 次。总数: view=2, diff=1, model=1
    const totalView = (calls.match(/gh .*pr view/g) || []).length;
    const totalDiff = (calls.match(/gh .*pr diff/g) || []).length;
    const totalReviewExec = (calls.match(/loopx .*pr-review .*--format json/g) || []).length;
    assert.strictEqual(totalView, 2, `gh pr view 应共 2 次（仅第一次：起始+INV2 复核），实际 ${totalView}`);
    assert.strictEqual(totalDiff, 1, `gh pr diff 应只发生 1 次（仅第一次），实际 ${totalDiff}`);
    assert.strictEqual(totalReviewExec, 1, `loopx pr-review 模型执行应只发生 1 次，实际 ${totalReviewExec}`);
  });

  test('--force-recheck 绕过短路，强制重跑完整管线', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    seedArtifact(repo, 7, HEAD);
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--force-recheck'], {}, repo, 60);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.ok((calls.match(/loopx .*pr-review .*--format json/g) || []).length >= 1, 'force-recheck 应触发模型执行');
  });
});

describe('T2 comment upsert', () => {
  test('REVIEW_UPSERT_PUBLISH=1 时：无既有 comment 标记走 POST 新建；有标记走 PATCH 更新（不新增 comment）', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    // 阶段 A：空 comments 列表 + upsert 开启 → GET 检索无命中 → 走 POST（gh pr comment 路径）
    let sbx = makeSandbox({ commentExisting: null });
    const rA = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE],
      { REVIEW_UPSERT_PUBLISH: '1' }, repo, 0);
    assert.strictEqual(rA.code, 0, rA.out);
    const callsA = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(callsA, /gh .*comment.*--body-file/, '首次发布应走 POST');
    assert.ok(!/gh .*api.*-X PATCH/i.test(callsA), '无命中时不应有 PATCH');

    // 阶段 B：预置带标记的既有 comment + 已落盘 artifact（debounce 窗口内）
    // → 零 API 短路，发布阶段走 upsert PATCH（更新既有 comment，不新增）
    const marker = `{"id":901,"body":"seeded body<!-- loopx-flow:review:7@${HEAD.toLowerCase()} -->","node_id":"CM-X"}`;
    sbx = makeSandbox({ commentExisting: [marker] });
    seedArtifact(repo, 7, HEAD);
    const rB = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE],
      { REVIEW_UPSERT_PUBLISH: '1' }, repo, 60);
    assert.strictEqual(rB.code, 0, rB.out);
    assert.match(rB.out, /THROTTLE|短路|复用/i, '有既有 comment 标记时应短路复用');
    const callsB = fs.readFileSync(sbx.logs, 'utf8');
    assert.match(callsB, /gh .*api.*-X PATCH/i, '短路发布应走 PATCH 更新既有 comment');
    assert.ok(!/gh pr comment/i.test(callsB), 'PATCH 命中后不应再 POST 新增 comment');
  });
});

describe('T3 进程内节流', () => {
  test('REVIEW_SHORTCIRCUIT=1 且 REVIEW_DEBOUNCE_SECONDS > 0 且距上次执行 < debounce 时短路复用', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    seedArtifact(repo, 7, HEAD);
    // 给 artifact 注入 reviewed_at = now（节流窗口内）
    const p = path.join(repo, '.loopx', 'reviews', `7@${HEAD.toLowerCase()}.json`);
    const art = JSON.parse(fs.readFileSync(p, 'utf8'));
    art.reviewed_at = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(art, null, 2));
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE],
      {}, repo, 60);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /THROTTLE|REUSED|短路|复用/i, '窗口内应短路');
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.strictEqual((calls.match(/loopx .*pr-review .*--format json/g) || []).length, 0,
      '节流短路不得触发模型执行');
  });
});
