# ADR-0019：Gate 授权签名面迁移到 GitHub（以评论替代强制 TTY）

- **状态**：Accepted
- **日期**：2026-11-27
- **批准**：JustinIanAI（按维护者 2026-11-27 会话指令实施 Issue #82）
- **关联**：[ADR-0009](0009-specification-authorization.md)（Gate1 规格授权）、[ADR-0012](0012-delivery-authorization-and-recovery.md)（Gate2 发布授权）、Issue #82

## 背景

Gate1 在 `single_owner` 下强制真实 TTY（`[[ -t 0 ]]` + 输入 `yes`，`bin/loopx-flow:1106-1107`），Gate2 的 `release-approve` 同样强制 TTY。这在远程开发、CI、Agent 驱动的会话里不可用，只能人工切回终端同步阻塞。

更关键的是：**TTY 不是强安全边界**。`script -q`、`tmux` 或任何 PTY 包装都能满足 `[[ -t 0 ]]`；而 Agent 本来已持有仓库写权限与 `gh` 凭据。TTY 只证明“有终端”，不证明“是本人”，付出的是可观测的易用性代价。

## 决策

1. **默认授权面改为 GitHub 评论签名**，`single_owner` 与 `independent` 共用同一套评论校验，只差身份条件：
   - Gate1 标记：`<!-- loopx-flow:gate1-authorization:<feature>@<contract_sha> -->`
     正文：`gate=1;mode=<mode>;contract_sha=<sha>;spec_commit=<sha>;approver=<login>`
     - `single_owner`：评论作者必须 **等于** `accepted_by`；
     - `independent`：评论作者必须 **不等于** 执行 `approve` 的 login（既有行为不变）。
   - Gate2 标记：`<!-- loopx-flow:release-authorization:<pr>@<head> -->`
     正文：`gate=2;mode=single_owner;head=<head>;contract_sha=<sha>;principal=<accepted_by>;risk_acceptance=<accepted_by>@<accepted_at>`
     评论作者必须 **等于** `accepted_by`。
2. **新增 `--prepare`**：只计算并打印 `contract_sha` / `head` / `spec_commit` 与可直接粘贴的评论模板，**零写入**。
3. **默认非交互**：`approve` / `release-approve` 先查评论；找不到时 fail-closed，并提示先跑 `--prepare`。
4. **保留 `--interactive`**：显式走 TTY 确认（Gate1）或 TTY 后写评论（Gate2），供过渡期与离线场景使用。
5. **`--yes` 继续拒绝**：自动化不得代签。
6. **授权记录不变**：两条路径都产出同一份 `user_gate` 固定 evidence 串，`gate verify contract` 的核验逻辑不变。

## 安全边界（必须如实披露）

- 评论路径证明的是“**持有 `accepted_by` GitHub 会话的人批准了该 SHA**”，属于**账号级**，不证明自然人；与 `independent` 同一强度层级。
- 持有 owner token 的 Agent 理论上可代发评论。但 TTY 路径同样可被 PTY 包装绕过，因此不存在“TTY 更强”的假象；真实差异是可审计性与异步能力。
- 强分离仍用 `independent`（另一 GitHub 账号）。需要更强不可抵赖时，后续可叠加 SSH/GPG 签名（`ssh-keygen -Y sign`，Agent 不持有私钥），**不在本 ADR 范围**。
- `REQ-GATE1-AUTH-1` 的 evidence 固定串不做变更，避免破坏 `gate verify contract` 与既有收据。

## 否决

- 否决保留 TTY 作为唯一路径：阻塞远程/CI，且不构成真实安全边界。
- 否决新增 `--yes` 无签名路径：Agent 可自签，违背人闸目的。
- 否决把 Gate1 改成 GitHub PR Approve：与 ADR-0009 决策 10（Gate1 不用 PR Approve）冲突，也会与 Gate2 混淆。

## 修订

- **PRD**：`REQ-CHECKPOINT-1`（single_owner 授权面）、`REQ-CHECKPOINT-2`（Mode B 评论校验）、`REQ-GATE1-AUTH-1`（补充评论路径与 `--prepare`），新增 `REQ-GATE-SIGNATURE-1`。
- **设计**：`approve contract` / `release-approve` 行的授权面、`--prepare` / `--interactive` 语义与失败条件。
- **AGENTS.md**：铁律 3、阶段 0/4/8 的 TTY 表述。
- **退役**：不退役；`--interactive` 保留一个发布周期后评估。

## 不做什么

- 不实现 SSH/GPG 签名（后续增强）。
- 不改变 Gate1/Gate2 的授权主体、门禁数量、`user_gate` evidence 固定串与 Gate2 readiness 策略。
- 不改变 `--yes` 的拒绝语义。
