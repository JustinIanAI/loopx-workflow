# User Stories & Sizing: merge-compensation

- **Diff 目标**: ≤ 500 行（含测试）
- **Feature**: `merge-compensation`

## Story 1: 已合并 PR 的幂等重跑

**As** 交付 Agent，**I want** 在 squash 已完成但后续步骤失败后重跑 `loopx-flow merge`，**so that** 只补未完成步骤而不重复合并。

- AC1: PR 为 `MERGED` 时不执行 readiness/merge。
- AC2: 未合并 PR 仍走现有 APPROVED → readiness → HEAD 二次比对 → merge。
- AC3: 重跑只补 stop/retire/sync/archive/push。

## Story 2: 停机与退役的“已执行”识别

**As** 交付 Agent，**I want** stop/retire 的“已停止/已退役”被视为成功，**so that** 补偿不会二次卡死。

- AC1: `goal not found` / 已停止 → 继续。
- AC2: 真实失败 → 非 0 并打印修复命令。

## Story 3: archive 与本地 base 同步

**As** 维护者，**I want** 合入后 capsule 移动被提交并推送，**so that** 远端集成分支与本地一致。

- AC1: features 目录存在则移动；archive 已存在则跳过。
- AC2: 刷新 base、pull --ff-only、commit、push；失败非 0。

## Story 4: 假完成阻断

**As** 决策者，**I want** 任何未完成步骤都阻止“闭环完成”文案，**so that** 不再出现假完成。

- AC1: 部分失败输出“已合入、未闭环”与重跑命令。
- AC2: 全部完成才输出完成。
