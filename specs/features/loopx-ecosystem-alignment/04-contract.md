# Contract & Task Map: loopx-ecosystem-alignment

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-30 15:44:18
- **Feature**: loopx-ecosystem-alignment
- **Goal-ID**: loopx-ecosystem-alignment-goal

## 1. 冻结 TypeScript 契约签名 (Frozen Signatures)

```typescript
/**
 * LoopX PR #7545 标准化 PR 描述数据模型
 */
export interface LoopxPrBody {
  readonly motivation: string;
  readonly approach: string;
  readonly changes: readonly {
    readonly file: string;
    readonly explanation: string;
  }[];
  readonly risks: string;
  readonly verificationMatrix: readonly {
    readonly check: string;
    readonly result: 'passed' | 'failed' | string;
    readonly details?: string;
  }[];
}

/**
 * LoopX 官方交付审查三维评价指标
 */
export interface ReviewEvaluationDimensions {
  readonly delivery: 'complete' | 'fragmented';
  readonly longHorizon: 'proven' | 'not_yet_proven';
  readonly userExperience: 'clear' | 'regression';
}

/**
 * 带有三维准则与双语裁决的审查结果
 */
export interface EnhancedReviewResult {
  readonly schemaVersion: 'authentic_review_result_v1';
  readonly verdict: 'approve' | 'request_changes';
  readonly dimensions: ReviewEvaluationDimensions;
  readonly findings: readonly {
    readonly file: string;
    readonly line?: number;
    readonly severity: 'blocker' | 'major' | 'minor' | 'advisory';
    readonly summary: string;
    readonly repro?: string;
  }[];
  readonly unblockConditions: readonly string[];
  readonly englishVerdict: string;
  readonly declaration: {
    readonly reviewer: 'codex' | 'claude';
    readonly model: string;
    readonly declaration: 'runtime_reported';
  };
  readonly headOid: string;
}

/**
 * 针对审查意见的更新与验证汇报模型 (PR #7545 模式)
 */
export interface ReviewResponseReport {
  readonly commitSha: string;
  readonly resolvedFindings: readonly {
    readonly level: 'P1' | 'P2' | 'Blocker' | 'Major' | 'Minor';
    readonly summary: string;
    readonly fixDetails: string;
    readonly testRef: string;
  }[];
  readonly verificationMatrix: readonly {
    readonly check: string;
    readonly result: 'passed' | 'failed';
  }[];
}

/**
 * LoopX Goal 全生命周期管控配置
 */
export interface GoalLifecycleConfig {
  readonly goalId: string;
  readonly projectPath: string;
  readonly capsuleStateFilePath: string;
  readonly autoSyncGlobal: boolean;
  readonly retireOnMerge: boolean;
}

/**
 * 核心断言不变量 (Invariant Assertions)
 */
export interface InvariantAssertions {
  // 不变量 1: PR Body 必须包含 PR #7545 的 4-Part 体系及验证矩阵表格
  assertPrBodyFollowsPr7545Structure(body: string): boolean;

  // 不变量 2: Review 报告 Block 4 必须包含 delivery/long_horizon/user_experience 三维准则与双语 Verdict
  assertReviewContains3DDimensions(block4: string): boolean;

  // 不变量 3: .loopx/registry.json 严禁被 Git 跟踪 (消除 registry_tracked_but_not_push_allowed)
  assertPrivateRegistryUntrackedInGit(gitStatusOutput: string): boolean;

  // 不变量 4: 新特性的 state_file 必须持久化在 specs/features/<feat>/ACTIVE_STATE.md
  assertStateFileCapsuleBound(goalEntry: Record<string, any>, feature: string): boolean;

  // 不变量 5: cmd_merge 必须在 stop 后执行 retire-global-goal，消除全局僵尸残留
  assertGoalCleanlyRetiredOnMerge(globalRegistryGoals: readonly any[], goalId: string): boolean;
}
```

## 2. 任务清单 (Tasks)

```
[Task 1: 编写红绿契约测试] (tests/unit/loopx-ecosystem-alignment.test.js)
       │
       ▼
[Task 2: LoopX Goal 全生命周期纳管与边界合规]
       ├── Task 2.1: 解除 .loopx/registry.json Git 跟踪并更新 .gitignore
       ├── Task 2.2: 改造 cmd_feature 绑定胶囊 state-file (specs/features/<feat>/ACTIVE_STATE.md)
       ├── Task 2.3: 在 approve / check / merge 处自动注入 loopx sync-global
       └── Task 2.4: 改造 cmd_merge 在 stop 后联动 retire-global-goal 清除僵尸
       │
       ▼
[Task 3: 对齐 PR #7545 标准的 PR 描述自动聚合器]
       └── Task 3.1: 重构 authentic-review.js 中的 buildBody，输出双语 4-Part 结构与验证矩阵表格
       │
       ▼
[Task 4: 增强 Adversarial Review 三维准则与双语整体裁决]
       ├── Task 4.1: 更新 review prompt 注入 delivery/long_horizon/user_experience 评估要求
       └── Task 4.2: 增强 fiveBlock Block 4 渲染三维打分与双语 Verdict
       │
       ▼
[Task 5: 实现 loopx-flow respond <pr_id> 指令]
       └── Task 5.1: 自动提取最新 Commit Diff、比对上一轮 carryover、生成标准更新汇报并置顶
       │
       ▼
[Task 6: 阶段 5/6 门禁验证与质量收据融合 (100% 全绿)]
```
