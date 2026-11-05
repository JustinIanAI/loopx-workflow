# Review Pipeline Throttle 质量凭据（阶段 5/6）

## 门禁实测

| 门禁 | 命令 | 结果 |
|------|------|------|
| Typecheck | `npm run typecheck` (tsc --noEmit) | PASS |
| Lint | `npm run lint` (gate-lint.sh: 10 脚本语法 + JS AST + 入口权限) | PASS |
| Build | `npm run build` (gate-build.sh) | PASS |
| Test | `npm run test` | PASS (96/96, 15 suites；已把 `review-pipeline-throttle.test.js` 纳入 `test:unit` 清单) |
| loopx-flow check | 四大门禁 + 语义审查 + 质量适配器 | 门禁全绿；收据回写 BLOCKED（环境级，见下） |

## 节流专项测试（7 个子用例，全绿）

`tests/unit/review-pipeline-throttle.test.js`：

- **T1a 同 head 幂等**：首次完整管线落盘 artifact；第 2 次仅 1 次 `gh pr view` 后短路。
  实测 `gh pr view`=3（第 1 次 2 次：起始 + INV2 复核；第 2 次 1 次幂等探测），
  `gh pr diff`=1、`loopx pr-review`=1 → 第 2 次**不重取 diff、不重跑模型**。
- **T1b 跨 head 不复用**：预置旧 head 的 ok artifact，当前 head 已漂移 → 不命中幂等，
  模型执行 1 次（防 fail-open：旧 head 结论不得当新 head 发布）。
- **T1c `--force-recheck`**：绕过幂等，强制重跑。
- **T2 comment upsert**：`REVIEW_UPSERT_PUBLISH=1` 下无标记 → `POST`；
  有标记 → `PATCH` 且不再 `gh pr comment`（不堆叠新评论）。
- **T3a 突发合并**：同 PR 上次完整执行 < debounce 且 head 已漂移 → 输出 `合并突发` 等待，
  实测 elapsed ≥ 2s（debounce=3），等待后仍完成 1 次真实评审。
- **T3b 禁用窗口**：`REVIEW_DEBOUNCE_SECONDS=0` → 不等待，立即执行。
- **T3c 429 退避**：`gh api` 首次 429（`retry-after: 0`）→ 重试后成功发布，
  实测 comments GET ≥ 2 次，最终仍走 `gh pr comment`。

## 行为不变量（INV）

- INV-T1：幂等复用不改变发布结果——同一 head 无论跑 1 次还是 N 次，发布的 comment 正文一致。
- INV-T2：upsert 标记行必须含 `pr@headOid`（`<!-- loopx-flow:review:<pr>@<head> -->`，置于正文尾部），
  head 漂移后旧 comment 不匹配、新 comment 被创建；且不破坏首行 Reviewer 结构。
- INV-T3：节流与退避失败一律 fail-closed（非零退出），不静默吞掉。

## 默认行为回归确认

`tests/unit/authentic-review-pipeline.test.js` 26/26 通过。三件套全部为显式 opt-in：

| 开关 | 默认 | 作用 |
|------|------|------|
| `REVIEW_SHORTCIRCUIT` | 关闭 | 开启 head-oid 幂等 + 突发合并 |
| `REVIEW_DEBOUNCE_SECONDS` | 60 | 合流窗口（0 = 禁用等待） |
| `REVIEW_UPSERT_PUBLISH` | 关闭 | 完整管线发布走 upsert（幂等路径恒走 upsert） |
| `REVIEW_BACKOFF_BASE_MS` / `REVIEW_MAX_RETRIES` | 1000 / 3 | 429/503 指数退避 |

人工本地裸跑 `node authentic-review.js --pr N --repo o/r` 行为与改造前完全一致。
`bin/loopx-flow review` 由编排器显式注入 `REVIEW_SHORTCIRCUIT=1`、`REVIEW_DEBOUNCE_SECONDS=60`、
`REVIEW_UPSERT_PUBLISH=1`。

## 收据回写阻断说明（环境级，非代码缺陷）

`loopx-flow check` 的 1/3 四大门禁与 2/3 语义审查/质量适配器均已全绿；
仅 3/3 将 receipt 写入 LoopX goal 控制面时受阻：

```
[BLOCKED] LoopX change-quality record failed:
[Errno 1] Operation not permitted:
'/Users/freecisco_yan/.codex/loopx/goals/review-pipeline-remediation-goal/change-quality/receipts/...json.lock'
```

另：`review-pipeline-throttle-goal` 尚未注册进 LoopX 全局 registry
（`loopx start-goal --guided` 停在 Agent Identity Gate；`register-agent` 报 goal not found），
`loopx-flow approve contract review-pipeline-throttle` 因 `configure-goal` 无法锁定指纹而 FAIL-CLOSED。
两处均为本机 LoopX 控制面状态问题，未修改代码绕过。

## 改动文件

- `skills/code-review/scripts/authentic-review.js`：THROTTLE 配置、`loadReviewArtifact`（head 键控）、
  `listReviewArtifactsForPr`（仅节流计时）、`throttleRemainingMs`、`sleepSync`、`ghApiWithBackoff`、
  `publishReviewCommentUpsert`、`--force-recheck`
- `bin/loopx-flow`：`cmd_review` 注入降载 env + `--force-recheck` 透传；
  `cmd_respond` comment upsert（GET → PATCH / POST）
- `tests/unit/review-pipeline-throttle.test.js`：7 个子用例（新增）
- `package.json`：`test:unit` 纳入新测试文件（用例只增不减）
- `specs/features/review-pipeline-throttle/{01-decisions,04-contract,05-evidence}.md`
