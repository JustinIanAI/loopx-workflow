'use strict';
/**
 * 集中式 LoopX 三层能力探针（ADR-0010 决策 4 / ADR-0015 决策 4）。
 * 第 1 层：真实子命令 `--help` 的必填 Flag / 子命令签名；第 2 层：`schema_version` 白名单；
 * 第 3 层：`loopx --version` 软提示。BLOCK / WARN 成员只登记在这里，doctor 与各 L0 命令共用。
 * 探测口径取自锚点 `loopx 2.3.0`（loopx-project/loopx@f4c5d6d7）的真实帮助输出。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const ANCHOR = { version: '2.3.0', ref: 'loopx-project/loopx@f4c5d6d7' };
const P = (argv, required, choices) => ({ argv, required, choices: choices || {} });
const C = (id, tier, commands, signal, probes, impact, cli) => ({ id, tier, commands, signal, probes, impact, cli });

const CAPABILITIES = [
  C('goal.bootstrap', 'BLOCK', ['feature'], 'loopx bootstrap --help', [
    P(['bootstrap', '--help'], ['--goal-id', '--state-file'])
  ], 'feature 创建与 Goal 绑定'),
  C('todo.lease', 'BLOCK', ['todo'], 'loopx todo claim|complete --help', [
    P(['todo', 'claim', '--help'], ['--goal-id', '--todo-id', '--agent-id', '--claimed-by', '--claim-operation-id']),
    P(['todo', 'complete', '--help'], ['--claim-operation-id'])
  ], 'todo claim / todo done 受管执行'),
  C('todo.user_gate', 'BLOCK', ['todo'], 'loopx todo add --help', [
    P(['todo', 'add', '--help'], [
      '--required-write-scope', '--task-domain', '--task-repository', '--validation-command', '--operation-id',
      '--claim-operation-id', '--task-class', '--decision-scope', '--decision-outcome', '--global-gate'
    ])
  ], 'User Gate Todo 注入与受管完成'),
  C('change-quality.strict-receipt', 'BLOCK', ['check'], 'loopx change-quality prepare|record|verify --help', [
    P(['change-quality', 'prepare', '--help'], ['--goal-id', '--base-ref']),
    P(['change-quality', 'record', '--help'], ['--goal-id', '--result-json', '--execute', '--base-ref']),
    P(['change-quality', 'verify', '--help'], ['--goal-id'])
  ], 'check 严格质量收据准备/写入/核验'),
  C('pr-review.merge-readiness', 'BLOCK', ['review', 'merge'], 'loopx pr-review --help', [
    P(['pr-review', '--help'], ['--check-merge-readiness'])
  ], 'review / merge 合并就绪核验'),
  C('pr-review.check-result', 'BLOCK', ['review'], 'loopx pr-review --help', [
    P(['pr-review', '--help'], ['--check-result'])
  ], 'review 审查结论核验'),
  C('goal.lifecycle', 'BLOCK', ['merge'], 'loopx goal-lifecycle|sync-global --help', [
    P(['goal-lifecycle', '--help'], ['--goal-id', '--operation'], { '--operation': ['stop', 'resume'] }),
    P(['sync-global', '--help'], ['--goal-id'])
  ], 'merge 后 Goal 收尾与全局同步'),
  C('issue-fix.feasibility', 'BLOCK', ['issue'], 'loopx issue-fix --help', [
    P(['issue-fix', '--help'], ['feasibility'])
  ], 'issue 缺陷可行性裁决（缺失即 issue 非 0）'),
  C('integration-branch', 'BLOCK', ['integrate'], 'loopx integration-branch --help', [
    P(['integration-branch', '--help'], ['configure', 'status', 'sync'])
  ], 'integrate 集成分支预演（缺失即 integrate 非 0）'),
  C('goal.acceptance', 'WARN', [], 'loopx goal-acceptance --help', [
    P(['goal-acceptance', '--help'], ['--goal-id'])
  ], '可选 goal-acceptance 校验（默认 WARN 降级）'),
  C('gh.cli', 'BLOCK', ['pr', 'review', 'merge', 'issue', 'release-approve'], 'gh --version', [], 'GitHub PR / Review / Merge / Issue 事实读写', 'gh')
];

// 第 2 层：编排层消费的 LoopX JSON 载荷白名单（ADR-0015 决策 4）。
const SCHEMA_WHITELIST = {
  'todo.claim': ['loopx_coordination_todo_claim_result_v0'],
  'todo.complete': ['loopx_coordination_todo_terminal_lifecycle_result_v0'],
  'todo.update': ['loopx_coordination_todo_update_result_v0'],
  status: ['task_graph_projection_v0', 'agent_lane_next_action_projection_v0'],
  'change-quality.prepare': ['change_quality_prepare_packet_v2'],
  'change-quality.receipt': ['change_quality_receipt_v2'],
  'change-quality.verify': ['change_quality_receipt_verification_v2'],
  'pr-review.contract': ['pull_request_review_execution_contract_v2'],
  'pr-review.result': ['pull_request_review_result_v1']
};

const run = (bin, args) => spawnSync(bin, args, { encoding: 'utf8', timeout: 15000 });

function readLoopxVersion(loopxBin) {
  const r = run(loopxBin, ['--version']);
  const raw = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  if (r.status !== 0 || !match) return { ok: false, raw: raw || `<exit ${r.status}>`, version: '' };
  return { ok: true, raw: raw.split('\n')[0].trim(), version: match[1] };
}

// 从 `--help` 文本抽取可核验签名：长选项 + `{a,b,c}` 选择集。
// 逐字符扫描而非整段正则，保证 `--operation {stop,resume}` 这类写法不会被漏判。
function extractSignature(text) {
  const flags = new Set();
  const words = new Set();
  const source = String(text || '');
  const flagPattern = /(^|[^\w-])(--[A-Za-z][A-Za-z0-9-]*)/g;
  let match;
  while ((match = flagPattern.exec(source)) !== null) flags.add(match[2]);
  const choicePattern = /\{([^{}]+)\}/g;
  while ((match = choicePattern.exec(source)) !== null) {
    for (const part of match[1].split(',')) if (part.trim()) words.add(part.trim());
  }
  return { flags, words };
}

const signatureHas = (signature, token) => (token.startsWith('--') ? signature.flags.has(token) : signature.words.has(token));

// ADR-0010 / ADR-0015：issue-fix 与 integration-branch 只对 issue / integrate 为 BLOCK；
// 在 doctor（全局视图）与其他命令视角下降级为 WARN。
function effectiveTier(capability, scope) {
  if (capability.tier !== 'BLOCK') return capability.tier;
  if (!scope || scope === 'doctor' || scope === 'all') {
    const optionalOnly = capability.commands.length > 0 && capability.commands.every((cmd) => cmd === 'issue' || cmd === 'integrate');
    return optionalOnly ? 'WARN' : 'BLOCK';
  }
  return capability.commands.includes(scope) ? 'BLOCK' : 'WARN';
}

function probeCapability(capability, { loopxBin, scope, loopxAvailable }) {
  const tier = effectiveTier(capability, scope);
  const entry = {
    id: capability.id,
    tier,
    signal: capability.signal,
    status: 'PASS',
    detail: 'help 签名完整',
    missing: [],
    unevaluable: [],
    location: `lib/capability-probe.js#CAPABILITIES[${capability.id}]`
  };
  const degraded = tier === 'BLOCK' ? 'BLOCK' : 'WARN';
  if (capability.cli) {
    if (run(capability.cli, ['--version']).status === 0) {
      entry.detail = `${capability.cli} CLI 可用`;
    } else {
      entry.status = degraded;
      entry.missing.push(capability.cli);
      entry.detail = `${capability.cli} CLI 缺失`;
    }
    return entry;
  }
  if (!loopxAvailable) {
    entry.status = tier === 'BLOCK' ? 'UNKNOWN' : 'WARN';
    entry.detail = 'loopx CLI 未安装或 --version 不可用，无法探测';
    entry.unevaluable.push(`loopx ${capability.signal}`);
    return entry;
  }
  for (const probe of capability.probes) {
    const argsLabel = `loopx ${probe.argv.join(' ')}`;
    const r = run(loopxBin, probe.argv);
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status !== 0) {
      entry.unevaluable.push(`${argsLabel} 退出码 ${r.status === null ? 'null' : r.status}`);
      continue;
    }
    if (!output.trim()) {
      entry.unevaluable.push(`${argsLabel} 无 help 输出`);
      continue;
    }
    const signature = extractSignature(output);
    for (const token of probe.required) {
      if (!signatureHas(signature, token)) entry.missing.push(`${argsLabel} → ${token}`);
    }
    for (const [flag, expected] of Object.entries(probe.choices)) {
      for (const choice of expected) {
        if (!signatureHas(signature, choice)) entry.missing.push(`${argsLabel} → ${flag} 缺少取值 ${choice}`);
      }
    }
  }
  if (entry.missing.length > 0) {
    entry.status = degraded;
    entry.detail = `缺少必需 Flag/子命令: ${entry.missing.join('; ')}`;
  } else if (entry.unevaluable.length > 0) {
    entry.status = tier === 'BLOCK' ? 'UNKNOWN' : 'WARN';
    entry.detail = `help 探测不可用: ${entry.unevaluable.join('; ')}`;
  }
  return entry;
}

function probeCapabilities({ loopxBin = 'loopx', scope = 'doctor' } = {}) {
  const version = readLoopxVersion(loopxBin);
  const inScope = !scope || scope === 'doctor' || scope === 'all'
    ? CAPABILITIES
    : CAPABILITIES.filter((capability) => capability.commands.includes(scope));
  const entries = inScope.map((capability) => probeCapability(capability, { loopxBin, scope, loopxAvailable: version.ok }));
  const blocked = entries.filter((entry) => entry.tier === 'BLOCK' && (entry.status === 'BLOCK' || entry.status === 'UNKNOWN'));
  let advisory = '';
  if (!version.ok) {
    advisory = '未检测到可用的 loopx CLI，能力矩阵按 UNKNOWN / WARN 降级呈现。';
  } else if (version.version !== ANCHOR.version) {
    advisory = blocked.length === 0
      ? `版本软提示: loopx ${version.version} ≠ 已验证锚点 ${ANCHOR.version}；Flag 签名与 schema_version 白名单均通过，建议执行本地金丝雀自测（不阻断）。`
      : `版本差异: loopx ${version.version} ≠ 已验证锚点 ${ANCHOR.version}，且存在未通过能力。`;
  }
  return {
    schema_version: 'loopx_flow_capability_matrix_v0',
    scope,
    loopx_version: version.version || '',
    loopx_version_raw: version.raw,
    anchor: ANCHOR,
    advisory,
    blocked,
    entries
  };
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
  const widths = header.map((heading, index) => Math.max(heading.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd();
  const out = [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)];
  out.push('', `[i] 第 2 层 schema_version 白名单: ${Object.keys(SCHEMA_WHITELIST).length} 个消费方已登记（未知版本一律 Fail-Closed）`);
  if (result.advisory) out.push(`[i] 第 3 层版本软提示: ${result.advisory}`);
  return out.join('\n');
}

function formatBlockedCards(result, trigger) {
  return result.blocked.map((entry) => formatDiagnosticCard({
    trigger,
    expected: entry.missing.length > 0 ? entry.missing.join('; ') : `可用的 help 探测（${entry.signal}）`,
    actual: entry.status === 'UNKNOWN' ? `UNKNOWN: ${entry.detail}` : `BLOCK: ${entry.detail}`,
    impact: (CAPABILITIES.find((capability) => capability.id === entry.id) || {}).impact || entry.id,
    location: entry.location,
    version: result.loopx_version_raw
  })).join('\n\n');
}

function assertSchemaVersion(consumer, payload) {
  const allowed = SCHEMA_WHITELIST[consumer];
  const actual = payload && typeof payload === 'object' && typeof payload.schema_version === 'string'
    ? payload.schema_version
    : 'missing';
  if (!allowed) return { ok: false, consumer, expected: `<未登记的消费方 ${consumer}>`, actual, reason: `消费方 ${consumer} 未登记 schema_version 白名单，禁止放行` };
  if (!allowed.includes(actual)) return { ok: false, consumer, expected: allowed.join(' | '), actual, reason: `${consumer} schema_version 不在白名单: ${actual}` };
  return { ok: true, consumer, expected: allowed.join(' | '), actual };
}

function schemaDiagnosticCard(consumer, verdict, version) {
  return formatDiagnosticCard({
    trigger: `消费 LoopX JSON 载荷 (${consumer})`,
    expected: verdict.expected,
    actual: verdict.reason ? `${verdict.actual}（${verdict.reason}）` : verdict.actual,
    impact: `${consumer} 载荷解析与后续业务副作用`,
    location: `lib/capability-probe.js#SCHEMA_WHITELIST[${consumer}]`,
    version
  });
}

// 从命令输出中提取第一个 JSON 对象（LoopX 可能在 JSON 前后打印提示行）。
function firstJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function parseArgs(argv) {
  const opts = { command: 'matrix', scope: 'doctor', format: 'text', consumer: '', loopxBin: process.env.LOOPX_BIN || 'loopx' };
  let index = 0;
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    opts.command = argv[0];
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--scope' && value) { opts.scope = value; index += 1; }
    else if (argv[index] === '--format' && value) { opts.format = value; index += 1; }
    else if (argv[index] === '--consumer' && value) { opts.consumer = value; index += 1; }
    else if (argv[index] === '--loopx-bin' && value) { opts.loopxBin = value; index += 1; }
    else if (argv[index] === '--json') opts.format = 'json';
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'matrix' || opts.command === 'require') {
    const result = probeCapabilities({ loopxBin: opts.loopxBin, scope: opts.scope });
    if (opts.format !== 'quiet') {
      process.stdout.write(`${opts.format === 'json' ? JSON.stringify(result, null, 2) : formatMatrix(result)}\n`);
    }
    if (result.blocked.length > 0) {
      process.stderr.write(`${formatBlockedCards(result, `loopx-flow ${opts.scope}（能力前置探针）`)}\n`);
      // matrix 是 doctor 诊断视图，降级呈现不阻断；require 才是 L0 命令的 Fail-Closed 门。
      process.exit(opts.command === 'require' ? 1 : 0);
    }
    process.exit(0);
  }
  if (opts.command === 'assert-schema') {
    if (!opts.consumer) {
      process.stderr.write('assert-schema 需要 --consumer <name>\n');
      process.exit(2);
    }
    let payload = null;
    try {
      payload = JSON.parse(firstJsonObject(fs.readFileSync(0, 'utf8')) || '');
    } catch (_) {
      payload = null;
    }
    const verdict = assertSchemaVersion(opts.consumer, payload);
    if (!verdict.ok) {
      process.stderr.write(`${schemaDiagnosticCard(opts.consumer, verdict, '')}\n`);
      process.exit(1);
    }
    process.stdout.write(`${verdict.actual}\n`);
    process.exit(0);
  }
  process.stderr.write(`未知子命令: ${opts.command}（可用: matrix | require | assert-schema）\n`);
  process.exit(2);
}

module.exports = {
  ANCHOR,
  CAPABILITIES,
  SCHEMA_WHITELIST,
  probeCapabilities,
  readLoopxVersion,
  extractSignature,
  effectiveTier,
  assertSchemaVersion,
  schemaDiagnosticCard,
  formatDiagnosticCard,
  formatMatrix,
  formatBlockedCards
};
