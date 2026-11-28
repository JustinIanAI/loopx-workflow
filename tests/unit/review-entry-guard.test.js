'use strict';
/**
 * #88 回归：authentic-review 入口必须把 main() 的 rejection 收口为
 * `[NOT_VERIFIED]` 诊断标记 + 退出码 1。
 *
 * 为什么要有这组用例：ADR-0017 Stage 1 起 main 是 async。若入口没有 .catch，
 * 一个 rejected promise 会以未捕获拒绝崩溃栈退出——栈里没有 [NOT_VERIFIED]，
 * bin/loopx-flow 与 CI 只能看到「进程异常退出」，无法区分「审查跑完了但没过」
 * 与「审查根本没跑完」。下游的唯一判据就是这两样东西：stderr 标记 + exit 1。
 *
 * 用例分两层：
 *   A. 注入 exit/log 直接驱动 runEntry，断言它的收口语义；
 *   B. 以子进程跑真实实现（runEntry + 默认 exit/log），断言进程级 stderr 与退出码。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, '../../skills/code-review/scripts/authentic-review.js');
const { runEntry } = require(SRC);

const MARKER = '[NOT_VERIFIED] authentic review pipeline aborted:';

function captureSink() {
  const logs = [];
  const exits = [];
  return {
    logs,
    exits,
    log: (msg) => logs.push(msg),
    exit: (code) => exits.push(code),
  };
}

describe('#88/A runEntry 收口语义', () => {
  test('main 抛 Error → 记录 [NOT_VERIFIED] + Error.message，并以 1 退出', async () => {
    const sink = captureSink();
    await runEntry(async () => { throw new Error('boom'); }, sink);
    assert.deepStrictEqual(sink.exits, [1], '必须恰好以退出码 1 结束一次');
    assert.strictEqual(sink.logs.length, 1);
    assert.strictEqual(sink.logs[0], `${MARKER} boom`);
  });

  test('main 抛非 Error（字符串）→ 用 String(err) 收口，不吞诊断', async () => {
    const sink = captureSink();
    await runEntry(() => { throw '字符串失败'; }, sink); // eslint-disable-line no-throw-literal
    assert.deepStrictEqual(sink.exits, [1]);
    assert.strictEqual(sink.logs[0], `${MARKER} 字符串失败`);
  });

  test('main 抛无 message 的对象 → 仍写出可读诊断（String 回退）', async () => {
    const sink = captureSink();
    await runEntry(async () => { throw { code: 'E_FAIL' }; }, sink); // eslint-disable-line no-throw-literal
    assert.deepStrictEqual(sink.exits, [1]);
    assert.strictEqual(sink.logs[0], `${MARKER} [object Object]`);
  });

  test('main 正常返回 → 不写 [NOT_VERIFIED]，不调用 exit', async () => {
    const sink = captureSink();
    await runEntry(async () => 'ok', sink);
    assert.deepStrictEqual(sink.logs, []);
    assert.deepStrictEqual(sink.exits, []);
  });
});

describe('#88/B 入口守卫确实接在 runEntry 上', () => {
  test('require.main 分支调用 runEntry(main)，不得退回裸 main()', () => {
    // 行为用例只证明 runEntry 的语义；这条锚点证明守卫真的用了它。
    // 否则删掉整个守卫块时 A/B 两组仍全绿，「收口被拆掉」会静默通过。
    const src = fs.readFileSync(SRC, 'utf8');
    const guard = src.match(/if \(require\.main === module\) \{[\s\S]*?\n\}/);
    assert.ok(guard, '入口守卫块必须存在');
    assert.match(guard[0], /runEntry\(main\)/);
    assert.doesNotMatch(guard[0], /main\(\)\.catch/);
  });
});

describe('#88/C 进程级：真实实现以 exit 1 + stderr 标记收场', () => {
  function runChild(throwExpr) {
    const code = `require(${JSON.stringify(SRC)}).runEntry(async () => { throw ${throwExpr}; });`;
    return spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  }

  test('rejection → 子进程退出码 1，stderr 含 [NOT_VERIFIED] 标记', () => {
    const r = runChild(`new Error('stage2 rejected')`);
    assert.strictEqual(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /\[NOT_VERIFIED\] authentic review pipeline aborted: stage2 rejected/);
  });

  test('非 Error rejection 同样以退出码 1 + 标记收场', () => {
    const r = runChild(`'plain string rejection'`);
    assert.strictEqual(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /\[NOT_VERIFIED\] authentic review pipeline aborted: plain string rejection/);
  });
});
