# Feature Capsule: fail-closed-remediation

- **Feature Name**: `fail-closed-remediation`
- **Branch**: `feature/fail-closed-remediation`
- **LoopX Goal**: `fail-closed-remediation-goal`
- **Current Status**: `Implemented (contract approved; gates green; check pending)`
- **Contract Status**: `FROZEN & APPROVED (SHA256 locked)`
- **Source**: ADR-0003 · ADR-0004 · REQ-CHECKPOINT-1 · REQ-FAILCLOSED-1 · REQ-CHECK-IDENTITY-1 · issue #17

## 过程文档索引

1. [01-decisions.md](01-decisions.md) — 实现取舍（链接 ADR-0003/0004）
2. [02-prd.md](02-prd.md) — 需求切片与验收
3. [03-stories.md](03-stories.md) — 故事拆分
4. [04-contract.md](04-contract.md) — 契约与不变量
5. [05-evidence.md](05-evidence.md) — 门禁与收据

## 审阅要点

- `approve` 必须先锁定 SHA 再落批准标记；缺 `loopx` 或锁定失败不得留下 APPROVED。
- `doctor` 缺 `loopx` 非 0；`check` 无 Goal 非 0，有胶囊时先跑 `gate verify contract`。
- `feature` 不再预创建 `ACTIVE_STATE.md`，让 `loopx bootstrap` 建立 canonical authority（修复 issue #17）。
- `sync-global` 有限重试后仍失败则非 0。
