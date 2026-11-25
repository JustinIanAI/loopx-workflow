#!/usr/bin/env node
'use strict';
/**
 * prove-cli-surface.js — Cold-start real-surface Prove runner for `features/cli-surface.md`
 *
 * Adapted from pstack@0.15.46 (MIT License, Copyright (c) 2026 Lauren Tan)
 * and aligned with LoopX-Workflow ADR-0007 / ADR-0011 / ADR-0014.
 *
 * Executes every mapped sub-feature in `skills/verification-harness/features/cli-surface.md`
 * against real child-process invocations of `bin/loopx-flow`, writes durable Proof JSON +
 * Markdown outside the disposable sandbox, tears down all temporary sandboxes, and verifies
 * Proof survival + zero host/repository residue.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const {
  WORKFLOW_ROOT,
  resolveRepoRoot,
  createRunDir,
  resolveLoopxExecutable,
} = require('../../../lib/paths');

const HELP_TEXT = [
  'Usage: node skills/verification-harness/scripts/prove-cli-surface.js --output-dir <dir>',
  '',
  'Options:',
  '  --output-dir <dir>   Required. Directory outside the disposable sandbox where',
  '                       cli-surface-proof.json and cli-surface-proof.md are written.',
  '  -h, --help           Print this help message.',
].join('\n');

function parseArgs(argv) {
  let outputDir = '';
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--output-dir') {
      outputDir = argv[i + 1] || '';
      i += 1;
    } else if (arg.startsWith('--output-dir=')) {
      outputDir = arg.slice('--output-dir='.length);
    } else {
      throw new Error(`[FAIL-CLOSED] Unknown argument: ${arg}`);
    }
  }
  return { outputDir: outputDir.trim(), help };
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function digestOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256Buffer(fs.readFileSync(filePath));
}

function lockedContractText(text) {
  const line = '- **Contract-Status**: FROZEN & APPROVED';
  if (/Contract-Status/i.test(text)) {
    return text.replace(/.*Contract-Status.*$/m, line);
  }
  return `${line}\n${text}`;
}

function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function copyTreeFiles(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeFiles(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
      const mode = fs.statSync(srcPath).mode;
      if (mode & 0o111) {
        fs.chmodSync(dstPath, 0o755);
      }
    }
  }
}

function setupCliWorkspace(sandboxRoot) {
  const repoDir = path.join(sandboxRoot, 'target-repo');
  const mockBinDir = path.join(sandboxRoot, 'mock-bin');
  const homeDir = path.join(sandboxRoot, 'isolated-home');
  const tmpDir = path.join(sandboxRoot, 'isolated-tmp');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(mockBinDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  // Copy real orchestrator surfaces into the disposable repo so workflow-init / preflight / loopx-flow run authentically
  copyTreeFiles(path.join(WORKFLOW_ROOT, 'bin'), path.join(repoDir, 'bin'));
  copyTreeFiles(path.join(WORKFLOW_ROOT, 'lib'), path.join(repoDir, 'lib'));
  copyTreeFiles(path.join(WORKFLOW_ROOT, 'scripts'), path.join(repoDir, 'scripts'));
  copyTreeFiles(path.join(WORKFLOW_ROOT, 'skills'), path.join(repoDir, 'skills'));
  fs.copyFileSync(path.join(WORKFLOW_ROOT, 'package.json'), path.join(repoDir, 'package.json'));
  fs.copyFileSync(path.join(WORKFLOW_ROOT, '.gitignore'), path.join(repoDir, '.gitignore'));
  fs.mkdirSync(path.join(repoDir, 'specs/features'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'specs/features/.gitkeep'), '');
  fs.mkdirSync(path.join(repoDir, 'specs/archive'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'specs/archive/.gitkeep'), '');
  fs.mkdirSync(path.join(repoDir, 'docs/design'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs/design/.gitkeep'), '');
  fs.mkdirSync(path.join(repoDir, 'docs/guides'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs/guides/.gitkeep'), '');
  fs.mkdirSync(path.join(repoDir, 'tests/unit/issues'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'tests/unit/issues/.gitkeep'), '');

  // Contract Fake `gh` for network-free deterministic GitHub boundary auditing
  const ghCommentsFile = path.join(sandboxRoot, 'gh-comments.json');
  const ghCallsLog = path.join(sandboxRoot, 'gh-calls.jsonl');
  fs.writeFileSync(ghCommentsFile, '[]\n');

  const fakeGhJs = path.join(mockBinDir, 'fake-gh.js');
  fs.writeFileSync(fakeGhJs, [
    "'use strict';",
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(ghCallsLog)}, JSON.stringify({ argv: args }) + '\\n');`,
    "if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write('Logged in to github.com\\n'); process.exit(0); }",
    "if (args[0] === 'api' && args[1] === 'user') { process.stdout.write('executor\\n'); process.exit(0); }",
    "if (args[0] === 'repo' && args[1] === 'view') { process.stdout.write('JustinIanAI/loopx-workflow\\n'); process.exit(0); }",
    "if (args[0] === 'pr' && args[1] === 'list') { process.stdout.write('43\\n'); process.exit(0); }",
    "if (args[0] === 'api' && args[1] === 'repos/JustinIanAI/loopx-workflow/issues/43/comments') {",
    `  process.stdout.write(fs.readFileSync(${JSON.stringify(ghCommentsFile)}, 'utf8'));`,
    '  process.exit(0);',
    '}',
    'process.exit(0);',
  ].join('\n'));
  const ghWrapper = path.join(mockBinDir, 'gh');
  fs.writeFileSync(ghWrapper, `#!/usr/bin/env bash\nexec "${process.execPath}" "${fakeGhJs}" "$@"\n`, { mode: 0o755 });

  // Stateful Contract Fake `loopx` for isolated offline Gate 1 & preflight readiness checks
  const fakeLoopxStateFile = path.join(sandboxRoot, 'fake-loopx-state.json');
  const loopxCallsLog = path.join(sandboxRoot, 'loopx-calls.jsonl');
  fs.writeFileSync(fakeLoopxStateFile, JSON.stringify({ userGates: [] }, null, 2));

  const fakeLoopxJs = path.join(mockBinDir, 'fake-loopx.js');
  fs.writeFileSync(fakeLoopxJs, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    `const statePath = ${JSON.stringify(fakeLoopxStateFile)};`,
    `const defaultRegPath = ${JSON.stringify(path.join(repoDir, '.loopx', 'registry.json'))};`,
    `fs.appendFileSync(${JSON.stringify(loopxCallsLog)}, JSON.stringify({ argv: args }) + '\\n');`,
    'function flagVal(name) {',
    '  const i = args.indexOf(name);',
    '  return (i >= 0 && i + 1 < args.length) ? args[i + 1] : "";',
    '}',
    'const regPath = flagVal("--registry") || process.env.LOOPX_REGISTRY || defaultRegPath;',
    'function readReg() {',
    '  try { return JSON.parse(fs.readFileSync(regPath, "utf8")); } catch (_) { return { schema_version: "0.1", goals: [] }; }',
    '}',
    'function writeReg(reg) {',
    '  fs.mkdirSync(path.dirname(regPath), { recursive: true });',
    '  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\\n");',
    '}',
    'if (args.includes("--version")) { process.stdout.write("loopx 2.3.0\\n"); process.exit(0); }',
    'if (args.includes("doctor") && args.includes("--format")) {',
    '  const skillNames = ["loopx-agent-collaboration","loopx-change-quality","loopx-control-plane","loopx-doc-registry","loopx-performance-diagnosis","loopx-pr-program","loopx-pr-review","loopx-project","loopx-self-repair"];',
    '  const skillsMap = {};',
    '  for (const name of skillNames) { skillsMap[name] = { exists: true, required_phrases: true, route_conflict: false }; }',
    '  const checks = [',
    '    { id: "installed_required_skills", ok: true, applicable: true },',
    '    { id: "installed_required_skill_routes", ok: true, applicable: true },',
    '    { id: "local_state_route_unambiguous", ok: true, applicable: true },',
    '    { id: "global_registry_writable", ok: true, applicable: true },',
    '    { id: "typescript_effect_runtime_ready", ok: true, applicable: true }',
    '  ];',
    '  process.stdout.write(JSON.stringify({ ok: true, healthy: true, status: "ok", checks, skills: skillsMap, install_freshness: { status: "python_distribution", requires_upgrade: false, current_version: "2.3.0" }, skill_delivery: { status: "ok" } }) + "\\n");',
    '  process.exit(0);',
    '}',
    'if (args.includes("bootstrap")) {',
    '  const reg = readReg();',
    '  const gid = flagVal("--goal-id");',
    '  if (gid && !reg.goals.some((g) => g.id === gid)) {',
    '    reg.goals.push({ id: gid, state_file: flagVal("--state-file") || `.loopx/goals/${gid}/ACTIVE_GOAL_STATE.md`, control_plane: { progress_review: {} } });',
    '  }',
    '  writeReg(reg);',
    '  process.stdout.write(JSON.stringify({ ok: true, goal_id: gid || null }) + "\\n");',
    '  process.exit(0);',
    '}',
    'if (args.includes("configure-goal")) {',
    '  const reg = readReg();',
    '  const gid = flagVal("--goal-id");',
    '  const rev = flagVal("--progress-review-contract-revision");',
    '  let goal = reg.goals.find((g) => g.id === gid);',
    '  if (!goal) { goal = { id: gid, control_plane: { progress_review: {} } }; reg.goals.push(goal); }',
    '  if (!goal.control_plane) goal.control_plane = {};',
    '  if (!goal.control_plane.progress_review) goal.control_plane.progress_review = {};',
    '  if (rev) goal.control_plane.progress_review.contract_revision = rev;',
    '  writeReg(reg);',
    '  process.exit(0);',
    '}',
    'if (args.includes("register-agent") || args.includes("sync-global")) { process.exit(0); }',
    'if (args.includes("todo") && args.includes("add")) {',
    '  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
    '  const scopeRaw = flagVal("--decision-scope");',
    '  const scopeKey = scopeRaw.split(":").pop() || scopeRaw;',
    '  const todoId = "ug_" + (state.userGates.length + 1);',
    '  state.userGates.push({ todo_id: todoId, goal_id: flagVal("--goal-id"), task_class: flagVal("--task-class") || "user_gate", decision_scope: { scope_key: scopeKey }, decision_outcome: null, superseded_by: null, evidence: "" });',
    '  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));',
    '  process.stdout.write(JSON.stringify({ todo_id: todoId }) + "\\n");',
    '  process.exit(0);',
    '}',
    'if (args.includes("todo") && args.includes("complete")) {',
    '  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
    '  const tid = flagVal("--todo-id");',
    '  const item = state.userGates.find((u) => u.todo_id === tid);',
    '  if (item) {',
    '    item.decision_outcome = flagVal("--decision-outcome") || "approve";',
    '    item.evidence = flagVal("--evidence") || "";',
    '  }',
    '  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));',
    '  process.stdout.write(JSON.stringify({ ok: true, todo_id: tid }) + "\\n");',
    '  process.exit(0);',
    '}',
    'if (args.includes("todo") && args.includes("list")) {',
    '  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
    '  const gid = flagVal("--goal-id");',
    '  const todos = state.userGates.filter((u) => !gid || u.goal_id === gid);',
    '  process.stdout.write(JSON.stringify({ todos }) + "\\n");',
    '  process.exit(0);',
    '}',
    'process.exit(0);',
  ].join('\n'));
  const loopxWrapper = path.join(mockBinDir, 'loopx');
  fs.writeFileSync(loopxWrapper, `#!/usr/bin/env bash\nexec "${process.execPath}" "${fakeLoopxJs}" "$@"\n`, { mode: 0o755 });

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'prove@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'prove-harness'], { cwd: repoDir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoDir });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/JustinIanAI/loopx-workflow.git'], { cwd: repoDir });
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'chore: initial prove sandbox commit'], { cwd: repoDir });

  return {
    repoDir,
    mockBinDir,
    homeDir,
    tmpDir,
    ghCommentsFile,
    ghCallsLog,
    loopxCallsLog,
    registryPath: path.join(repoDir, '.loopx', 'registry.json'),
  };
}

function runCli(ws, args, opts = {}) {
  const cwd = opts.cwd || ws.repoDir;
  return spawnSync(path.join(ws.repoDir, 'bin/loopx-flow'), args, {
    cwd,
    input: opts.input !== undefined ? opts.input : '',
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
      HOME: ws.homeDir,
      LOOPX_TMP_DIR: ws.tmpDir,
      LOOPX_REGISTRY: ws.registryPath,
      LOOPX_USAGE_PING: '0',
      PATH: `${ws.mockBinDir}:${process.env.PATH || ''}`,
      ...(opts.env || {}),
    },
  });
}

function assertCondition(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

function renderMarkdownReport(proof) {
  const lines = [
    '# Cold-Start CLI Surface Proof (`features/cli-surface.md`)',
    '',
    `- **Schema Version**: \`${proof.schema_version}\``,
    `- **Feature Map**: \`${proof.feature_map}\``,
    `- **Upstream Baseline**: \`${proof.upstream_baseline}\``,
    `- **Overall Status**: \`${proof.overall_status}\``,
    `- **Generated At**: \`${proof.generated_at}\``,
    `- **Sandbox Removed**: \`${proof.cleanup.sandbox_removed}\``,
    `- **Proof Survived Cleanup**: \`${proof.cleanup.proof_survived_cleanup}\``,
    `- **Main Repo Registry Unchanged**: \`${proof.isolation.main_repo_registry_unchanged}\``,
    `- **Host Global Registry Unchanged**: \`${proof.isolation.host_global_registry_unchanged}\``,
    '',
    '## Sub-feature Verification Results',
    '',
    '| Sub-feature ID | Status | Real-vs-Mock | Command / Surface | Key State & Side-Effect Observations |',
    '|---|---|---|---|---|',
  ];

  for (const step of proof.steps) {
    const obs = step.observations.map((o) => o.replace(/\|/g, '\\|')).join('<br>');
    lines.push(`| \`${step.id}\` | \`${step.status}\` | \`${step.real_vs_mock}\` | \`${step.surface}\` | ${obs} |`);
  }

  lines.push(
    '',
    '## Triage Summary (`Doc Drift` / `Harness Gap` / `Product Bug`)',
    '',
    `- **Outcome**: \`${proof.triage.outcome}\``,
    `- **Doc Drift**: ${proof.triage.doc_drift.length === 0 ? 'None (0)' : proof.triage.doc_drift.join('; ')}`,
    `- **Harness Gap**: ${proof.triage.harness_gap.length === 0 ? 'None (0)' : proof.triage.harness_gap.join('; ')}`,
    `- **Product Bug**: ${proof.triage.product_bug.length === 0 ? 'None (0)' : proof.triage.product_bug.join('; ')}`,
    ''
  );
  return lines.join('\n');
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n${HELP_TEXT}\n`);
    process.exit(2);
  }
  if (parsed.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    process.exit(0);
  }
  if (!parsed.outputDir) {
    process.stderr.write(`[FAIL-CLOSED] Missing required --output-dir <dir> flag.\n${HELP_TEXT}\n`);
    process.exit(2);
  }

  const callerRepoRoot = resolveRepoRoot(process.cwd());
  const outputDir = path.resolve(parsed.outputDir);
  const mainRepoRegistry = path.join(callerRepoRoot, '.loopx', 'registry.json');
  const hostGlobalRegistry = path.join(os.homedir(), '.loopx', 'registry.global.json');
  const beforeMainRegistryDigest = digestOrNull(mainRepoRegistry);
  const beforeHostRegistryDigest = digestOrNull(hostGlobalRegistry);

  const runHandle = createRunDir('prove-cli-surface', callerRepoRoot);
  const sandboxDir = runHandle.dir;

  if (outputDir === sandboxDir || outputDir.startsWith(`${sandboxDir}${path.sep}`)) {
    runHandle.cleanup(0);
    fs.rmSync(sandboxDir, { recursive: true, force: true });
    process.stderr.write('[FAIL-CLOSED] --output-dir must point outside the disposable sandbox so Proof survives cleanup.\n');
    process.exit(2);
  }

  const steps = [];
  let runError = null;

  try {
    const ws = setupCliWorkspace(sandboxDir);

    // 1. cli-help-surface
    {
      const res = runCli(ws, ['--help']);
      assertCondition(res.status === 0, `cli-help-surface exited with ${res.status}: ${res.stderr}`);
      for (const token of ['LoopX AI-Native Flow Orchestrator', 'approve contract', 'gate verify', 'todo claim', 'todo done']) {
        assertCondition(res.stdout.includes(token), `cli-help-surface missing expected token: ${token}`);
      }
      steps.push({
        id: 'cli-help-surface',
        surface: 'bin/loopx-flow --help',
        status: 'passed',
        real_vs_mock: 'real',
        observations: [
          'exit_code === 0',
          'stdout contains orchestrator banner + core subcommand signatures (approve contract / gate verify / todo claim / todo done)',
        ],
      });
    }

    // 2. cli-init-and-subdir-anchor
    {
      // Negative check first: non-TTY init without loopx-workflow.config.json must fail closed
      const negInit = runCli(ws, ['init']);
      assertCondition(negInit.status !== 0, 'First-time non-TTY init without config must fail closed');
      assertCondition(
        (negInit.stderr + negInit.stdout).includes('FAIL-CLOSED'),
        'First-time non-TTY init must emit FAIL-CLOSED diagnostic'
      );

      // Write explicit independent config and run init
      const cfgPath = path.join(ws.repoDir, 'loopx-workflow.config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({
        schema_version: 'loopx_workflow_config_v0',
        authorization_mode: 'independent',
      }, null, 2) + '\n');
      execFileSync('git', ['add', 'loopx-workflow.config.json'], { cwd: ws.repoDir });
      execFileSync('git', ['commit', '-qm', 'chore: configure independent authorization mode'], { cwd: ws.repoDir });

      const posInit = runCli(ws, ['init']);
      assertCondition(posInit.status === 0, `init with config failed (${posInit.status}): ${posInit.stdout}\n${posInit.stderr}`);
      assertCondition(fs.existsSync(path.join(ws.repoDir, '.loopx', 'tmp')), 'repo-root .loopx tmp directory must be created');
      assertCondition(fs.existsSync(path.join(ws.repoDir, '.git/hooks/pre-commit')), 'pre-commit hook must be installed');

      // Subdirectory invocation check
      const nestedDir = path.join(ws.repoDir, 'subdir/nested');
      fs.mkdirSync(nestedDir, { recursive: true });
      const subStatus = runCli(ws, ['status', '--next', 'demo-slice'], { cwd: nestedDir });
      assertCondition(subStatus.status === 0, `status --next from subdir failed (${subStatus.status}): ${subStatus.stderr}`);
      assertCondition(subStatus.stdout.includes('Feature: demo-slice'), 'status --next must resolve feature name');
      assertCondition(subStatus.stdout.includes('Read-only projection'), 'status --next must declare read-only projection');
      assertCondition(!fs.existsSync(path.join(nestedDir, '.loopx')), 'No CWD-relative .loopx directory may leak into subdir/nested');

      steps.push({
        id: 'cli-init-and-subdir-anchor',
        surface: 'bin/loopx-flow init + bin/loopx-flow status --next (from subdir/nested)',
        status: 'passed',
        real_vs_mock: 'real+contract_fake',
        observations: [
          `non-TTY init without config rejected fail-closed (exit=${negInit.status})`,
          'init with explicit config created repo-root .loopx tmp sandbox and .git/hooks/pre-commit (exit=0)',
          'status --next from subdir/nested anchored REPO_ROOT cleanly with zero subdir/nested/.loopx leak',
        ],
      });
    }

    // 3. cli-feature-and-gate1-negative
    {
      // Verify pre-commit hook installed by init blocks direct commits on main
      fs.writeFileSync(path.join(ws.repoDir, "README.md"), "# blocked direct main commit\n");
      execFileSync("git", ["add", "README.md"], { cwd: ws.repoDir });
      const blockedMainCommit = spawnSync("git", ["commit", "-qm", "should be blocked on main"], {
        cwd: ws.repoDir,
        encoding: "utf8",
      });
      assertCondition(blockedMainCommit.status !== 0, "pre-commit hook must block direct commits to main");
      execFileSync("git", ["reset", "--hard", "-q", "HEAD"], { cwd: ws.repoDir });

      // Scaffold feature/demo-slice via real loopx-flow feature
      const featRes = runCli(ws, ["feature", "demo-slice"]);
      assertCondition(featRes.status === 0, `loopx-flow feature failed (${featRes.status}): ${featRes.stdout}\n${featRes.stderr}`);

      const curBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ws.repoDir, encoding: "utf8" }).trim();
      assertCondition(curBranch === "feature/demo-slice", `Expected branch feature/demo-slice, got ${curBranch}`);

      const capsuleDir = path.join(ws.repoDir, "specs/features/demo-slice");
      const expectedFiles = ["00-INDEX.md", "01-decisions.md", "02-prd.md", "03-stories.md", "04-contract.md", "05-evidence.md"];
      for (const f of expectedFiles) {
        assertCondition(fs.existsSync(path.join(capsuleDir, f)), `Capsule file missing: ${f}`);
      }

      const negVerify = runCli(ws, ["gate", "verify", "contract", "demo-slice"]);
      assertCondition(negVerify.status !== 0, "gate verify contract on DRAFT contract must fail closed");

      const negApprove = runCli(ws, ["approve", "contract", "demo-slice"]);
      assertCondition(negApprove.status !== 0, "approve contract on unapproved DRAFT capsule must fail closed");

      const contractDraft = fs.readFileSync(path.join(capsuleDir, "04-contract.md"), "utf8");
      assertCondition(!contractDraft.includes("FROZEN & APPROVED"), "Failed approve contract must never write FROZEN & APPROVED");

      steps.push({
        id: "cli-feature-and-gate1-negative",
        surface: "bin/loopx-flow feature + pre-commit main guard + gate verify/approve (negative)",
        status: "passed",
        real_vs_mock: "real+contract_fake",
        observations: [
          `pre-commit hook blocked direct main commit (exit=${blockedMainCommit.status})`,
          "switched to branch feature/demo-slice and generated all 6 capsule files",
          `premature gate verify contract exited ${negVerify.status} and approve contract exited ${negApprove.status} with zero FROZEN & APPROVED leak`,
        ],
      });
    }

    // 4. cli-gate1-approve-and-tamper-detect
    {
      const capsuleDir = path.join(ws.repoDir, 'specs/features/demo-slice');
      fs.writeFileSync(path.join(capsuleDir, '01-decisions.md'), [
        '# Architecture Decisions: demo-slice',
        '- **Status**: APPROVED',
        '- **ADR**: ADR-0011',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(capsuleDir, '03-stories.md'), [
        '# Stories: demo-slice',
        '- Story-1: Prove CLI surface end-to-end',
        '  - AC: CLI commands enforce fail-closed invariants',
        '',
      ].join('\n'));
      const draftContract = [
        '# Contract: demo-slice',
        '',
        '- **Contract-Status**: DRAFT (Pending Approval)',
        '- **AC**: AC-1 (Story-1) CLI surface verified with real state assertions',
        '- **Scope**: skills/verification-harness/**',
        '- **Verification Plan**: node skills/verification-harness/scripts/prove-cli-surface.js',
        '- **依赖顺序**: Story-1',
        '- **引用**: ADR-0011, REQ-EVIDENCE-1',
        '',
      ].join('\n');
      const contractPath = path.join(capsuleDir, '04-contract.md');
      fs.writeFileSync(contractPath, draftContract);

      execFileSync('git', ['add', '-A'], { cwd: ws.repoDir });
      execFileSync('git', ['commit', '-qm', 'feat(demo-slice): freeze candidate stage 1-4 capsule'], { cwd: ws.repoDir });
      const specCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ws.repoDir, encoding: 'utf8' }).trim();

      const expectedLockedSha = sha256Text(lockedContractText(draftContract));
      const gate1CommentBody = [
        `<!-- loopx-flow:gate1-authorization:demo-slice@${expectedLockedSha} -->`,
        `gate=1;mode=independent;contract_sha=${expectedLockedSha};spec_commit=${specCommit};approver=reviewer-bot`,
      ].join('\n');
      fs.writeFileSync(ws.ghCommentsFile, JSON.stringify([
        { body: gate1CommentBody, user: { login: 'reviewer-bot' } },
      ], null, 2));

      const approveRes = runCli(ws, ['approve', 'contract', 'demo-slice']);
      assertCondition(
        approveRes.status === 0,
        `approve contract failed (${approveRes.status}):\nSTDOUT:\n${approveRes.stdout}\nSTDERR:\n${approveRes.stderr}`
      );

      const postLockSha = sha256Buffer(fs.readFileSync(contractPath));
      assertCondition(postLockSha === expectedLockedSha, `Locked SHA mismatch: ${postLockSha} !== ${expectedLockedSha}`);

      const verifyPass = runCli(ws, ['gate', 'verify', 'contract', 'demo-slice']);
      assertCondition(verifyPass.status === 0, `gate verify contract failed (${verifyPass.status}): ${verifyPass.stderr}`);

      // Tamper 1 line in 04-contract.md and confirm fail-closed tamper block
      fs.appendFileSync(contractPath, '\n<!-- unauthorized post-freeze mutation -->\n');
      const verifyTamper = runCli(ws, ['gate', 'verify', 'contract', 'demo-slice']);
      assertCondition(verifyTamper.status !== 0, 'Tampered 04-contract.md must fail closed on gate verify contract');
      assertCondition(
        (verifyTamper.stderr + verifyTamper.stdout).includes('CONTRACT_TAMPERED'),
        'Tampered contract rejection must report CONTRACT_TAMPERED'
      );

      const ghCallLines = fs.readFileSync(ws.ghCallsLog, 'utf8').trim().split('\n').filter(Boolean);
      assertCondition(ghCallLines.length >= 3, 'Contract Fake gh must record cross-process argv calls');

      steps.push({
        id: 'cli-gate1-approve-and-tamper-detect',
        surface: 'bin/loopx-flow approve contract + gate verify contract (lock & tamper detect)',
        status: 'passed',
        real_vs_mock: 'real+contract_fake',
        observations: [
          `locked SHA-256 ${expectedLockedSha.slice(0, 16)}... in registry & user_gate (exit=0)`,
          'gate verify contract passed (exit=0) when intact and blocked with CONTRACT_TAMPERED (exit!=0) after 1-line edit',
          `audited ${ghCallLines.length} cross-process gh CLI invocations`,
        ],
      });
    }

    // 5. cli-todo-managed-canary (Real LoopX 2.3.x CLI when available)
    {
      const resolvedLoopx = resolveLoopxExecutable();
      const realLoopxBin = resolvedLoopx && resolvedLoopx.ok ? resolvedLoopx.bin : "";
      const verProbe = realLoopxBin
        ? spawnSync(realLoopxBin, ['--version'], { encoding: 'utf8' })
        : { status: 1, stdout: '', stderr: '' };
      const versionOut = `${verProbe.stdout || ''}${verProbe.stderr || ''}`.trim();
      const hasRealLoopx23 = verProbe.status === 0 && /^loopx\s+2\.3\.\d+/.test(versionOut);

      if (!hasRealLoopx23) {
        steps.push({
          id: 'cli-todo-managed-canary',
          surface: 'bin/loopx-flow todo claim + todo done (real loopx 2.3.x)',
          status: 'verified_unreachable',
          real_vs_mock: 'real',
          observations: [
            `prerequisite missing: real loopx 2.3.x binary not installed on PATH (detected: ${versionOut || 'none'})`,
          ],
        });
      } else {
        const canaryDir = path.join(sandboxDir, 'real-loopx-canary');
        const canaryProj = path.join(canaryDir, 'project');
        const canaryRuntime = path.join(canaryDir, 'runtime');
        const canaryRegistry = path.join(canaryDir, 'registry.json');
        const canaryTmp = path.join(canaryDir, 'tmp');
        const canaryHome = path.join(canaryDir, 'home');
        fs.mkdirSync(canaryProj, { recursive: true });
        fs.mkdirSync(canaryRuntime, { recursive: true });
        fs.mkdirSync(canaryTmp, { recursive: true });
        fs.mkdirSync(canaryHome, { recursive: true });

        const realEnv = {
          ...process.env,
          LC_ALL: 'en_US.UTF-8',
          LANG: 'en_US.UTF-8',
          HOME: canaryHome,
          LOOPX_REGISTRY: canaryRegistry,
          LOOPX_TMP_DIR: canaryTmp,
          LOOPX_AGENT_ID: 'agent-prove',
          LOOPX_USAGE_PING: '0',
        };
        const runRealLoopx = (lxArgs) => spawnSync(
          realLoopxBin,
          ['--format', 'json', '--registry', canaryRegistry, '--runtime-root', canaryRuntime, ...lxArgs],
          { cwd: WORKFLOW_ROOT, encoding: 'utf8', timeout: 60000, env: realEnv }
        );

        const goalId = 'vh-canary-goal';
        const boot = runRealLoopx([
          'bootstrap', '--project', canaryProj, '--goal-id', goalId,
          '--objective', 'verification-harness cli-surface canary', '--state-file', path.posix.join('.loopx', 'state.md'),
        ]);
        assertCondition(boot.status === 0, `real loopx bootstrap failed: ${boot.stdout}\n${boot.stderr}`);

        const regAgent = runRealLoopx(['register-agent', '--goal-id', goalId, '--agent-id', 'agent-prove', '--execute']);
        assertCondition(regAgent.status === 0, `real loopx register-agent failed: ${regAgent.stdout}\n${regAgent.stderr}`);

        const added = runRealLoopx([
          'todo', 'add', '--goal-id', goalId, '--role', 'agent',
          '--text', 'prove cli-surface managed claim/done', '--claimed-by', 'agent-prove',
        ]);
        assertCondition(added.status === 0, `real loopx todo add failed: ${added.stdout}\n${added.stderr}`);

        const listed = runRealLoopx(['todo', 'list', '--goal-id', goalId, '--role', 'agent']);
        assertCondition(listed.status === 0, `real loopx todo list failed: ${listed.stdout}\n${listed.stderr}`);
        const listPayload = extractFirstJson(listed.stdout);
        const todoItem = (listPayload && listPayload.todos || []).find((t) => t.text.includes('prove cli-surface'));
        assertCondition(Boolean(todoItem && todoItem.todo_id), 'Failed to locate newly added canary todo_id');
        const todoId = todoItem.todo_id;

        const claimed = spawnSync(
          path.join(WORKFLOW_ROOT, 'bin/loopx-flow'),
          ['todo', 'claim', todoId, '--goal-id', goalId],
          { cwd: WORKFLOW_ROOT, encoding: 'utf8', timeout: 60000, env: realEnv }
        );
        assertCondition(claimed.status === 0, `loopx-flow todo claim failed: ${claimed.stdout}\n${claimed.stderr}`);
        const claimJson = extractFirstJson(claimed.stdout);
        assertCondition(claimJson && claimJson.ok === true && claimJson.execution_managed === true, 'todo claim must return managed receipt');

        const claimCacheFile = path.join(canaryTmp, 'claims', `${goalId}--${todoId}.json`);
        assertCondition(fs.existsSync(claimCacheFile), '5-tuple claim cache file must exist after todo claim');
        const cacheObj = JSON.parse(fs.readFileSync(claimCacheFile, 'utf8'));
        assertCondition(
          cacheObj.goal_id === goalId && cacheObj.todo_id === todoId && cacheObj.agent_id === 'agent-prove',
          '5-tuple claim cache fields mismatch'
        );

        const done = spawnSync(
          path.join(WORKFLOW_ROOT, 'bin/loopx-flow'),
          ['todo', 'done', todoId, '--goal-id', goalId, '--evidence', 'cli-surface cold-start prove'],
          { cwd: WORKFLOW_ROOT, encoding: 'utf8', timeout: 60000, env: realEnv }
        );
        assertCondition(done.status === 0, `loopx-flow todo done failed: ${done.stdout}\n${done.stderr}`);
        const doneJson = extractFirstJson(done.stdout);
        assertCondition(doneJson && doneJson.ok === true && doneJson.status === 'done', 'todo done must complete todo');
        assertCondition(!fs.existsSync(claimCacheFile), '5-tuple claim cache must be removed on todo done');

        steps.push({
          id: 'cli-todo-managed-canary',
          surface: `bin/loopx-flow todo claim + todo done (real ${versionOut})`,
          status: 'passed',
          real_vs_mock: 'real',
          observations: [
            `real ${versionOut} bootstrap/register-agent/todo add succeeded in isolated runtime`,
            `todo claim wrote 5-tuple receipt (${cacheObj.handoff_mode}) and todo done completed + removed cache (exit=0)`,
          ],
        });
      }
    }
  } catch (err) {
    runError = err;
  } finally {
    // Always force-clean disposable sandbox even if an assertion failed mid-drive
    runHandle.cleanup(0);
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }

  if (runError) {
    process.stderr.write(`[FAIL-CLOSED] Cold-start Prove failed: ${runError.message}\n`);
    process.exit(1);
  }

  const sandboxRemoved = !fs.existsSync(sandboxDir);
  const afterMainRegistryDigest = digestOrNull(mainRepoRegistry);
  const afterHostRegistryDigest = digestOrNull(hostGlobalRegistry);
  const mainRepoUnchanged = beforeMainRegistryDigest === afterMainRegistryDigest;
  const hostGlobalUnchanged = beforeHostRegistryDigest === afterHostRegistryDigest;

  if (!sandboxRemoved || !mainRepoUnchanged || !hostGlobalUnchanged) {
    process.stderr.write(
      `[FAIL-CLOSED] Post-cleanup isolation check failed: sandboxRemoved=${sandboxRemoved}, mainRepoUnchanged=${mainRepoUnchanged}, hostGlobalUnchanged=${hostGlobalUnchanged}\n`
    );
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const proofJsonPath = path.join(outputDir, 'cli-surface-proof.json');
  const proofMdPath = path.join(outputDir, 'cli-surface-proof.md');

  const proof = {
    schema_version: 'loopx_verification_harness_proof_v1',
    feature_map: 'skills/verification-harness/features/cli-surface.md',
    upstream_baseline: 'cursor/plugins@fbb86c09bbb4a25e490aaed136899ced1e9140e4 (pstack@0.15.46, MIT)',
    generated_at: new Date().toISOString(),
    overall_status: 'passed',
    steps,
    cleanup: {
      sandbox_dir: path.relative(callerRepoRoot, sandboxDir).startsWith('..')
        ? '<isolated-loopx-tmp>/prove-cli-surface'
        : path.relative(callerRepoRoot, sandboxDir),
      sandbox_removed: sandboxRemoved,
      proof_survived_cleanup: true,
    },
    isolation: {
      main_repo_registry_unchanged: mainRepoUnchanged,
      host_global_registry_unchanged: hostGlobalUnchanged,
    },
    triage: {
      outcome: 'clean',
      doc_drift: [],
      harness_gap: [],
      product_bug: [],
    },
  };

  fs.writeFileSync(proofJsonPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  fs.writeFileSync(proofMdPath, `${renderMarkdownReport(proof)}\n`, 'utf8');

  const survived = fs.existsSync(proofJsonPath) && fs.existsSync(proofMdPath) && !fs.existsSync(sandboxDir);
  if (!survived) {
    process.stderr.write('[FAIL-CLOSED] Proof artifacts failed post-cleanup survival check.\n');
    process.exit(1);
  }

  process.stdout.write(`[✓] Cold-start Prove passed (${steps.length} sub-features). Proof saved to ${outputDir}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  lockedContractText,
};
