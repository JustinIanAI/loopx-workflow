'use strict';
/**
 * W1（TRE-87 / #39）基线止血回归：
 *   - scripts/gate-lint.sh 在 git ls-files 失败时 Fail-Closed（不再静默 exit 0）；
 *   - LINT-01..05 五类门禁的负向突变必红；
 *   - bin/loopx-flow readiness_json_field 容忍非 JSON 前置噪声；
 *   - cmd_pr create 透传 --base 与 passthru 参数；
 *   - register-agent 不再无条件吞错（仅容忍幂等冲突）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const GATE_LINT = path.join(PROJECT_ROOT, 'scripts/gate-lint.sh');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');

function makeSandbox({ git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-lint-sbx-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const gate = path.join(root, 'scripts/gate-lint.sh');
  fs.copyFileSync(GATE_LINT, gate);
  fs.chmodSync(gate, 0o755);
  if (git) execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function runGate(root) {
  return spawnSync(path.join(root, 'scripts/gate-lint.sh'), [], { cwd: root, encoding: 'utf8' });
}

function withSandbox(opts, fn) {
  const root = makeSandbox(opts);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeProbe(root, rel, body, mode = 0o644) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, { mode });
}

describe('gate-lint Fail-Closed 与负向突变守卫', () => {
  test('门禁自身在 bash 3.2 下语法合法（heredoc 内不得含裸反引号）', () => {
    const res = spawnSync('bash', ['-n', GATE_LINT], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
  });

  test('干净 Git 沙箱为正向控制：门禁通过', () => {
    withSandbox({}, (root) => {
      const res = runGate(root);
      assert.strictEqual(res.status, 0, `干净沙箱应通过:\n${res.stdout}\n${res.stderr}`);
    });
  });

  test('LINT-05 Fail-Closed：git ls-files 失败时门禁必须非 0（回归 fail-open）', () => {
    withSandbox({ git: false }, (root) => {
      const res = runGate(root);
      assert.strictEqual(res.status, 1, `非 Git 目录必须阻断:\n${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout + res.stderr, /git ls-files 失败/);
    });
  });

  test('LINT-01：Shell 语法错误必红', () => {
    withSandbox({}, (root) => {
      writeProbe(root, 'lib/broken.sh', '#!/bin/bash\nif [ a == b then\n');
      const res = runGate(root);
      assert.strictEqual(res.status, 1);
      assert.match(res.stdout, /语法错误在/);
    });
  });

  test('LINT-02：JavaScript AST 语法错误必红', () => {
    withSandbox({}, (root) => {
      writeProbe(root, 'scripts/broken.js', 'const = ;\n');
      const res = runGate(root);
      assert.strictEqual(res.status, 1);
      assert.match(res.stdout, /JS 语法错误在/);
    });
  });

  test('LINT-03：入口脚本缺失执行位必红', () => {
    withSandbox({}, (root) => {
      writeProbe(root, 'bin/loopx-flow', '#!/bin/bash\nexit 0\n', 0o644);
      const res = runGate(root);
      assert.strictEqual(res.status, 1);
      assert.match(res.stdout, /缺失可执行权限/);
    });
  });

  for (const [label, rel, body, expected] of [
    ['os.tmpdir()', 'lib/probe.js', 'const p = os.tmpdir();\n', '禁止直接调用 os.tmpdir'],
    ['裸 mktemp', 'lib/probe.sh', '#!/bin/bash\nmktemp\n', '禁止裸 mktemp'],
    ['外部 which', 'lib/probe.sh', '#!/bin/bash\nwhich git\n', '禁止外部 which'],
    ['隐式 python3', 'lib/probe.sh', '#!/bin/bash\npython3 x.py\n', '禁止隐式 python3'],
    ['宿主机绝对路径', 'lib/probe.js', 'const p = "/Users/someone/file";\n', '禁止宿主机绝对路径字面量'],
  ]) {
    test(`LINT-04 静态守卫：${label} 必红`, () => {
      withSandbox({}, (root) => {
        writeProbe(root, rel, body);
        const res = runGate(root);
        assert.strictEqual(res.status, 1, `${label} 应被拦截:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout, new RegExp(expected));
      });
    });
  }

  test('LINT-05：受跟踪运行态目录文件必红', () => {
    withSandbox({}, (root) => {
      writeProbe(root, '.loopx/leak.json', '{}\n');
      execFileSync('git', ['add', '-f', '.loopx/leak.json'], { cwd: root });
      const res = runGate(root);
      assert.strictEqual(res.status, 1);
      assert.match(res.stdout, /禁止跟踪运行时\/私有目录文件/);
    });
  });
});

describe('loopx-flow 现码止血', () => {
  function extractFunction(name) {
    const script = fs.readFileSync(LOOPX_FLOW, 'utf8');
    const start = script.indexOf(`${name}() {`);
    assert.ok(start >= 0, `应存在函数 ${name}`);
    const marker = `\n' "$raw"\n}`;
    const end = script.indexOf(marker, start);
    assert.ok(end > start, `函数 ${name} 应完整`);
    return script.slice(start, end + marker.length);
  }

  test('readiness_json_field 容忍非 JSON 前置噪声（含伪大括号）', () => {
    const runner = path.join(os.tmpdir(), `readiness-probe-${process.pid}.sh`);
    fs.writeFileSync(runner, `${extractFunction('readiness_json_field')}\nreadiness_json_field "$1"\n`);
    try {
      const noisy = '[WARN] 前置 {not-json} 噪声 {"ready":true,"blocking_reasons":[]}';
      const ok = spawnSync('bash', [runner, noisy], { encoding: 'utf8' });
      assert.strictEqual(ok.status, 0, ok.stderr);
      assert.strictEqual(JSON.parse(ok.stdout).ready, true);

      const bad = spawnSync('bash', [runner, 'no json at all'], { encoding: 'utf8' });
      assert.strictEqual(bad.status, 1, '无 JSON 时必须解析失败');
      assert.match(bad.stderr, /readiness JSON 解析失败/);
    } finally {
      fs.rmSync(runner, { force: true });
    }
  });

  test('Mode A/B 非 0 readiness JSON 捕获未被盲删（禁删 || true 红线）', () => {
    const script = fs.readFileSync(LOOPX_FLOW, 'utf8');
    const hits = script.match(/--check-merge-readiness "\$pr_id@\$head_oid" --format json 2>&1 \|\| true/g) || [];
    assert.strictEqual(hits.length, 2, 'Mode A/B 两处 readiness 捕获必须保留 || true');
  });

  test('cmd_pr create 透传 --base 与 passthru 参数', () => {
    const script = fs.readFileSync(LOOPX_FLOW, 'utf8');
    const start = script.indexOf('cmd_pr() {');
    const end = script.indexOf('\ncmd_', start + 5);
    const body = script.slice(start, end);
    assert.match(body, /gh pr create --title "\$title" --base "\$base"/, '必须显式传递 --base');
    assert.match(body, /"\$\{passthru_args\[@\]\}"/, '必须透传剩余参数');
    assert.strictEqual(body.includes('--body-file - "${draft_args[@]}" "$@"'), false, '不得丢弃解析后的剩余参数');
  });

  test('register-agent 不再无条件吞错，仅容忍幂等冲突', () => {
    const script = fs.readFileSync(LOOPX_FLOW, 'utf8');
    assert.strictEqual(/register-agent[^\n]*--execute[^\n]*\|\| true/.test(script), false, 'register-agent 不得无条件 || true');
    assert.match(script, /register-agent 失败（非幂等冲突/);
  });
});
