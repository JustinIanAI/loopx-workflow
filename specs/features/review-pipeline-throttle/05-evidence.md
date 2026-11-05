# Review Pipeline Throttle 质量凭据（阶段 5/6）

## 门禁实测

| 门禁 | 命令 | 结果 |
|------|------|------|
| Typecheck | `npm run typecheck` (tsc --noEmit) | PASS |
| Lint | `npm run lint` (gate-lint.sh: 10 脚本语法 + JS AST + 入口权限) | PASS |
| Build | `npm run build` (gate-build.sh) | PASS |
| Test | `npm run test` | PASS (89/89, 14 suites) |
| loopx-flow check | 四大门禁 + 语义审查 + 质量适配器 | 门禁全绿；收据回写 BLOCKED |

## 节流专项测试 (T1/T2/T3)

`tests/unit/review-pipeline-throttle.test.js` 全部通过：
- T1 head-oid 幂等短路：同一 pr@head 已有 ok artifact 时，第二次执行不再调 `gh pr view/diff` 与模型执行（零 API 短路，`gh pr view` 共 2 次：起始 + INV2 复核；diff/model 各 1 次仅第一次）。
- T2 comment upsert：`REVIEW_UPSERT_PUBLISH=1` 时，无既有标记走 POST 新建；有标记走 PATCH 更新（不新增 comment）。
- T3 进程内节流：`REVIEW_SHORTCIRCUIT=1` + `REVIEW_DEBOUNCE_SECONDS>0` 且距上次 < debounce 时短路复用。

## 行为不变量（INV）

- INV-T1：短路复用不改变发布结果（正文来自同一 artifact）。
- INV-T2：comment 标记行必须含 `pr@headOid`（`<!-- loopx-flow:review:<pr>@<head> -->`，置于正文尾部，不破坏首行 Reviewer 结构）。
- INV-T3：节流与退避失败一律 fail-closed（非零退出），不静默吞掉。

## 收据回写阻断说明

`loopx-flow check` 的 1/3 四大门禁与 2/3 语义审查/质量适配器均已全绿并同步 05-evidence；
仅 3/3 将 receipt 写入 LoopX goal 控制面时受阻：

```
[BLOCKED] LoopX change-quality record failed:
[Errno 1] Operation not permitted:
'/Users/freecisco_yan/.codex/loopx/goals/review-pipeline-remediation-goal/change-quality/receipts/...json.lock'
```

另：`review-pipeline-throttle-goal` 尚未注册进 LoopX 全局 registry（`loopx start-goal --guided`
在 Agent Identity Gate 处要求显式 agent-id；register-agent 报 goal not found）。
此为环境级阻断（控制面锁 + goal 未注册），非代码缺陷。代码侧四大门禁与语义审查全部通过。

## 改动文件

- `skills/code-review/scripts/authentic-review.js`：THROTTLE 配置 + 短路/退避/upsert 逻辑 + `--force-recheck`
- `bin/loopx-flow`：`cmd_review` 增加 `--force-recheck`、`cmd_respond` upsert、`cmd_review` 注入降载 env
- `tests/unit/review-pipeline-throttle.test.js`：T1/T2/T3 节流单测（新增）
- `specs/features/review-pipeline-throttle/04-contract.md`：契约
- `specs/features/review-pipeline-throttle/01-decisions.md`：实现取舍

## 默认行为回归确认

`tests/unit/authentic-review-pipeline.test.js` 26/26 通过——确认降载三件套均为显式 opt-in
（`REVIEW_SHORTCIRCUIT` / `REVIEW_UPSERT_PUBLISH` / `REVIEW_DEBOUNCE_SECONDS`），
人工本地裸跑 `node authentic-review.js` 时行为与改造前完全一致，不引入回归。
