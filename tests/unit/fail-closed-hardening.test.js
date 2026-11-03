const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOOPX_FLOW = path.join(PROJECT_ROOT, 'bin/loopx-flow');
const REG_PATH = path.join(PROJECT_ROOT, '.loopx/registry.json');

let hadOriginalReg = false;
let originalRegContent = null;

function ensureRegistryFixture() {
  const contractFile = fs.existsSync(path.join(PROJECT_ROOT, 'specs/features/fail-closed-hardening/04-contract.md'))
    ? path.join(PROJECT_ROOT, 'specs/features/fail-closed-hardening/04-contract.md')
    : path.join(PROJECT_ROOT, 'specs/archive/fail-closed-hardening/04-contract.md');
  const contractSha = crypto.createHash('sha256').update(fs.readFileSync(contractFile)).digest('hex');

  fs.mkdirSync(path.dirname(REG_PATH), { recursive: true });
  let reg = { goals: [] };
  if (fs.existsSync(REG_PATH)) {
    try { reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8')); } catch (_) {}
  }
  if (!Array.isArray(reg.goals)) reg.goals = [];
  let g = reg.goals.find(item => item.id === 'fail-closed-hardening-goal' || item.goal_id === 'fail-closed-hardening-goal');
  if (!g) {
    g = {
      id: 'fail-closed-hardening-goal',
      control_plane: { progress_review: { contract_revision: contractSha } }
    };
    reg.goals.push(g);
  } else {
    if (!g.control_plane) g.control_plane = {};
    if (!g.control_plane.progress_review) g.control_plane.progress_review = {};
    g.control_plane.progress_review.contract_revision = contractSha;
  }
  fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2));
}

test.before(() => {
  hadOriginalReg = fs.existsSync(REG_PATH);
  if (hadOriginalReg) {
    try { originalRegContent = fs.readFileSync(REG_PATH, 'utf8'); } catch (_) {}
  }
  ensureRegistryFixture();
});

test.after(() => {
  if (hadOriginalReg && originalRegContent !== null) {
    fs.writeFileSync(REG_PATH, originalRegContent);
  } else if (!hadOriginalReg && fs.existsSync(REG_PATH)) {
    fs.unlinkSync(REG_PATH);
  }
});

test('1. ADR-003: gate verify pr is retired and must be rejected', () => {
  const res = spawnSync(LOOPX_FLOW, ['gate', 'verify', 'pr', 'fail-closed-hardening'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 1, 'Calling retired pr gate must exit with code 1');
  assert.match(res.stderr + res.stdout, /未知守卫阶段|可选: decisions, contract/, 'Must show decisions or contract as valid stages');
});

test('2. ADR-002: Double-anchored Contract Gate: passes on matching SHA256', () => {
  const res = spawnSync(LOOPX_FLOW, ['gate', 'verify', 'contract', 'fail-closed-hardening'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 0, 'Matching contract SHA256 and approved marker must pass');
  assert.match(res.stdout, /阶段 4 契约冻结签名通过|契约双重锚定核验通过/, 'Must confirm contract gate pass');
});

test('3. ADR-002: Double-anchored Contract Gate: fails closed on tampered contract SHA256', () => {
  const contractFile = fs.existsSync(path.join(PROJECT_ROOT, 'specs/features/fail-closed-hardening/04-contract.md'))
    ? path.join(PROJECT_ROOT, 'specs/features/fail-closed-hardening/04-contract.md')
    : path.join(PROJECT_ROOT, 'specs/archive/fail-closed-hardening/04-contract.md');
  const originalContent = fs.readFileSync(contractFile, 'utf8');

  try {
    fs.writeFileSync(contractFile, originalContent + "\n<!-- Tampered modification -->");

    const res = spawnSync(LOOPX_FLOW, ['gate', 'verify', 'contract', 'fail-closed-hardening'], {
      encoding: 'utf8'
    });
    assert.strictEqual(res.status, 1, 'Tampered contract must fail gate check');
    assert.match(res.stderr + res.stdout, /契约已被篡改|CONTRACT_TAMPERED|指纹不一致/, 'Must alert contract tampering');
  } finally {
    fs.writeFileSync(contractFile, originalContent);
  }
});

test('4. ADR-005: package.json and environment version alignment', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '2.0.0', 'package.json version must be aligned to 2.0.0');
  assert.ok(pkg.engines && pkg.engines.node, 'package.json must declare engines.node');
  assert.match(pkg.engines.node, />=22\.22\.3/, 'Node engine must require >=22.22.3');
});

test("5. ADR-002: Double-anchored Contract Gate: fails closed when contract_revision is missing in registry", () => {
  ensureRegistryFixture();
  const currentReg = fs.readFileSync(REG_PATH, "utf8");
  try {
    const reg = JSON.parse(currentReg);
    const g = reg.goals?.find(item => item.id === "fail-closed-hardening-goal" || item.goal_id === "fail-closed-hardening-goal");
    if (g && g.control_plane?.progress_review) {
      g.control_plane.progress_review.contract_revision = "";
    }
    fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2));

    const res = spawnSync(LOOPX_FLOW, ["gate", "verify", "contract", "fail-closed-hardening"], {
      encoding: "utf8"
    });
    assert.strictEqual(res.status, 1, "Must fail gate check when contract_revision is empty in registry");
    assert.match(res.stderr + res.stdout, /MISSING_LOCKED_CONTRACT_REVISION|尚未在 LoopX 控制面锁定指纹/, "Must output missing revision error");
  } finally {
    ensureRegistryFixture();
  }
});
