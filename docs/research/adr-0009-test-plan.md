# ADR-0009 负向测试计划与首轮结果（research）

> 状态：research；参考实现 `tests/research/adr-0009-reference.js`，测试 `tests/research/adr-0009-reference.test.js`。
> 说明：正式 `bin/loopx-flow` 尚未实现 ADR-0009；本测试验证契约是否可执行，不修改生产命令。

## 覆盖矩阵

| 用例 | 契约点 | 期望 | 首轮结果 |
|---|---|---|---|
| T0 | single_owner 配置 + 匹配 evidence | 成功，写 marker | PASS |
| T1 | 非 TTY approve | 非 0，不写 marker | PASS |
| T2 | `--yes` | 非 0 | PASS |
| T3 | 缺 `loopx-workflow.config.json` | 非 0 | PASS |
| T4 | single_owner 缺风险接受 | 非 0 | PASS |
| T5 | independent Gate1 | 非 0（待 ADR-0012） | PASS |
| T6 | evidence 缺键 | gate verify 非 0 | PASS |
| T7 | decision_outcome=reject | gate verify 非 0 | PASS |
| T8 | contract SHA 变化 | gate verify 非 0 | PASS |
| T9 | 配置/evidence 模式不一致 | gate verify 非 0 | PASS |

## 首轮结果（2026-11-12）

命令：

```bash
node --test tests/research/adr-0009-reference.test.js
```

结果：

```text
# tests 10
# pass 10
# fail 0
# duration_ms 40.506
```

## 全仓测试（附带结果）

- `npm test`：117/118 通过，1 个**既存**失败：`tests/unit/env-governance.test.js` 的 INV-ENV-6 发现真实 `.loopx/registry.json` 中 `e2e-pipeline-demo-goal` 缺 `state_file`。该问题与 ADR-0009 测试无关（测试使用隔离临时目录），但它会阻塞 `loopx migrate-local-state`，需按 ADR-0007 单独治理。
- `npm run lint`：PASS。

## 说明

- 本测试是**参考实现**，正式 wrapper 尚未实现；正式实现落地后需用同一 T1–T9 复跑。
- 参考实现不写 LoopX/registry；只测配置、TTY、evidence 解析与 gate verify 判定。
- T8 当前先命中 `decision_scope_mismatch`（record scope 用的是旧 SHA）；正式实现应按「SHA 变化 → 非 0」报告，不需要区分具体错误码。
