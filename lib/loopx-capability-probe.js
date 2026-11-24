'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ANCHOR = { version: '2.3.0', commit: 'loopx-project/loopx@f4c5d6d7' };
const SCHEMA_WHITELIST = [
  'loopx_coordination_todo_claim_result_v0',
  'loopx_coordination_todo_update_result_v0',
  'loopx_coordination_todo_terminal_lifecycle_result_v0',
  'task_graph_projection_v0',
  'agent_lane_next_action_projection_v0',
  'change_quality_prepare_packet_v2',
  'change_quality_receipt_v2',
  'change_quality_receipt_verification_v2',
  'pull_request_review_execution_contract_v2',
  'pull_request_review_result_v1',
];

const CAPABILITIES = [
  { id: 'goal.bootstrap', tier: 'BLOCK', argv: ['bootstrap', '--help'], signals: ['--goal-id', '--state-file'] },
  { id: 'todo.claim', tier: 'BLOCK', argv: ['todo', 'claim', '--help'], signals: ['--goal-id', '--todo-id', '--agent-id', '--claimed-by', '--claim-operation-id'] },
  { id: 'todo.parser', tier: 'BLOCK', argv: ['todo', 'complete', '--help'], signals: ['--required-write-scope', '--task-domain', '--task-repository', '--validation-command', '--operation-id', '--claim-operation-id', '--task-class', '--decision-scope', '--decision-outcome', '--global-gate'] },
  { id: 'change-quality.strict-receipt', tier: 'BLOCK', argv: ['change-quality', 'record', '--help'], signals: ['--goal-id', '--result-json', '--execute', '--base-ref', '--strict'] },
  { id: 'pr-review.merge-readiness', tier: 'BLOCK', argv: ['pr-review', '--help'], signals: ['--check-merge-readiness'] },
  { id: 'pr-review.check-result', tier: 'BLOCK', argv: ['pr-review', '--help'], signals: ['--check-result'] },
  { id: 'goal.lifecycle', tier: 'BLOCK', argv: ['goal-lifecycle', '--help'], signals: ['stop', 'sync-global', '--goal-id', '--state-file'] },
  { id: 'issue-fix.feasibility', tier: 'BLOCK', onlyFor: 'issue', argv: ['issue-fix', '--help'], signals: ['feasibility'] },
  { id: 'integration-branch', tier: 'BLOCK', onlyFor: 'integrate', argv: ['integration-branch', '--help'], signals: ['configure', 'status', 'sync'] },
  { id: 'goal.acceptance', tier: 'WARN', argv: ['goal-acceptance', '--help'], signals: ['verify', '--format'] },
];

function parseArgs(argv) {
  const opts = { command: 'doctor', format: 'text', payloadFile: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--command') opts.command = argv[++i] || 'doctor';
    else if (arg === '--payload-file') opts.payloadFile = argv[++i] || null;
    else if (arg === '--format') opts.format = argv[++i] || 'text';
  }
  return opts;
}

function probeCapability(cap, command) {
  const proc = spawnSync('loopx', cap.argv, { encoding: 'utf8', timeout: 5000 });
  const text = `${proc.stdout || ''}${proc.stderr || ''}`;
  let probe = 'PASS';
  let missing = [];
  if (proc.error || proc.status !== 0 || !text.trim()) {
    probe = 'UNKNOWN';
    missing = cap.signals.slice();
  } else {
    missing = cap.signals.filter((signal) => !text.includes(signal));
    probe = missing.length === 0 ? 'PASS' : 'BLOCK';
  }
  let status = probe === 'PASS' ? 'PASS' : cap.tier === 'BLOCK' ? 'BLOCK' : 'WARN';
  if (cap.onlyFor && (command === 'doctor' || command !== cap.onlyFor) && status !== 'PASS') status = 'WARN';
  return {
    id: cap.id,
    tier: cap.tier,
    signal: cap.signals.join(', '),
    command: `loopx ${cap.argv.join(' ')}`,
    status,
    probe,
    missing,
  };
}

function probeSchema(payloadFile) {
  const row = {
    id: 'schema.version',
    tier: 'BLOCK',
    signal: `白名单 ${SCHEMA_WHITELIST.length} 项`,
    command: payloadFile ? `schema_version @ ${payloadFile}` : 'schema_version 白名单已注册',
    status: 'PASS',
    probe: 'PASS',
    missing: [],
  };
  if (!payloadFile) return { row, detail: null };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  } catch (_) {
    row.status = 'BLOCK';
    row.probe = 'BLOCK';
    row.missing = ['<invalid-json>'];
    return { row, detail: { actual: '<invalid-json>', expected: SCHEMA_WHITELIST.join(', ') } };
  }
  const actual = payload && typeof payload.schema_version === 'string' ? payload.schema_version : '<missing>';
  if (!SCHEMA_WHITELIST.includes(actual)) {
    row.status = 'BLOCK';
    row.probe = 'BLOCK';
    row.missing = [actual];
    return { row, detail: { actual, expected: SCHEMA_WHITELIST.join(', ') } };
  }
  return { row, detail: null };
}

function probeVersion() {
  const proc = spawnSync('loopx', ['--version'], { encoding: 'utf8', timeout: 5000 });
  const text = `${proc.stdout || ''}${proc.stderr || ''}`;
  const match = text.match(/(\d+\.\d+\.\d+)/);
  const version = match ? match[1] : '<unknown>';
  const drifted = proc.status !== 0 || !match || version !== ANCHOR.version;
  return {
    version,
    anchor: ANCHOR.version,
    status: drifted ? 'WARN' : 'PASS',
    text: drifted
      ? `版本软提示: 当前 loopx ${version} 与已验证锚点 ${ANCHOR.version}（${ANCHOR.commit}）不同；Flag 与 schema_version 兼容时仅告警，建议先跑本地金丝雀自测。`
      : `版本锚点一致: loopx ${version}`,
  };
}

function buildCard({ command, advisory, rows, schemaDetail }) {
  const failures = rows.filter((row) => row.status === 'BLOCK');
  if (failures.length === 0 && !schemaDetail) return null;
  const expected = failures.map((row) => `${row.id}: ${row.signal}`).join('；');
  if (schemaDetail) {
    return [
      '=== LoopX 升级契约差异诊断卡 ===',
      `当前 loopx 版本: ${advisory.version}`,
      `触发命令: loopx-flow capability-probe --command ${command}`,
      `期望 Flag/schema_version: ${schemaDetail.expected}`,
      `实际 schema_version: ${schemaDetail.actual}`,
      `探测结果: schema.version=BLOCK`,
      '影响范围: 所有消费 LoopX --format json 载荷的 L0 命令',
      `适配定位: 按锚点 ${ANCHOR.commit} 更新白名单或升级 LoopX skills 后重跑探针`,
      '====================================',
    ].join('\n');
  }
  return [
    '=== LoopX 升级契约差异诊断卡 ===',
    `当前 loopx 版本: ${advisory.version}`,
    `触发命令: loopx-flow capability-probe --command ${command}`,
    `期望 Flag/schema_version: ${expected}`,
    `实际缺失/不匹配: ${failures.map((row) => `${row.id}=${row.missing.join(', ') || '<none>'}`).join('；')}`,
    `探测结果: ${failures.map((row) => `${row.id}=${row.probe}`).join(', ')}`,
    `影响范围: ${failures.map((row) => row.id).join(', ')} 相关 L0 命令`,
    `适配定位: 对照锚点 ${ANCHOR.commit} 核对子命令帮助签名，必要时升级 LoopX skills`,
    '====================================',
  ].join('\n');
}

function formatText(result) {
  const lines = [
    `LoopX 三层能力探针 / 能力矩阵 (command=${result.command})`,
    '| 能力 | 探测信号 | 状态 |',
    '| --- | --- | --- |',
  ];
  for (const row of result.capabilities) {
    lines.push(`| ${row.id} | ${row.signal} | ${row.status} |`);
  }
  lines.push(result.advisory.text);
  if (result.card) lines.push(result.card);
  return `${lines.join('\n')}\n`;
}

function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write('用法: loopx-capability-probe [--command doctor|issue|integrate] [--payload-file <path>] [--format text|json]\n');
    return 0;
  }
  const rows = CAPABILITIES.map((cap) => probeCapability(cap, opts.command));
  const schema = probeSchema(opts.payloadFile);
  rows.push(schema.row);
  const advisory = probeVersion();
  const card = buildCard({ command: opts.command, advisory, rows, schemaDetail: schema.detail });
  const hasBlock = rows.some((row) => row.status === 'BLOCK');
  const hasWarn = rows.some((row) => row.status === 'WARN') || advisory.status === 'WARN';
  const result = {
    command: opts.command,
    status: hasBlock ? 'BLOCK' : hasWarn ? 'WARN' : 'PASS',
    exit_code: hasBlock ? 1 : 0,
    capabilities: rows,
    advisory,
    card,
  };
  if (opts.format === 'json') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatText(result));
  }
  return result.exit_code;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[FAIL-CLOSED] LoopX 能力探针执行失败: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { CAPABILITIES, SCHEMA_WHITELIST, run };
