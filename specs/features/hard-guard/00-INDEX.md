# Feature Capsule: hard-guard (阶段守卫与防直推熔断机制)

> **特性定位**：建立主干提交防直推物理钩子、阶段签名校验门禁以及 PR 必须经过 Approve 决议的绝对 Fail-Closed 熔断机制。

---

## 1. 特性元数据与状态
- **Feature Name**: `hard-guard`
- **Target Branch**: `feature/hard-enforcement-guard`
- **LoopX Goal**: `hard-guard-goal`
- **Current Status**: `DELIVERED & VERIFIED`
- **Contract Status**: `FROZEN & APPROVED`

---

## 2. 过程文档索引 (全周期一站式审阅)
1. **[01-decisions.md](01-decisions.md)** - 阶段 1：架构压力测试备忘录（排除 3 个顶级设计分支，确立 Fail-Closed 原则）
2. **[02-prd.md](02-prd.md)** - 阶段 2：精益 PRD 与承重假设验证矩阵（定义 4 项不可变契约与反驳用例）
3. **[03-stories.md](03-stories.md)** - 阶段 3：Job Story 拆解与 Diff 范围约束（单 PR ≤ 500 行，拆解为 6 个原子任务）
4. **[04-contract.md](04-contract.md)** - 阶段 4：TypeScript 接口固化、断言不变量与任务清单
5. **[05-evidence.md](05-evidence.md)** - 阶段 5/6：本地四大硬门禁实测数据与 LoopX 质量凭据

---

## 3. 关键审查要点速览
- **核心契约**：`HardGuardStage` 类型与 `GateVerificationResult` 结构，严禁无 Approved 标记执行合并。
- **本地验证**：`tests/unit/guard.test.js` 100% PASS（覆盖阶段签名校验、pre-commit 钩子阻断、未 Approve 合并拦截）。
