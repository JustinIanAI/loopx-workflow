# Feature Contract & Tasks: delivery-review-merge-lock

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-28 17:15:57
- **Feature Branch**: feature/delivery-review-merge-lock
- **LoopX Goal**: delivery-review-merge-lock-goal

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
/**
 * LoopX 动态交付审查 (L2) 与合入就绪度物理锁契约
 */
export interface DeliveryReviewMetadata {
  prNumber: number;
  repo: string;
  headBranch: string;
  headOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  targetFeature: string;
  contractSha256: string;
}

export interface DeliveryReviewFiveBlock {
  identityAndScope: {
    targetFeature: string;
    headBranch: string;
    diffSize: string;
    withinLimit: boolean;
  };
  contractConformity: {
    status: 'FROZEN & APPROVED' | 'DRAFT' | 'DRIFTED';
    contractSha256: string;
    breakingChangesCount: number;
  };
  gateEvidence: {
    typecheckPassed: boolean;
    lintPassed: boolean;
    buildPassed: boolean;
    testPassed: boolean;
    changeQualityReceiptVerified: boolean;
  };
  blastRadiusAndCompat: {
    impactedModules: string[];
    antiEntropyApplied: boolean;
  };
  rollbackPlan: {
    strategy: string;
  };
}

export interface MergeReadinessLockResult {
  prNumber: number;
  headOid: string;
  approvedByHuman: boolean;
  loopxReadinessVerified: boolean;
  lockStatus: 'UNLOCKED' | 'BLOCKED';
  reason?: string;
}

/**
 * 契约不变量 (Contract Invariants):
 * 1. [Inv-1]: loopx-flow review 必须基于真实 PR 元数据动态渲染 5-Block 报告，严禁回退为完全静态硬编码文本。
 * 2. [Inv-2]: loopx-flow merge 必须严格核验人类 APPROVED 审批，且调用的 loopx pr-review --check-merge-readiness 严禁加 '|| true' 逃逸。
 * 3. [Inv-3]: 只要合入就绪度物理锁未通过或 HEAD SHA 发生漂移，merge 操作必须立即以 Exit Code 1 阻断。
 */
```

## 2. 任务清单 (Tasks)

- [x] 【✓】t1: 改造 `bin/loopx-flow review` 支持基于真实 PR 与胶囊元数据动态渲染 5-Block 双语审查报告
- [x] 【✓】t2: 改造 `bin/loopx-flow merge` 彻底移除 `loopx pr-review --check-merge-readiness` 上的 `2>/dev/null || true` 逃逸通道
- [x] 【✓】t3: 编写 `tests/unit/delivery-review-merge-lock.test.js` 进行动态审查与物理防偷跑锁阻断测试
- [x] 【✓】t4: 执行四大硬门禁与质量收据核验确保 100% 全绿并通过
