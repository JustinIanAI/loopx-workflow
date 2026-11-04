# ADR-0003：审批、体检与全局同步的失败边界

- **状态**：Accepted
- **日期**：2026-11-04

## 背景

`cmd_approve` 先把契约文件写成 `FROZEN & APPROVED`，再计算 SHA256 并调用 `loopx configure-goal`。本机没有 `loopx` 时整段锁定被跳过，命令仍打印“审批通过”；`configure-goal` 失败时标记已经落盘。`cmd_doctor` 在没有 `loopx` 时只打黄字并成功退出。`feature` 与 `approve` 中的 `sync-global` 被 `2>/dev/null || true` 吞掉。

## 决策

- `approve contract`：先要求 `loopx`；对**带批准标记的最终内容**计算 SHA256；`configure-goal` 成功后才原子替换契约文件；失败删除临时内容、不落批准标记；随后 `sync-global` 失败重试 2 次仍失败则非 0。
- `doctor`：没有 `loopx` 时输出结构化诊断卡（原因/影响/修复命令）并非 0 退出。`preflight-check.sh` 仍按原策略只告警，避免 `init` 在无 `loopx` 环境不可用。
- `feature` 与 `approve` 的 `sync-global`：重试后仍失败则非 0，并打印可重试的同步命令。
- 所有失败输出必须包含修复指令，禁止只打印“通过”。

## 否决

- **保留 warning**：与“断点 1 物理锁定”冲突。
- **先写 marker 再回滚**：失败路径容易留下半状态；先算最终内容再原子替换更可靠。
- **无限重试**：全局 registry 有锁，必须有限次后失败。

## 修订

- PRD：`REQ-CHECKPOINT-1` 增加原子审批；`REQ-FAILCLOSED-1` 增加 approve/doctor/sync 失败；删除「明确不在本基线里的行为」中 doctor 行。
- 设计：第 3 节命令表、第 10 节失败矩阵。
- 退役：无。

## 不做什么

- 不把 `preflight-check.sh` 的 loopx 警告升级为阻断（本 ADR 只收紧 `doctor`）。
- 不改变 LoopX `configure-goal` 自身的语义。
