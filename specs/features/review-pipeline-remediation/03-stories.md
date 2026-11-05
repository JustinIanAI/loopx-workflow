# User Stories & Sizing: review-pipeline-remediation

- **Diff 目标**: ≤500 行（含测试）
- **Feature**: `review-pipeline-remediation`

## Story 1: carryover 逐条裁决

**As** 维护者，**I want** 上轮 findings 每条都有 fixed/reproducible/obsolete，**so that** 不再全部标 reproducible。

- AC1: 模型缺状态 → NOT_VERIFIED。
- AC2: reproducible 存在 → verdict 封顶。
- AC3: carryover 段在 check-result 前进入正文。

## Story 2: 审查者不可用不回退

**As** 决策者，**I want** codex 缺失时 NOT_VERIFIED，**so that** 不静默换模型。

- AC1: 无 codex → exit 1。
- AC2: 显式 --agent-bin claude 可用。

## Story 3: 实际模型声明

**As** 审计者，**I want** Reviewer 行写实际模型，**so that** 不冒充 codex。

- AC1: 默认读 codex config / REVIEW_MODEL。
- AC2: runtime_reported 优先。

## Story 4: 3D 与 follow-up

**As** 维护者，**I want** 3D 评价进入 prompt，并清理 R2 follow-up。

- AC1: THREE_D_EVAL 被 prompt 使用。
- AC2: merge 过滤当前 feature；approve 临时文件 trap。
