# Feature Contract & Tasks: review-pipeline-remediation

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-11-04 17:59:02
- **Feature Branch**: feature/review-pipeline-remediation
- **LoopX Goal**: review-pipeline-remediation-goal

## 1. 冻结 TypeScript 接口契约

```typescript
export type CarryoverStatus = 'fixed' | 'reproducible' | 'obsolete';

export interface PriorFinding {
  readonly index: number;
  readonly file: string;
  readonly line?: number | null;
  readonly severity?: string;
  readonly summary: string;
}

export interface CarryoverAdjudication {
  readonly finding_index: number;
  readonly status: CarryoverStatus;
  readonly evidence: string;
}

export interface ReviewerDeclaration {
  readonly actor_kind: 'model_agent';
  readonly declaration_source: 'runtime_reported' | 'self_reported';
  readonly declared_model: string;
  readonly declared_provider: string;
}

export interface ReviewResult {
  readonly target_exact_head: string;
  readonly verdict: 'APPROVE' | 'REQUEST_CHANGES';
  readonly review_body: string;
  readonly findings: readonly unknown[];
  readonly reviewer: ReviewerDeclaration;
  readonly carryover: readonly CarryoverAdjudication[];
}

/**
 * 不变量：
 * Inv-1: 上轮 findings 存在时，carryover 必须覆盖每一条，status ∈ fixed/reproducible/obsolete。
 * Inv-2: 缺状态/非法状态 => NOT_VERIFIED，exit 1。
 * Inv-3: 任一 reproducible => verdict 封顶 REQUEST_CHANGES。
 * Inv-4: carryover 段加入 review_body 后，才写 result 并跑 check-result；发布正文 = 被校验正文。
 * Inv-5: codex 不可用 => NOT_VERIFIED；只有 --agent-bin 显式指定才允许 claude。
 * Inv-6: Reviewer.declared_model 优先 runtime_reported，其次 REVIEW_MODEL / codex config 默认模型，不得固定 codex。
 * Inv-7: THREE_D_EVAL 必须进入 prompt（delivery/long_horizon/user_experience）。
 * Inv-8: merge 脏文件过滤只排除当前 feature；approve 临时文件必须 trap 清理。
 */
```

## 2. 任务清单

- [ ] t1: prompt 注入上轮 findings + carryover 输出 schema。
- [ ] t2: 解析/校验 carryover；缺状态 fail-closed。
- [ ] t3: reproducible 封顶；carryover 段在 check-result 前进入正文。
- [ ] t4: 删除隐式 claude 回退。
- [ ] t5: 实际模型解析 + Reviewer 行。
- [ ] t6: THREE_D_EVAL 注入 prompt。
- [ ] t7: issue #23 两项清理。
- [ ] t8: 25+ 行测试 + 四门禁 + 收据。
