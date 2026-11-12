'use strict';
/**
 * 仓库根级授权配置隔离：一旦仓库提交了 loopx-workflow.config.json，
 * 仍按“旧接线/纯 SHA/readiness”断言的测试需要临时把配置移开。
 * 测试按 --test-concurrency=1 顺序执行，finally 恢复，不改变真实生产行为。
 */
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function withoutRepoConfig(fn) {
  const cfg = path.join(PROJECT_ROOT, 'loopx-workflow.config.json');
  const bak = cfg + '.test-bak';
  const had = fs.existsSync(cfg);
  if (had) fs.renameSync(cfg, bak);
  try {
    return fn();
  } finally {
    if (had && fs.existsSync(bak)) fs.renameSync(bak, cfg);
  }
}

// 用于“整个测试体都要在无 config 下运行”的场景：返回 restore 函数，必须在 finally 调用。
function detachRepoConfig() {
  const cfg = path.join(PROJECT_ROOT, 'loopx-workflow.config.json');
  const bak = cfg + '.test-bak';
  const had = fs.existsSync(cfg);
  if (had) fs.renameSync(cfg, bak);
  return function restore() {
    if (had && fs.existsSync(bak)) fs.renameSync(bak, cfg);
  };
}

module.exports = { PROJECT_ROOT, withoutRepoConfig, detachRepoConfig };
