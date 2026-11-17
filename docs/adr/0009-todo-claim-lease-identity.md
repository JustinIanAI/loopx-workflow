# ADR-0009：todo claim 传递已注册 Agent 与稳定幂等键

- **状态**：Accepted
- **日期**：2026-11-16
- **关联**：GitHub issue #12、`REQ-NATIVE-1`、`REQ-LEASE-1`

## 背景

LoopX 2.3.0 的 `task-lease acquire` 要求 `--owner` 与 `--idempotency-key`。`owner` 还必须是该 Goal 已注册的 Agent。`loopx-flow todo claim` 只传了 `--goal-id` 和 `--todo-id`，合法 Todo 因此无法申领。补上任意身份后又会得到 `owner_not_registered`。编排器把这两类控制面错误直接透出，没有可执行的修复指令。

## 决策

- `todo claim` 先读 `loopx agent-directory --format json`，并跟随 `next_cursor` 调用 `--cursor`，直到没有下一页。已见游标再出现就停止，避免死循环。只把 `registered: true` 的 `agent_id` 当作 owner。`registered: false` 的诊断行不是 owner。全部页面读完之后，才做 `OK` / `UNREGISTERED` / `MISSING` / `AMBIGUOUS` 判定。
- 翻页结束后，若 `registered_agent_count` 仍大于读到的注册身份数，视为目录不完整并退出。这种情况不报 `AMBIGUOUS`，也不报 `MISSING`。
- `LOOPX_AGENT_ID` 已设置时，它必须能折到某个已注册身份；租约使用注册表里的拼写。折不到就退出，并打印带 `--execute` 的 `loopx register-agent`。身份原文整段传递，不按空格切开。占位符 `<registered-agent-id>` 原样打印，不做 shell `%q` 转义。
- 未设置 `LOOPX_AGENT_ID` 时，仅当已注册身份恰好一个才自动使用。没有注册身份时退出，并打印 `loopx register-agent --goal-id <goal> --agent-id <registered-agent-id> --execute`。多于一个时退出，列出已读到的身份，要求设置 `LOOPX_AGENT_ID`。这些情况都不调用 `task-lease acquire`。
- 申领前先 `task-lease inspect`。没有租约记录时，幂等键是 `loopx-flow:claim:` 加上 SHA256(`goal_id`、`todo_id`、`owner` 以换行连接)。同一三元组在仍然没有租约时重试不变。
- 存在活动租约（`schema_version` 为 `task_lease_v0`、`status` 为 `active`、`expires_at` 仍未到期）且 `owner` 与当前身份相同，则复用该租约上的 `idempotency_key`，用来重放这一代。
- 租约已过期或已释放，或记录还在但不是当前 owner 的活动租约时，幂等键改为 SHA256(`goal_id`、`todo_id`、`owner`、`lease_epoch`、`version`、`next` 以换行连接)。同一份已结束快照的重试键不变，且不等于上一把键。缺省时 `lease_epoch` 按 1、`version` 按 0，与 LoopX 对已存在租约的读法一致。
- 调用方传入 `--idempotency-key` 时原样透传，不再 inspect，也不改写。键必须是 LoopX public-safe token。
- acquire 被拒绝时仍以 LoopX 的结果退出。`idempotency_key_reuse` 必须原样出现。只有 `todo_lease_conflict` 或 `write_scope_conflict` 才说明可能被其他 Agent 持有。
- `todo done` 的 release 参数不在本决策内。

## 否决

- **把沙箱验证用的 agent id 写进编排器**：身份属于 Goal，不属于命令。
- **没有注册身份时仍调用 acquire**：底层错误不是修复指令，调用者无法知道下一步。
- **有多个注册身份时取第一个**：会以错误 owner 拿走租约。
- **把 Goal 原文拼进幂等键**：Goal id 可以含非 ASCII，通不过 public-safe token。
- **过期或释放后继续使用同一把三元组键**：LoopX 在租约记录仍在且不再处于可重放的活动状态时，会以 `idempotency_key_reuse` 拒绝这把键。

## 修订

- PRD：新增 `REQ-LEASE-1`；`REQ-FAILCLOSED-1` 补上身份无法确定时的退出。
- 设计：第 3 节 `todo claim` 行、第 10 节失败矩阵、第 11 节落点。
- 退役：无。`native-dispatch-deep-integration` 的冻结契约不改；原不变量仍要求 acquire 携带 goal 与 todo，并在失败时退出。

## 不做什么

- 不在 `todo done` / `task-lease release` 上传 `--owner`、原幂等键或 `--expected-version`。
- 不自动执行 `register-agent`。
- 不新增 `--owner` 命令行参数；当前身份只来自 `LOOPX_AGENT_ID` 或唯一注册身份。
