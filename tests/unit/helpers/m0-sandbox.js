'use strict';
/**
 * M0 sandbox helper：在临时目录里复制 bin/loopx-flow 并初始化 git 仓库，
 * 让 approve/gate/merge 的真实脚本在干净工作区里跑，不依赖真实项目控制面。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function makeSandbox(prefix = 'm0-sandbox-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs/features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs/archive'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.loopx'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.mockbin'), { recursive: true });
  fs.copyFileSync(path.join(PROJECT_ROOT, 'bin/loopx-flow'), path.join(dir, 'bin/loopx-flow'));
  fs.chmodSync(path.join(dir, 'bin/loopx-flow'), 0o755);
  fs.writeFileSync(path.join(dir, 'README.md'), '# sandbox\n');
  fs.writeFileSync(path.join(dir, '.loopx/registry.json'), JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));
  execSync('git init -q && git config user.email sandbox@example.com && git config user.name sandbox && git add -A && git commit -qm sandbox-init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// 与 bin/loopx-flow approve 的最终落盘字节一致：批准标记行固定、不含审批人/时间
function lockedContractText(text) {
  const line = '- **Contract-Status**: FROZEN & APPROVED';
  if (/Contract-Status/i.test(text)) return text.replace(/.*Contract-Status.*$/m, line);
  return line + '\n' + text;
}

function lockedShaFile(contractPath) {
  return sha256(lockedContractText(fs.readFileSync(contractPath, 'utf8')));
}

function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function writeConfig(dir, mode, riskAcceptance) {
  const body = { schema_version: 'loopx_workflow_config_v0', authorization_mode: mode };
  if (riskAcceptance) body.single_owner_risk_acceptance = riskAcceptance;
  return write(dir, 'loopx-workflow.config.json', JSON.stringify(body, null, 2));
}

function contractText(feature) {
  return [
    '# Contract: ' + feature,
    '',
    '- **Contract-Status**: DRAFT (Pending Approval)',
    '- **AC**: AC-1 (Story-1) 行为可验证',
    '- **Scope**: 仅 ' + feature + ' 相关命令',
    '- **Verification Plan**: npm run test',
    '- **依赖顺序**: Story-1 -> Story-2',
    '- **引用**: REQ-CHECKPOINT-1',
    ''
  ].join('\n');
}

function writeCapsule(dir, feature, opts = {}) {
  const contract = write(dir, 'specs/features/' + feature + '/04-contract.md', opts.contract || contractText(feature));
  write(dir, 'specs/features/' + feature + '/01-decisions.md', opts.decisions || '# Decisions\n\n- **Status**: APPROVED\n');
  write(dir, 'specs/features/' + feature + '/03-stories.md', opts.stories || '# Stories\n\n- Story-1: 实现 ' + feature + '\n  - AC: 命令行为与契约一致\n');
  write(dir, 'specs/features/' + feature + '/00-INDEX.md', '# Index\n\n- **Current Status**: `Proposed`\n- **Contract Status**: `DRAFT`\n');
  return { contractPath: contract, contractSha: sha256(fs.readFileSync(contract, 'utf8')) };
}

function mock(dir, name, body) {
  const p = path.join(dir, '.mockbin', name);
  fs.writeFileSync(p, '#!/usr/bin/env bash\nset -u\n' + body + '\n', { mode: 0o755 });
  return p;
}

function mockLoopx(dir, body) {
  return mock(dir, 'loopx', 'echo "$*" >> "' + path.join(dir, 'loopx-calls.log') + '"\n' + body);
}

function mockGh(dir, body) {
  return mock(dir, 'gh', body);
}

function run(dir, args, envExtra = {}) {
  return spawnSync(path.join(dir, 'bin/loopx-flow'), args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      PATH: path.join(dir, '.mockbin') + ':' + (process.env.PATH || ''),
      HOME: path.join(dir, '.home'),
      LOOPX_REGISTRY: path.join(dir, '.loopx/registry.json'),
      ...envExtra
    }
  });
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// 让 gate verify 通过用的 registry/loopx 侧替身
function registryWithGoal(dir, goalId, contractSha) {
  write(dir, '.loopx/registry.json', JSON.stringify({
    schema_version: '0.1',
    goals: [{ id: goalId, control_plane: { progress_review: { contract_revision: contractSha } } }]
  }, null, 2));
}

function userGateTodos(sha, evidence, outcome = 'approve') {
  return JSON.stringify({
    todos: [{
      task_class: 'user_gate',
      decision_outcome: outcome,
      decision_scope: { scope_key: sha },
      superseded_by: null,
      evidence
    }]
  });
}

function gate1Evidence({ mode = 'single_owner', sha, spec = 'b'.repeat(40), feature = 'feat', principal = 'owner', risk }) {
  let text = 'authorization_mode=' + mode + ';contract_sha=' + sha + ';spec_commit=' + spec + ';feature=' + feature + ';principal=' + principal;
  if (risk) text += ';risk_acceptance=' + risk;
  return text;
}

// independent Gate1 的 gh 替身：返回执行者 login + 一条有效 gate=1 评论（可关闭）
function ghGate1Mock(dir, { feature, sha, approver = 'approver1', login = 'executor', includeComment = true } = {}) {
  const comments = includeComment ? [{
    body: '<!-- loopx-flow:gate1-authorization:' + feature + '@' + sha + ' -->\n' +
      'gate=1;mode=independent;contract_sha=' + sha + ';spec_commit=' + 'b'.repeat(40) + ';approver=' + approver,
    user: { login: approver }
  }] : [];
  const commentsFile = path.join(dir, 'comments.json');
  fs.writeFileSync(commentsFile, JSON.stringify(comments));
  return mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "${login}"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "list" ]]; then echo "7"; exit 0; fi
if [[ "$1" == "api" && "$2" == "repos/owner/repo/issues/7/comments" ]]; then cat "${commentsFile}"; exit 0; fi
exit 0`);
}

module.exports = {
  PROJECT_ROOT,
  ghGate1Mock,
  makeSandbox,
  sha256,
  lockedContractText,
  lockedShaFile,
  write,
  writeConfig,
  contractText,
  writeCapsule,
  mock,
  mockLoopx,
  mockGh,
  run,
  cleanup,
  registryWithGoal,
  userGateTodos,
  gate1Evidence
};
