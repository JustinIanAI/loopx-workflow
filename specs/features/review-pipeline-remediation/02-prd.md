# Feature PRD Slice: review-pipeline-remediation

- **Feature**: `review-pipeline-remediation`
- **Goal**: `review-pipeline-remediation-goal`
- **Requirements**: `REQ-REVIEW-1`、`REQ-PR-BODY-1`

## 1. 切片范围

修复 review 管线的 carryover 裁决、发布顺序、审查者回退与模型声明，并清理 R2 两项 follow-up。

## 2. 验收准则

1. 有上轮 findings 时，模型必须逐条输出 `fixed/reproducible/obsolete`；缺失/非法 → NOT_VERIFIED。
2. `reproducible` 存在时 verdict 不得为 APPROVE（封顶 REQUEST_CHANGES）。
3. carryover 段必须进入 `review_body` 后再跑 `check-result`；发布的是被校验正文。
4. codex 不可用时默认 NOT_VERIFIED；显式 `--agent-bin claude` 才允许 claude。
5. Reviewer 行记录实际默认模型（`gemini-3.8-flash-high`），不得固定 `codex`。
6. THREE_D_EVAL 注入 prompt，覆盖 delivery/long_horizon/user_experience。
7. issue #23：merge 脏文件过滤只排除当前 feature；approve 临时文件有 trap 清理。
8. 行为测试 ≥25。

## 3. 承重假设

- LoopX check-result 只校验格式/声明；carryover 语义由脚本校验。
- codex 默认模型来自本机 config；`REVIEW_MODEL` 可覆盖用于测试/审计。
