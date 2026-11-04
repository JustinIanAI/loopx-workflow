# Feature PRD Slice: merge-compensation

- **Feature**: `merge-compensation`
- **Goal**: `merge-compensation-goal`
- **Product decisions**: ADR-0002
- **Requirements**: `REQ-GOAL-1`、`REQ-FAILCLOSED-1`、`REQ-CAPSULE-1`

## 1. 切片范围

只处理 `loopx-flow merge <pr> [feature]` 在 GitHub squash 之后的补偿与幂等；不改合入前审批、readiness、HEAD 二次比对。

## 2. 验收准则

1. PR 已 `MERGED` 时重跑 `merge`：不重复调用 `gh pr merge`，只补 stop/retire/sync/archive。
2. `goal-lifecycle stop` 返回“已停止/不存在”时视为成功；真实失败非 0。
3. `retire-global-goal` 返回“global registry 不存在/已退役”时视为成功；真实失败非 0。
4. `sync-global` 失败重试后仍失败则非 0。
5. `specs/features/<feature>` 存在则移到 archive；已存在 archive 则跳过。
6. archive 移动后刷新本地 base、提交并推送；push 失败非 0。
7. 只有全部步骤完成才打印完成；部分失败打印“已合入、未闭环”并给出重跑命令。
8. 现有 `loopx-flow merge` 的 APPROVED / readiness / HEAD 防偷跑行为不回归。

## 3. 承重假设

- GitHub 的 PR `state`/`mergedAt` 在 merge 后可稳定读取。
- LoopX 对已停止/已退役 Goal 的错误文本可识别，且不会因第二次 stop/retire 破坏状态。
- 本地 base 分支可 fast-forward；若不能，命令必须失败而不是强推。
