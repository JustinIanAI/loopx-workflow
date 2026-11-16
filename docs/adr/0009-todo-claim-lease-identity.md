# ADR-0009：todo claim 传递已注册 Agent 与稳定幂等键

- **状态**：Accepted
- **日期**：2026-11-16
- **关联**：GitHub issue #12、`REQ-NATIVE-1`、`REQ-LEASE-1`

## 背景

LoopX 2.3.0 的 `task-lease acquire` 要求 `--owner` 与 `--idempotency-key`。`owner` 还必须是该 Goal 已注册的 Agent。`loopx-flow todo claim` 只传了 `--goal-id` 和 `--todo-id`，合法 Todo 因此无法申领。补上任意身份后又会得到 `owner_not_registered`。编排器把这两类控制面错误直接透出，没有可执行的修复指令。

## 决策

- `todo claim` 先读 `loopx agent-directory --format json`。只把 `registered: true` 的 `agent_id` 当作 owner。
- `LOOPX_AGENT_ID` 已设置时，它必须能折到某个已注册身份；租约使用注册表里的拼写。折不到就退出，并打印带 `--execute` 的 `loopx register-agent`。
- 未设置 `LOOPX_AGENT_ID` 时，仅当已注册身份恰好一个才自动使用。没有注册身份时退出，并打印 `loopx register-agent --goal-id <goal> --agent-id <registered-agent-id> --execute`。多于一个，或目录页读不全时退出，列出已读到的身份，要求设置 `LOOPX_AGENT_ID`。这两种情况都不调用 `task-lease acquire`。
- 幂等键是 `loopx-flow:claim:` 加上 SHA256(`goal_id`、`todo_id`、`owner` 以换行连接) 的十六进制。同一三元组重试不变，并且符合 LoopX public-safe token。acquire 被拒绝时仍以 LoopX 的结果退出，编排器不另作租约裁决。
- `todo done` 的 release 参数不在本决策内。

## 否决

- **把沙箱验证用的 agent id 写进编排器**：身份属于 Goal，不属于命令。
- **没有注册身份时仍调用 acquire**：底层错误不是修复指令，调用者无法知道下一步。
- **有多个注册身份时取第一个**：会以错误 owner 拿走租约。
- **把 Goal 原文拼进幂等键**：Goal id 可以含非 ASCII，通不过 public-safe token。

## 修订

- PRD：新增 `REQ-LEASE-1`；`REQ-FAILCLOSED-1` 补上身份无法确定时的退出。
- 设计：第 3 节 `todo claim` 行、第 10 节失败矩阵、第 11 节落点。
- 退役：无。`native-dispatch-deep-integration` 的冻结契约不改；原不变量仍要求 acquire 携带 goal 与 todo，并在失败时退出。

## 不做什么

- 不在 `todo done` / `task-lease release` 上传 `--owner`、原幂等键或 `--expected-version`。
- 不自动执行 `register-agent`。
- 不新增 `--owner` 命令行参数；当前身份只来自 `LOOPX_AGENT_ID` 或唯一注册身份。
