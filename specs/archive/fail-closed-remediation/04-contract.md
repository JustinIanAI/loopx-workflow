# Feature Contract & Tasks: fail-closed-remediation

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-11-04 17:13:22
- **Feature Branch**: feature/fail-closed-remediation
- **LoopX Goal**: fail-closed-remediation-goal
- **Product decisions**: [ADR-0003](../../docs/adr/0003-approve-doctor-sync.md)、[ADR-0004](../../docs/adr/0004-check-goal-identity.md)

## 1. 冻结 TypeScript 接口契约

```typescript
export type FailClosedExitCode = 0 | 1;

export interface DiagnosticCard {
  readonly title: string;
  readonly cause: string;
  readonly impact: string;
  readonly fixCommands: readonly string[];
}

export interface ApprovalLockResult {
  readonly feature: string;
  readonly goalId: string;
  readonly contractSha256: string;
  readonly locked: boolean;
  readonly markerWritten: boolean;
  readonly exitCode: FailClosedExitCode;
}

export interface CheckIdentity {
  readonly feature?: string;
  readonly goalId?: string;
  readonly source: 'argument' | 'branch' | '--goal-id';
}

export interface SyncGlobalResult {
  readonly goalId?: string;
  readonly attempts: number;
  readonly ok: boolean;
  readonly exitCode: FailClosedExitCode;
}

/**
 * 契约不变量：
 * Inv-1: 无 loopx 时 approve 不得写任何批准标记；exitCode 1。
 * Inv-2: 只有 configure-goal 成功后才把带 FROZEN & APPROVED 的最终内容原子写入契约。
 * Inv-3: check 无 feature 且无 --goal-id 时 exitCode 1；不得跳过收据核验后打印成功。
 * Inv-4: 有胶囊且存在 04-contract.md 时，check 先执行 gate verify contract。
 * Inv-5: ingest 无 feature 且无 goal-id 时 exitCode 1；不得回退到 specs/features 第一个目录。
 * Inv-6: feature 在 bootstrap 成功前不创建 ACTIVE_STATE.md；bootstrap 负责创建。
 * Inv-7: sync-global 最多重试 3 次；仍失败 exitCode 1。
 */
```

## 2. 任务清单

- [x] t1: `cmd_feature` 去掉预创建 ACTIVE_STATE，bootstrap 后兜底检查。
- [x] t2: `cmd_approve` 原子锁定/回滚/缺 loopx 即停。
- [x] t3: `cmd_doctor` 缺 loopx 非 0。
- [x] t4: `cmd_check` 身份解析、gate verify、收据目标与成功文案。
- [x] t5: `sync_global_required` helper 并接入 feature/approve。
- [x] t6: `ingest` 删除 entries[0] 回退。
- [x] t7: R1 P2：merge 切 base 前检查脏文件/恢复分支。
- [x] t8: 行为测试 + 四门禁 + 收据。
