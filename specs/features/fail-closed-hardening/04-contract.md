# Contract & Task Map: fail-closed-hardening

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-30 11:40:16
- **Feature**: fail-closed-hardening
- **Goal-ID**: fail-closed-hardening-goal

## 1. 冻结 TypeScript 接口契约 (Frozen Signatures)

```typescript
/**
 * 结构化终端诊断引导卡片
 */
export interface DiagnosticCard {
  readonly title: string;
  readonly cause: string;
  readonly impact: string;
  readonly fixCommands: readonly string[];
}

/**
 * 契约双重锚定校验元数据
 */
export interface ContractAnchor {
  readonly feature: string;
  readonly contractPath: string;
  readonly currentSha256: string;
  readonly lockedRevisionSha256?: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly status: 'DRAFT' | 'FROZEN & APPROVED' | 'TAMPERED';
}

/**
 * 严格门禁执行阶段（注意: 'pr' 已根据 ADR-003 物理退役）
 */
export type GateVerifyStage = 'decisions' | 'contract';

/**
 * 核心执行断言不变量 (Invariants)
 */
export interface InvariantAssertions {
  // 不变量 1: 分支切换或创建失败必须立即返回退出码 1，绝不在 main 裸跑
  assertBranchCreationFailClosed(exitCode: number, branch: string): boolean;

  // 不变量 2: configure-goal 锁定失败必须立即返回退出码 1，绝不打印审批通过
  assertContractLockFailClosed(exitCode: number, goalId: string): boolean;

  // 不变量 3: 文件当前 SHA256 与已锁定 revision 不一致时，门禁必须一票否决
  assertContractFingerprintIntegrity(currentSha: string, lockedSha: string): boolean;

  // 不变量 4: 请求退役的 pr 门禁时必须报错拒绝 (exitCode != 0)
  assertRetiredPrGateRejected(stage: string): boolean;
}
```

## 2. 核心任务依赖拓扑图 (Task Map)

```
[Task 1: 编写单元测试用例] (tests/unit/fail-closed-hardening.test.js - Failing Repro)
       │
       ▼
[Task 2: bin/loopx-flow Fail-Closed 与诊断卡片改造]
       │
       ├─► 2.1 修复分支创建失败阻断 (cmd_feature)
       ├─► 2.2 修复 Goal 注册失败阻断 (cmd_init / cmd_feature)
       ├─► 2.3 修复契约锁定失败阻断 (cmd_approve)
       └─► 2.4 修复合并后生命周期核销阻断 (cmd_merge)
       │
       ▼
[Task 3: Contract Gate 双重锚定比对逻辑] (cmd_gate contract)
       │
       ▼
[Task 4: 退役 gate verify pr 虚假分支与 Usage 声明净化] (ADR-003)
       │
       ▼
[Task 5: package.json 与 README 版本依赖对齐] (ADR-005)
       │
       ▼
[Task 6: 四大门禁与 change-quality 严格收据验证] (Stage 5/6 闭环)
```
