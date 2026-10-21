# Feature Contract & Tasks: cli-flow

## 1. 契约冻结 (TypeScript Interfaces & Invariants)
```typescript
/**
 * LoopX Flow Orchestrator Command Contract
 */
export type LoopXFlowCommand = 
  | 'doctor'
  | 'init'
  | 'start'
  | 'todo'
  | 'check'
  | 'review'
  | 'merge'
  | 'issue'
  | 'status'
  | 'help';

export interface LoopXFlowExecutionResult {
  command: LoopXFlowCommand;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InspectionCheckpoint {
  stage: 1 | 2 | 4 | 6 | 8;
  name: string;
  targetFile: string;
  acceptanceCriteria: string[];
}
```

## 2. 任务清单 (Tasks)
- [x] 【✅】t1: 补充开源合规文件 (`LICENSE`, `.gitignore`)
- [x] 【✅】t2: 重构四大硬门禁并接入 `tests/unit/workflow.test.js`
- [x] 【✅】t3: 补充 GitHub PR 与 Issue 模版
- [x] 【✅】t4: 编写并验证轻量 CLI 编排器 (`bin/loopx-flow`)
- [x] 【✅】t5: 编写关键节点验收手册 (`docs/guides/reviewer-inspection-guide.md`) 与新手教程 (`README.md`, `QUICKSTART.md`)
- [x] 【✅】t6: 全量运行四大门禁与前置体检确保 100% 通过
