# Feature Capsule: m0-application-orchestration

> **特性描述**：M0 交付 —— 把 ADR-0008~0012 的产品约束落到真实命令行为：Gate1/Gate2 正式授权、CI 与分模式分支保护、ingest 消费真实门禁退出码、Issue/Todo 能力缺口修复、Fast-Path 去直推 main。
- **Feature Name**: `m0-application-orchestration`
- **Branch**: `feature/m0-application-orchestration`
- **LoopX Goal**: `m0-application-orchestration-goal`
- **Current Status**: `IN_PROGRESS (Stage 1~4 Initialized)`
- **Contract Status**: `DRAFT (Pending Approval)`

## 过程文档索引
1. [01-decisions.md](01-decisions.md) - 阶段 1：本胶囊实现取舍（链接 ADR-0008~0012）
2. [02-prd.md](02-prd.md) - 阶段 2：本切片覆盖的 `REQ-*` / ADR 与验收
3. [03-stories.md](03-stories.md) - 阶段 3：交付故事与 AC
4. [04-contract.md](04-contract.md) - 阶段 4：冻结的命令契约、AC 矩阵、Scope、Verification Plan、依赖顺序
5. [05-evidence.md](05-evidence.md) - 阶段 6：四门禁与收据证据（`check` 生成/回写）

## 备注
- 产品正文仍是 `docs/prd/loopx-workflow.md`；本文档只记录本切片实现与验收，不另立产品需求。
- 运行时 `ACTIVE_STATE.md` 归 LoopX runtime，不入 Git。
