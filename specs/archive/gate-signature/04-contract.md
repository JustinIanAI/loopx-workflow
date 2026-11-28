# 04-Contract: gate-signature（Gate 授权签名面迁移）

- **Contract-Status**: DRAFT (Pending Approval)
- **追溯**：`REQ-GATE-SIGNATURE-1`、`REQ-CHECKPOINT-1`、`REQ-CHECKPOINT-2`、ADR-0019

## 冻结接口

### `bin/loopx-flow`

```bash
current_branch_pr()                                    # -> <PR number> | 空
find_gate1_single_owner_comment <feature> <contract_sha> <spec_commit> <accepted_by>
                                                       # -> <login> | 空
cmd_approve contract <feature> [--prepare|--interactive]
cmd_release_approve <pr> [--prepare|--interactive]
```

### 评论契约

```html
<!-- loopx-flow:gate1-authorization:<feature>@<contract_sha> -->
gate=1;mode=single_owner;contract_sha=<sha>;spec_commit=<sha>;approver=<accepted_by>
```

```html
<!-- loopx-flow:release-authorization:<pr>@<head> -->
gate=2;mode=single_owner;head=<head>;contract_sha=<sha>;principal=<accepted_by>;risk_acceptance=<accepted_by>@<accepted_at>
```

## 断言不变量

1. `--prepare` 不写任何文件/评论、不调用 `configure-goal`。
2. 默认路径找不到合法评论 → 非 0，且不写批准标记 / 授权评论。
3. 评论作者、`contract_sha`、`spec_commit`（Gate1）或 `head`（Gate2）、`mode` 任一不符 → 非 0。
4. `--interactive` 仍要求 TTY；`--yes` 仍非 0。
5. `user_gate` evidence 固定串不变，`gate verify contract` 逻辑不变。
6. 已有合法 `gate=2` 评论时 `release-approve` 不重复写。

## AC 矩阵

| AC | 验收标准 | Story | 验证 |
|---|---|---|---|
| AC-1 | Gate1 `--prepare` 输出模板且零写入 | Story-1 | `gate-github-signature.test.js` |
| AC-2 | `single_owner` 有效 `gate=1` 评论 → 无 TTY 通过 | Story-1 | 同文件 |
| AC-3 | Gate2 `--prepare` 输出模板且零写入 | Story-2 | 同文件 |
| AC-4 | 有效 `gate=2` 评论 → 成功且不重复写 | Story-2 | 同文件 |
| AC-5 | 作者/SHA/`spec_commit` 不符 → 拒绝且不留授权 | Story-3 | 同文件 |
| AC-6 | 无评论且非 `--interactive` → 非 0 并提示 TTY | Story-3 | 同文件 + `adr-0009/0012` 既有用例 |

## Scope

- **包含**：`bin/loopx-flow` 的 `cmd_approve` / `cmd_release_approve` 与两个查找函数；`tests/unit/gate-github-signature.test.js`；`tests/unit/adr-0012-gate2.test.js` 的 mock 适配。
- **不包含**：SSH/GPG 签名；Gate2 readiness / CI 策略；`user_gate` evidence 串变更。

## Verification Plan

```bash
npm run typecheck && npm run lint && npm run build && npm run test
node --test tests/unit/gate-github-signature.test.js tests/unit/adr-0009-gate1-auth.test.js tests/unit/adr-0012-gate2.test.js
```

## 依赖顺序

`Story-1` → `Story-2` → `Story-3`
