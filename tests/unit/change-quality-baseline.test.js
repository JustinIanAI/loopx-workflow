'use strict';
/**
 * Feature: change-quality-baseline — GitHub Issue #13 回归测试
 *
 * 覆盖：
 *   - discoverBaseRef()：按 origin/HEAD → origin/main → origin/master 解析真实远程默认基线
 *   - ingest-to-loopx-quality.js：把解析出的 --base-ref 透传给 prepare/record/verify
 *   - 资格未启用：ingest 与 loopx-flow check 前置阶段输出 fail-closed 诊断卡与启用命令
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INGEST_SCRIPT = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const DESIGN_DOC = path.join(PROJECT_ROOT, 'docs/design/loopx-workflow-design.md');
const { discoverBaseRef } = require(INGEST_SCRIPT);

// 构造一个只有指定远程追踪引用的临时 git 仓库，不伪造 origin/main。
function makeTrunkRepo(refs, headRef) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-trunk-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  for (const ref of refs) {
    execFileSync('git', ['update-ref', `refs/remotes/origin/${ref}`, 'HEAD'], { cwd: dir });
  }
  if (headRef) {
    execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${headRef}`], { cwd: dir });
  }
  fs.mkdirSync(path.join(dir, '.loopx'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.loopx/registry.json'), JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));
  return dir;
}

function withMockLoopx(repoDir, prepareJson, fn) {
  const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-mock-bin-'));
  const logFile = path.join(tmpBin, 'calls.log');
  const mock = path.join(tmpBin, 'loopx');
  const script = `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(logFile)}
if [[ "$*" == *"change-quality prepare"* ]]; then
  printf '%s' ${JSON.stringify(prepareJson)}
  exit 0
fi
printf '%s' '{"ok":true}'
exit 0
`;
  fs.writeFileSync(mock, script, { mode: 0o755 });
  const env = { ...process.env, PATH: `${tmpBin}:${process.env.PATH || ''}` };
  try {
    return fn({ env, logFile });
  } finally {
    fs.rmSync(tmpBin, { recursive: true, force: true });
  }
}

const REVIEW_REQUIRED = JSON.stringify({
  ok: true,
  status: 'review_required',
  policy: { enabled: true, safe_fix: false, strict_receipt: true },
  scope: { scope_fingerprint: 'abcdef123456', base_commit: 'HEAD', base_ref: 'origin/master' },
});
const QUALIFICATION_DISABLED = JSON.stringify({
  ok: true,
  status: 'disabled',
  policy: { enabled: false, safe_fix: false, strict_receipt: true },
  scope: { scope_fingerprint: 'abcdef123456', base_commit: 'HEAD', base_ref: 'origin/master' },
});

describe('discoverBaseRef：远程默认基线解析（GitHub Issue #13）', () => {
  test('主干为 origin/master 且无 origin/main 时解析为 origin/master', () => {
    const repo = makeTrunkRepo(['master']);
    try {
      assert.strictEqual(discoverBaseRef(repo), 'origin/master');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('存在 origin/main 时解析为 origin/main', () => {
    const repo = makeTrunkRepo(['main', 'master']);
    try {
      assert.strictEqual(discoverBaseRef(repo), 'origin/main');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('origin/HEAD 存在时优先解析为 origin/HEAD', () => {
    const repo = makeTrunkRepo(['master', 'main'], 'master');
    try {
      assert.strictEqual(discoverBaseRef(repo), 'origin/HEAD');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('三种远程基线均不存在时抛出可操作错误', () => {
    const repo = makeTrunkRepo([]);
    try {
      assert.throws(() => discoverBaseRef(repo), /origin\/HEAD|origin\/main|origin\/master/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('ingest 适配器：--base-ref 透传与资格前置诊断', () => {
  test('prepare/record/verify 均收到解析出的 --base-ref origin/master', () => {
    const repo = makeTrunkRepo(['master']);
    const gateFile = path.join(repo, '.loopx-gate-results.json');
    fs.writeFileSync(gateFile, JSON.stringify({
      schema_version: 'loopx_flow_gate_results_v0',
      gates: [
        { name: 'typecheck', command: 'npm run typecheck', exit_code: 0, status: 'passed' },
        { name: 'lint', command: 'npm run lint', exit_code: 0, status: 'passed' },
        { name: 'build', command: 'npm run build', exit_code: 0, status: 'passed' },
        { name: 'test', command: 'npm run test', exit_code: 0, status: 'passed' }
      ]
    }));
    try {
      withMockLoopx(repo, REVIEW_REQUIRED, ({ env, logFile }) => {
        const res = spawnSync(process.execPath, [INGEST_SCRIPT, '--goal-id', 'issue-13-goal', '--gate-results', gateFile], {
          cwd: repo, env, encoding: 'utf8',
        });
        assert.strictEqual(res.status, 0, `ingest 应通过: ${res.stderr}${res.stdout}`);
        const log = fs.readFileSync(logFile, 'utf8');
        const lines = log.trim().split('\n');
        assert.ok(lines.length >= 3, `应调用 prepare/record/verify, got: ${log}`);
        for (const line of lines) {
          assert.match(line, /--base-ref origin\/master/, `每步都必须带解析出的基线: ${line}`);
        }
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('资格未启用时 ingest 前置 fail-closed 并输出启用命令', () => {
    const repo = makeTrunkRepo(['master']);
    try {
      withMockLoopx(repo, QUALIFICATION_DISABLED, ({ env }) => {
        const res = spawnSync(process.execPath, [INGEST_SCRIPT, '--goal-id', 'issue-13-goal'], {
          cwd: repo, env, encoding: 'utf8',
        });
        assert.strictEqual(res.status, 1, '资格未启用必须非 0');
        const out = res.stdout + res.stderr;
        assert.match(out, /资格|BLOCKED/);
        assert.match(out, /configure-goal --goal-id issue-13-goal --change-quality-enabled --execute/,
          '诊断卡必须给出带 --execute 的启用命令（否则仅干跑预览、不写回 registry）');
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('loopx-flow check 前置诊断（GitHub Issue #13）', () => {
  // 关键隔离：不依赖宿主 checkout 存在 origin/* 引用，避免 check 在
  // resolve_change_quality_base_ref 阶段就退出，根本触不到 mocked loopx。
  test('资格未启用时 check 在四大门禁之前 fail-closed', () => {
    const repo = makeTrunkRepo(['master']);
    const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-check-bin-'));
    const marker = path.join(tmpBin, 'npm-was-run');
    fs.writeFileSync(path.join(tmpBin, 'loopx'),
      `#!/usr/bin/env bash\n${require('./helpers/capability-stub').HELP_PRELUDE}\nprintf '%s' ${JSON.stringify(QUALIFICATION_DISABLED)}\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(tmpBin, 'npm'),
      `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
    try {
      const env = { ...process.env, PATH: `${tmpBin}:${process.env.PATH || ''}` };
      const res = spawnSync(LOOPX_FLOW, ['check', '--goal-id', 'issue-13-goal'], {
        cwd: repo, env, encoding: 'utf8', timeout: 60000,
      });
      assert.strictEqual(res.status, 1, '资格未启用必须阻断 check');
      const out = res.stdout + res.stderr;
      assert.match(out, /\[-\]/, '必须输出 fail-closed 诊断卡');
      assert.match(out, /configure-goal --goal-id issue-13-goal --change-quality-enabled --execute/);
      assert.strictEqual(fs.existsSync(marker), false, '诊断必须发生在四大门禁之前');
    } finally {
      fs.rmSync(tmpBin, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  // 回归：prepare 非零退出 + 错误 JSON 时，旧实现 `|| echo '{}'` 形成双 JSON，
  // JSON.parse 失败后回落空对象被误判为 OK，导致空跑四大门禁（TRE-44 P2）。
  test('prepare 非零退出返回错误 JSON 时 check 前置判 UNKNOWN 并阻断门禁', () => {
    const repo = makeTrunkRepo(['master']);
    const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-check-unknown-bin-'));
    const marker = path.join(tmpBin, 'npm-was-run');
    const logFile = path.join(tmpBin, 'loopx-calls.log');
    fs.writeFileSync(path.join(tmpBin, 'loopx'), `#!/usr/bin/env bash
${require('./helpers/capability-stub').HELP_PRELUDE}
echo "$*" >> ${JSON.stringify(logFile)}
if [[ "$*" == *"change-quality prepare"* ]]; then
  printf '%s' '{"ok":false,"schema_version":"change_quality_error_v0","error":"goal not found in registry"}'
  exit 1
fi
printf '%s' '{"ok":true}'
exit 0
`, { mode: 0o755 });
    fs.writeFileSync(path.join(tmpBin, 'npm'),
      `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
    try {
      const env = { ...process.env, PATH: `${tmpBin}:${process.env.PATH || ''}` };
      const res = spawnSync(LOOPX_FLOW, ['check', '--goal-id', 'issue-13-goal'], {
        cwd: repo, env, encoding: 'utf8', timeout: 60000,
      });
      assert.strictEqual(res.status, 1, 'prepare 失败必须阻断 check');
      const out = res.stdout + res.stderr;
      assert.match(out, /FAIL-CLOSED/, '必须输出 fail-closed 诊断卡');
      assert.match(out, /UNKNOWN|无法判定/, '必须明确判为 UNKNOWN 而非误判 OK');
      assert.match(out, /prepare 退出码/, '诊断卡须含退出码与输出等可操作信息');
      assert.match(out, /configure-goal --goal-id issue-13-goal --change-quality-enabled --execute/);
      assert.strictEqual(fs.existsSync(marker), false, '资格未知时不得空跑四大门禁');
      const log = fs.readFileSync(logFile, 'utf8');
      assert.match(log, /change-quality prepare/);
      assert.doesNotMatch(log, /change-quality record/, '资格未知不得进入 record 阶段');
    } finally {
      fs.rmSync(tmpBin, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('check/doctor 与 ingest 的源码均包含 --base-ref 与资格诊断接线', () => {
    const flow = fs.readFileSync(LOOPX_FLOW, 'utf8');
    assert.match(flow, /resolve_change_quality_base_ref\(\)/, '应集中解析远程默认基线');
    assert.match(flow, /--base-ref/, 'check 必须向 loopx 传递 --base-ref');
    assert.match(flow, /configure-goal --goal-id .*--change-quality-enabled --execute/, '诊断卡必须含带 --execute 的启用命令');
    assert.match(flow, /preflight_change_quality_qualification/, 'doctor/check 必须调用资格前置诊断');
  });
});

describe('失败矩阵文档（GitHub Issue #13）', () => {
  test('docs/design 第 10 节补充基线与资格两个失败语义', () => {
    const doc = fs.readFileSync(DESIGN_DOC, 'utf8');
    const matrix = doc.slice(doc.indexOf('## 10. 失败矩阵'));
    assert.match(matrix, /origin\/master/);
    assert.match(matrix, /change-quality 资格/);
  });
});
