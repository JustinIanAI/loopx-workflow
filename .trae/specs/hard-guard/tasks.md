# Feature Contract & Tasks: hard-guard

- **Contract-Status**: `FROZEN & APPROVED`
- **Feature Branch**: `feature/hard-enforcement-guard`
- **Base PRD**: `docs/prd/hard-guard-prd.md`
- **Decisions**: `docs/decisions/hard-guard-decisions.md`

---

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
export type HardGuardStage = 'decisions' | 'contract' | 'pr';

export interface GateVerificationResult {
  stage: HardGuardStage;
  targetRef: string;
  passed: boolean;
  requiredMarker: string;
  observedMarker?: string;
  errorMessage?: string;
}

export interface MergeAuditRecord {
  prId: string;
  headSha: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'OFFLINE_BYPASS';
  operator: string;
  timestamp: string;
  reason?: string;
}

/**
 * 契约不变量断言 (Invariants):
 * 1. reviewDecision !== 'APPROVED' 时，执行 merge 必须 exit 1 阻断，绝不允许调用任何合并 API。
 * 2. decisions.md 缺失 "Status: APPROVED BY HUMAN" 时，gate 检查必须 exit 1。
 * 3. tasks.md 缺失 "Contract-Status: FROZEN & APPROVED" 时，gate 检查必须 exit 1。
 * 4. 当前 Git 分支为 main 时，pre-commit 钩子必须 exit 1 拒绝 commit。
 */
```

---

## 2. 任务清单 (Tasks)
- [x] 【✅】t1: 编写 Git 主干提交防直推钩子 `scripts/git-hooks/pre-commit` 并在 `scripts/workflow-init.sh` 挂载
- [x] 【✅】t2: 在 `bin/loopx-flow` 中新增 `gate verify` 子命令支持阶段签名校验
- [x] 【✅】t3: 改造 `bin/loopx-flow merge` 为绝对 Fail-Closed 阻断机制
- [x] 【✅】t4: TDD 红绿循环，编写 `tests/unit/guard.test.js` 并验证四大门禁 100% 全绿
- [x] 【✅】t5: 阶段 6 L1 代码级审查 (0 阻断项)
- [ ] 【 】t6: 阶段 7 交付级审查，呈报 8 项事实核验表等待人类 Approve
