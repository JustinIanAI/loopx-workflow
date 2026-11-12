# Architecture Decisions: m0-application-orchestration

- **Status**: APPROVED
- **Feature**: m0-application-orchestration
- **产品决策正文**: [ADR-0008](../../docs/adr/0008-application-orchestration-layer.md) ~ [ADR-0012](../../docs/adr/0012-delivery-authorization-and-recovery.md)；本文只记录本切片实现取舍。

## 1. Gate1 授权（ADR-0009 / ADR-0012 决策 10）
- **选择**: `approve contract` 先落最终字节（固定批准标记行 `- **Contract-Status**: FROZEN & APPROVED`，不含审批人/时间），再对这份字节计算 SHA256。
- **理由**: 第二审批人签的是最终锁定字节；评论 `contract_sha`、`configure-goal` 参数、evidence、最终落盘必须是同一份字节的 SHA。
- **否决**: 用加标记前的文件哈希去找评论（会导致评论绑定的字节 ≠ 锁定字节）。

## 2. Gate2 分模式（ADR-0012）
- **选择**: `merge` 按 `authorization_mode` 分 Mode A/B；Mode A 只认绑定当前 head 的非作者 APPROVED formal review + `reviewDecision`；Mode B 只认 `release-approve` 结构化评论（head/contract_sha/principal/risk_acceptance）+ 当前 head 的 Agent review 证据。
- **选择**: Mode A readiness 只认 JSON `ready===true`；Mode B 按 `blocking_reasons` 允许/忽略列表三档判定。
- **选择**: 已 MERGED 但缺授权记录时记审计告警（网页/管理员绕过无法阻止，不宣称已阻止）。

## 3. CI 与分支保护（ADR-0012 决策 5）
- **选择**: 新增 CI workflow（job name 固定 `Four Gates`）；新增 `scripts/setup-branch-protection.sh` 分模式 `--check/--apply`；`doctor` 里 Gate1 上下文只 WARN，`merge` 缺保护 fail-closed。

## 4. 证据与门禁退出码（ADR-0011）
- **选择**: `check` 捕获四门禁真实退出码写入临时 gate-results（`loopx_flow_gate_results_v0`），`ingest` 只消费该文件；缺结果拒绝写 `passed`。

## 5. Issue / Todo / Fast-Path（ADR-0012 决策 7）
- **选择**: `todo claim/done` 内部先 `register-agent`，再带 `--owner` + `--idempotency-key`（完成前用 `task-lease inspect` 的版本做 CAS）；`issue` 只读 `decision.route`；`fast-fix-push.sh` 删除直推 `main`，只走分支 + PR。

## 6. 本批未做（不扩张范围）
- `review` 仍通过 issue comment 发布；formal review 通道与 Mode B 只认 review `commit_id` 留到下一批。
- 分支保护 `--apply` 需要仓库管理员执行；本批只交付脚本与 `--check` 集成。
