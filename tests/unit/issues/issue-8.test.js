'use strict';
/**
 * Issue #8 + Temp Artifact / Path Mapping Remediation 回归守卫：
 *
 * 覆盖：
 *   1. 静态卫生守卫（bin/、scripts/、skills/、lib/）：无 /tmp、os.tmpdir(、裸 mktemp、
 *      which、python3、外部 sleep、CWD 相对 '.loopx/、本机路径，显式豁免须带 # loopx-allow:；
 *   2. .gitignore 与 Git 跟踪边界：.loopx/、.codex/ 已忽略，受跟踪文件零运行态/凭据/本机路径泄露；
 *   3. 生产 temp 分配器并行调用生成唯一路径，互不覆写；
 *   4. lib/paths.sh 与 loopx-flow init：沙箱初始化、无 ${TMPDIR:-/tmp}、BSD mktemp 模板合规；
 *   5. resolveTmpDir 锚定目标 Git 仓库根，不受 process.cwd() 偏移影响；
 *   6. 动态哨兵 + 异构环境冒烟（含空格路径、子目录、master 主干、无 which/python3、空 TMPDIR、隔离 HOME）；
 *   7. D1 附属 worktree 缺 registry 强制 fail-closed，只提示主 checkout 候选，显式 --registry（含空格）放行；
 *   8. D2 loopx-flow gc 并发活跃保护 + 禁止跟随符号链接 + respond-report 缺缓存 fail-closed。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const PATHS_SH = path.join(PROJECT_ROOT, 'lib/paths.sh');
const INGEST = path.join(PROJECT_ROOT, 'skills/code-review/scripts/ingest-to-loopx-quality.js');
const RESPOND = path.join(PROJECT_ROOT, 'skills/code-review/scripts/respond-report.js');
const { allocateTempArtifactPath, resolveTmpDir } = require(INGEST);
const { gcWorkspaceArtifacts } = require(path.join(PROJECT_ROOT, 'lib/paths.js'));

const SCAN_ROOTS = ['bin', 'scripts', 'skills', 'lib'].map((dir) => path.join(PROJECT_ROOT, dir));
const SCAN_EXTENSIONS = new Set(['.js', '.sh']);

const HYGIENE_RULES = [
  { name: 'hardcoded /tmp path', re: /(?:^|[^A-Za-z0-9_.$/\\])\/(?:private\/)?tmp\/[A-Za-z0-9_.${}-]+/ },
  { name: 'os.tmpdir()', re: /\bos\.tmpdir\s*\(|\btmpdir\s*\(/ },
  { name: 'bare mktemp without template', re: /\bmktemp(?:\s+-d)?(?:\s*$|\s*[;&|)]|\s+2>)/ },
  { name: 'non-POSIX which', re: /(?:^|[;&|(\s`$])which\s+[A-Za-z0-9_.-]+/ },
  { name: 'implicit python3', re: /\bpython3\b/ },
  { name: 'external sleep spawn', re: /spawnSync\s*\(\s*['"]sleep['"]/ },
  { name: 'CWD-relative .loopx/', re: /['"]\.loopx\// },
  { name: 'host absolute path', re: /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Z]:\\\\Users\\\\/ },
];

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(entry.name)) || entry.name === 'loopx-flow' || entry.name === 'pre-commit') {
      out.push(full);
    }
  }
  return out;
}

function isCommentOrExplicitAllow(line) {
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
  return /(?:#|\/\/)\s*loopx-allow:\s*\S+/.test(line);
}

test('1. 生产源码（bin/scripts/skills/lib）静态卫生守卫（零豁免旁路）', () => {
  const files = SCAN_ROOTS.flatMap((dir) => walkFiles(dir));
  assert.ok(files.length > 10, `治理扫描应覆盖生产源码，实际文件数: ${files.length}`);

  const offenders = [];
  for (const file of files) {
    const rel = path.relative(PROJECT_ROOT, file);
    if (rel === 'scripts/gate-lint.sh') continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (isCommentOrExplicitAllow(line)) return;
      for (const rule of HYGIENE_RULES) {
        if (rule.re.test(line)) {
          offenders.push(`${rel}:${idx + 1} [${rule.name}]: ${line.trim()}`);
        }
      }
    });
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `生产源码存在临时工件或跨平台路径卫生违规（如需特例须同行加 # loopx-allow: <reason>）:\n${offenders.join('\n')}`
  );
});

test('2. .gitignore 与 Git 跟踪边界：.loopx/.codex/qa-acceptance 不入库且零凭据/本机路径泄露', () => {
  const ignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.loopx\/$/m, '.gitignore 必须整目录忽略项目私有运行态 .loopx/');
  assert.match(ignore, /^\.codex\/$/m, '.gitignore 必须忽略 .codex/');

  for (const probe of ['.loopx/tmp/probe-artifact.json', '.loopx/cache/reviews/1@abc.json', '.loopx/registry.json']) {
    const ignored = spawnSync('git', ['check-ignore', '-q', probe], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    assert.strictEqual(ignored.status, 0, `git check-ignore 必须命中 ${probe}`);
  }

  const leakedRuntime = execFileSync('git', ['ls-files', '.loopx', '.codex', 'qa-acceptance'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  }).trim();
  assert.strictEqual(leakedRuntime, '', `运行态/私有目录禁止被 Git 跟踪: ${leakedRuntime}`);

  const trackedFiles = execFileSync('git', ['ls-files'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const secretViolations = [];
  for (const rel of trackedFiles) {
    if (rel === 'scripts/gate-lint.sh' || rel === 'scripts/git-hooks/pre-commit' || rel.startsWith('tests/') || rel === 'docs/design/temp-artifact-remediation-plan.md') {
      continue;
    }
    const abs = path.join(PROJECT_ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const content = fs.readFileSync(abs, 'utf8');
    if (/\b(?:oc|ou)_[0-9a-f]{32}\b|\bcli_[0-9a-f]{16}\b/.test(content)) {
      secretViolations.push(`${rel}: Feishu ID/app_id literal`);
    }
    if (/"(?:base_token|app_secret)"\s*:\s*"(?!\*{2,}"|\s*"|<)[A-Za-z0-9_-]{8,}"/.test(content)) {
      secretViolations.push(`${rel}: Feishu secret/token literal`);
    }
    if (!rel.startsWith('skills/systematic-debugging/') && /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/.test(content)) {
      secretViolations.push(`${rel}: host absolute path`);
    }
  }
  assert.deepStrictEqual(secretViolations, [], `受跟踪文件存在凭据或本机绝对路径泄露:\n${secretViolations.join('\n')}`);
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
  const pathsSh = fs.readFileSync(PATHS_SH, 'utf8');

  const initStart = script.indexOf('cmd_init()');
  const initEnd = script.indexOf('sync_global_required()');
  assert.ok(initStart >= 0 && initEnd > initStart, '应能在 bin/loopx-flow 中定位 cmd_init()');
  const initSection = script.slice(initStart, initEnd);
  assert.match(initSection, /\.loopx\/tmp/, 'loopx-flow init 必须创建 .loopx/tmp/');
  assert.match(pathsSh, /LOOPX_TMP_DIR="\$\{LOOPX_TMP_DIR:-\$EFFECTIVE_ROOT\/\.loopx\/tmp\}"/, 'lib/paths.sh 应支持 LOOPX_TMP_DIR 覆盖沙箱目录');
  assert.strictEqual(script.includes('${TMPDIR:-/tmp}'), false, 'PR 正文临时文件不得回退到系统 /tmp');
  assert.match(script, /--body-file -/, 'PR 正文发布应优先走 stdin 流式传递而非临时文件');

  // BSD mktemp (macOS) 要求模板末尾必须以 X 结尾，不能带 .log / .md 后缀。
  const fastPush = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts/fast-fix-push.sh'), 'utf8');
  for (const [label, src] of [['bin/loopx-flow', script], ['lib/paths.sh', pathsSh], ['scripts/fast-fix-push.sh', fastPush]]) {
    const badTemplates = [...src.matchAll(/mktemp\s+(?:-d\s+)?["']([^"']*XXXXXX[^"']+)["']/g)]
      .map((m) => m[1])
      .filter((tpl) => !tpl.endsWith('X'));
    assert.deepStrictEqual(badTemplates, [], `${label} 的 mktemp 模板必须以 X 结尾以兼容 macOS BSD mktemp`);
  }

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsd-mktemp-probe-'));
  try {
    const res = spawnSync('mktemp', [path.join(probeDir, 'pr-body-test.XXXXXX')], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `宿主 mktemp 必须成功创建无后缀模板: ${res.stderr}`);
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
});

test('5. resolveTmpDir 锚定在仓库根目录 .loopx/tmp，不受 process.cwd() 偏移影响', () => {
  const prevOverride = process.env.LOOPX_TMP_DIR;
  const prevCwd = process.cwd();
  delete process.env.LOOPX_TMP_DIR;
  try {
    process.chdir(path.join(PROJECT_ROOT, 'skills/code-review'));
    assert.strictEqual(resolveTmpDir(), path.join(PROJECT_ROOT, '.loopx/tmp'));
  } finally {
    process.chdir(prevCwd);
    if (prevOverride !== undefined) process.env.LOOPX_TMP_DIR = prevOverride;
  }
});

test('6. 动态哨兵 + 异构环境冒烟：含空格路径/子目录/master 主干/空 TMPDIR/隔离 HOME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx smoke '));
  const repo = path.join(root, 'repo with spaces');
  const subDir = path.join(repo, 'nested', 'sub dir');
  const sentinelTmp = path.join(root, 'sentinel tmp');
  const flowTmp = path.join(root, 'flow tmp');
  const fakeHome = path.join(root, 'fake home');
  const mockBin = path.join(root, 'mock bin');
  try {
    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(sentinelTmp, { recursive: true });
    fs.mkdirSync(flowTmp, { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(mockBin, { recursive: true });

    execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'smoke@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Smoke'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), '# smoke\n');
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
      name: 'smoke-repo',
      scripts: { typecheck: 'echo ok', lint: 'echo ok', build: 'echo ok', test: 'echo ok' },
    }, null, 2));
    for (const d of ['specs/features', 'specs/archive', 'docs/design', 'docs/guides', 'tests/unit', 'tests/unit/issues', 'scripts', 'skills', 'bin']) {
      fs.mkdirSync(path.join(repo, d), { recursive: true });
    }
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/master', 'HEAD'], { cwd: repo });

    // 最小化 PATH（故意排除 which 与 python3），仅提供基础 POSIX 工具、node、git 与 mock loopx
    const keepBins = ['bash', 'sh', 'env', 'git', 'node', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'sed', 'awk', 'grep', 'cut', 'tr', 'mktemp', 'dirname', 'basename', 'date', 'chmod', 'ls', 'find', 'head', 'tail', 'wc', 'sort', 'uname'];
    for (const tool of keepBins) {
      const whichRes = spawnSync('/usr/bin/env', ['sh', '-c', `command -v ${tool}`], { encoding: 'utf8' });
      const p = (whichRes.stdout || '').trim();
      if (p && fs.existsSync(p)) {
        const dst = path.join(mockBin, tool);
        if (!fs.existsSync(dst)) fs.symlinkSync(p, dst);
      }
    }
    fs.writeFileSync(path.join(mockBin, 'gh'), '#!/usr/bin/env bash\nif [[ "$1" == "api" && "$2" == "rate_limit" ]]; then echo \'{"resources":{"core":{"limit":5000,"remaining":5000},"graphql":{"limit":5000,"remaining":5000}}}\'; exit 0; fi\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(mockBin, 'npm'), '#!/usr/bin/env bash\necho ok\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(mockBin, 'loopx'), `#!/usr/bin/env bash
if [[ "$1" == "doctor" ]]; then
  printf '%s' '{"ok":true,"checks":[{"id":"installed_required_skills","ok":true,"applicable":true},{"id":"installed_required_skill_routes","ok":true,"applicable":true}],"skills":{"loopx-project":{"exists":true,"required_phrases":true,"route_conflict":false}},"install_freshness":{"status":"fresh","requires_upgrade":false},"skill_delivery":{"status":"ready"}}'
  exit 0
fi
printf '{"ok":true,"goals":[]}'
exit 0
`, { mode: 0o755 });

    const env = {
      ...process.env,
      PATH: mockBin,
      TMPDIR: sentinelTmp,
      LOOPX_TMP_DIR: flowTmp,
      HOME: fakeHome,
      CODEX_HOME: path.join(fakeHome, '.codex'),
    };
    const docRes = spawnSync(LOOPX_FLOW, ['doctor'], { cwd: subDir, env, encoding: 'utf8' });
    assert.strictEqual(docRes.status, 0, `含空格子目录 doctor 必须成功: ${docRes.stdout}\n${docRes.stderr}`);
    assert.deepStrictEqual(fs.readdirSync(sentinelTmp), [], 'TMPDIR 哨兵目录必须保持完全为空');
    assert.deepStrictEqual(fs.readdirSync(flowTmp), [], '成功路径下 LOOPX_TMP_DIR 必须自动清理为空');

    const initScript = path.join(PROJECT_ROOT, 'scripts/workflow-init.sh');
    const initRes = spawnSync(initScript, [], { cwd: subDir, env, encoding: 'utf8' });
    assert.strictEqual(initRes.status, 0, `含空格子目录 workflow-init 必须成功: ${initRes.stdout}\n${initRes.stderr}`);
    const skillsDir = path.join(fakeHome, '.codex', 'skills');
    assert.strictEqual(fs.existsSync(skillsDir), false, '未传 --link-global-skills 时不得默认写入 $HOME/.codex/skills');
    assert.match(fs.readFileSync(initScript, 'utf8'), /--link-global-skills/, 'workflow-init.sh 必须将全局 skills 挂载改为 --link-global-skills opt-in');
    assert.deepStrictEqual(fs.readdirSync(sentinelTmp), [], 'workflow-init 后 TMPDIR 哨兵目录仍必须保持为空');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('7. D1 附属 worktree 缺 registry 强制 fail-closed 且支持含空格 --registry 显式指定', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx wt '));
  const mainRepo = path.join(root, 'main checkout');
  const wtRepo = path.join(root, 'linked wt');
  const mockBin = path.join(root, 'bin');
  try {
    fs.mkdirSync(mainRepo, { recursive: true });
    fs.mkdirSync(mockBin, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: mainRepo });
    execFileSync('git', ['config', 'user.email', 'wt@example.com'], { cwd: mainRepo });
    execFileSync('git', ['config', 'user.name', 'WT'], { cwd: mainRepo });
    fs.writeFileSync(path.join(mainRepo, 'README.md'), '# main\n');
    execFileSync('git', ['add', 'README.md'], { cwd: mainRepo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: mainRepo });

    const mainReg = path.join(mainRepo, '.loopx', 'registry.json');
    fs.mkdirSync(path.dirname(mainReg), { recursive: true });
    fs.writeFileSync(mainReg, JSON.stringify({ schema_version: '0.1', goals: [] }, null, 2));

    execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt-branch', wtRepo], { cwd: mainRepo });

    const regLog = path.join(root, 'loopx-args.log');
    fs.writeFileSync(path.join(mockBin, 'loopx'), `#!/usr/bin/env bash
printf '%s\n' "$@" > ${JSON.stringify(regLog)}
echo '{"goals":[]}'
exit 0
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${mockBin}:${process.env.PATH || ''}` };

    const failRes = spawnSync(LOOPX_FLOW, ['todo', 'list'], { cwd: wtRepo, env, encoding: 'utf8' });
    assert.notStrictEqual(failRes.status, 0, '附属 worktree 缺 registry 必须 fail-closed');
    assert.match(failRes.stderr, /当前 worktree 无 LoopX registry/, '必须明确提示 worktree 缺 registry');
    assert.ok(failRes.stderr.includes('main checkout/.loopx/registry.json'), '应提示主 checkout 候选路径');
    assert.strictEqual(fs.existsSync(regLog), false, 'fail-closed 时不得调用 loopx');

    const okRes = spawnSync(LOOPX_FLOW, ['--registry', mainReg, 'todo', 'list'], { cwd: wtRepo, env, encoding: 'utf8' });
    assert.strictEqual(okRes.status, 0, `显式 --registry 必须成功: ${okRes.stdout}\n${okRes.stderr}`);
    const loggedArgs = fs.readFileSync(regLog, 'utf8').trim().split('\n');
    assert.strictEqual(loggedArgs[0], '--registry');
    assert.strictEqual(loggedArgs[1], mainReg, '含空格的 --registry 路径不得被拆词');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('8. D2 gc 活跃窗口保护与禁止跟随符号链接 + respond-report 缺缓存 fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopx-gc-'));
  const outsideTarget = path.join(root, 'outside-secret');
  const repo = path.join(root, 'repo');
  try {
    fs.mkdirSync(outsideTarget, { recursive: true });
    fs.writeFileSync(path.join(outsideTarget, 'keep.txt'), 'must-not-be-deleted');
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    const tmpDir = path.join(repo, '.loopx', 'tmp');
    const cacheDir = path.join(repo, '.loopx', 'cache', 'reviews');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    const oldDir = path.join(tmpDir, 'old-failed-run');
    const activeDir = path.join(tmpDir, 'active-run');
    const linkDir = path.join(tmpDir, 'symlink-escape');
    const oldCache = path.join(cacheDir, '1@old.json');
    fs.mkdirSync(oldDir);
    fs.mkdirSync(activeDir);
    fs.writeFileSync(oldCache, '{}');
    fs.symlinkSync(outsideTarget, linkDir);

    const now = Date.now();
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldDir, twentyDaysAgo, twentyDaysAgo);
    fs.utimesSync(oldCache, twentyDaysAgo, twentyDaysAgo);

    const rep = gcWorkspaceArtifacts({ repoRoot: repo, days: 14, force: false, nowMs: now });
    assert.strictEqual(fs.existsSync(oldDir), false, '过期运行目录应被清理');
    assert.strictEqual(fs.existsSync(oldCache), false, '过期缓存应被清理');
    assert.strictEqual(fs.existsSync(activeDir), true, '1 小时内活跃运行目录必须受保护');
    assert.strictEqual(rep.skippedActiveCount >= 1, true, '应计入受保护活跃项');
    assert.strictEqual(rep.skippedSymlinkCount >= 1, true, '符号链接必须被跳过');
    assert.strictEqual(fs.existsSync(path.join(outsideTarget, 'keep.txt')), true, '绝不得跟随符号链接删除外部目录');

    const missingRes = spawnSync(process.execPath, [RESPOND, '--pr', '999', '--head', 'deadbeef', '--print'], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.notStrictEqual(missingRes.status, 0, '缺少评审缓存时 respond-report 必须 fail-closed');
    assert.match(missingRes.stderr, /未找到评审缓存|loopx-flow review/, '应提示重跑 loopx-flow review');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
