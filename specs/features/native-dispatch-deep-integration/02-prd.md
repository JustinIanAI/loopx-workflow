# Lean PRD: native-dispatch-deep-integration

## 1. 核心目标与用户旅程
开发者/AI Agent 通过 `loopx-flow` 执行任务申领、缺陷分流与本地预集成时，所有状态裁决由 LoopX 原生控制面完成：
- `loopx-flow todo claim t1` → LoopX 排他租约 acquire，冲突即阻断；
- `loopx-flow todo done t1` → LoopX todo complete + 租约 release；
- `loopx-flow issue 123` → LoopX issue-fix feasibility 因果裁决修复路由；
- `loopx-flow integrate` → LoopX integration-branch 本地预集成（默认 preview）。

## 2. 承重假设矩阵
- **假设 1**: loopx CLI 在执行环境中存在；缺失时所有相关命令 Fail-Closed 而非降级假成功。
- **假设 2**: feasibility 的 route 输出为唯一权威路由结论，`loopx-flow` 不做二次裁决。
- **假设 3**: integration-branch 的 configure 已由 `workflow-init.sh`/用户预先配置，`integrate` 仅负责 sync/status 透传。
