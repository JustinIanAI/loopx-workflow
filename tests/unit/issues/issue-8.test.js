'use strict';
/**
 * Issue #8 regression：统一治理 loopx 与 loopx-flow 临时文件与交付物路径。
 *
 * 覆盖：
 *   1. 生产源码（bin/、scripts/、skills/）不再硬编码系统 /tmp 固定文件名；
 *   2. .loopx/tmp/ 被 gitignore，临时工件不会泄漏进 diff / 收据；
 *   3. 生产 temp 分配器并行调用生成唯一路径，互不覆写；
 *   4. loopx-flow init 负责创建项目本地临时沙箱，PR 正文不再用 ${TMPDIR:-/tmp}。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const INGEST = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const { allocateTempArtifactPath } = require(INGEST);

const SCAN_ROOTS = ['bin', 'scripts', 'skills'].map((dir) => path.join(PROJECT_ROOT, dir));
const SCAN_EXTENSIONS = new Set(['.js', '.sh']);

// 硬编码系统临时目录固定路径：/tmp/<name> 或 /private/tmp/<name>。
// 前缀限定避免误伤 https://example.com/tmp/... 之类的普通路径片段。
const HARDCODED_TMP_PATH = /(?:^|[^A-Za-z0-9_.$/\\])\/(?:private\/)?tmp\/[A-Za-z0-9_.${}-]+/;

const ALLOWED_HOST_TEMP_APIS = ['mktemp', 'os.tmpdir', 'TMPDIR'];

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(entry.name)) || entry.name === 'loopx-flow') {
      out.push(full);
    }
  }
  return out;
}

function isCommentOrAllowedTempApi(line) {
  const trimmed = line.trim();
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('<!--')
  ) {
    return true;
  }
  // mktemp / os.tmpdir() / TMPDIR 是唯一命名的合规手段，允许出现在实现里。
  return ALLOWED_HOST_TEMP_APIS.some((token) => trimmed.includes(token));
}

test('1. 生产源码零硬编码 /tmp 固定文件名（静态治理扫描）', () => {
  const files = SCAN_ROOTS.flatMap((dir) => walkFiles(dir));
  assert.ok(files.length > 10, `治理扫描应覆盖生产源码，实际文件数: ${files.length}`);

  const offenders = [];
  for (const file of files) {
    const rel = path.relative(PROJECT_ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (isCommentOrAllowedTempApi(line)) return;
      if (HARDCODED_TMP_PATH.test(line)) {
        offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `业务脚本/技能脚本禁止硬编码系统 /tmp 固定文件名，请改用项目沙箱 .loopx/tmp/ + mktemp/PID:\n${offenders.join('\n')}`
  );
});

test('2. .loopx/tmp/ 进入 gitignore，临时工件不会泄漏进 diff 或质量收据', () => {
  const ignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.loopx\/tmp\/$/m, '.gitignore 必须忽略项目本地临时沙箱 .loopx/tmp/');

  const ignored = spawnSync('git', ['check-ignore', '-q', '.loopx/tmp/probe-artifact.json'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });
  assert.strictEqual(ignored.status, 0, 'git check-ignore 必须命中 .loopx/tmp/ 下的临时工件');
});

test('3. 生产 temp 分配器并行生成唯一路径且互不覆写', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-tmp-unique-'));
  const previousOverride = process.env.LOOPX_TMP_DIR;
  process.env.LOOPX_TMP_DIR = sandbox;
  try {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => allocateTempArtifactPath('parallel-probe')),
      Promise.resolve().then(() => allocateTempArtifactPath('parallel-probe'))
    ]);

    assert.notStrictEqual(first, second, '并行调用必须生成不同临时路径，禁止固定文件名覆写');
    assert.strictEqual(path.dirname(first), sandbox, '临时路径必须落在 LOOPX_TMP_DIR 沙箱内');
    assert.strictEqual(path.dirname(second), sandbox, '临时路径必须落在 LOOPX_TMP_DIR 沙箱内');
    assert.match(path.basename(first), /^parallel-probe-\d+-[0-9a-f]{12}\.json$/);
    assert.match(path.basename(second), /^parallel-probe-\d+-[0-9a-f]{12}\.json$/);

    fs.writeFileSync(first, 'first-artifact');
    fs.writeFileSync(second, 'second-artifact');
    assert.strictEqual(fs.readFileSync(first, 'utf8'), 'first-artifact', '首个工件内容不得被覆写');
    assert.strictEqual(fs.readFileSync(second, 'utf8'), 'second-artifact', '第二个工件内容不得被覆写');
  } finally {
    if (previousOverride === undefined) delete process.env.LOOPX_TMP_DIR;
    else process.env.LOOPX_TMP_DIR = previousOverride;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('4. loopx-flow init 创建项目本地沙箱，PR 正文不再回退系统 /tmp', () => {
  const script = fs.readFileSync(LOOPX_FLOW, 'utf8');

  const initStart = script.indexOf('cmd_init()');
  const initEnd = script.indexOf('sync_global_required()');
  assert.ok(initStart >= 0 && initEnd > initStart, '应能在 bin/loopx-flow 中定位 cmd_init()');
  const initSection = script.slice(initStart, initEnd);
  assert.match(initSection, /mkdir -p "\$PROJECT_ROOT\/\.loopx\/tmp"/, 'loopx-flow init 必须创建 .loopx/tmp/');
  assert.match(script, /LOOPX_TMP_DIR="\$\{LOOPX_TMP_DIR:-\$PROJECT_ROOT\/\.loopx\/tmp\}"/, '应支持 LOOPX_TMP_DIR 覆盖沙箱目录');
  assert.strictEqual(script.includes('${TMPDIR:-/tmp}'), false, 'PR 正文临时文件不得回退到系统 /tmp');
  assert.match(script, /mktemp "\$\{LOOPX_TMP_DIR\}\/pr-body-/, 'PR 正文必须落在项目沙箱内且文件名唯一');
});
