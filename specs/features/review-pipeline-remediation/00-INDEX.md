# Feature Capsule: review-pipeline-remediation

- **Feature Name**: `review-pipeline-remediation`
- **Branch**: `feature/review-pipeline-remediation`
- **LoopX Goal**: `review-pipeline-remediation-goal`
- **Current Status**: `Implemented (contract approved; gates green; check pending)`
- **Contract Status**: `FROZEN & APPROVED (SHA256 locked)`
- **Source**: REQ-REVIEW-1 · ADR-0006 · R1/R2 follow-ups (issue #23)

## 过程文档索引

1. [01-decisions.md](01-decisions.md)
2. [02-prd.md](02-prd.md)
3. [03-stories.md](03-stories.md)
4. [04-contract.md](04-contract.md)
5. [05-evidence.md](05-evidence.md)

## 审阅要点

- 上轮 findings 必须逐条 `fixed` / `reproducible` / `obsolete`，并在 `check-result` 之前进入正文；
- codex 不可用时不得隐式回退 claude；显式 `--agent-bin` 才允许；
- Reviewer 行记录实际默认模型（Gemini-3.8-flash-high）；
- 清理 R2 follow-up：merge 脏文件过滤收窄、approve 临时文件 trap。
