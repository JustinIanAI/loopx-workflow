# gate-signature 实现取舍

- **Status**: APPROVED（2026-11-27；Gate1 授权记录仍由人类执行 `loopx-flow approve contract` 写入）
- **关联**：[ADR-0019](../../../docs/adr/0019-gate-signature-via-github.md)、`REQ-GATE-SIGNATURE-1`

## 取舍

1. **默认评论、显式 TTY**：`approve` / `release-approve` 默认查 GitHub 评论；`--interactive` 才走 TTY，避免既有自动化静默改变语义。
2. **复用 independent 解析**：Gate1 的 `single_owner` 路径复用同一 marker/字段解析，只把身份条件从“作者 ≠ 执行者”换成“作者 == accepted_by”。
3. **`--prepare` 零写入**：只计算 SHA/head 并打印模板，不写批准标记、不写授权评论、不调 `configure-goal`。
4. **evidence 固定串不变**：两条签名路径产出同一份 `user_gate` evidence，`gate verify contract` 逻辑零改动。
5. **Gate1 不要求 Draft**：评论路径用当前分支的 open PR（兼容 `feat/*` 与 `feature/*`）；`independent` 的 Draft/分支约束保持不变。
6. **Gate2 不重复写**：`release-approve` 发现已有合法 `gate=2` 评论即视为完成，不再追加评论。

## 否决

- 否决 `--yes` 无签名路径。
- 否决把 Gate1 改成 PR Approve（ADR-0009 决策 10）。
- 否决在本 PR 叠加 SSH/GPG 签名（后续增强）。
