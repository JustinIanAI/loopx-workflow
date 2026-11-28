'use strict';
/**
 * P0（G2 锚定纠偏）回归测试
 *
 * 背景：审查管线的主机四门禁（gates()）与 buildEvidenceGraph 此前运行在本地 cwd，
 * 而非 PR 精确 headRefOid。当本地工作区未检出该 PR 的精确 head 时：
 *   ① 四门禁跑的不是 PR 精确代码（把"对的判成 unverified"属于验证层自证失真）；
 *   ② 审查员指认的 PR 新增测试文件在本地 cwd 不存在 → resolveRepoTestPath 返回 null → 错判 unverified。
 *
 * 本组用例验证两条硬约束：
 *   A. 仅当本地 HEAD 与审查目标 headRefOid 一致时才允许本地四门禁实测（localGateAnchor）；
 *   B. buildEvidenceGraph 贯通 repoRoot 后，invariant 测试路径解析与 node --test 执行均锚定 repoRoot。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const {
  localGateAnchor,
  buildSkippedValidation,
} = require(path.join(PROJECT_ROOT, 'skills/code-review/scripts/authentic-review.js'));
const {
  buildEvidenceGraph,
} = require(path.join(PROJECT_ROOT, 'skills/code-review/scripts/evidence-builder.js'));

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function makeTempGitRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-head-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'anchor@test'], dir);
  sh('git', ['config', 'user.name', 'anchor'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'anchor');
  sh('git', ['add', '.'], dir);
  sh('git', ['commit', '-qm', 'init'], dir);
  const head = sh('git', ['rev-parse', 'HEAD'], dir);
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
  return { dir, head };
}

describe('P0/A localGateAnchor：本地 HEAD 与审查目标 headRefOid 一致性门禁', () => {
  test('本地 HEAD == headRefOid 时允许本地四门禁实测', (t) => {
    const { dir, head } = makeTempGitRepo(t);
    const r = localGateAnchor(dir, head);
    assert.strictEqual(r.match, true);
    assert.strictEqual(r.localHead, head);
  });

  test('HEAD 漂移（本地 HEAD != headRefOid）时禁止本地实测（宁缺毋假）', (t) => {
    const { dir } = makeTempGitRepo(t);
    const r = localGateAnchor(dir, 'f'.repeat(40));
    assert.strictEqual(r.match, false);
    assert.ok(r.localHead, '应返回实际本地 HEAD 便于告警');
  });

  test('headRefOid 缺失时禁止本地实测（fail-closed）', (t) => {
    const { dir } = makeTempGitRepo(t);
    assert.strictEqual(localGateAnchor(dir, '').match, false);
    assert.strictEqual(localGateAnchor(dir, null).match, false);
    assert.strictEqual(localGateAnchor(dir, undefined).match, false);
  });
});

describe('P0/B buildEvidenceGraph：repoRoot 锚定 invariant 测试路径解析与执行', () => {
  const CONTRACT = {
    evidence_requirements: [
      {
        evidence_id: 'validation_matrix',
        items_field: 'items',
        item_fields: ['case_id', 'invariant_or_case', 'command_or_check', 'status', 'result', 'required', 'skip_or_failure_reason'],
      },
    ],
  };
  const PLAN = { required_evidence_ids: ['validation_matrix'] };

  function writePassingTest(repoDir) {
    const file = path.join(repoDir, 'tests', 'unit', 'anchor-invariant.test.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      "const test = require('node:test');\nconst assert = require('node:assert');\ntest('anchor invariant holds', () => assert.strictEqual(1, 1));\n",
    );
    return 'tests/unit/anchor-invariant.test.js';
  }

  function callGraph(repoRoot) {
    return buildEvidenceGraph({
      contract: CONTRACT,
      plan: PLAN,
      diff: '',
      headOid: 'a'.repeat(40),
      pr: 1,
      motivation: 'P0 anchor regression',
      validation: [],
      modelEvidence: {
        validation_matrix: {
          items: [
            { case_id: 'changed_invariant_positive', test_path: ['tests/unit/anchor-invariant.test.js'] },
          ],
        },
      },
      repoRoot,
    });
  }

  function invariantRow(graph) {
    const vm = graph.validation_matrix;
    assert.ok(vm && Array.isArray(vm.items), '应产出 validation_matrix.items');
    return vm.items.find(it => it && it.case_id === 'changed_invariant_positive');
  }

  test('repoRoot 下存在通过的测试文件时，invariant 行实测为 passed', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-repo-'));
    t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
    writePassingTest(dir);
    const row = invariantRow(callGraph(dir));
    assert.ok(row, '应产出 changed_invariant_positive 行');
    assert.strictEqual(row.status, 'passed', `应实测通过，实际: ${JSON.stringify(row)}`);
    assert.strictEqual(row.exit_code, 0);
  });

  test('repoRoot 下不存在该测试文件时，invariant 行保持 unverified（不伪造）', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-repo-'));
    t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
    const row = invariantRow(callGraph(dir));
    assert.ok(row);
    assert.strictEqual(row.status, 'unverified');
  });

  test('不传 repoRoot 时回退 process.cwd()：仓库根无该测试 → unverified（模拟修复前错判场景）', () => {
    const graph = buildEvidenceGraph({
      contract: CONTRACT,
      plan: PLAN,
      diff: '',
      headOid: 'a'.repeat(40),
      pr: 1,
      motivation: 'P0 anchor regression (no repoRoot)',
      validation: [],
      modelEvidence: {
        validation_matrix: {
          items: [
            { case_id: 'changed_invariant_positive', test_path: ['tests/unit/anchor-invariant.test.js'] },
          ],
        },
      },
    });
    const row = invariantRow(graph);
    assert.ok(row);
    assert.strictEqual(row.status, 'unverified', 'cwd 解析不到该文件时必须 unverified，证明锚定对象确实改变');
  });
});

describe('C. 跳过本地门禁时的 validation 行（#74 评审 P0）', () => {
  test('HEAD 不匹配 → 四门禁行必须是 unverified/NOT_RUN，不得伪造 failed 与 exit_code', () => {
    const headOid = 'b'.repeat(40);
    const rows = buildSkippedValidation(headOid, [{ name: 'Four Gates', bucket: 'in_progress' }]);
    const gateRows = rows.filter((r) => ['typecheck', 'lint', 'build', 'test'].includes(r.case_id));
    assert.strictEqual(gateRows.length, 4, '四个门禁行必须都在（缺行等于隐瞒「未运行」这一事实）');
    for (const row of gateRows) {
      assert.strictEqual(row.status, 'unverified', `${row.case_id} 未运行时必须 unverified`);
      assert.strictEqual(row.result, 'NOT_RUN');
      assert.strictEqual(row.exit_code, undefined, `${row.case_id} 未运行不得携带 exit_code`);
    }
  });
});

describe('D. evidence graph 的精确 head 守卫（#74 评审 P1）', () => {
  const CONTRACT = {
    evidence_requirements: [
      {
        evidence_id: 'validation_matrix',
        items_field: 'items',
        item_fields: ['case_id', 'invariant_or_case', 'command_or_check', 'status', 'result', 'required', 'skip_or_failure_reason'],
      },
    ],
  };
  const PLAN = { required_evidence_ids: ['validation_matrix'] };

  function runWith(headAnchored) {
    let executed = 0;
    const graph = buildEvidenceGraph({
      contract: CONTRACT,
      plan: PLAN,
      diff: '',
      headOid: 'd'.repeat(40),
      pr: 1,
      motivation: 'evidence graph head guard',
      validation: [],
      modelEvidence: {
        validation_matrix: {
          items: [{ case_id: 'changed_invariant_positive', test_path: ['tests/unit/review-anchor-head.test.js'] }],
        },
      },
      repoRoot: PROJECT_ROOT,
      runNodeTest: () => { executed += 1; return { status: 0 }; },
      headAnchored,
    });
    const row = graph.validation_matrix.items.find((it) => it && it.case_id === 'changed_invariant_positive');
    return { row, executed };
  }

  test('headAnchored=false 时即使测试路径存在也不执行，行必须 unverified', () => {
    const { row, executed } = runWith(false);
    assert.ok(row, '应产出 changed_invariant_positive 行');
    assert.strictEqual(executed, 0, 'HEAD 未锚定时禁止在任何本地代码上执行测试');
    assert.strictEqual(row.status, 'unverified', '非被审查提交上的结果不能算 passed');
    assert.strictEqual(row.exit_code, undefined);
  });

  test('headAnchored=true 时照常执行，作为上一条的对照', () => {
    const { row, executed } = runWith(true);
    assert.strictEqual(executed, 1, '锚定一致时必须真的执行');
    assert.strictEqual(row.status, 'passed');
  });
});
