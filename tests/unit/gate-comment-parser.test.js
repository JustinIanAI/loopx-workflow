'use strict';
/**
 * Issue #92：Gate 授权评论解析必须只有一份实现。
 *
 * Gate1 independent / Gate1 single_owner / Gate2 Mode B 此前各自复制了
 * 「分页 JSON 拆段 → marker 匹配 → key=value 解析 → 身份比较」约 40 行。
 * 本用例锁定收敛结果：新增字段只改 helper 一处，三处调用点只传条件。
 *
 * 范围说明：`agent_comment_ok` 的 reviews/comments 扫描属另一条通道（ADR-0012 决策 2②），
 * 不在本 issue 的授权评论解析范围内。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../bin/loopx-flow'), 'utf8');

function occurrences(needle) {
  return SOURCE.split(needle).length - 1;
}

function functionBody(name) {
  const start = SOURCE.indexOf(`${name}() {`);
  assert.notStrictEqual(start, -1, `${name} 必须存在`);
  const lines = SOURCE.slice(start).split('\n');
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    out.push(lines[i]);
    if (lines[i] === '}') break;
  }
  return out.join('\n');
}

test('三个 Gate 授权函数不再各自内联分页解析', () => {
  for (const name of ['find_gate1_independent_comment', 'find_gate1_single_owner_comment', 'release_authorization_ok']) {
    const body = functionBody(name);
    assert.doesNotMatch(body, /node -e/, `${name} 不得再内联 node 解析器`);
    assert.doesNotMatch(body, /while \(i < raw\.length\)/, `${name} 不得再复制分页拆段循环`);
  }
});

test('三个 Gate 授权路径都调用共享 helper，且 helper 只定义一次', () => {
  assert.strictEqual(occurrences('gate_comment_author "$comments"'), 3);
  assert.strictEqual(occurrences('function gate_comment_author()'), 0, 'bash 风格定义为 name() {，不写成 function 关键字');
  assert.strictEqual(occurrences('\ngate_comment_author() {'), 1);
});

test('三处调用点只传 marker、身份条件与必需字段', () => {
  assert.match(SOURCE, /neq "\$executor" approver[\s\S]*?gate=1 mode=independent/);
  assert.match(SOURCE, /eq "\$accepted_by" approver[\s\S]*?gate=1 mode=single_owner/);
  assert.match(SOURCE, /eq "\$accepted_by" principal[\s\S]*?gate=2 mode=single_owner/);
});
