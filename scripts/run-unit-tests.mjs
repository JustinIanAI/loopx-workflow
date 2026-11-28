#!/usr/bin/env node
// Discover tests/unit/**/*.test.js in stable UTF-8 order and run them with
// node --test. A directory argument, when present and not a flag, overrides
// the scan root; every remaining argument is passed through to node --test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function defaultUnitRoot() {
  return fileURLToPath(new URL('../tests/unit/', import.meta.url));
}

function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function isHelpersDir(entry) {
  return entry.isDirectory() && entry.name === 'helpers';
}

// rootDir is the unit-test root (normally <repo>/tests/unit). Returns absolute
// paths sorted by their POSIX relative path in UTF-8 byte order.
export function discoverUnitTests(rootDir) {
  const root = path.resolve(rootDir);
  const relativePaths = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isHelpersDir(entry)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        relativePaths.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }

  walk(root);
  relativePaths.sort(compareUtf8);
  return relativePaths.map((rel) => path.join(root, ...rel.split('/')));
}

export function parseRunnerArgs(argv, fallbackRoot = defaultUnitRoot()) {
  const extraArgs = argv.slice();
  let rootDir = fallbackRoot;
  if (extraArgs.length > 0 && !extraArgs[0].startsWith('-')) {
    const candidate = path.resolve(extraArgs[0]);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      rootDir = candidate;
      extraArgs.shift();
    }
  }
  return { rootDir, extraArgs };
}

// `node --test` picks its default reporter by Node major version, and the
// shape differs when stdout is a pipe rather than a TTY (Node 22 emits TAP:
// `# fail 0`; newer majors emit spec: `ℹ fail 0`). Callers that assert on
// runner output need one stable contract, so pin TAP unless the caller asked
// for a specific reporter.
export function resolveTestReporterArgs(extraArgs = []) {
  const explicit = extraArgs.some(
    (arg) => arg === '--test-reporter' || arg.startsWith('--test-reporter='),
  );
  return explicit ? [] : ['--test-reporter=tap'];
}

export function runUnitTests(rootDir, extraArgs = [], options = {}) {
  const files = discoverUnitTests(rootDir);
  const stderr = options.stderr || process.stderr;
  if (files.length === 0) {
    stderr.write(
      `run-unit-tests: no *.test.js files found under ${path.resolve(rootDir)} `
      + '(helpers/ and non-test files are excluded); refusing to report a false pass\n',
    );
    return 1;
  }

  // Keep NODE_TEST_CONTEXT. Review gates and a few unit tests invoke
  // `npm test` from inside an already-running `node --test`. Stripping the
  // variable starts an independent suite, which discovers those tests again
  // and re-enters `npm test`.
  const result = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    ...extraArgs,
    ...resolveTestReporterArgs(extraArgs),
    ...files,
  ], {
    stdio: options.stdio || 'inherit',
    cwd: options.cwd,
    env: options.env,
  });

  if (result.error) {
    stderr.write(`run-unit-tests: failed to spawn node --test: ${result.error.message}\n`);
    return 1;
  }
  if (result.status === null) {
    stderr.write(`run-unit-tests: node --test terminated by signal ${result.signal || 'unknown'}\n`);
    return 1;
  }
  return result.status;
}

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isDirectExecution()) {
  const { rootDir, extraArgs } = parseRunnerArgs(process.argv.slice(2));
  const code = runUnitTests(rootDir, extraArgs);
  process.exit(code);
}
