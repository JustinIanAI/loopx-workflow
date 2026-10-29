# Feature Contract & Tasks: native-dispatch-deep-integration

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-28 17:38:45
- **Feature Branch**: feature/native-dispatch-deep-integration
- **LoopX Goal**: native-dispatch-deep-integration-goal

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
/**
 * LoopX 原生调度深度集成契约 (task-lease / issue-fix / integration-branch)
 */
export interface TodoLeaseFlowResult {
  todoId: string;
  goalId: string;
  action: 'claim' | 'done';
  leaseStatus: 'ACQUIRED' | 'RELEASED' | 'BLOCKED';
  exitCode: 0 | 1;
  reason?: string;
}

export interface IssueFeasibilityRoute {
  issueRef: string;
  repo: string;
  reproductionStatus: 'confirmed' | 'planned' | 'missing' | 'blocked';
  scopeClass: 'bounded' | 'uncertain' | 'oversized';
  route: 'fix_pr' | 'comment_only' | 'triage_only';
  rationale?: string;
}

export interface IntegrationPreviewResult {
  mode: 'preview' | 'execute' | 'status';
  loopxCommand: string[];
  exitCode: 0 | 1;
}

/**
 * 契约不变量 (Contract Invariants):
 * 1. [Inv-1]: `todo claim` 必须调用 `loopx task-lease acquire --goal-id <gid> --todo-id <tid>`；任何失败必须 Exit 1 并输出显式 Fail-Closed 消息，严禁静默降级。
 * 2. [Inv-2]: `todo done` 必须串联 `loopx todo complete` 与 `loopx task-lease release`，两步任一失败即 Exit 1。
 * 3. [Inv-3]: `issue` 必须先经 `gh issue view` 提取真实元数据，再调用 `loopx issue-fix feasibility` 获取唯一路由裁决 (fix_pr|comment_only|triage_only)；feasibility 失败必须 Exit 1，严禁回退静态分流文案。
 * 4. [Inv-4]: `integrate` 默认以 preview 模式调用 `loopx integration-branch sync` (不携带 --execute)；仅显式 `--execute` 时携带；`--status` 透传 `integration-branch status`。
 */
```

## 2. 任务清单 (Tasks)
- [x] 【✓】t1: 改造 `cmd_todo` claim/done 接入 `loopx task-lease acquire/release` 排他租约 Fail-Closed 流转
- [x] 【✓】t2: 改造 `cmd_issue` 基于 `gh issue view` + `loopx issue-fix feasibility` 实现真实因果路由
- [x] 【✓】t3: 新增 `cmd_integrate` 封装 `loopx integration-branch sync/status` 本地预集成
- [x] 【✓】t4: 编写 `tests/unit/native-dispatch.test.js` 覆盖租约/路由/集成三条路径与负向熔断
- [x] 【✓】t5: 执行四大硬门禁与质量收据核验确保 100% 全绿并通过
