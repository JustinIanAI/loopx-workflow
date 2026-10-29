# Architecture Decisions: native-dispatch-deep-integration
- **Status**: APPROVED BY HUMAN (freecisco_yan@2026-10-28, 预授权："继续按照方案执行Feature开发，直至完成整个方案")
- **Feature**: native-dispatch-deep-integration

## 1. 核心技术路线对比与权衡
- **分支 1 (采纳)**: `loopx-flow` 全部调度动作直接透传 LoopX 原生命令 (`task-lease`, `issue-fix feasibility`, `integration-branch`)，编排器只做参数组装、元数据提取与 Fail-Closed 熔断，不复制任何控制面状态。优点：单一真理源 (LoopX 控制面)；缺点：强依赖 loopx CLI 存在性（以 Fail-Closed 显式暴露，可接受）。
- **分支 2 (否决)**: 在 `loopx-flow` 内自建租约表/路由表/集成分支逻辑。否决原因：制造第二真理源，违背"LoopX 生态能力真正嵌入流程"的 v2 审计定调。

## 2. 关键决策记录
- **D1 租约 Fail-Closed**: `todo claim` 的 `task-lease acquire` 失败 (租约被他人持有) 必须 Exit 1，严禁静默继续；`todo done` 先 `todo complete` 再 `task-lease release`，保证租约释放可观测。
- **D2 feasibility 因果路由**: `issue` 命令从 `gh issue view` 提取真实元数据，将 reproduction/scope 观察量传给 `loopx issue-fix feasibility`，由其唯一裁决 `fix_pr | comment_only | triage_only`；feasibility 失败即 Exit 1，禁止落回静态分流文案。
- **D3 integrate 双模式**: `integrate` 默认 preview (`loopx integration-branch sync` 无 `--execute`)，显式 `--execute` 才落盘；`--status` 透传 `integration-branch status`。
- **D4 Goal 解析**: goal-id 统一从当前分支 `feature/<name>` 推导为 `<name>-goal`，允许 `--goal-id` 显式覆盖；解析失败时 Fail-Closed。
