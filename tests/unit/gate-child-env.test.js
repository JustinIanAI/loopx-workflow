'use strict';
/**
 * Issue #83：`loopx-flow check` 的门禁子进程必须拿到确定性环境。
 *
 * 编排器启动时会导出 LOOPX_TMP_DIR / LOOPX_REGISTRY，审查通道还会带 REVIEW_*。
 * 这些变量被门禁子进程继承后，依赖 ambient env 的单测在 check 下必红，
 * 而单独 `npm test` 全绿。gate_child_env 负责在 spawn 前剥离。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const PATHS_SH = path.join(ROOT, 'lib/paths.sh');
const FLOW = path.join(ROOT, 'bin/loopx-flow');

function runWithPaths(script, env) {
  return spawnSync('bash', ['-c', `set -euo pipefail; source ${JSON.stringify(PATHS_SH)}; ${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('gate_child_env 剥离 LOOPX_TMP_DIR / LOOPX_REGISTRY / REVIEW_*，保留其他变量', () => {
  const r = runWithPaths(
    "gate_child_env node -e 'process.stdout.write(JSON.stringify(process.env))'",
    {
      LOOPX_TMP_DIR: '/tmp/should-be-stripped',
      LOOPX_REGISTRY: '/tmp/registry-should-be-stripped',
      REVIEW_TIMEOUT_MS: '1234',
      REVIEW_MODEL: 'deepseek',
      KEEP_ME: 'kept',
    }
  );
  assert.strictEqual(r.status, 0, r.stderr);
  const env = JSON.parse(r.stdout);
  assert.strictEqual(env.LOOPX_TMP_DIR, undefined, 'LOOPX_TMP_DIR 必须被剥离');
  assert.strictEqual(env.LOOPX_REGISTRY, undefined, 'LOOPX_REGISTRY 必须被剥离');
  assert.strictEqual(env.REVIEW_TIMEOUT_MS, undefined, 'REVIEW_* 必须被剥离');
  assert.strictEqual(env.REVIEW_MODEL, undefined, 'REVIEW_* 必须被剥离');
  assert.strictEqual(env.KEEP_ME, 'kept', '无关变量不得被误删');
});

test('gate_child_env 透传子进程退出码与参数', () => {
  const r = runWithPaths("gate_child_env bash -c 'exit 7'", {});
  assert.strictEqual(r.status, 7);
  const echoed = runWithPaths("gate_child_env printf '%s' 'a b'", {});
  assert.strictEqual(echoed.stdout, 'a b');
});

test('check 与 respond 的四门禁都经过 gate_child_env', () => {
  const source = fs.readFileSync(FLOW, 'utf8');
  assert.match(source, /gate_child_env npm run "\$gate_name"/, 'check 门禁循环必须使用 gate_child_env');
  for (const gate of ['typecheck', 'lint', 'build']) {
    assert.match(source, new RegExp(`gate_child_env npm run ${gate} `), `respond 通道的 ${gate} 必须使用 gate_child_env`);
  }
  assert.match(source, /gate_child_env npm test /, 'respond 通道的 test 必须使用 gate_child_env');
  assert.doesNotMatch(source, /^\s+if ! npm (run|test) /m, '不得残留继承编排器环境的门禁调用');
});
