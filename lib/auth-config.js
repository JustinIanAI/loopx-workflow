'use strict';
/**
 * lib/auth-config.js — loopx-workflow.config.json 的唯一写入者（W14 / Issue #81）
 *
 * 职责边界：只负责「把人类已确认的 authorization_mode 原子落盘」。
 * 它不判断这次写入是否被允许——TTY 人闸在 bin/loopx-flow 的 init / config 命令里，
 * 读侧校验仍由 bin/loopx-flow 的 auth_require_config 承担。两侧共用同一 Schema 常量口径。
 *
 * CLI: node lib/auth-config.js set <file> <independent|single_owner> [accepted_by] [accepted_at]
 */
const fs = require('node:fs');

const SCHEMA_VERSION = 'loopx_workflow_config_v0';
const MODES = ['independent', 'single_owner'];

function buildConfig(mode, { acceptedBy = '', acceptedAt = '' } = {}) {
  if (!MODES.includes(mode)) {
    throw new Error(`非法 authorization_mode: ${mode}（仅 ${MODES.join(' | ')}）`);
  }
  const config = { schema_version: SCHEMA_VERSION, authorization_mode: mode };
  if (mode === 'single_owner') {
    if (!acceptedBy || !acceptedAt) throw new Error('single_owner 需要 accepted_by 与 accepted_at（风险接受不可为空）');
    config.single_owner_risk_acceptance = { accepted_by: acceptedBy, accepted_at: acceptedAt };
  }
  return config;
}

// 原子写：同目录临时文件 + rename；失败时清理临时文件，绝不留半写配置。
function writeConfig(file, mode, opts) {
  const config = buildConfig(mode, opts);
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* 已不存在 */ }
    throw err;
  }
  return config;
}

function main(argv) {
  const [action, file, mode, acceptedBy, acceptedAt] = argv;
  if (action !== 'set' || !file || !mode) {
    console.error('用法: node lib/auth-config.js set <file> <independent|single_owner> [accepted_by] [accepted_at]');
    return 2;
  }
  try {
    const config = writeConfig(file, mode, { acceptedBy, acceptedAt });
    console.log(JSON.stringify({ file, authorization_mode: config.authorization_mode }));
    return 0;
  } catch (err) {
    console.error(`[-] [FAIL-CLOSED] ${err.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { SCHEMA_VERSION, MODES, buildConfig, writeConfig };
