'use strict';
/**
 * 集中式 LoopX 三层能力探针（ADR-0010 决策 4 / ADR-0015 决策 4）。
 * 第 1 层：子命令 `--help` 必填 Flag 签名（BLOCK 缺失或 UNKNOWN 即阻断相关 L0 命令）
 * 第 2 层：JSON 载荷 `schema_version` 白名单（Fail-Closed + 升级差异诊断卡）
 * 第 3 层：版本号软提示（签名与载荷兼容时仅 WARN，不阻断）
 * BLOCK/WARN 成员与探测信号只写在这里，doctor 与各 L0 命令共用同一矩阵。
 */
const { spawnSync } = require('node:child_process');

const ANCHOR = { version: '2.3.0', ref: 'loopx-project/loopx@f4c5d6d7' };
const P = (args, flags) => ({ args, flags });
const C = (id, severity, commands, signal, probes, impact, cli) => ({ id, severity, commands, signal, probes, impact, cli });

const CAPABILITIES = [
  C('goal.bootstrap', 'BLOCK', ['feature'], 'loopx bootstrap --help', [P(['bootstrap', '--help'], ['--goal-id', '--state-file'])], 'feature 创建/绑定 Goal'),
  C('todo.lease', 'BLOCK', ['todo'], 'loopx todo claim|complete --help', [
    P(['todo', 'claim', '--help'], ['--goal-id', '--todo-id', '--agent-id', '--claimed-by']),
    P(['todo', 'complete', '--help'], ['--claim-operation-id'])
  ], 'todo claim / todo done 受管执行'),
  C('todo.user_gate', 'BLOCK', ['todo'], 'loopx todo add --help', [P(['todo', 'add', '--help'], [
    '--required-write-scope', '--task-domain', '--task-repository', '--validation-command', '--operation-id',
    '--claim-operation-id', '--task-class', '--decision-scope', '--decision-outcome', '--global-gate'
  ])], 'User Gate Todo 注入与受管完成'),
  C('change-quality.strict-receipt', 'BLOCK', ['check'], 'loopx change-quality record --help',
    [P(['change-quality', 'record', '--help'], ['--goal-id', '--result-json', '--execute', '--base-ref'])], 'check 严格质量收据写入'),
  C('pr-review.merge-readiness', 'BLOCK', ['review', 'merge'], 'loopx pr-review --help', [P(['pr-review', '--help'], ['--check-merge-readiness'])], 'review / merge 合并就绪核验'),
  C('pr-review.check-result', 'BLOCK', ['review'], 'loopx pr-review --help', [P(['pr-review', '--help'], ['--check-result'])], 'review 审查结论核验'),
  C('goal.lifecycle', 'BLOCK', ['merge'], 'loopx goal-lifecycle --help', [P(['goal-lifecycle', '--help'], ['stop', 'sync-global'])], 'merge 后 Goal 收尾与全局同步'),
  C('issue-fix.feasibility', 'BLOCK', ['issue'], 'loopx issue-fix --help', [P(['issue-fix', '--help'], ['feasibility'])], 'issue 缺陷可行性裁决（缺失即 issue 非 0）'),
  C('integration-branch', 'BLOCK', ['integrate'], 'loopx integration-branch --help', [P(['integration-branch', '--help'], ['configure', 'status', 'sync'])], 'integrate 集成分支预演（缺失即 integrate 非 0）'),
  C('goal.acceptance', 'WARN', [], 'loopx goal-acceptance --help', [P(['goal-acceptance', '--help'], ['--goal-id'])], '可选 goal-acceptance 校验（默认降级）'),
  C('gh.cli', 'BLOCK', ['pr', 'review', 'merge', 'issue', 'release-approve'], 'command -v gh', [], 'GitHub PR / Review / Merge / Issue 事实读写', 'gh')
];

const SCHEMA_WHITELIST = {
  'todo.claim': ['loopx_coordination_todo_claim_result_v0'],
  'todo.complete': ['loopx_coordination_todo_terminal_lifecycle_result_v0'],
  'todo.update': ['loopx_coordination_todo_update_result_v0'],
  'status': ['task_graph_projection_v0', 'agent_lane_next_action_projection_v0'],
  'change-quality.prepare': ['change_quality_prepare_packet_v2'],
  'change-quality.receipt': ['change_quality_receipt_v2'],
  'change-quality.verify': ['change_quality_receipt_verification_v2'],
  'pr-review.contract': ['pull_request_review_execution_contract_v2'],
  'pr-review.result': ['pull_request_review_result_v1']
};

function run(bin, args) {
  return spawnSync(bin, args, { encoding: 'utf8', timeout: 15000 });
}

function readLoopxVersion(loopxBin) {
  const r = run(loopxBin, ['--version']);
  const raw = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  if (r.status !== 0 || !match) return { ok: false, raw: raw || `<exit ${r.status}>`, version: '' };
  return { ok: true, raw: raw.split('\n')[0], version: match[1] };
}

function hasToken(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,=(])${escaped}(?=$|[\\s,)=])`, 'm').test(text);
}

// ADR-0010：issue-fix / integration-branch 只对 issue / integrate 为 BLOCK，doctor 视角仅 WARN。
function effectiveSeverity(capability, scope) {
  if (capability.severity !== 'BLOCK') return capability.severity;
  if (!scope || scope === 'doctor' || scope === 'all') {
    const optional = capability.commands.length > 0 && capability.commands.every((cmd) => cmd === 'issue' || cmd === 'integrate');
    return optional ? 'WARN' : 'BLOCK';
  }
  return capability.commands.includes(scope) ? 'BLOCK' : 'WARN';
}

function probeCapability(capability, { loopxBin, scope, loopxPresent }) {
  const severity = effectiveSeverity(capability, scope);
  const entry = { id: capability.id, severity, signal: capability.signal, status: 'PASS', detail: '', missing: [], location: `lib/capability-probe.js#CAPABILITIES[${capability.id}]` };
  const down = severity === 'BLOCK' ? 'BLOCK' : 'WARN';
  if (capability.cli) {
    if (run(capability.cli, ['--version']).status === 0) { entry.detail = `${capability.cli} CLI 可用`; return entry; }
    entry.status = down; entry.detail = `${capability.cli} CLI 缺失`; entry.missing.push(capability.cli); return entry;
  }
  if (!loopxPresent) { entry.status = severity === 'BLOCK' ? 'UNKNOWN' : 'WARN'; entry.detail = 'loopx CLI 未安装，无法探测'; return entry; }
  const unknowns = [];
  for (const probe of capability.probes) {
    const r = run(loopxBin, probe.args);
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status !== 0) { unknowns.push(`${probe.args.join(' ')} 退出码 ${r.status ?? 'null'}`); continue; }
    if (!output.trim()) { unknowns.push(`${probe.args.join(' ')} 无 help 输出`); continue; }
    for (const flag of probe.flags) if (!hasToken(output, flag)) entry.missing.push(`${probe.args.join(' ')} → ${flag}`);
  }
  if (entry.missing.length > 0) { entry.status = down; entry.detail = `缺少必需 Flag/子命令: ${entry.missing.join(', ')}`; return entry; }
  if (unknowns.length > 0) { entry.status = severity === 'BLOCK' ? 'UNKNOWN' : 'WARN'; entry.detail = `help 探测不可用: ${unknowns.join('; ')}`; return entry; }
  entry.detail = 'help 签名完整';
  return entry;
}

function scopeCapabilities(scope) {
  return !scope || scope === 'doctor' || scope === 'all' ? CAPABILITIES : CAPABILITIES.filter((cap) => cap.commands.includes(scope));
}

function probeCapabilities({ loopxBin = 'loopx', scope = 'doctor' } = {}) {
  const version = readLoopxVersion(loopxBin);
  const entries = scopeCapabilities(scope).map((cap) => probeCapability(cap, { loopxBin, scope, loopxPresent: version.ok }));
  const blocked = entries.filter((entry) => entry.severity === 'BLOCK' && (entry.status === 'BLOCK' || entry.status === 'UNKNOWN'));
  let advisory = '';
  if (version.ok && version.version !== ANCHOR.version) {
    advisory = blocked.length === 0
      ? `版本软提示: loopx ${version.version} ≠ 已验证锚点 ${ANCHOR.version}；签名与 schema_version 白名单均通过，建议执行本地金丝雀自测（不阻断）。`
      : `版本差异: loopx ${version.version} ≠ 已验证锚点 ${ANCHOR.version}。`;
  } else if (!version.ok) {
    advisory = '未检测到 loopx CLI，能力矩阵按 UNKNOWN/WARN 降级呈现。';
  }
  return { schema_version: 'loopx_flow_capability_matrix_v0', scope, loopx_version: version.version || '', loopx_version_raw: version.raw, anchor: ANCHOR, advisory, blocked, entries };
}

function formatDiagnosticCard({ trigger, expected, actual, impact, location, version }) {
  return [
    '┌─ LoopX 升级契约差异诊断卡 ─────────────────────────────────────',
    `│ 当前 loopx 版本 : ${version || 'unknown'} (锚点 ${ANCHOR.version} / ${ANCHOR.ref})`,
    `│ 触发命令        : ${trigger}`,
    `│ 期望            : ${expected}`,
    `│ 实际            : ${actual}`,
    `│ 影响范围        : ${impact}`,
    `│ 适配定位        : ${location}`,
    '│ 修复建议        : 对齐上游契约后重跑 loopx-flow doctor；禁止静默降级或 fail-open',
    '└────────────────────────────────────────────────────────────────'
  ].join('\n');
}

function formatMatrix(result) {
  const header = ['能力', '探测信号', '状态', '说明'];
  const rows = result.entries.map((entry) => [entry.id, entry.signal, entry.status, entry.detail]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
  if (result.advisory) out.push('', `[i] ${result.advisory}`);
  return out.join('\n');
}

function formatBlockedCards(result, trigger) {
  return result.blocked.map((entry) => formatDiagnosticCard({
    trigger,
    expected: entry.missing.length > 0 ? entry.missing.join('; ') : `可用的 help 探测（${entry.signal}）`,
    actual: entry.status === 'UNKNOWN' ? `UNKNOWN: ${entry.detail}` : `BLOCK: ${entry.detail}`,
    impact: (CAPABILITIES.find((cap) => cap.id === entry.id) || {}).impact || entry.id,
    location: entry.location,
    version: result.loopx_version_raw
  })).join('\n\n');
}

function assertSchemaVersion(consumer, payload) {
  const allowed = SCHEMA_WHITELIST[consumer];
  const actual = payload && typeof payload === 'object' && typeof payload.schema_version === 'string' ? payload.schema_version : 'missing';
  if (!allowed) return { ok: false, consumer, expected: `<未登记的消费方 ${consumer}>`, actual, reason: `消费方 ${consumer} 未登记 schema_version 白名单，禁止放行` };
  if (!allowed.includes(actual)) return { ok: false, consumer, expected: allowed.join(' | '), actual, reason: `${consumer} schema_version 不在白名单: ${actual}` };
  return { ok: true, consumer, expected: allowed.join(' | '), actual };
}

function schemaDiagnosticCard(consumer, verdict, version) {
  return formatDiagnosticCard({
    trigger: `消费 LoopX JSON 载荷 (${consumer})`,
    expected: verdict.expected,
    actual: verdict.actual,
    impact: `${consumer} 载荷解析与后续业务副作用`,
    location: `lib/capability-probe.js#SCHEMA_WHITELIST[${consumer}]`,
    version
  });
}

module.exports = { ANCHOR, CAPABILITIES, SCHEMA_WHITELIST, probeCapabilities, readLoopxVersion, assertSchemaVersion, schemaDiagnosticCard, formatDiagnosticCard, formatMatrix, formatBlockedCards, effectiveSeverity };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = { command: argv[0] || 'matrix', format: 'text', scope: 'doctor', loopxBin: process.env.LOOPX_BIN || 'loopx' };
  for (let i = 1; i < argv.length; i += 2) if (argv[i].startsWith('--')) opts[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
  if (opts.command === 'matrix' || opts.command === 'require') {
    const result = probeCapabilities({ loopxBin: opts.loopxBin, scope: opts.scope });
    if (opts.format !== 'quiet') process.stdout.write(`${opts.format === 'json' ? JSON.stringify(result, null, 2) : formatMatrix(result)}\n`);
    if (result.blocked.length > 0) {
      process.stderr.write(`${formatBlockedCards(result, `loopx-flow ${opts.scope}（能力前置探针）`)}\n`);
      // matrix 是诊断视图（doctor），不阻断；require 才是 L0 命令的 Fail-Closed 门。
      process.exit(opts.command === 'require' ? 1 : 0);
    }
    process.exit(0);
  }
  process.stderr.write(`未知子命令: ${opts.command}（可用: matrix | require）\n`);
  process.exit(2);
}
