# capability-probe 切片验收

- **Goal**: `capability-probe-goal`
- **追溯**：`REQ-CAPABILITY-1`、ADR-0015 决策 4、ADR-0010 决策 4 / T2 / T3

## 切片

1. `probe_loopx_capabilities` 三层探针：真实子命令 `--help` 必填 Flag 签名、`schema_version` 白名单、版本号软提示。
2. `loopx-flow doctor` 输出「能力 → 探测信号 → PASS / WARN / BLOCK / UNKNOWN」矩阵；`loopx-flow capabilities [--scope]` 提供同一矩阵的按命令视图。
3. L0 命令前置 Fail-Closed：`issue`、`integrate`、`todo claim/done` 在 BLOCK / UNKNOWN 时非 0 并输出《LoopX 升级契约差异诊断卡》。
4. Contract Fake CLI 负向测试覆盖缺 Flag、`issue-fix` / `integration-branch` 缺失、help 不可用（UNKNOWN）、未知 `schema_version`、版本漂移软提示。

## 第 2 层 schema_version 覆盖边界

所有经 `read_loopx_json` 统一入口消费的 LoopX JSON 载荷都在白名单内校验，L0 命令消费路径遇到未知版本一律 Fail-Closed（`doctor` 的 `status` 视图按 ADR 降级为 WARN）。当前登记 9 个消费方：

| 消费方 | schema 路径 | 允许值（锚点 loopx 2.3.0 实测） |
|---|---|---|
| `status` | `projection_envelope.schema_version` | `loopx_projection_envelope_v0` |
| `todo.list` | `projection_envelope.schema_version` | `loopx_projection_envelope_v0` |
| `agent-directory` | 顶层 `schema_version` | `peer_agent_directory_v0` |
| `task-lease.inspect` | 顶层 `schema_version` | `task_lease_v0` |
| `todo.add` | 顶层 `schema_version` | `loopx_coordination_todo_create_result_v0` |
| `todo.claim` | 顶层 `schema_version` | `loopx_coordination_todo_claim_result_v0` |
| `todo.complete` | 顶层 `schema_version` | `loopx_coordination_todo_terminal_lifecycle_result_v0` |
| `change-quality.prepare` | 顶层 `schema_version` | `change_quality_prepare_packet_v2` |
| `change-quality.verify` | 顶层 `schema_version` | `change_quality_receipt_verification_v2` |

**不在本白名单覆盖范围内的读取点**（调用点自行判定 `ok` 与业务字段，不经过 `read_loopx_json`）：

- `pr-review --check-merge-readiness`（`mode_a_readiness_ok` / `mode_b_readiness_ok`）：同一命令的成功包（`pull_request_merge_readiness_v0`）与错误包（`loopx_pr_review_command_response_v0`）schema 不同，且调用点依赖 `readiness_json_field` 的前置噪声容错；本轮不纳入白名单，避免把错误包误判为契约漂移。
- `issue-fix feasibility`（`cmd_issue`）：调用点按退出码与 `decision.route` 判定，响应包无稳定顶层白名单锚点。

后续如要把上述两类收口到统一 wrapper，需要先为它们定义成功/错误两类 schema 的判别规则，并在本表登记后再改调用点。

## 验收

- [x] 缺必需子命令 / Flag → `require` 非 0 + 诊断卡（触发命令、期望、实际、影响范围、适配定位）。
- [x] 未知 / 缺失 `schema_version` → 非 0 + 诊断卡。
- [x] 非关键能力（`issue-fix` / `integration-branch` 在 `doctor` 视角、`goal-acceptance`）→ WARN 披露降级，不阻断。
- [x] 版本漂移但签名与白名单兼容 → 软提示，不阻断。
- [x] Four Gates 全绿（2026-11-27 本地实测：`npm run typecheck` / `lint` / `build` / `test` 全部退出 0，330 用例通过）。
