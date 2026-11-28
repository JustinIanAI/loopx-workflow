# ADR-0018：Gate1 授权通道与 GitHub 评论签名（已被 ADR-0019 取代）

- **状态**：Superseded by [ADR-0019](0019-gate-signature-via-github.md)
- **日期**：2026-11-27（起草）/ 2026-11-28（标记取代）
- **关联**：[ADR-0019](0019-gate-signature-via-github.md)（Accepted，已实现）、[ADR-0009](0009-specification-authorization.md)、[ADR-0012](0012-delivery-authorization-and-recovery.md)、Issue #82

## 取代说明

本 ADR 与 ADR-0019 处理同一问题（#82：Gate1 不再强制 TTY，改为 GitHub 评论签名），结论方向一致但方案不同。ADR-0019 已由维护者 Accept 并在 `bin/loopx-flow` 落地（`--prepare` / `--interactive`、v1 评论标记、`REQ-GATE-SIGNATURE-1`），主分支行为以 ADR-0019 为准。

按 delete-first 与"单一权威"原则，本 ADR 不再作为并行设计生效：不新增 `authorization_channel` 配置键，不定义 v2 评论格式，不改 `user_gate` 固定 evidence 键，不改 `gate verify` 与 `merge` 的校验范围。正文草案已删除，避免与已实现行为产生第二套口径。

## 保留的两项未覆盖缺口（后续候选，不是本 ADR 的生效决策）

ADR-0019 解决了"在哪里签"，但没有覆盖以下两点，记录在此以免丢失：

1. **签署对象对审批人不可复算**。`contract_sha` 是对"`Contract-Status` 已改写为 `FROZEN & APPROVED` 之后"的字节取哈希（`bin/loopx-flow:1095` 附近），审批人在 PR 上读到的是 DRAFT 版本，无法独立复算，只能相信执行者打印的值。若要让签名可自证，需要引入"状态行中立"的摘要（如 `normalize` 后取 SHA256），并让 `approve` 与 `--prepare` 共用同一谓词。
2. **Gate1 授权事实在 Gate2 不再复验**。评论校验通过后写入本地 `user_gate`，`gate1_verify_authorization` 离线只解析 evidence；评论事后被编辑、删除或 PR 关闭时，本地授权仍有效。若要闭环，可在 `merge` 按 `comment_id` 回读并复验，代价是 Gate2 增加一次 GitHub 读取。

两项均改变权威校验范围或新增契约键，属独立决策，需要单独 ADR 并回写 `REQ-*` 后才能实施；在此之前不改变现有行为。
