'use strict';
/**
 * Feature: CI workflow — Gate2 的四门禁 CI 事实（REQ-CI-PROTECTION-1 / ADR-0012）
 *
 * 断言 .github/workflows/ci.yml：
 *   - pull_request 与 push main 触发；ubuntu-latest；Node 22（engines >=22.22.3）；
 *   - job id four-gates + job name 恰好为 "Four Gates"（分支保护的 required status check context）；
 *   - npm ci 后分别跑 typecheck / lint / build / test，且不得 continue-on-error / 无权限提升。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(PROJECT_ROOT, '.github/workflows/ci.yml');

function readWorkflow() {
  return fs.readFileSync(WORKFLOW, 'utf8');
}

test('1. CI workflow 文件存在且非空', () => {
  assert.strictEqual(fs.existsSync(WORKFLOW), true, '.github/workflows/ci.yml 必须存在');
  assert.ok(fs.statSync(WORKFLOW).size > 50, 'CI workflow 不得为空');
});

test('2. 触发条件：pull_request + push 到 main', () => {
  const yml = readWorkflow();
  assert.match(yml, /^on:\s*$/m, '必须声明 on 触发块');
  assert.match(yml, /^ {2}pull_request:\s*$/m, '必须在 pull_request 上触发');
  assert.match(yml, /^ {2}push:\s*$/m, '必须在 push 上触发');
  assert.match(yml, /^ {2}push:[\s\S]*?^ {4}branches:[\s\S]*?^\s+- main\s*$/m, 'push 必须限定 main 分支');
});

test('3. 运行环境：ubuntu-latest + Node 22', () => {
  const yml = readWorkflow();
  assert.match(yml, /runs-on:\s*ubuntu-latest/, '必须在 ubuntu-latest 上运行');
  assert.match(yml, /node-version:\s*['"]?22['"]?/, '必须使用 Node 22（engines 要求 >=22.22.3）');
  assert.match(yml, /uses:\s*actions\/checkout@/, '必须 checkout 仓库');
  assert.match(yml, /uses:\s*actions\/setup-node@/, '必须使用 setup-node');
});

test('4. 四门禁步骤：npm ci + typecheck/lint/build/test', () => {
  const yml = readWorkflow();
  assert.match(yml, /run:\s*npm ci\b/, '必须用 npm ci 安装依赖');
  for (const gate of ['typecheck', 'lint', 'build', 'test']) {
    assert.strictEqual(
      yml.includes('npm run ' + gate),
      true,
      '缺少 npm run ' + gate + ' 步骤'
    );
  }
});

test('5. 状态检查 context：job id four-gates + job name 恰好 "Four Gates"', () => {
  const yml = readWorkflow();
  assert.match(yml, /^ {2}four-gates:\s*$/m, 'job id 必须是 four-gates');
  assert.match(yml, /^ {4}name:\s*Four Gates\s*$/m, 'job name 必须恰好是 Four Gates（分支保护 required context）');
});

test('6. 不得使用 continue-on-error，权限最小化 contents: read', () => {
  const yml = readWorkflow();
  assert.strictEqual(yml.includes('continue-on-error'), false, 'CI 门禁不得 continue-on-error');
  assert.match(yml, /^permissions:\s*$/m, '必须声明 permissions');
  assert.match(yml, /^ {2}contents:\s*read\s*$/m, 'permissions 必须最小化为 contents: read');
});
