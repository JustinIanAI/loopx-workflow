'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js');
const FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const {
  reviewAgentArgs, resolveReviewRuntimeSelection, declaredModelFamily,
  resolveReviewerDeclaration, isolatedGateEnv,
} = require(SCRIPT);

const runDir = { dir: '/sandbox/review-pr67' };
const out = '/sandbox/review-pr67/out.txt';
const codexBase = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', runDir.dir];
const claudeBase = ['-p', '--tools', 'Read', '--permission-mode', 'dontAsk', '--add-dir', runDir.dir];

test('default-off keeps the historical codex and claude argv', () => {
  const off = { env: {} };
  assert.deepStrictEqual(reviewAgentArgs('codex', runDir, out, off), [...codexBase, '-o', out, '-']);
  assert.deepStrictEqual(reviewAgentArgs('claude', runDir, null, off), claudeBase);
});

test('codex and claude map model and reasoning effort, CLI outranks env', () => {
  assert.deepStrictEqual(reviewAgentArgs('codex', runDir, out, {
    model: 'agy-cli/gemini-3.8-flash', reasoningEffort: 'high',
    env: { REVIEW_MODEL: 'from-env', REVIEW_REASONING_EFFORT: 'low' },
  }), [...codexBase, '-m', 'agy-cli/gemini-3.8-flash', '-c', 'model_reasoning_effort=high', '-o', out, '-']);
  assert.deepStrictEqual(reviewAgentArgs('claude', runDir, null, {
    env: { REVIEW_MODEL: 'provider:openai/gpt-4o', REVIEW_REASONING_EFFORT: 'max' },
  }), [...claudeBase, '--model', 'provider:openai/gpt-4o', '--effort', 'max']);
  assert.deepStrictEqual(resolveReviewRuntimeSelection({
    model: 'from-cli', env: { REVIEW_MODEL: 'from-env', REVIEW_REASONING_EFFORT: 'low' },
  }), { model: 'from-cli', reasoningEffort: 'low' });
});

test('empty, control-character, and illegal effort values fail closed', () => {
  for (const selection of [
    { model: '', env: {} },
    { model: 'bad\nid', env: {} },
    { model: 'has space', env: {} },
    { reasoningEffort: 'turbo', env: {} },
  ]) {
    assert.throws(() => reviewAgentArgs('codex', runDir, null, selection), /FAIL-CLOSED/);
  }
  assert.throws(() => resolveReviewRuntimeSelection({ env: { REVIEW_REASONING_EFFORT: '' } }), /FAIL-CLOSED/);
  assert.throws(() => resolveReviewRuntimeSelection({ env: { REVIEW_MODEL: 'ok\r' } }), /FAIL-CLOSED/);
});

test('declared_model strips router, gateway, and endpoint prefixes and stays self_reported', () => {
  const samples = {
    'agy-cli/gemini-3.8-flash': 'gemini-3.8-flash',
    'auto/gpt-5.4': 'gpt-5.4',
    'magpie/claude-sonnet': 'claude-sonnet',
    'provider:openai/gpt-4o': 'gpt-4o',
    'https://gateway.example/v1/models/gemini-2.5-pro': 'gemini-2.5-pro',
    'gpt-5.4@2026-01-01': 'gpt-5.4',
    'gemini-3.8-flash-high': 'gemini-3.8-flash-high',
  };
  for (const [raw, family] of Object.entries(samples)) {
    assert.strictEqual(declaredModelFamily(raw), family);
  }
  const selfReported = resolveReviewerDeclaration(
    { reviewer_execution: { status: 'unavailable' } },
    { reviewer: { declared_model: 'agy-cli/gemini-3.8-flash', declared_provider: 'google', declaration_source: 'runtime_reported' } },
    'codex', null, 'agy-cli/gemini-3.8-flash',
  );
  assert.strictEqual(selfReported.declaration_source, 'self_reported');
  assert.strictEqual(selfReported.declared_model, 'gemini-3.8-flash');
  assert.doesNotMatch(selfReported.declared_model, /[\/:@]/);
  const runtime = resolveReviewerDeclaration(
    { reviewer_execution: { status: 'runtime_reported', model: 'magpie/gpt-5', provider: 'openai', reasoning_effort: 'high', observation_id: 'obs-1' } },
    null, 'codex', null, null,
  );
  assert.strictEqual(runtime.declaration_source, 'runtime_reported');
  assert.strictEqual(runtime.declared_model, 'gpt-5');
  assert.strictEqual(runtime.declared_reasoning_effort, 'high');
});

function hostLoopxPython() {
  const bin = process.env.LOOPX_BIN || 'loopx';
  const ver = spawnSync(bin, ['--version'], { encoding: 'utf8', env: { ...process.env, LOOPX_USAGE_PING: '0' } });
  if (ver.status !== 0 || !/^loopx\s+2\.3\.\d+/.test(`${ver.stdout}${ver.stderr}`)) return '';
  const script = (bin.includes('/') ? [bin] : (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, bin))).find(file => {
    try { return fs.statSync(file).isFile(); } catch (_) { return false; }
  });
  if (!script) return '';
  let py = '';
  try {
    const parts = fs.readFileSync(script, 'utf8').split('\n', 1)[0].replace(/^#!/, '').trim().split(/\s+/);
    py = path.basename(parts[0] || '') === 'env' ? parts.find((arg, i) => i > 0 && !arg.startsWith('-')) : parts[0];
    if (py && !path.isAbsolute(py)) py = path.join(path.dirname(script), py);
  } catch (_) { return ''; }
  return py && spawnSync(py, ['-c', 'from loopx.capabilities.pr_review_queue.result_check import _reviewer_errors'], { encoding: 'utf8' }).status === 0 ? py : '';
}

test('sanitized family passes loopx 2.3.0 reviewer declaration; the raw router id does not', (t) => {
  const py = hostLoopxPython();
  if (!py) return t.skip('host loopx 2.3.x Python interpreter not available (set LOOPX_BIN or PATH)');
  const family = declaredModelFamily('agy-cli/gemini-3.8-flash');
  const probe = spawnSync(py, ['-c', `
from loopx.capabilities.pr_review_queue.result_check import _reviewer_errors
family, raw = ${JSON.stringify(family)}, "agy-cli/gemini-3.8-flash"
def packet(model):
    return {"actor_kind":"model_agent","declaration_source":"self_reported","declared_model":model,"declared_provider":"google"}
ok = _reviewer_errors(packet(family), f"Reviewer: model_agent model {family} provider google declaration self_reported head abc\\n")
bad = _reviewer_errors(packet(raw), "Reviewer: model_agent model agy-cli/gemini-3.8-flash provider google declaration self_reported head abc\\n")
print("OK" if ok == [] else "UNEXPECTED " + ",".join(ok))
print("BAD" if any("not_a_product_family_name" in item for item in bad) else "MISSING " + ",".join(bad))
`], { encoding: 'utf8' });
  assert.strictEqual(probe.status, 0, probe.stderr || probe.stdout);
  assert.match(probe.stdout, /^OK\nBAD\n/);
});

test('isolatedGateEnv removes REVIEW_MODEL and REVIEW_REASONING_EFFORT', () => {
  const clean = isolatedGateEnv({
    PATH: '/usr/bin', REVIEW_MODEL: 'agy-cli/gemini-3.8-flash',
    REVIEW_REASONING_EFFORT: 'high', REVIEW_SHORTCIRCUIT: '1', KEEP: 'yes',
  });
  assert.strictEqual(clean.REVIEW_MODEL, undefined);
  assert.strictEqual(clean.REVIEW_REASONING_EFFORT, undefined);
  assert.strictEqual(clean.REVIEW_SHORTCIRCUIT, undefined);
  assert.strictEqual(clean.PATH, '/usr/bin');
  assert.strictEqual(clean.KEEP, 'yes');
});

test('authentic-review --help and illegal CLI values fail closed before any review', () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0, help.stderr);
  for (const needle of ['--model', '--reasoning-effort', 'REVIEW_MODEL']) assert.match(help.stdout, new RegExp(needle));
  const bad = spawnSync(process.execPath, [SCRIPT, '--pr', '1', '--repo', 'o/r', '--reasoning-effort', 'turbo'], { encoding: 'utf8' });
  const empty = spawnSync(process.execPath, [SCRIPT, '--model'], { encoding: 'utf8' });
  const eqBad = ['--reasoning-effort=turbo', '--model=', '--agent-bin='].map((flag) => spawnSync(process.execPath, [SCRIPT, flag], { encoding: 'utf8' }));
  const cliBeatsEnv = spawnSync(process.execPath, [SCRIPT, '--reasoning-effort', 'nope'], {
    encoding: 'utf8', env: { ...process.env, REVIEW_REASONING_EFFORT: 'low' },
  });
  for (const result of [bad, empty, ...eqBad]) {
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /FAIL-CLOSED/);
  }
  assert.notStrictEqual(cliBeatsEnv.status, 0);
  assert.match(cliBeatsEnv.stderr, /非法值/);
});

test('loopx-flow review help, fail-closed, and flag forwarding', () => {
  const help = spawnSync('bash', [FLOW, 'review', '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0, help.stderr);
  for (const needle of ['--model <id>', '--reasoning-effort <level>', 'model_reasoning_effort', 'default-off']) {
    assert.match(help.stdout, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const cases = [
    [['review', '12', '--reasoning-effort', 'turbo'], /FAIL-CLOSED/],
    [['review', '12', '--model', ''], /FAIL-CLOSED/],
    [['review', '12', '--model', 'bad\nid'], /控制字符/],
    [['review', '12', '--reasoning-effort=turbo'], /FAIL-CLOSED/],
    [['review', '12', '--model='], /FAIL-CLOSED/],
    [['review', '12', '--agent-bin='], /FAIL-CLOSED/],
  ];
  for (const [argv, pattern] of cases) {
    const result = spawnSync('bash', [FLOW, ...argv], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, pattern);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-flow-'));
  const capture = path.join(dir, 'node-args');
  fs.writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\ncase "$*" in *repo*view*) echo owner/repo ;; *pr*view*) echo false ;; esac\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'node'), `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(capture)}\nexit 0\n`, { mode: 0o755 });
  const forwarded = spawnSync('bash', [
    FLOW, 'review', '12', '--model=agy-cli/gemini-3.8-flash', '--reasoning-effort=high', '--agent-bin=claude',
  ], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LOOPX_TMP_DIR: dir, REVIEW_MODEL: 'env-model' } });
  try {
    assert.strictEqual(forwarded.status, 0, forwarded.stderr || forwarded.stdout);
    const args = fs.readFileSync(capture, 'utf8');
    assert.match(args, /authentic-review\.js/);
    assert.match(args, /--model agy-cli\/gemini-3\.8-flash/);
    assert.match(args, /--reasoning-effort high/);
    assert.match(args, /--agent-bin claude/);
    assert.doesNotMatch(args, /env-model/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('本地参数非法必须先于能力探针失败（CI 无 loopx 也返回参数诊断）', () => {
  // 复现默认 CI 环境：PATH 里没有 loopx。若 dispatch 能力门抢在参数校验之前，
  // `--model` 的控制字符诊断会被能力探针的 UNKNOWN 诊断卡掩盖（review #73 P0）。
  const noLoopxPath = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter);
  const cases = [
    [['review', '12', '--model', 'bad\nid'], /控制字符/],
    [['review', '12', '--reasoning-effort', 'turbo'], /非法值/],
    [['review', '12', '--agent-bin='], /FAIL-CLOSED/],
    // 末位缺值：必须给出「为空」诊断，而不是被 set -e 的 `shift 2` 静默吃掉。
    [['review', '12', '--model'], /--model 为空/],
    [['review', '12', '--reasoning-effort'], /--reasoning-effort 为空/],
    [['review', '12', '--agent-bin'], /--agent-bin 需要 codex 或 claude/],
    // flag 前置不得被当成 PR 编号。
    [['review', '--model', 'gpt'], /请指定 PR 编号/],
    // --agent-bin 与 --model 同口径拒绝控制字符。
    [['review', '12', '--agent-bin', 'codex\n--yolo'], /--agent-bin 含换行/],
  ];
  for (const [argv, pattern] of cases) {
    const result = spawnSync('bash', [FLOW, ...argv], {
      encoding: 'utf8',
      env: { ...process.env, PATH: noLoopxPath },
    });
    assert.notStrictEqual(result.status, 0, `${argv.join(' ')} 必须非 0`);
    assert.match(result.stderr, pattern, `${argv.join(' ')} 应先给出本地参数诊断`);
    assert.doesNotMatch(result.stderr, /升级契约差异诊断卡/, `${argv.join(' ')} 不得被能力探针抢先阻断`);
  }
});

test('#70 isolatedGateEnv normalizes C.UTF-8 locale on darwin only', () => {
  const base = { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8', LC_CTYPE: 'C.UTF-8', KEEP: 'x' };
  const mac = isolatedGateEnv(base, { platform: 'darwin' });
  assert.strictEqual(mac.LC_ALL, 'en_US.UTF-8');
  assert.strictEqual(mac.LANG, 'en_US.UTF-8');
  assert.strictEqual(mac.LC_CTYPE, 'en_US.UTF-8');
  assert.strictEqual(mac.KEEP, 'x');
  assert.strictEqual(base.LC_ALL, 'C.UTF-8');
  const linux = isolatedGateEnv(base, { platform: 'linux' });
  assert.strictEqual(linux.LC_ALL, 'C.UTF-8');
  const other = isolatedGateEnv({ LC_ALL: 'zh_CN.UTF-8' }, { platform: 'darwin' });
  assert.strictEqual(other.LC_ALL, 'zh_CN.UTF-8');
});
