'use strict';
/**
 * 能力门在 dispatch 边界生效的端到端负向用例（review #73 P0 / P1）。
 *
 * 覆盖：
 *   - 六个 L0 命令在能力探针 UNKNOWN 时于第一个不可逆动作之前非 0 退出；
 *   - `merge` 当 `goal-lifecycle --operation` 缺少 `stop` 取值时阻断，且未调用 `gh pr merge`；
 *   - `check` 当 `change-quality prepare` 返回未知 schema_version 时阻断，且未空跑四大门禁。
 * 能力门只在 `bin/loopx-flow` 的 dispatch 边界执行一次，这里验证的是真实脚本行为。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const h = require('./helpers/m0-sandbox');
const { HELP_SIGNATURE, HELP_PRELUDE } = require('./helpers/capability-stub');

function writeLoopxMock(dir, { help = HELP_SIGNATURE, body = 'exit 0', version = '2.3.0' } = {}) {
  const script = `#!/usr/bin/env bash
args="$*"
if [[ "$args" == "--version" ]]; then echo "loopx ${version}"; exit 0; fi
if [[ "$args" == *"--help" ]]; then
cat <<'LOOPX_HELP'
${help}
LOOPX_HELP
exit 0
fi
${body}
`;
  fs.writeFileSync(path.join(dir, '.mockbin', 'loopx'), script, { mode: 0o755 });
}

// 覆盖全部 BLOCK 能力的帮助签名，仅移除 goal-lifecycle 的 choices 取值。
const HELP_WITHOUT_STOP = HELP_SIGNATURE.replace(
  'goal-lifecycle --goal-id GOAL_ID --operation {stop,resume} --reason REASON --execute',
  'goal-lifecycle --goal-id GOAL_ID --operation OPERATION --reason REASON --execute'
);

function makeGitSandbox(prefix) {
  const dir = h.makeSandbox(prefix);
  fs.writeFileSync(path.join(dir, '.mockbin', 'gh'), '#!/usr/bin/env bash\necho "gh $*" >> "' + path.join(dir, 'gh-calls.log') + '"\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'gh-calls.log'), '');
  return dir;
}

test('P0: merge 在 goal-lifecycle 缺少 stop 取值时于 gh pr merge 之前阻断', () => {
  const dir = makeGitSandbox('cap-gate-merge-');
  try {
    h.writeCapsule(dir, 'gate-merge');
    h.writeConfig(dir, 'independent');
    writeLoopxMock(dir, { help: HELP_WITHOUT_STOP });
    const r = h.run(dir, ['merge', '1', 'gate-merge']);
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /LoopX 升级契约差异诊断卡/);
    assert.match(r.stderr, /--operation 缺少取值 stop/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'gh-calls.log'), 'utf8'), /gh pr merge/, '合并前不得执行 gh pr merge');
  } finally { h.cleanup(dir); }
});

test('P0: 探针不可用（无 --version / 无 help）时 feature/check/review/merge 全部前置阻断', () => {
  for (const [command, args] of [
    ['feature', ['feature', 'gate-feature']],
    ['check', ['check', '--goal-id', 'gate-check-goal']],
    ['review', ['review', '1']],
    ['merge', ['merge', '1', 'gate-merge']],
  ]) {
    const dir = makeGitSandbox(`cap-gate-${command}-`);
    try {
      h.writeCapsule(dir, 'gate-merge');
      h.writeConfig(dir, 'independent');
      writeLoopxMock(dir, { body: 'exit 0' });
      // 让 --version 与 --help 都失败：探针只能得 UNKNOWN。
      fs.writeFileSync(path.join(dir, '.mockbin', 'loopx'), '#!/usr/bin/env bash\nexit 2\n', { mode: 0o755 });
      const r = h.run(dir, args);
      assert.notStrictEqual(r.status, 0, `${command} 必须非 0: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /LoopX 升级契约差异诊断卡/, `${command} 必须输出诊断卡`);
      assert.match(r.stderr, /scope=/, `${command} 必须指明 scope`);
      assert.doesNotMatch(fs.readFileSync(path.join(dir, 'gh-calls.log'), 'utf8'), /gh pr merge|gh pr view|gh pr create/, `${command} 阻断前不得执行 PR 读写成`);
    } finally { h.cleanup(dir); }
  }
});

test('P1: check 遇到未知 change-quality prepare schema_version 时阻断且不跑四大门禁', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-gate-check-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-gate-check-bin-'));
  const marker = path.join(bin, 'npm-was-run');
  try {
    execSync('git init -q && git config user.email t@example.com && git config user.name t', { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
    execSync('git add README.md && git commit -qm init', { cwd: repo });
    execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: repo });
    fs.mkdirSync(path.join(repo, '.loopx'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.loopx/registry.json'), JSON.stringify({ schema_version: '0.1', goals: [] }));
    fs.writeFileSync(path.join(bin, 'loopx'), `#!/usr/bin/env bash
args="$*"
if [[ "$args" == "--version" ]]; then echo "loopx 2.3.0"; exit 0; fi
if [[ "$args" == *"--help" ]]; then
cat <<'LOOPX_HELP'
${HELP_SIGNATURE}
LOOPX_HELP
exit 0
fi
if [[ "$args" == *"change-quality prepare"* ]]; then
  printf '%s' '{"ok":true,"schema_version":"change_quality_prepare_packet_v9","policy":{"enabled":true},"status":"review_required"}'
  exit 0
fi
printf '%s' '{"ok":true}'
exit 0
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
    const r = spawnSync(path.join(h.PROJECT_ROOT, 'bin/loopx-flow'), ['check', '--goal-id', 'gate-check-goal'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 60000,
    });
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /LoopX 升级契约差异诊断卡/);
    assert.match(r.stderr, /change_quality_prepare_packet_v9/);
    assert.strictEqual(fs.existsSync(marker), false, 'schema 不符时不得空跑四大门禁');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('P0: --help/-h 不触发能力门（只打印用法，无副作用）', () => {
  const dir = makeGitSandbox('cap-gate-help-');
  try {
    // 探针完全不可用，但 --help 必须在能力门之前就返回用法。
    fs.writeFileSync(path.join(dir, '.mockbin', 'loopx'), '#!/usr/bin/env bash\nexit 2\n', { mode: 0o755 });
    for (const command of ['feature', 'check', 'pr', 'review', 'merge', 'release-approve']) {
      const r = h.run(dir, [command, '--help']);
      assert.doesNotMatch(r.stderr, /能力探针未通过/, `${command} --help 不得触发能力门`);
      assert.doesNotMatch(r.stdout + r.stderr, /升级契约差异诊断卡/, `${command} --help 不得输出能力诊断卡`);
    }
  } finally { h.cleanup(dir); }
});

// Stage B findings P0-1 回归用例：成功路径 stdout 不含能力矩阵（`--format quiet` 只验不污染）。
test('P0: 成功门 stdout 不含矩阵（require_success_is_quiet）', () => {
  const dir = makeGitSandbox('cap-gate-success-');
  try {
    h.writeCapsule(dir, 'gate-success');
    h.writeConfig(dir, 'independent');
    writeLoopxMock(dir, { body: 'exit 0' });
    // 直接调用 shell 函数 require_loopx_capabilities，验证成功时 stdout 为空且退出 0。
    const r = h.run(dir, []);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    // 实现层回归：直接校验 lib 的 require 路径生成结果——成功时走 quiet 不输出矩阵。
    const { spawnSync } = require('node:child_process');
    const probe = spawnSync('node', [path.join(dir, 'lib/capability-probe.js'), 'require', '--scope', 'todo', '--format', 'quiet'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: path.join(dir, '.mockbin') + ':' + process.env.PATH },
    });
    assert.strictEqual(probe.status, 0, probe.stdout + probe.stderr);
    assert.doesNotMatch(probe.stdout, /能力\s+探测信号/);
    assert.doesNotMatch(probe.stdout, /升级契约差异诊断卡/);
    assert.doesNotMatch(String(probe.stdout || ''), /LoopX .*schema_version/);
  } finally { h.cleanup(dir); }
});
