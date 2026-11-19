'use strict';
/**
 * lib/paths.js — loopx-workflow 唯一 Node 路径锚定、运行目录与可执行文件解析模块
 *
 * 职责边界（ADR-0007 / D1 / D2）：
 *   - WORKFLOW_ROOT：工作流代码/技能静态资产根（基于 __dirname 规范化）。
 *   - REPO_ROOT：被操作的目标 Git 仓库（当前 worktree 顶层，不把 WORKFLOW_ROOT 当目标仓）。
 *   - LOOPX_TMP_DIR：编排层进程临时沙箱（env > <REPO_ROOT>/.loopx/tmp）；每次运行独立目录，
 *     成功即删、失败保留供取证并交由 `loopx-flow gc` 回收。
 *   - LOOPX_REVIEW_CACHE_DIR：`<REPO_ROOT>/.loopx/cache/reviews`（D2 降级为可丢弃缓存）。
 *   - resolveLoopxExecutable / findOnPath：纯 Node 跨平台可执行探测，彻底移除外部 `which`。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return path.resolve(p);
  }
}

const WORKFLOW_ROOT = safeRealpath(path.resolve(__dirname, '..'));

function resolveRepoRoot(cwd = process.cwd(), { strict = false } = {}) {
  const startDir = path.resolve(cwd || process.cwd());
  const res = spawnSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (res.status === 0 && res.stdout && res.stdout.trim()) {
    return safeRealpath(res.stdout.trim());
  }
  if (strict) {
    throw new Error(`当前目录不是 Git 仓库（无法解析 REPO_ROOT）: ${startDir}`);
  }
  return safeRealpath(startDir);
}

function resolveTmpDir(repoRoot) {
  const override = process.env.LOOPX_TMP_DIR;
  if (override) return path.resolve(override);
  const root = repoRoot ? safeRealpath(repoRoot) : resolveRepoRoot();
  return path.join(root, '.loopx', 'tmp');
}

function resolveReviewCacheDir(repoRoot) {
  const root = repoRoot ? safeRealpath(repoRoot) : resolveRepoRoot();
  return path.join(root, '.loopx', 'cache', 'reviews');
}

function resolveLegacyReviewDir(repoRoot) {
  const root = repoRoot ? safeRealpath(repoRoot) : resolveRepoRoot();
  return path.join(root, '.loopx', 'reviews');
}

function resolveCodexHome(env = process.env) {
  return (env && env.CODEX_HOME) ? path.resolve(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
}

// 唯一临时工件路径（向后兼容 ingest-to-loopx-quality.js 既有导出）
function allocateTempArtifactPath(prefix = 'change-quality-agent-result', ext = 'json', repoRoot) {
  const tmpDir = resolveTmpDir(repoRoot);
  fs.mkdirSync(tmpDir, { recursive: true });
  const suffix = ext ? `.${String(ext).replace(/^\./, '')}` : '';
  return path.join(tmpDir, `${prefix}-${process.pid}-${crypto.randomBytes(6).toString('hex')}${suffix}`);
}

// 每次运行一个独占目录：成功即删（LOOPX_KEEP_TMP=1 时保留）；失败保留并打印路径供取证。
const _activeRunDirs = new Set();
let _signalHooksInstalled = false;

function _installSignalHooks() {
  if (_signalHooksInstalled) return;
  _signalHooksInstalled = true;
  process.on('exit', (code) => {
    for (const entry of Array.from(_activeRunDirs)) entry.cleanup(code);
  });
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(sig, () => {
      for (const entry of Array.from(_activeRunDirs)) entry.cleanup(code);
      process.exit(code);
    });
  }
}

function createRunDir(prefix = 'flow', repoRoot) {
  const tmpRoot = resolveTmpDir(repoRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tmpRoot, `${prefix}-`));
  let cleaned = false;
  const cleanup = (exitCode = 0) => {
    if (cleaned) return;
    cleaned = true;
    _activeRunDirs.delete(handle);
    if (exitCode === 0 && process.env.LOOPX_KEEP_TMP !== '1') {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    } else if (fs.existsSync(dir)) {
      process.stderr.write(`[i] 运行工件保留于: ${dir}\n`);
    }
  };
  const handle = {
    dir,
    file: (name) => path.join(dir, name),
    cleanup,
  };
  _activeRunDirs.add(handle);
  _installSignalHooks();
  return handle;
}

function isExecutableFile(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function findOnPath(program, pathEnv) {
  if (!program) return null;
  if (program.includes('/') || program.includes('\\')) {
    const resolved = path.resolve(program);
    return isExecutableFile(resolved) ? resolved : null;
  }
  const dirs = String(pathEnv || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, program);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function activeRuntimeCandidates(env) {
  const out = [];
  const push = (dir, source) => {
    if (!dir) return;
    out.push({ file: path.join(dir, 'bin', 'loopx'), source });
    out.push({ file: path.join(dir, 'Scripts', 'loopx.exe'), source });
  };
  push(env.CONDA_PREFIX, 'CONDA_PREFIX');
  if (env.CONDA_EXE) {
    out.push({ file: path.join(path.dirname(env.CONDA_EXE), 'loopx'), source: 'CONDA_EXE' });
  }
  push(env.VIRTUAL_ENV, 'VIRTUAL_ENV');
  push(env.MAMBA_ROOT_PREFIX, 'MAMBA_ROOT_PREFIX');
  return out;
}

function resolveLoopxExecutable(env = process.env) {
  const explicit = env.LOOPX_BIN && String(env.LOOPX_BIN).trim();
  if (explicit) {
    if (explicit.includes('/') || explicit.includes('\\')) {
      const resolved = path.resolve(explicit);
      if (isExecutableFile(resolved)) return { ok: true, bin: resolved, source: 'LOOPX_BIN' };
      return {
        ok: false,
        error: `LOOPX_BIN=${explicit} does not point to an executable file. Refusing to fall back to PATH (fail-closed).`,
      };
    }
    const fromExplicit = findOnPath(explicit, env.PATH);
    if (fromExplicit) return { ok: true, bin: fromExplicit, source: 'LOOPX_BIN' };
    return {
      ok: false,
      error: `LOOPX_BIN=${explicit} was not found as an executable file. Refusing to fall back to PATH (fail-closed).`,
    };
  }
  const fromPath = findOnPath('loopx', env.PATH);
  if (fromPath) return { ok: true, bin: fromPath, source: 'PATH' };
  for (const item of activeRuntimeCandidates(env)) {
    if (isExecutableFile(item.file)) return { ok: true, bin: item.file, source: item.source };
  }
  return {
    ok: false,
    error: 'No executable loopx found via LOOPX_BIN, PATH, or the active runtime (CONDA_PREFIX, CONDA_EXE, VIRTUAL_ENV, MAMBA_ROOT_PREFIX). Set LOOPX_BIN to an executable path (fail-closed).',
  };
}

// 按仓库真实存在的远程默认基线解析：origin/HEAD → origin/main → origin/master（Issue #13）。
function discoverBaseRef(repoPath = process.cwd()) {
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
    try {
      execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
        stdio: 'ignore',
      });
      return ref;
    } catch (_) {
      // try next candidate
    }
  }
  throw new Error('无法解析远程默认基线：origin/HEAD / origin/main / origin/master 均不存在；请先 git fetch origin && git remote set-head origin -a');
}

// 将证据文本中的宿主机本机绝对路径替换为可移植占位符（R9）。
function sanitizeEvidenceText(text, { repoRoot, runtimeRoot } = {}) {
  let out = String(text || '');
  const pairs = [];
  if (runtimeRoot) pairs.push([safeRealpath(runtimeRoot), '<loopx-runtime-root>']);
  const home = os.homedir();
  if (home) {
    pairs.push([path.join(home, '.codex', 'loopx'), '<loopx-runtime-root>']);
    pairs.push([path.join(home, '.loopx'), '<loopx-runtime-root>']);
  }
  if (repoRoot) pairs.push([safeRealpath(repoRoot), '<repo-root>']);
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [needle, repl] of pairs) {
    if (needle && out.includes(needle)) out = out.split(needle).join(repl);
  }
  return out;
}

// 并发安全的临时目录与评审缓存回收器（§3.2 / R18）：
//   1. realpath 前缀校验 + lstat 禁止跟随符号链接；
//   2. 1 小时活跃保护窗（mtime < 3600s 一律跳过，除非显式 force=true），防止误删并行 Agent 活跃目录。
const ACTIVE_PROTECTION_WINDOW_MS = 3600 * 1000;

function gcDirectory(baseDir, { days = 14, force = false, nowMs = Date.now() } = {}) {
  const report = { baseDir, removed: [], skippedSymlink: [], skippedActive: [], kept: [] };
  if (!baseDir || !fs.existsSync(baseDir)) return report;
  const baseLstat = fs.lstatSync(baseDir);
  if (baseLstat.isSymbolicLink() || !baseLstat.isDirectory()) return report;
  const baseReal = fs.realpathSync(baseDir);
  const maxAgeMs = Math.max(0, Number(days)) * 86400 * 1000;

  for (const name of fs.readdirSync(baseDir)) {
    const fullPath = path.join(baseDir, name);
    let lst;
    try {
      lst = fs.lstatSync(fullPath);
    } catch (_) {
      continue;
    }
    if (lst.isSymbolicLink()) {
      report.skippedSymlink.push(fullPath);
      continue;
    }
    let entryReal;
    try {
      entryReal = fs.realpathSync(fullPath);
    } catch (_) {
      continue;
    }
    if (entryReal !== path.join(baseReal, name) || !entryReal.startsWith(baseReal + path.sep)) {
      report.skippedSymlink.push(fullPath);
      continue;
    }
    const ageMs = nowMs - lst.mtimeMs;
    if (!force && ageMs < ACTIVE_PROTECTION_WINDOW_MS) {
      report.skippedActive.push(fullPath);
      continue;
    }
    if (ageMs >= maxAgeMs) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      report.removed.push(fullPath);
    } else {
      report.kept.push(fullPath);
    }
  }
  return report;
}

function gcWorkspaceArtifacts({ repoRoot, tmpDir, days = 14, force = false, nowMs = Date.now() } = {}) {
  const root = repoRoot ? safeRealpath(repoRoot) : resolveRepoRoot(process.cwd());
  const cacheDir = resolveReviewCacheDir(root);
  const sandboxDir = tmpDir ? path.resolve(tmpDir) : resolveTmpDir(root);
  const cacheReport = gcDirectory(cacheDir, { days, force, nowMs });
  const tmpReport = gcDirectory(sandboxDir, { days, force, nowMs });
  return {
    repoRoot: root,
    days: Math.max(0, Number(days)),
    force: Boolean(force),
    cache: cacheReport,
    tmp: tmpReport,
    removedCount: cacheReport.removed.length + tmpReport.removed.length,
    skippedActiveCount: cacheReport.skippedActive.length + tmpReport.skippedActive.length,
    skippedSymlinkCount: cacheReport.skippedSymlink.length + tmpReport.skippedSymlink.length,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--discover-base-ref') {
    try {
      process.stdout.write(discoverBaseRef(args[1] || process.cwd()));
      process.exit(0);
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
  }
  if (args[0] === '--gc') {
    let repoRoot = '';
    let tmpDir = '';
    let days = 14;
    let force = false;
    let asJson = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--repo-root' && args[i + 1]) repoRoot = args[++i];
      else if (args[i] === '--tmp-dir' && args[i + 1]) tmpDir = args[++i];
      else if (args[i] === '--days' && args[i + 1]) days = Number(args[++i]);
      else if (args[i] === '--force') force = true;
      else if (args[i] === '--json') asJson = true;
    }
    if (!Number.isFinite(days) || days < 0) {
      process.stderr.write('[FAIL-CLOSED] --days 必须是非负数字。\n');
      process.exit(2);
    }
    const res = gcWorkspaceArtifacts({ repoRoot: repoRoot || undefined, tmpDir: tmpDir || undefined, days, force });
    if (asJson) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stdout.write(
        `[✓] GC 完成 (days=${res.days}, force=${res.force}): 清理 ${res.removedCount} 项 ` +
        `(cache=${res.cache.removed.length}, tmp=${res.tmp.removed.length})，` +
        `保护活跃项 ${res.skippedActiveCount}，跳过符号链接 ${res.skippedSymlinkCount}。\n`,
      );
    }
    process.exit(0);
  }
}

module.exports = {
  WORKFLOW_ROOT,
  safeRealpath,
  resolveRepoRoot,
  resolveTmpDir,
  resolveReviewCacheDir,
  resolveLegacyReviewDir,
  resolveCodexHome,
  allocateTempArtifactPath,
  createRunDir,
  isExecutableFile,
  findOnPath,
  activeRuntimeCandidates,
  resolveLoopxExecutable,
  discoverBaseRef,
  sanitizeEvidenceText,
  ACTIVE_PROTECTION_WINDOW_MS,
  gcDirectory,
  gcWorkspaceArtifacts,
};
