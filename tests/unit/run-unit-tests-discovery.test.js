'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const UNIT_ROOT = path.join(PROJECT_ROOT, 'tests', 'unit');
const RUNNER = path.join(PROJECT_ROOT, 'scripts', 'run-unit-tests.mjs');
const RUNNER_URL = pathToFileURL(RUNNER).href;

function loadRunner() {
  return import(RUNNER_URL);
}

function writeFile(root, rel, contents) {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function freshTestEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function listDiskUnitTests(unitRoot) {
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'helpers') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) found.push(path.resolve(full));
    }
  }
  walk(unitRoot);
  return found;
}

test('discoverUnitTests walks fixtures in UTF-8 order and skips helpers and non-tests', async () => {
  const { discoverUnitTests } = await loadRunner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-discover-'));
  try {
    writeFile(root, 'z.test.js', '');
    writeFile(root, 'a.test.js', '');
    writeFile(root, 'issues-m.test.js', '');
    writeFile(root, 'issues/b.test.js', '');
    writeFile(root, 'issues/a.test.js', '');
    writeFile(root, 'issues/m.test.js', '');
    writeFile(root, 'helpers/skip.test.js', '');
    writeFile(root, 'helpers/nested/also.test.js', '');
    writeFile(root, 'issues/helpers/hidden.test.js', '');
    writeFile(root, 'readme.md', '# notes');
    writeFile(root, 'plain.js', 'module.exports = {};');
    writeFile(root, '.gitkeep', '');
    writeFile(root, 'issues/.gitkeep', '');
    writeFile(root, 'issues/notes.md', 'nope');

    const found = discoverUnitTests(root);
    const rels = found.map((full) => path.relative(root, full).split(path.sep).join('/'));
    const expected = [
      'a.test.js',
      'issues-m.test.js',
      'issues/a.test.js',
      'issues/b.test.js',
      'issues/m.test.js',
      'z.test.js',
    ];
    assert.deepStrictEqual(rels, expected);
    assert.deepStrictEqual(rels.slice().sort(compareUtf8), expected);
    assert.ok(!rels.some((rel) => rel === 'helpers/skip.test.js' || rel.includes('/helpers/') || rel.startsWith('helpers/')));
    assert.ok(!rels.some((rel) => rel.endsWith('.md') || rel.endsWith('.gitkeep') || rel === 'plain.js'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('empty directory is fail-closed with a non-zero exit and a stderr error', async () => {
  const { discoverUnitTests, runUnitTests } = await loadRunner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-discover-empty-'));
  const stderrChunks = [];
  try {
    writeFile(root, 'helpers/skip.test.js', '');
    writeFile(root, 'notes.md', '');
    writeFile(root, '.gitkeep', '');
    assert.deepStrictEqual(discoverUnitTests(root), []);

    const code = runUnitTests(root, [], {
      stderr: { write: (chunk) => stderrChunks.push(String(chunk)) },
    });
    assert.notStrictEqual(code, 0);
    assert.match(stderrChunks.join(''), /no \*\.test\.js files found/);

    const cli = spawnSync(process.execPath, [RUNNER, root], { encoding: 'utf8' });
    assert.notStrictEqual(cli.status, 0);
    assert.match(cli.stderr, /no \*\.test\.js files found/);
    assert.strictEqual(cli.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('direct entry passes node --test exit status and stdio, including extra args', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-discover-run-'));
  try {
    writeFile(root, 'alpha.test.js', [
      "'use strict';",
      "const { test } = require('node:test');",
      "test('alpha sentinel', () => {});",
      "test('beta sentinel', () => { throw new Error('beta should be filtered'); });",
    ].join('\n'));
    writeFile(root, 'issues/fail.test.js', [
      "'use strict';",
      "const { test } = require('node:test');",
      "test('issue fail sentinel', () => { throw new Error('expected failure sentinel'); });",
    ].join('\n'));

    const filtered = spawnSync(process.execPath, [RUNNER, root, '--test-name-pattern', 'alpha sentinel'], {
      encoding: 'utf8',
      env: freshTestEnv(),
    });
    assert.strictEqual(filtered.status, 0, filtered.stderr);
    assert.match(filtered.stdout, /alpha sentinel/);
    assert.doesNotMatch(filtered.stdout, /beta sentinel|issue fail sentinel/);

    const failingFile = path.join(root, 'issues', 'fail.test.js');
    const direct = spawnSync(process.execPath, ['--test', '--test-concurrency=1', failingFile], {
      encoding: 'utf8',
      env: freshTestEnv(),
    });
    const via = spawnSync(process.execPath, [RUNNER, path.join(root, 'issues')], {
      encoding: 'utf8',
      env: freshTestEnv(),
    });
    const nested = spawnSync(process.execPath, [RUNNER, root, '--test-name-pattern', 'alpha sentinel'], { encoding: 'utf8' });
    assert.strictEqual(nested.status, 0);
    assert.strictEqual(nested.stdout, '');
    assert.notStrictEqual(direct.status, 0);
    assert.strictEqual(via.status, direct.status);
    assert.match(via.stdout, /expected failure sentinel/);
    assert.match(via.stdout, /# fail [1-9]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repository tests/unit discovery matches every *.test.js except helpers/', async () => {
  const { discoverUnitTests } = await loadRunner();
  const found = discoverUnitTests(UNIT_ROOT).map((full) => path.resolve(full));
  const rels = found.map((full) => path.relative(PROJECT_ROOT, full).split(path.sep).join('/'));
  const disk = listDiskUnitTests(UNIT_ROOT).map((full) => path.resolve(full));

  assert.ok(rels.includes('tests/unit/todo-managed-execution.test.js'));
  assert.ok(rels.includes('tests/unit/review-sandbox-file-input.test.js'));
  assert.ok(rels.includes('tests/unit/run-unit-tests-discovery.test.js'));
  assert.deepStrictEqual(new Set(found), new Set(disk));
  assert.strictEqual(found.length, disk.length);

  const relOrder = rels.map((rel) => rel.slice('tests/unit/'.length));
  assert.deepStrictEqual(relOrder.slice().sort(compareUtf8), relOrder);
  assert.ok(rels.every((rel) => rel.startsWith('tests/unit/') && rel.endsWith('.test.js')));
  assert.ok(!rels.some((rel) => rel.includes('/helpers/')));
});
