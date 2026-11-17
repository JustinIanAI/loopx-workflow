'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const PREFLIGHT = path.join(PROJECT_ROOT, 'scripts/preflight-check.sh');
const WORKFLOW_INIT = path.join(PROJECT_ROOT, 'scripts/workflow-init.sh');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const READINESS = path.join(PROJECT_ROOT, 'scripts/loopx-skill-readiness.js');
const { evaluateDoctorPayload } = require(READINESS);

function readyPayload(patch = {}) {
  return {
    ok: true,
    checks: [
      {
        id: 'installed_required_skills',
        required: false,
        ok: true,
        applicable: true,
        detail: 'loopx-project',
      },
      {
        id: 'installed_required_skill_routes',
        required: false,
        ok: true,
        applicable: true,
        detail: 'loopx-project=valid:True;routes:1',
      },
    ],
    skills: {
      'loopx-project': { exists: true, required_phrases: true, route_conflict: false },
    },
    install_freshness: {
      status: 'fresh',
      reason: 'default release snapshot timestamp is within the freshness window',
      requires_upgrade: false,
      upgrade_command: 'loopx workflow-skills --install\nloopx doctor --format json',
    },
    skill_delivery: { status: 'ready' },
    fix: 'python3 -m pip install --upgrade loopx\nloopx doctor',
    ...patch,
  };
}

function withSkill(payload, skillPatch) {
  payload.skills = {
    'loopx-project': { ...payload.skills['loopx-project'], ...skillPatch },
  };
  return payload;
}

test('就绪 payload：skills、routes 与新鲜度同时通过', () => {
  const result = evaluateDoctorPayload(readyPayload());
  assert.strictEqual(result.ok, true, result.reasons.join('；'));
  assert.deepStrictEqual(result.reasons, []);
});

test('python_distribution 且技能齐全时通过（pip 安装不是过期）', () => {
  const result = evaluateDoctorPayload(readyPayload({
    install_freshness: {
      status: 'python_distribution',
      reason: 'LoopX is installed as a managed Python distribution',
      requires_upgrade: false,
      upgrade_command: 'python3 -m pip install --upgrade loopx\nloopx doctor',
    },
  }));
  assert.strictEqual(result.ok, true, result.reasons.join('；'));
});

test('installed_required_skills 未通过时阻断，即使 doctor.ok 与退出码语义上可放行', () => {
  const payload = readyPayload();
  payload.checks[0].ok = false;
  payload.checks[0].detail = '';
  payload.ok = true;
  const result = evaluateDoctorPayload(payload);
  assert.strictEqual(result.ok, false);
  assert.match(result.reasons.join('\n'), /installed_required_skills 未通过/);
});

test('路由短语过期或 route_conflict 时阻断', () => {
  const staleRoute = evaluateDoctorPayload(withSkill(readyPayload(), {
    required_phrases: false,
  }));
  assert.strictEqual(staleRoute.ok, false);
  assert.match(staleRoute.reasons.join('\n'), /loopx-project 路由过期或冲突/);

  const payload = readyPayload();
  payload.checks[1].ok = false;
  const conflict = evaluateDoctorPayload(withSkill(payload, { route_conflict: true }));
  assert.strictEqual(conflict.ok, false);
  assert.match(conflict.reasons.join('\n'), /installed_required_skill_routes 未通过/);
  assert.match(conflict.reasons.join('\n'), /路由过期或冲突/);
});

test('技能文件缺失时阻断', () => {
  const result = evaluateDoctorPayload(withSkill(readyPayload(), { exists: false }));
  assert.strictEqual(result.ok, false);
  assert.match(result.reasons.join('\n'), /skill loopx-project 缺失/);
});

test('新鲜度为 stale、repair_recommended、missing 时阻断，并带上 doctor 修复命令', () => {
  for (const status of ['stale', 'repair_recommended', 'missing']) {
    const result = evaluateDoctorPayload(readyPayload({
      install_freshness: {
        status,
        reason: status === 'repair_recommended'
          ? 'installed LoopX skills are missing or stale'
          : `status ${status}`,
        requires_upgrade: true,
        upgrade_command: 'loopx workflow-skills --install\nloopx slash-commands --install',
      },
      skill_delivery: { status: status === 'repair_recommended' ? 'repair_recommended' : 'ready' },
    }));
    assert.strictEqual(result.ok, false, status);
    assert.match(result.reasons.join('\n'), new RegExp(`install_freshness\\.status=${status}`));
    assert.match(result.repair, /loopx workflow-skills --install/);
  }
});

test('skill_delivery.status=repair_recommended 单独阻断', () => {
  const result = evaluateDoctorPayload(readyPayload({
    skill_delivery: { status: 'repair_recommended' },
  }));
  assert.strictEqual(result.ok, false);
  assert.match(result.reasons.join('\n'), /skill_delivery\.status=repair_recommended/);
});

test('requires_upgrade 为真时阻断，即使 status 不在过期枚举里', () => {
  const result = evaluateDoctorPayload(readyPayload({
    install_freshness: {
      status: 'python_distribution',
      requires_upgrade: true,
      upgrade_command: 'python3 -m pip install --upgrade loopx',
    },
  }));
  assert.strictEqual(result.ok, false);
  assert.match(result.reasons.join('\n'), /requires_upgrade=true/);
  assert.match(result.repair, /pip install --upgrade loopx/);
});

test('检查项缺失、技能列表为空、JSON 不是对象时阻断', () => {
  const missingChecks = evaluateDoctorPayload(readyPayload({ checks: [] }));
  assert.strictEqual(missingChecks.ok, false);
  assert.match(missingChecks.reasons.join('\n'), /未返回 installed_required_skills/);

  const emptySkills = evaluateDoctorPayload(readyPayload({ skills: {} }));
  assert.strictEqual(emptySkills.ok, false);
  assert.match(emptySkills.reasons.join('\n'), /skills 列表为空/);

  const broken = evaluateDoctorPayload(null);
  assert.strictEqual(broken.ok, false);
  assert.match(broken.reasons.join('\n'), /不是 JSON 对象/);
  assert.match(broken.repair, /loopx doctor --format json/);
});

test('applicable 均为 false 时不因宿主自管技能阻断', () => {
  const payload = readyPayload({
    checks: [
      { id: 'installed_required_skills', ok: true, applicable: false, required: false },
      { id: 'installed_required_skill_routes', ok: true, applicable: false, required: false },
    ],
    skills: {},
    install_freshness: { status: 'repair_recommended', requires_upgrade: true },
    skill_delivery: { status: 'repair_recommended' },
  });
  const result = evaluateDoctorPayload(payload);
  assert.strictEqual(result.ok, true, result.reasons.join('；'));
});

test('fix 字段里的 markdown 代码块被抽成可执行修复指令', () => {
  const result = evaluateDoctorPayload(readyPayload({
    install_freshness: { status: 'fresh', requires_upgrade: false },
    fix: 'Upgrade:\n\n```\nloopx slash-commands --install\nloopx doctor\n```',
  }));
  assert.strictEqual(result.ok, true);
  assert.match(result.repair, /^loopx slash-commands --install\nloopx doctor$/);
});

function resolveTool(name) {
  return execFileSync('/usr/bin/which', [name], {
    encoding: 'utf8',
    env: process.env,
  }).trim();
}

function makeIsolatedPath(loopxDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-11-path-'));
  for (const name of ['git', 'gh', 'node', 'npm', 'which', 'sed', 'mktemp', 'rm']) {
    fs.symlinkSync(resolveTool(name), path.join(dir, name));
  }
  const parts = [dir, '/usr/bin', '/bin'];
  if (loopxDir) parts.unshift(loopxDir);
  return { dir, path: parts.join(':') };
}

function writeFakeLoopx(dir) {
  const file = path.join(dir, 'loopx');
  fs.writeFileSync(file, `#!/bin/bash
if [[ "\${1:-}" != "doctor" ]]; then
  echo "unexpected loopx args: \$*" >&2
  exit 1
fi
if [[ -n "\${LOOPX_DOCTOR_STDERR:-}" ]]; then
  printf '%s\\n' "$LOOPX_DOCTOR_STDERR" >&2
fi
if [[ -n "\${LOOPX_DOCTOR_FIXTURE:-}" ]]; then
  cat "$LOOPX_DOCTOR_FIXTURE"
fi
exit "\${LOOPX_DOCTOR_EXIT:-0}"
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function runPreflight(env) {
  return spawnSync('/bin/bash', [PREFLIGHT], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('preflight：doctor 退出码 0 但 skills 缺失或过期时非零退出', () => {
  const loopxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-11-loopx-'));
  writeFakeLoopx(loopxDir);
  const isolated = makeIsolatedPath(loopxDir);
  const fixture = path.join(loopxDir, 'doctor.json');
  const payload = readyPayload({
    install_freshness: {
      status: 'repair_recommended',
      reason: 'installed LoopX skills are missing or stale',
      requires_upgrade: true,
      upgrade_command: 'loopx workflow-skills --install\nloopx slash-commands --install',
    },
  });
  payload.checks[0].ok = false;
  fs.writeFileSync(fixture, JSON.stringify(payload));

  const res = runPreflight({
    PATH: isolated.path,
    LOOPX_DOCTOR_FIXTURE: fixture,
    LOOPX_DOCTOR_EXIT: '0',
  });
  const output = `${res.stdout}${res.stderr}`;
  assert.notStrictEqual(res.status, 0, output);
  assert.match(output, /installed_required_skills 未通过/);
  assert.match(output, /install_freshness\.status=repair_recommended/);
  assert.match(output, /installed LoopX skills are missing or stale/);
  assert.match(output, /修复指令:/);
  assert.match(output, /loopx workflow-skills --install/);
  assert.match(output, /不得标记为就绪/);
  assert.doesNotMatch(output, /100% 完美通过/);
});

test('preflight：doctor 非零退出时阻断，即使 stdout 看起来就绪', () => {
  const loopxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-11-loopx-'));
  writeFakeLoopx(loopxDir);
  const isolated = makeIsolatedPath(loopxDir);
  const fixture = path.join(loopxDir, 'doctor.json');
  fs.writeFileSync(fixture, JSON.stringify(readyPayload()));
  const res = runPreflight({
    PATH: isolated.path,
    LOOPX_DOCTOR_FIXTURE: fixture,
    LOOPX_DOCTOR_EXIT: '3',
    LOOPX_DOCTOR_STDERR: 'registry unavailable',
  });
  const output = `${res.stdout}${res.stderr}`;
  assert.notStrictEqual(res.status, 0, output);
  assert.match(output, /退出码 3/);
  assert.match(output, /验证未通过/);
  assert.match(output, /修复指令: loopx doctor --format json/);
});

test('preflight：技能与新鲜度全部就绪时通过', () => {
  const loopxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-11-loopx-'));
  writeFakeLoopx(loopxDir);
  const isolated = makeIsolatedPath(loopxDir);
  const fixture = path.join(loopxDir, 'doctor.json');
  fs.writeFileSync(fixture, JSON.stringify(readyPayload()));
  const res = runPreflight({
    PATH: isolated.path,
    LOOPX_DOCTOR_FIXTURE: fixture,
    LOOPX_DOCTOR_EXIT: '0',
  });
  const output = `${res.stdout}${res.stderr}`;
  assert.strictEqual(res.status, 0, output);
  assert.match(output, /LoopX skills\/routes\/新鲜度: .*PASS/);
  assert.match(output, /required skills、routes 与安装新鲜度通过/);
  assert.doesNotMatch(output, /FAIL-CLOSED/);
});

test('preflight：没有 loopx 时只告警，不把缺 CLI 升级为阻断', () => {
  const isolated = makeIsolatedPath(null);
  const res = runPreflight({ PATH: isolated.path });
  const output = `${res.stdout}${res.stderr}`;
  assert.strictEqual(res.status, 0, output);
  assert.match(output, /推荐工具 loopx: .*NOT FOUND/);
  assert.doesNotMatch(output, /FAIL-CLOSED/);
  assert.doesNotMatch(output, /skills\/routes\/新鲜度/);
});

test('workflow-init 与 loopx-flow init 传播 preflight 的非零退出', () => {
  const init = fs.readFileSync(WORKFLOW_INIT, 'utf8');
  assert.match(init, /set -euo pipefail/);
  assert.match(init, /preflight-check\.sh" --fix/);
  assert.doesNotMatch(init, /preflight-check\.sh[^\n]*\|\| true/);

  const flow = fs.readFileSync(LOOPX_FLOW, 'utf8');
  assert.match(flow, /scripts\/workflow-init\.sh"/);
  assert.doesNotMatch(flow, /workflow-init\.sh"[^\n]*\|\| true/);
});

test('CLI：无法解析的 doctor stdout 非零退出并给出修复指令', () => {
  const res = spawnSync(process.execPath, [READINESS], {
    input: 'not-json',
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /FAIL-CLOSED/);
  assert.match(res.stderr, /不是 JSON 对象/);
  assert.match(res.stderr, /loopx doctor --format json/);
});
