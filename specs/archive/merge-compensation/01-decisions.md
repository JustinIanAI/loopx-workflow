# Implementation Decisions: merge-compensation

- **Status**: APPROVED BY HUMAN (agent-executed under decision-maker mandate; 2026-11-04)
- **Product decision**: [ADR-0002](../docs/adr/0002-merge-compensation.md)
- **Feature**: merge-compensation
- **Goal**: merge-compensation-goal

## 1. 实现取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| 补偿状态来源 | 使用 PR `state/mergedAt`、Goal stop/retire 状态、`specs/archive/<feature>` 目录等可观测事实 | 不新增独立状态机，避免与真实状态漂移 |
| 已合并重跑 | 先读 PR 状态；`MERGED` 时跳过 readiness 与 `gh pr merge` | squash 不可回滚，重跑只能补未完成步骤 |
| 已执行 stop/retire | 识别 `goal not found` / 已停止 / 已退役为成功 | 避免第二次运行被“已执行”卡死 |
| archive | 目录在 features 则移动；已在 archive 则跳过 | 幂等 |
| 合入后本地同步 | fetch/checkout base、pull --ff-only、提交并推送 archive 移动 | 防止本地归档未提交导致远端与本地不一致 |
| 失败输出 | 非 0 + “已合入、未闭环” + 重跑命令 | 不打印假完成 |

## 2. 明确不做

- 不自动无限重试。
- 不删除 Goal 历史、todos 或 review 产物。
- 不绕过 GitHub Approve、merge readiness、HEAD 二次比对。
- 不把补偿逻辑放进 `loopx` 控制面；只改 `bin/loopx-flow` 的编排与退出码。
