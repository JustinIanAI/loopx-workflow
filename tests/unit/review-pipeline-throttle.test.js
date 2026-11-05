'use strict';
/**
 * Feature: review-pipeline-throttle — TDD 验收测试
 *
 * 验证三项降载改动：
 *   T1 head-oid 幂等：同一 pr@head 已存在 native_check.ok=true 的 artifact 时，
 *      第二次执行 1 次 gh pr view 后短路复用，不再取 diff / 重跑模型 / 堆叠评论；
 *      跨 head 绝不复用（fail-open）。
 *   T2 comment upsert：发布阶段先 GET 检索带标记的 comment；命中 → PATCH，未命中 → POST。
 *   T3 客户端节流：同 PR 完整执行间隔 < debounceSeconds 时有界等待合并突发；
 *      gh api 429/503 指数退避重试。
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
    apiFailFirst = false,   // gh api comments 首次返回 429（验证指数退避重试）
  } = opts;
  const apiStateFile = path.join(dir, 'api-fail-once.state');

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
    `      if [[ "${apiFailFirst}" == "true" && ! -f ${JSON.stringify(apiStateFile)} ]]; then`,
    `        : > ${JSON.stringify(apiStateFile)}`,
    '        echo "gh: API rate limit exceeded for user (HTTP 429) retry-after: 0" >&2',
    '        exit 1',
    '      fi',
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
  test('同一 head 已有 ok artifact 时，第二次执行不重跑 diff 与模型，发布走 upsert', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    const sbx = makeSandbox();
    // 第一次：无既有 artifact → 完整管线（落盘 .loopx/reviews/7@head.json）
    const r1 = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 0);
    assert.strictEqual(r1.code, 0, r1.out);
    // 第二次：同一 head 命中幂等 → 1 次 prView 后短路（不 diff、不跑模型、不堆叠评论）
    const r2 = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 0);
    assert.strictEqual(r2.code, 0, r2.out);
    assert.match(r2.out, /head-oid 幂等|复用既有评审结果/i, '应提示 head-oid 幂等短路');
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    // 第一次: 起始 prView + INV2 复核 prView + diff + 模型; 第二次: 仅 1 次 prView
    const totalView = (calls.match(/gh .*pr view/g) || []).length;
    const totalDiff = (calls.match(/gh .*pr diff/g) || []).length;
    const totalReviewExec = (calls.match(/loopx .*pr-review .*--format json/g) || []).length;
    assert.strictEqual(totalView, 3, `gh pr view 应为 3 次（第一次 2 次 + 第二次幂等探测 1 次），实际 ${totalView}`);
    assert.strictEqual(totalDiff, 1, `gh pr diff 应只发生 1 次（幂等后不得重取 diff），实际 ${totalDiff}`);
    assert.strictEqual(totalReviewExec, 1, `模型执行应只发生 1 次（幂等后不得重跑），实际 ${totalReviewExec}`);
  });

  test('head 已漂移时不得复用旧 artifact（跨 head 复用是 fail-open）', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    const OLD_HEAD = '2222222222222222222222222222222222222222';
    seedArtifact(repo, 7, OLD_HEAD);          // 旧 head 的评审产物
    const sbx = makeSandbox();                 // gh 报告当前 head = HEAD
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 0);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!/head-oid 幂等/.test(r.out), 'head 不同不得走幂等短路');
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.strictEqual((calls.match(/loopx .*pr-review .*--format json/g) || []).length, 1,
      'head 漂移后必须重新执行评审');
  });

  test('--force-recheck 绕过短路，强制重跑完整管线', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    seedArtifact(repo, 7, HEAD);
    const sbx = makeSandbox();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE, '--force-recheck'], {}, repo, 0);
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

describe('T3 客户端节流', () => {
  test('同一 PR 距上次完整执行不足 debounceSeconds 且 head 已漂移：有界等待合并突发后再执行', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    const OLD_HEAD = '2222222222222222222222222222222222222222';
    seedArtifact(repo, 7, OLD_HEAD); // 上次完整执行（不同 head）刚结束
    const sbx = makeSandbox();       // 当前 head = HEAD（已漂移 → 幂等不命中）
    const started = Date.now();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 3);
    const elapsed = Date.now() - started;
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /合并突发|等待 \d+s/i, '应提示节流等待');
    assert.ok(elapsed >= 2000, `应等待约 3s 合并突发，实际 ${elapsed}ms`);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    assert.strictEqual((calls.match(/loopx .*pr-review .*--format json/g) || []).length, 1,
      '等待后仍应完成一次真实评审');
  });

  test('REVIEW_DEBOUNCE_SECONDS=0 时不做等待（禁用节流窗口）', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    seedArtifact(repo, 7, '2222222222222222222222222222222222222222');
    const sbx = makeSandbox();
    const started = Date.now();
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE], {}, repo, 0);
    const elapsed = Date.now() - started;
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!/合并突发/.test(r.out), 'debounce=0 不应等待');
    assert.ok(elapsed < 2500, `debounce=0 应立即执行，实际 ${elapsed}ms`);
  });

  test('gh api 429 触发指数退避重试后成功（不 fail-closed 中断）', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-repo-'));
    const sbx = makeSandbox({ apiFailFirst: true, commentExisting: null });
    const r = run(sbx, ['--pr', '7', '--repo', 'o/r', '--feature', FEATURE],
      { REVIEW_UPSERT_PUBLISH: '1', REVIEW_BACKOFF_BASE_MS: '10' }, repo, 0);
    assert.strictEqual(r.code, 0, r.out);
    const calls = fs.readFileSync(sbx.logs, 'utf8');
    const apiGetAttempts = (calls.match(/gh api .*comments/g) || []).length;
    assert.ok(apiGetAttempts >= 2, `429 后应重试检索（实际 ${apiGetAttempts} 次）`);
    assert.match(calls, /gh .*comment.*--body-file/, '退避重试后仍应完成发布');
  });
});
