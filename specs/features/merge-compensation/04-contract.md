# Feature Contract & Tasks: merge-compensation

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-11-04 14:57:42
- **Feature Branch**: feature/merge-compensation
- **LoopX Goal**: merge-compensation-goal
- **Product decision**: [ADR-0002](../../docs/adr/0002-merge-compensation.md)

## 1. 冻结 TypeScript 接口契约

```typescript
export type MergeStepName = 'merge' | 'stop' | 'retire' | 'sync' | 'archive' | 'push';

export type MergeStepStatus = 'done' | 'skipped' | 'failed';

export interface MergeCompensationStep {
  readonly name: MergeStepName;
  readonly status: MergeStepStatus;
  readonly detail?: string;
}

export interface MergeCompensationResult {
  readonly prId: number;
  readonly feature?: string;
  readonly alreadyMerged: boolean;
  readonly steps: readonly MergeCompensationStep[];
  readonly allDone: boolean;
  readonly exitCode: 0 | 1;
}

/**
 * 契约不变量：
 * Inv-1: 只有 gh pr view 的 state !== 'MERGED' 且 mergedAt 为空时，才允许调用 gh pr merge。
 * Inv-2: stop/retire 的“已执行”结果识别为 skipped，不得重复写状态。
 * Inv-3: sync/archive/push 任一 failed => exitCode 1，且不得打印完成。
 * Inv-4: allDone === true 当且仅当所有必需步骤为 done/skipped；此时 exitCode 0。
 * Inv-5: 不新增独立状态机；状态来自 PR/Goal/文件系统的可观测事实。
 */
```

## 2. 任务清单

- [ ] t1: 读取 PR `state/mergedAt/reviewDecision/headRefOid`，实现已合并分支。
- [ ] t2: 抽出 stop/retire/sync/archive/push 的可重入步骤与错误识别。
- [ ] t3: 实现本地 base 刷新、archive 提交与 push。
- [ ] t4: 失败输出“已合入、未闭环”与重跑命令；成功才打印完成。
- [ ] t5: 新增 mock 行为测试（MERGED、stop/retire 已执行、sync 失败、archive 幂等、重跑补偿）。
- [ ] t6: 四门禁 + `loopx-flow check` 收据。
