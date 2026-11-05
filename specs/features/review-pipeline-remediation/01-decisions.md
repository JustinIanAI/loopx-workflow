# Implementation Decisions: review-pipeline-remediation

- **Status**: APPROVED BY HUMAN (freecisco_yan@2026-11-04 17:59:02)
- **Product decision**: [ADR-0006](../../docs/adr/0006-document-code-change-governance.md) + REQ-REVIEW-1
- **Feature**: review-pipeline-remediation
- **Goal**: review-pipeline-remediation-goal

## 1. 实现取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| carryover 状态 | 由模型逐条输出 `fixed/reproducible/obsolete`，脚本校验 | 删除硬编码 reproducible |
| carryover 发布顺序 | 进入 review_body 后再跑 `check-result` | 原生 output_hint 要求先保存最终正文再校验 |
| 缺状态 | 有上轮 findings 但模型未逐条裁决 → NOT_VERIFIED | fail-closed |
| codex 缺失 | 默认 NOT_VERIFIED；仅 `--agent-bin claude` 显式允许 | 删除隐式回退 |
| Reviewer 模型 | 优先 runtime_reported；否则 `REVIEW_MODEL`/codex config 默认模型 | 记录实际模型 |
| 3D 评价 | 用 THREE_D_EVAL 注入 prompt | 不再留死常量 |
| issue #23 | merge 脏文件过滤收窄到当前 feature；approve 临时文件 trap | 清理 R2 follow-up |

## 2. 不做

- 不伪造 LoopX 原生 runtime evidence。
- 不改 check-result 的格式/声明硬门禁。
