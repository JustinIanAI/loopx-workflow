'use strict';
/**
 * W14 / Issue #81：authorization_mode 受支持切换。
 *
 * 分工：
 *   - lib/auth-config.js 是唯一写入者（状态机 + 原子写），直接单测两种切换方向与非法输入；
 *   - bin/loopx-flow config set ... 的人闸是 TTY 确认，spawnSync 下无 TTY，故只覆盖
 *     Fail-Closed 分支与幂等分支（成功路径需真实终端，边界声明见 PR）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/m0-sandbox');

const AUTH_CONFIG = require(path.join(h.PROJECT_ROOT, 'lib/auth-config.js'));

// lib/auth-config.js 用驼峰入参，沙箱 helper 的 writeConfig 直接写 JSON（蛇形键）。
const RISK = { acceptedBy: 'owner1', acceptedAt: '2026-11-28T00:00:00Z' };
const RISK_JSON = { accepted_by: 'owner1', accepted_at: '2026-11-28T00:00:00Z' };

function configFile(dir) {
  return path.join(dir, 'loopx-workflow.config.json');
}

function readConfig(dir) {
  return JSON.parse(fs.readFileSync(configFile(dir), 'utf8'));
}

function leftoverTmp(dir) {
  return fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
}

test('auth-config: single_owner 写入携带风险接受字段', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'auth-config-so-'));
  try {
    const config = AUTH_CONFIG.writeConfig(configFile(dir), 'single_owner', RISK);
    assert.deepStrictEqual(config.single_owner_risk_acceptance, {
      accepted_by: 'owner1',
      accepted_at: '2026-11-28T00:00:00Z'
    });
    assert.deepStrictEqual(readConfig(dir), config);
    assert.deepStrictEqual(leftoverTmp(dir), []);
  } finally {
    h.cleanup(dir);
  }
});

test('auth-config: 切回 independent 时清除风险接受（delete-first，不留陈旧授权）', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'auth-config-ind-'));
  try {
    AUTH_CONFIG.writeConfig(configFile(dir), 'single_owner', RISK);
    const config = AUTH_CONFIG.writeConfig(configFile(dir), 'independent');
    assert.strictEqual(config.authorization_mode, 'independent');
    assert.strictEqual(config.single_owner_risk_acceptance, undefined);
    assert.strictEqual(readConfig(dir).single_owner_risk_acceptance, undefined);
    assert.deepStrictEqual(leftoverTmp(dir), []);
  } finally {
    h.cleanup(dir);
  }
});

test('auth-config: 非法模式与缺失风险接受一律拒绝且不落盘', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'auth-config-bad-'));
  try {
    assert.throws(() => AUTH_CONFIG.writeConfig(configFile(dir), 'owner_mode'), /非法 authorization_mode/);
    assert.throws(() => AUTH_CONFIG.writeConfig(configFile(dir), 'single_owner', { acceptedBy: 'owner1' }), /风险接受/);
    assert.strictEqual(fs.existsSync(configFile(dir)), false);
    assert.throws(() => AUTH_CONFIG.buildConfig(''), /非法 authorization_mode/);
    assert.deepStrictEqual(AUTH_CONFIG.MODES.slice().sort(), ['independent', 'single_owner']);
  } finally {
    h.cleanup(dir);
  }
});

test('config set: 非法模式 Fail-Closed 且不改动既有配置', () => {
  const dir = h.makeSandbox('auth-mode-invalid-');
  try {
    h.writeConfig(dir, 'independent');
    const before = fs.readFileSync(configFile(dir), 'utf8');
    const res = h.run(dir, ['config', 'set', 'authorization-mode', 'owner_mode']);
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /FAIL-CLOSED/);
    assert.strictEqual(fs.readFileSync(configFile(dir), 'utf8'), before);
  } finally {
    h.cleanup(dir);
  }
});

test('config set: 非 TTY 拒绝静默切换', () => {
  const dir = h.makeSandbox('auth-mode-notty-');
  try {
    h.writeConfig(dir, 'single_owner', RISK_JSON);
    const before = fs.readFileSync(configFile(dir), 'utf8');
    const res = h.run(dir, ['config', 'set', 'authorization-mode', 'independent']);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /需要 TTY 显式确认/);
    assert.strictEqual(fs.readFileSync(configFile(dir), 'utf8'), before);
  } finally {
    h.cleanup(dir);
  }
});

test('config set: 目标模式与当前一致时幂等退出，不写文件', () => {
  const dir = h.makeSandbox('auth-mode-noop-');
  try {
    h.writeConfig(dir, 'independent');
    const statBefore = fs.statSync(configFile(dir)).mtimeMs;
    const res = h.run(dir, ['config', 'set', 'authorization-mode', 'independent']);
    assert.strictEqual(res.status, 0);
    assert.match(res.stdout, /无需切换/);
    assert.strictEqual(fs.statSync(configFile(dir)).mtimeMs, statBefore);
  } finally {
    h.cleanup(dir);
  }
});

test('config: 子命令写错时给出用法并非 0 退出', () => {
  const dir = h.makeSandbox('auth-mode-usage-');
  try {
    const res = h.run(dir, ['config', 'mode', 'single_owner']);
    assert.strictEqual(res.status, 2);
    assert.match(res.stderr, /config set authorization-mode/);
  } finally {
    h.cleanup(dir);
  }
});

test('config set: 既有配置非法时先拒绝，不做覆盖写', () => {
  const dir = h.makeSandbox('auth-mode-corrupt-');
  try {
    h.write(dir, 'loopx-workflow.config.json', JSON.stringify({ schema_version: 'loopx_workflow_config_v0', authorization_mode: 'bogus' }, null, 2));
    const before = fs.readFileSync(configFile(dir), 'utf8');
    const res = h.run(dir, ['config', 'set', 'authorization-mode', 'independent']);
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /授权配置校验失败/);
    assert.strictEqual(fs.readFileSync(configFile(dir), 'utf8'), before);
  } finally {
    h.cleanup(dir);
  }
});
