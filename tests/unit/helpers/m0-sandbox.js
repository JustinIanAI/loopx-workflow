'use strict';
/**
 * M0 sandbox helper：在临时目录里复制 bin/loopx-flow 并初始化 git 仓库，
 * 让 approve/gate/merge 的真实脚本在干净工作区里跑，不依赖真实项目控制面。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execSync, execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function makeSandbox(prefix = 'm0-sandbox-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs/features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs/archive'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.loopx'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.mockbin'), { recursive: true });
  fs.copyFileSync(path.join(PROJECT_ROOT, 'bin/loopx-flow'), path.join(dir, 'bin/loopx-flow'));
  fs.chmodSync(path.join(dir, 'bin/loopx-flow'), 0o755);
  fs.copyFileSync(path.join(PROJECT_ROOT, 'lib/paths.sh'), path.join(dir, 'lib/paths.sh'));
  fs.copyFileSync(path.join(PROJECT_ROOT, 'lib/paths.js'), path.join(dir, 'lib/paths.js'));
  fs.copyFileSync(path.join(PROJECT_ROOT, 'lib/capability-probe.js'), path.join(dir, 'lib/capability-probe.js'));
  fs.copyFileSync(path.join(PROJECT_ROOT, 'lib/gate2-rebind.js'), path.join(dir, 'lib/gate2-rebind.js'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# sandbox\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.loopx/\n');
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

// Gate1 发布前置（REQ-PR-LIFECYCLE-1）：把规格包提交并推送到临时裸远端，
// 让 approve 的「已跟踪 + HEAD == origin/<branch>」检查可以通过。
function addRemote(dir) {
  const bare = dir + '-remote.git';
  if (!fs.existsSync(bare)) execSync(`git init -q --bare "${bare}"`, { stdio: 'ignore' });
  try {
    execSync('git remote get-url origin', { cwd: dir, stdio: 'ignore' });
    execSync(`git remote set-url origin "${bare}"`, { cwd: dir, stdio: 'ignore' });
  } catch (_) {
    execSync(`git remote add origin "${bare}"`, { cwd: dir, stdio: 'ignore' });
  }
  return bare;
}

// 在沙箱里造一段真实历史（ADR-0021 重绑需要真实 commit 与 origin/<base> ref）。
// 回调拿到 dir，返回 { signedHead, head }：signedHead 是作者签 gate=2 时的 commit，
// head 是补了 base 前进后的当前 head —— 两者承载同一份改动。
function withRebindHistory(dir, opts = {}) {
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const file = opts.file || 'feature.js';
  const signedContent = opts.signedContent || 'export const a = 1;\n';
  const currentContent = opts.currentContent || signedContent;
  // 沙箱的初始分支名取决于本机 git 默认（main/master），先记下来再切走。
  const trunk = currentBranch(dir);
  const workBranch = `feature/${opts.feature || 'gate2'}`;
  if (trunk !== workBranch) git(['checkout', '-q', '-b', workBranch]);

  // 签署时的改动必须落在 PR 分支上：若先提交到 trunk，PR 相对 base 的 diff 会是空。
  fs.writeFileSync(path.join(dir, file), signedContent);
  git(['add', '--', file]);
  git(['commit', '-qm', 'feat: signed change']);
  const signedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

  const bare = addRemote(dir);
  git(['checkout', '-q', trunk]);
  fs.writeFileSync(path.join(dir, 'main-advance.txt'), 'main moved\n');
  git(['add', '--', 'main-advance.txt']);
  git(['commit', '-qm', 'chore: main advance']);
  execFileSync('git', ['push', '-q', 'origin', trunk], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'set-head', 'origin', '-a'], { cwd: dir, stdio: 'ignore' });

  git(['checkout', '-q', workBranch]);
  if (currentContent !== signedContent) {
    fs.writeFileSync(path.join(dir, file), currentContent);
    git(['add', '--', file]);
    git(['commit', '-qm', 'feat: change after signing']);
  }
  // trunk 前进后合入 base：换 head 但对 base 的改动不变（真 merge commit，非快进）。
  execFileSync('git', ['merge', '-q', '--no-edit', '-m', `merge ${trunk}`, trunk], { cwd: dir, stdio: 'ignore' });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { signedHead, head, bare, baseRefName: trunk };
}

function currentBranch(dir) {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

function headSha(dir) {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

function publishSpecPackage(dir, feature) {
  const bare = addRemote(dir);
  const branch = currentBranch(dir);
  const specPath = `specs/features/${feature}`;
  const staged = execFileSync('git', ['status', '--porcelain', '--', specPath], { cwd: dir, encoding: 'utf8' }).trim();
  if (staged) {
    execFileSync('git', ['add', '--', specPath], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', `docs(${feature}): publish spec package`], { cwd: dir, stdio: 'ignore' });
  }
  execFileSync('git', ['push', '-q', '-u', 'origin', branch], { cwd: dir, stdio: 'ignore' });
  return { bare, branch, head: headSha(dir) };
}

function prViewJson(dir, { number = 7, state = 'OPEN', isDraft = true, url = 'https://example.test/pr/7', head } = {}) {
  return JSON.stringify({ number, state, isDraft, url, headRefOid: head || headSha(dir) });
}

function mockLoopx(dir, body) {
  return mock(dir, 'loopx', 'echo "$*" >> "' + path.join(dir, 'loopx-calls.log') + '"\n' + require('./capability-stub').HELP_PRELUDE + body);
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
  try { fs.rmSync(dir + '-remote.git', { recursive: true, force: true }); } catch (_) {}
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
    projection_envelope: { schema_version: 'loopx_projection_envelope_v0' },
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

// independent Gate1 的 gh 替身：返回执行者 login + 一条有效 gate=1 评论（可关闭）+ 可读 PR
function ghGate1Mock(dir, { feature, sha, approver = 'approver1', login = 'executor', includeComment = true, pr } = {}) {
  const specCommit = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  const comments = includeComment ? [{
    body: '<!-- loopx-flow:gate1-authorization:' + feature + '@' + sha + ' -->\n' +
      'gate=1;mode=independent;contract_sha=' + sha + ';spec_commit=' + specCommit + ';approver=' + approver,
    user: { login: approver }
  }] : [];
  const commentsFile = path.join(dir, 'comments.json');
  fs.writeFileSync(commentsFile, JSON.stringify(comments));
  const prJson = prViewJson(dir, pr || {});
  return mockGh(dir, `if [[ "$1" == "api" && "$2" == "user" ]]; then echo "${login}"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "view" ]]; then echo "owner/repo"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "list" ]]; then echo "7"; exit 0; fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then printf '%s\\n' '${prJson}'; exit 0; fi
if [[ "$1" == "api" && "$2" == "repos/owner/repo/issues/7/comments" ]]; then cat "${commentsFile}"; exit 0; fi
exit 0`);
}

module.exports = {
  PROJECT_ROOT,
  addRemote,
  withRebindHistory,
  currentBranch,
  headSha,
  publishSpecPackage,
  prViewJson,
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
