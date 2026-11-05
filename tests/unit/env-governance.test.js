'use strict';
/**
 * Feature: env-governance — 环境治理回归测试
 *
 * 覆盖 ADR-0007 / REQ-ENV-1..3：
 *   - isRuntimeArtifact()：运行时工件判定（锁文件 / .codex / .loopx / node_modules）
 *   - committedScopeFiles()：收据证据只取已提交 exact scope（不包含工作区改动）
 *   - .gitignore 覆盖运行时工件；git ls-files 中无运行时工件被跟踪
 *   - bin/loopx-flow doctor 的控制面检查与 50% API 预算基线文案
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INGEST = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const { isRuntimeArtifact, committedScopeFiles } = require(INGEST);

function git(args) {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
}

describe('isRuntimeArtifact：运行时工件判定', () => {
  test('锁文件、.codex、.loopx、node_modules、.DS_Store 判为运行时工件', () => {
    for (const p of [
      '.loopx/registry.json.lock',
      '.loopx/goals/loopx-workflow-oss/ACTIVE_GOAL_STATE.md.lock',
      '.codex/goals/hard-guard-feature/ACTIVE_GOAL_STATE.md',
      'node_modules/typescript/index.js',
      'docs/.DS_Store',
      'some/dir/file.lock',
    ]) {
      assert.strictEqual(isRuntimeArtifact(p), true, `${p} 应判为运行时工件`);
    }
  });

  test('普通源码/文档/配置路径判为非运行时工件', () => {
    for (const p of [
      'bin/loopx-flow',
      'skills/code-review/scripts/ingest-to-loopx-quality.js',
      'tests/unit/env-governance.test.js',
      'specs/features/env-governance/05-evidence.md',
      'docs/adr/0007-environment-governance.md',
      'package.json',
    ]) {
      assert.strictEqual(isRuntimeArtifact(p), false, `${p} 不应判为运行时工件`);
    }
  });

  test('空路径与反斜杠路径按运行时工件处理/归一化', () => {
    assert.strictEqual(isRuntimeArtifact(''), true);
    assert.strictEqual(isRuntimeArtifact('.codex\\goals\\x.md'), true);
    assert.strictEqual(isRuntimeArtifact('src\\app.js'), false);
  });
});

describe('committedScopeFiles：证据 refs 只取已提交 exact scope', () => {
  test('返回的文件全部来自已提交 diff，且不含运行时工件', () => {
    const base = git(['rev-parse', 'origin/main']).trim();
    const files = committedScopeFiles(base);
    assert.ok(Array.isArray(files), '应返回数组');
    for (const f of files) {
      assert.strictEqual(isRuntimeArtifact(f), false, `已提交 scope 中不应含运行时工件: ${f}`);
    }
    const committed = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
    for (const f of files) {
      assert.ok(committed.includes(f), `${f} 必须来自 ...HEAD 已提交范围`);
    }
  });

  test('不包含工作区未提交改动（INV-ENV-2）', () => {
    const base = git(['rev-parse', 'origin/main']).trim();
    const dirty = git(['diff', '--name-only', base]).split('\n').filter(Boolean);
    const committed = new Set(git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean));
    const workingTreeOnly = dirty.filter((f) => !committed.has(f));
    const files = committedScopeFiles(base);
    for (const f of workingTreeOnly) {
      assert.ok(!files.includes(f), `工作区专属文件不得进入证据 refs: ${f}`);
    }
  });

  test('无 baseCommit 或非法 baseCommit 时安全返回空数组，不抛异常', () => {
    assert.deepStrictEqual(committedScopeFiles(''), []);
    assert.deepStrictEqual(committedScopeFiles('0000000000000000000000000000000000000000'), []);
  });
});

describe('运行时工件隔离（INV-ENV-3）', () => {
  test('.gitignore 覆盖 .loopx/**/*.lock 与 .loopx/goals/', () => {
    const ignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8');
    assert.match(ignore, /^\.loopx\/\*\*\/\*\.lock$/m, '应忽略 .loopx 下所有锁文件');
    assert.match(ignore, /^\.loopx\/goals\/$/m, '应忽略 .loopx/goals 私有状态');
    assert.match(ignore, /^\.codex\/$/m, '应忽略 .codex 私有状态');
  });

  test('git ls-files 中不含 .codex/ 或 .loopx 锁文件', () => {
    const tracked = git(['ls-files']).split('\n').filter(Boolean);
    const leaked = tracked.filter(
      (f) => f.startsWith('.codex/') || /^\.loopx\/.*\.lock$/.test(f) || /^\.loopx\/goals\//.test(f),
    );
    assert.deepStrictEqual(leaked, [], `运行时工件不得被跟踪: ${leaked.join(', ')}`);
  });
});

describe('doctor 控制面与 API 预算检查契约（REQ-ENV-1/2）', () => {
  const script = fs.readFileSync(LOOPX_FLOW, 'utf8');

  test('doctor 调用 cmd_doctor_control_plane 且包含四类控制面检查', () => {
    assert.match(script, /cmd_doctor_control_plane\(\)/, '应定义 cmd_doctor_control_plane');
    assert.match(script, /cmd_doctor_control_plane; then/, 'doctor 主流程应调用该函数');
    assert.match(script, /runtime root 不一致/, '应检查 route 一致性');
    assert.match(script, /半迁移残留/, '应检查 ~/.loopx 半迁移残留');
    assert.match(script, /缺 state_file/, '应检查 registry goal 完整性');
    assert.match(script, /运行时工件仍被 Git 跟踪/, '应检查运行时工件跟踪面');
  });

  test('API 预算检查以官方上限 50% 为基线（INV-ENV-5）', () => {
    assert.match(script, /core_limit \/ 2|baseline=\$\(\( core_limit \/ 2 \)\)/, 'core 基线应为 limit/2');
    assert.match(script, /50% 安全基线/, '应打印 50% 基线');
    assert.match(script, /900 points\/min|80 content\/min|500 content\/h/, '应说明 secondary/content 官方上限');
    assert.match(script, /40 content\/min|250 content\/h/, '应说明 50% content 基线');
  });

  test('缺失 gh / loopx 时降级为 WARN 而非崩溃（INV-ENV-4）', () => {
    assert.match(script, /未检测到 gh CLI，跳过 API 预算检查/);
    assert.match(script, /无法评估 API 预算/);
  });
});
