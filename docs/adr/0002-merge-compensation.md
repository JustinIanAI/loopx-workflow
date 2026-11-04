# ADR-0002：合入后的补偿与全局退役

- **状态**：Accepted
- **日期**：2026-11-04

## 背景

`cmd_merge` 在 `gh pr merge --squash` 之后执行 `goal-lifecycle stop`、`retire-global-goal`、`sync-global` 与本地 archive 移动。当前实现中 `retire-global-goal` 与 `sync-global` 的失败被忽略，命令仍打印“已闭环核销并退役”；`stop` 失败时已经退出，但 GitHub 上的 squash 可能已经发生；再次运行 `merge` 会对已合并的 PR 再次调用 `gh pr merge` 而失败。squash 在 GitHub 上不可回滚。

## 决策

- `merge` 以**可观测状态**做幂等：`gh pr view` 的 `state`/`mergedAt`、Goal 的 stop/retire 状态、`specs/archive/<feature>` 目录。不新增独立状态机。
- 已 `MERGED` 时跳过合并与 readiness，只补未完成的 stop/retire/sync/archive 步骤。
- stop/retire 的“已执行”结果（Goal 不存在、已停止、已退役）识别为成功。
- retire、sync、archive 任一失败：非 0 退出，打印“已合入、未闭环”与可重跑命令；只有全部步骤完成才打印完成。
- 合入后刷新本地 base 分支，提交并推送 archive 移动；push 失败同样非 0。
- 失败信息必须包含：已完成的步骤、未完成的步骤、重跑命令。

## 否决

- **回滚 squash**：GitHub 上不可逆，且会制造双重历史。只做前向补偿。
- **继续忽略 retire/sync**：这正是当前“假完成”的来源。
- **新建补偿状态文件作为唯一真相**：容易与 PR/Goal/目录的真实状态漂移；可作为提示，但不作为权威。

## 修订

- PRD：`REQ-GOAL-1` 增加幂等与补偿；`REQ-FAILCLOSED-1` 增加 retire/sync/archive 失败；删除「明确不在本基线里的行为」中 merge 行与 7.4 的“未决 merge”。
- 设计：第 6 节重写合入顺序；第 10 节失败矩阵对应行改为非 0/补偿。
- 退役：无。

## 不做什么

- 不自动无限重试。
- 不删除 Goal 历史、todos 或 review 产物。
- 不绕过 GitHub Approve、merge readiness 或 HEAD 二次比对。
