const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

test('1. Directory skeleton integrity check', () => {
  const requiredDirs = [
    'docs/decisions',
    'docs/prd',
    'docs/stories',
    'docs/guides',
    '.trae/specs',
    'scripts',
    'skills',
    'bin',
    'tests/unit',
    'tests/unit/issues'
  ];

  for (const dir of requiredDirs) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    assert.strictEqual(
      fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory(),
      true,
      `Directory must exist: ${dir}`
    );
  }
});

test('2. Core 11 AI-Native skills integrity check', () => {
  const coreSkills = [
    'code-review',
    'design-grill',
    'create-prd',
    'strategy-red-team',
    'user-stories',
    'prioritize-features',
    'test-driven-development',
    'loopx-pr-review',
    'loopx-pr-merge',
    'loopx-issue-fix',
    'open-code-review'
  ];

  for (const skill of coreSkills) {
    const skillMd = path.join(PROJECT_ROOT, 'skills', skill, 'SKILL.md');
    assert.strictEqual(
      fs.existsSync(skillMd),
      true,
      `Skill definition file must exist: skills/${skill}/SKILL.md`
    );
    const content = fs.readFileSync(skillMd, 'utf8');
    assert.strictEqual(content.length > 50, true, `Skill file must not be empty: ${skill}`);
    assert.strictEqual(content.includes('name:'), true, `Skill file must declare frontmatter name: ${skill}`);
  }
});

test('3. Pipeline scripts syntax and executable permissions', () => {
  const scripts = [
    'scripts/preflight-check.sh',
    'scripts/workflow-init.sh',
    'scripts/fast-fix-push.sh',
    'scripts/run-ocr-audit.sh',
    'bin/loopx-flow'
  ];

  for (const script of scripts) {
    const fullPath = path.join(PROJECT_ROOT, script);
    assert.strictEqual(fs.existsSync(fullPath), true, `Script must exist: ${script}`);
    
    // Check executable bit
    const stats = fs.statSync(fullPath);
    assert.strictEqual(Boolean(stats.mode & 0o111), true, `Script must be executable: ${script}`);
    
    // Check bash syntax
    assert.doesNotThrow(() => {
      execSync(`bash -n "${fullPath}"`);
    }, `Bash script syntax must be valid: ${script}`);
  }
});

test('4. Open Source assets check (LICENSE, .gitignore, README, templates)', () => {
  const requiredFiles = [
    'LICENSE',
    '.gitignore',
    'README.md',
    'docs/QUICKSTART.md',
    'docs/guides/reviewer-inspection-guide.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/feature_request.md'
  ];

  for (const file of requiredFiles) {
    const fullPath = path.join(PROJECT_ROOT, file);
    assert.strictEqual(fs.existsSync(fullPath), true, `File must exist: ${file}`);
    assert.strictEqual(fs.statSync(fullPath).size > 20, true, `File must not be empty: ${file}`);
  }
});

test('5. CLI orchestrator (loopx-flow) sanity check', () => {
  const loopxFlow = path.join(PROJECT_ROOT, 'bin/loopx-flow');
  const output = execSync(`"${loopxFlow}" --help`, { encoding: 'utf8' });
  assert.strictEqual(output.includes('LoopX AI-Native Flow Orchestrator'), true);
  assert.strictEqual(output.includes('doctor'), true);
  assert.strictEqual(output.includes('start'), true);
  assert.strictEqual(output.includes('todo'), true);
  assert.strictEqual(output.includes('check'), true);
});
