# Feature Capsule: merge-compensation

- **Feature Name**: `merge-compensation`
- **Branch**: `feature/merge-compensation`
- **LoopX Goal**: `merge-compensation-goal`
- **Current Status**: `Implemented (contract approved; gates green; check pending)`
- **Contract Status**: `FROZEN & APPROVED (SHA256 locked)`
- **Source**: ADR-0002 · REQ-GOAL-1 · REQ-FAILCLOSED-1 · REQ-CAPSULE-1

## 过程文档索引

1. [01-decisions.md](01-decisions.md) — 本胶囊实现取舍（链接 ADR-0002）
2. [02-prd.md](02-prd.md) — 需求切片与验收
3. [03-stories.md](03-stories.md) — 故事拆分
4. [04-contract.md](04-contract.md) — 契约与不变量
5. [05-evidence.md](05-evidence.md) — 门禁与收据

## 审阅要点

- 只修 `cmd_merge` 的合入后补偿与幂等；不改 GitHub Approve / readiness / HEAD 二次比对语义。
- 已 MERGED 的 PR 允许重跑补步骤，不得重复 squash，不得在未完成时打印完成。
- stop/retire 的“已执行”必须识别为成功；sync/archive/push 失败必须非 0。
