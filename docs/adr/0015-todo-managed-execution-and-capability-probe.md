# ADR-0015：受管 Todo 执行委托与三层能力探针

- **状态**：Proposed
- **日期**：2026-11-23
- **审批**：待人类 Maintainer 签核后由 `Proposed` 置为 `Accepted`（依据 [ADR-0006](0006-document-code-change-governance.md) 与 [ADR-0008](0008-application-orchestration-layer.md) 决策 6，签批前不得冻结下游 `W3` / `W4` 契约或启动编码）
- **关联**：[ADR-0006](0006-document-code-change-governance.md)、[ADR-0008](0008-application-orchestration-layer.md)、[ADR-0010](0010-command-contracts-and-execution-protocol.md)、[ADR-0014](0014-temp-artifact-path-remediation-and-history-sanitization.md)、[2026-11-19 Pstack / Magpie / LoopX 整合调研报告](../research/2026-11-19-pstack-magpie-loopx-integration-validation.md)、[ADR 收口实施计划](../plans/2026-11-20-pstack-loopx-adr-closure-implementation-plan.md)
- **上游锚点**：`loopx-project/loopx@f4c5d6d7`（完整 SHA `f4c5d6d70c4c88ee4dae705c0ea7b5a8ea87e5ff`，与本机实测 `loopx 2.3.0` 全部 1,824 个源文件字节一致）
- **取代**：[ADR-0010](0010-command-contracts-and-execution-protocol.md) 末尾增补节中的旧 `REQ-LEASE-1`（手工 `task-lease inspect/acquire/release` 与 SHA-256 幂等键拼接方案）

## 背景

对照 `loopx-project/loopx@f4c5d6d7`（本机 `loopx 2.3.0`）源码与测试集交叉核验 `bin/loopx-flow` 现码后，发现三类影响核心编排可靠性的共享契约缺口：

1. **手工拼接底层 `task-lease` 与真实 LoopX 2.3.0 契约存在三处硬断裂**（此前被 `tests/unit/native-dispatch.test.js` 的无状态 Mock 脚本掩盖）：
   - **无子命令报错**：`todo done` 调用 `loopx todo --goal-id ... --todo-id ... --status done` 缺少显式子命令，真实 `loopx 2.3.0`（`loopx/cli_commands/todo.py`）直接抛出 `ValueError: loopx todo requires an explicit command`；
   - **释放幂等键 CAS 必败**：`todo done` 重新派生 `loopx-flow:release:<sha256>`，而真实 `loopx 2.3.0`（`task_lease_lifecycle_decision.ts`）强制要求 `task-lease release` 复用 `acquire` 原始代际 `idempotency_key`，否则直接返回 `lease_cas_mismatch`；
   - **未感知 `handoff_mode`**：当 Goal 配置为 `soft_claim` 时，直接调用 `loopx task-lease acquire` 会被 LoopX 拒绝并返回 `handoff_mode_forbids_lease`。
   - **根因**：`loopx commands` 明确将 `task-lease` 定位为宿主/适配器底层原语，要求普通任务流转走高层受管事务入口 `loopx todo claim` / `loopx todo complete`（`manage_execution=True`）。在编排层手搓底层原语不仅破坏原子性，而且每次 LoopX 升级内部租约模型都会击穿 `loopx-workflow`。
2. **`REQ-CAPABILITY-1` 缺少可执行的三层探针与 `schema_version` Fail-Closed 契约**：
   - [ADR-0010](0010-command-contracts-and-execution-protocol.md) 确立了 Required Capability Set（BLOCK / WARN 两档）与“不 Pin 版本”原则，但现码仍停留在零散的顶层 `--help | grep`，未按 LoopX 真实子命令帮助结构（`action_help` / 共享 `todo_parser` / 二级子命令树）校验必填参数签名，也未对 LoopX JSON 输出执行 `schema_version` 白名单 Fail-Closed 校验，面对上游破坏性变更存在 fail-open 静默误判风险。
3. **详细设计 §3.1 / §3.2 存在 ADR-0010 历史挂账**：
   - [docs/design/loopx-workflow-design.md](../design/loopx-workflow-design.md) §3.1 L0 命令契约表长期缺失「前置与后置条件」「证据契约」2 列，且缺少 ADR-0010 要求的 §3.2「L0 7 步执行协议及六结果语义」正文。

本 ADR 确立受管 Todo 执行委托、跨进程凭证缓存与 Q1 双分流停机恢复、上游锚点与三层能力/`schema_version` Fail-Closed 探针，以及隔离 Registry Real-CLI Canary 验证边界，并同步关闭上述设计文档挂账。

## 决策

### 1. 受管 Todo 执行委托（API 分层隔离，取代 ADR-0010 旧 `REQ-LEASE-1`）

1. **退役底层手工租约拼接（`delete-first`）**：
   - `loopx-flow todo claim` 与 `loopx-flow todo done` 全面退役手工调用 `loopx task-lease inspect/acquire/release`、自行生成 `loopx-flow:claim:<sha256>` / `loopx-flow:release:<sha256>` 幂等键，以及无子命令 `loopx todo --status done` 的非原子拼接实现。
   - **静态防退化约束**：除只读诊断 `doctor` 外，`bin/loopx-flow` 严禁直接调用 `loopx task-lease acquire/release/renew`（下游实施纳入静态守卫）。
2. **保留已注册 Agent 身份分页解析**：
   - `todo claim` 与未显式传 `--owner`/`--agent-id` 的 `todo done` 继续执行严格的身份解析：完整分页读取 `loopx agent-directory --format json`（跟随 `next_cursor` 直至无下一页；检测重复/停滞游标或总条数与 `registered_agent_count` 不一致时立即 fail-closed）。
   - 仅承认 `registered: true` 的 `agent_id`；设置 `LOOPX_AGENT_ID` 时折叠匹配到注册表拼写，未设置时仅在恰好存在 1 个已注册身份时自动选用；无注册身份、多身份未指定或 `LOOPX_AGENT_ID` 未注册时退出码非 0，打印可执行 `loopx register-agent ... --execute`（占位符 `<registered-agent-id>` 原样输出），且不调用 `loopx todo claim`。
3. **高层受管事务委托**：
   - **`loopx-flow todo claim`**：直接委托 LoopX 受管认领入口：
     ```text
     loopx --format json todo claim --goal-id <gid> --todo-id <tid> --agent-id <owner> --claimed-by <owner>
     ```
     不手工传递底层租约计数器，由 LoopX 自动开启 `manage_execution=True` 在单次 CAS 事务内完成认领、`hard_lease` / `soft_claim` 透明适配、`required_write_scopes` 冲突检测、Worktree 物理隔离与前置依赖检查。
   - **`loopx-flow todo done`**：直接委托 LoopX 受管完成入口：
     ```text
     loopx --format json todo complete --goal-id <gid> --todo-id <tid> --agent-id <owner> --claim-operation-id <op_id> [--evidence <ev>]
     ```
     由 LoopX 在同一 CAS 事务内校验执行权证明（`claimExecutionProof`）、运行绑定验收命令（如有）、将 Todo 置为 `done` 并原子释放关联租约（`released`）。
   - LoopX 返回的拒绝语义为唯一权威，编排器不得改写或笼统概括（例如不得将 `idempotency_key_reuse` 改写为“已被其他 Agent 持有”）。

### 2. `claim_operation_id` 凭证缓存与五元组校验（Q1 缓存契约）

1. **缓存落点**：
   - `loopx 2.3.0` 受管 `todo claim` 有意从返回体剥离内部 `lease` / `lease_changed` / `lease_idempotent` / `original_receipt`，仅暴露权威执行凭证 `claim_operation_id`、`execution_managed` 与 `next_cli_actions`。
   - `loopx-flow todo claim` 成功后，将凭证缓存写入仓库沙箱（严格遵循 [ADR-0014](0014-temp-artifact-path-remediation-and-history-sanitization.md) `LOOPX_TMP_DIR` 锚定契约）：
     ```text
     $LOOPX_TMP_DIR/claims/<gid>--<tid>.json
     ```
2. **五元组完整性校验**：
   - 缓存 JSON 必须保存 `claim_operation_id` 与完整**五元组**：
     1. `goal_id`
     2. `todo_id`
     3. `agent_id`
     4. `registry_path`（规范化后的当前生效 registry 路径，防止跨 Worktree 或隔离测试沙箱串用凭证）
     5. `handoff_mode`
   - 凭证缓存仅用于跨进程传递 `claim_operation_id`，**不是第二权威状态源**。
   - `loopx-flow todo done` 优先接受 CLI 显式传入的 `--claim-operation-id`；未显式传入时读取 `$LOOPX_TMP_DIR/claims/<gid>--<tid>.json` 并逐项校验五元组。若缓存缺失、JSON 损坏或五元组任一字段与当前执行上下文不一致，**不得直接复用缓存**，必须转入第 3 节 Q1 双分流恢复契约；`todo done` 成功完成后立即清理对应缓存文件。

### 3. Q1 双分流停机恢复契约（有效同 Owner 补领 vs 异常态 Fail-Closed）

当 `loopx-flow todo done` 面临缓存缺失/五元组失效（例如跨会话、`gc` 清理或临时目录重置）或已有 `claim_operation_id` 被拒绝时，严格执行以下双分流规则：

| 分流 | 观测条件（以 LoopX 只读查询与返回体为准） | 规定行为 |
|---|---|---|
| **分流 A：有效且同 Owner 自动补领** | 目标 Todo 仍处于活跃认领态、关联租约**未过期（有效）**且当前 Owner 与本次操作 `agent_id` 一致 | 允许自动调用受管 `loopx --format json todo claim --goal-id <gid> --todo-id <tid> --agent-id <owner> --claimed-by <owner>` 补领有效 `claim_operation_id` receipt，刷新 `$LOOPX_TMP_DIR/claims/<gid>--<tid>.json` 五元组缓存后再执行 `loopx todo complete`。 |
| **分流 B：过期 / 释放 / 转让 / `deferred` / 拒绝 — 一律 Fail-Closed 停机** | 出现以下任一状态：<br>• 租约**已过期**（`lease_state == "expired"`）<br>• 租约**已释放**（`released`）<br>• 租约**已转让 / 被其他 Agent 持有**（`owner_conflicts_with_claim` 等）<br>• Todo 处于 **`deferred` 挂起态**（`todo_not_open`）<br>• LoopX 返回 `idempotency_key_reuse`、`claim_execution_unavailable`、`execution_authority_granted == false` 或其他无法确认有效同 Owner 的状态 | **一律 Fail-Closed 非 0 停机**；**原样透出 LoopX 返回的 `recovery` 字段与恢复指引**：<br>• 过期态透出 `recovery`（如 `recovery.action = "claim_task"`）并提示操作者核对现状后显式重跑 `loopx-flow todo claim`；<br>• `deferred` 挂起态透出 `recovery` 并提示先由 Owner 显式执行 `loopx todo update --status open --clear-resume-when` 再重新 `claim`（严禁对 `deferred` 直接 `claim`）；<br>• **硬红线：严禁静默重新 `claim`**。 |

**附带 `todo update` CAS 约束**：若对带 `--update-expected-provider-revision` 的 `todo update` 执行恢复，必须先调用 `loopx todo list --todo-id <tid>` 对账最新 `authority_read.provider_revision` 后再重试，严禁静默 rebase 并发编辑。

### 4. 上游契约锚点与三层能力探针（修订 `REQ-CAPABILITY-1`，Q3 方案 A）

1. **上游锚点与非 Pin 原则**：
   - 契约基线锚定 **`loopx-project/loopx@f4c5d6d7`**（本机实测 `loopx 2.3.0`）。
   - 继续坚持 [ADR-0010](0010-command-contracts-and-execution-protocol.md)“不 Pin 精确版本号”原则，避免日常 `pip install --upgrade loopx` 小版本升级被无故阻断；以集中式能力探针（`probe_loopx_capabilities`）承接全部能力与契约兼容性核验。
2. **三层探针契约**：
   - **第 1 层：`--help` 子命令与必填 Flag 签名探针（Fail-Closed）**
     - 按 LoopX 真实子命令帮助入口探测（不得依赖顶层 `--help` 推断）：
       - `loopx todo claim --help`（专属 `action_help`）：探测 `--goal-id`、`--todo-id`、`--agent-id`、`--claimed-by`、`--claim-operation-id`；
       - `loopx todo add --help` / `loopx todo complete --help`（共享 `todo_parser`）：探测 `--required-write-scope`、`--task-domain`、`--task-repository`、`--validation-command`、`--operation-id`、`--claim-operation-id`、`--task-class`、`--decision-scope`、`--decision-outcome`、`--global-gate`；
       - `loopx change-quality prepare --help` / `record --help` / `verify --help`（二级子命令树）：探测 `--goal-id`、`--result-json`、`--execute`、`--base-ref` 及严格收据参数；
       - `loopx pr-review --help`：探测 `--check-merge-readiness`、`--check-result`；
       - `loopx goal-lifecycle --help`、`loopx bootstrap --help`：探测 `stop` / `sync-global` / `--goal-id` / `--state-file`；
       - `loopx integration-branch --help`：探测 `configure` / `status` / `sync`（仅对 `integrate` 为 BLOCK，`doctor` 查其他命令仅 WARN）；
       - `loopx issue-fix --help`：探测 `feasibility`（仅对 `issue` 为 BLOCK，`doctor` 查其他命令仅 WARN）；
       - `loopx goal-acceptance --help`（默认 WARN 档；仅当显式启用可选 `goal-acceptance` 校验时按契约核验）。
     - 保留 [ADR-0010](0010-command-contracts-and-execution-protocol.md) 的 BLOCK / WARN 两档 Required Capability Set 成员划分，并将 `todo.lease` 的底层探测口径升级为受管 Todo 执行签名（`todo claim` / `todo complete` 必填 Flag，不再探测 `task-lease acquire/release`）。任一 BLOCK 能力缺失或探测为 `UNKNOWN` → 相关 L0 命令立即非 0 阻断；WARN 能力缺失或 `UNKNOWN` → 输出 WARN 并披露降级。
   - **第 2 层：JSON 载荷 `schema_version` 白名单探针（Fail-Closed）**
     - 编排层消费任何 LoopX `--format json` 载荷前，必须校验其 `schema_version` 位于受支持白名单内：
       - **Todo 事务**：`loopx_coordination_todo_claim_result_v0`、`loopx_coordination_todo_update_result_v0`、`loopx_coordination_todo_terminal_lifecycle_result_v0`；
       - **状态与任务图**：`task_graph_projection_v0`、`agent_lane_next_action_projection_v0`；
       - **质量与审查**：`change_quality_prepare_packet_v2`、`change_quality_receipt_v2`、`change_quality_receipt_verification_v2`、`pull_request_review_execution_contract_v2`、`pull_request_review_result_v1`；
       - **可选扩展**：`goal-acceptance` 在启用时同样须通过其白名单 `schema_version` 校验。
     - 一旦出现未知 `schema_version`、缺失 `schema_version` 或非预期 JSON 结构，立即 **Fail-Closed 非 0 退出**，并输出结构化 **《LoopX 升级契约差异诊断卡》**（含当前 `loopx --version`、触发命令、期望与实际 Flag/`schema_version`、影响范围与适配定位），严禁静默降级或 fail-open。
   - **第 3 层：版本号软提示（Soft Advisory，非阻断）**
     - 读取 `loopx --version` 并与当前已验证锚点（`2.3.0` / `loopx-project/loopx@f4c5d6d7`）比对：若版本号变化但第 1 层 Flag 签名与第 2 层 `schema_version` 白名单全部通过，仅输出 `WARN` 软提示（建议执行本地金丝雀自测），**不阻断命令执行**。
3. **`doctor` 能力矩阵呈现**：
   - `loopx-flow doctor` 调用集中式探针并输出「能力 → 探测信号 → PASS / WARN / BLOCK」矩阵；对关键能力缺失/`UNKNOWN` 或 `schema_version` 失配输出《LoopX 升级契约差异诊断卡》。

### 5. 隔离 Registry Real-CLI Canary 验证边界

1. **Real Isolated CLI（本地 `loopx` 主路径与升级金丝雀）**：
   - 本地 `loopx` 正常流转与边界恢复测试（覆盖 `bootstrap` → `register-agent` → `todo add` → `loopx-flow todo claim` → `loopx-flow todo done`，含 `hard_lease` / `soft_claim`、同 Owner 补领、过期/释放/异主/`deferred` 停机并透出 `recovery`），必须在临时隔离目录（`$LOOPX_TMP_DIR` 或测试临时沙箱）通过独立 `--registry` 与 `--runtime-root` 调用本机**真实 `loopx` 二进制**，并在 `after/finally` 彻底清理。
   - **硬性不变量**：测试结束后，主仓库 `.loopx/registry.json` 与宿主机 `~/.loopx` 必须 **0 残留**。
2. **Contract Fake CLI（外部网络与负向故障注入专用）**：
   - 仅允许用于隔离外部网络（如 `gh`）或构造负向能力缺失、未知 `schema_version` 故障注入（ADR-0010 T2 / T3），且必须严格校验 `argv` 与 `stdin`；禁止再使用无状态 `echo ... && exit 0` 假脚本代替真实 `loopx` 测试正常流转。

### 6. 实现验收门（`Implemented → Verified` 门槛，非 `Accepted` 门槛）

下游 `W3`（`#41`）与 `W4`（`#42`）在进入 `Verified` 前必须全部实测通过：

- **T1（受管全链路 Real-CLI Canary）**：在隔离 Registry 下使用真实 `loopx` 分别跑通 `hard_lease` 与 `soft_claim` 模式的 `todo claim` → 写入五元组缓存 → `todo done` 原子完成与释放租约 → 清理缓存，验证主仓 `.loopx/registry.json` 0 残留；
- **T2（Q1 分流 A）**：删除五元组缓存但保持租约有效且同 Owner，`todo done` 自动补领 receipt 并成功完成；
- **T3（Q1 分流 B）**：分别构造租约已过期（`lease_state=expired`）、已释放、异主持有与 `deferred` 挂起态，`todo done` 一律非 0 Fail-Closed 停机并原样透出 LoopX `recovery` 指引，确认未触发静默重 `claim`；
- **T4（五元组防串用）**：篡改缓存中 `goal_id` / `todo_id` / `agent_id` / `registry_path` / `handoff_mode` 任一字段或写入损坏 JSON，`todo done` 拒绝直接复用该缓存；
- **T5（三层探针与 ADR-0010 T2/T3）**：使用 Contract Fake CLI 模拟 BLOCK 能力缺 Flag、探测 `UNKNOWN`、未知 `schema_version` → 非 0 阻断并输出《LoopX 升级契约差异诊断卡》；模拟 WARN 能力缺失 → WARN 披露降级；仅变更 `loopx --version` 而签名与 `schema_version` 均兼容 → 软提示不阻断；
- **T6（API 分层静态守卫）**：静态守卫验证除 `doctor` 外，`bin/loopx-flow` 无直接调用 `task-lease acquire/release/renew`。

## 否决

- **否决继续修补手工 `task-lease` 路径**（如补存 `lease_idempotency_key` 与手写 `handoff_mode` 分支）：在编排层复制 LoopX 底层租约状态机违背薄编排原则，后续任何上游 Lease 演进仍会导致断裂。
- **否决过期 / 释放 / 转让 / `deferred` 态静默自动重新 `claim`**：会掩盖并发交接冲突与人工挂起意图，违背 Fail-Closed 原则（Q1 已明确否决）。
- **否决硬锁精确 LoopX 版本号（Version Pinning）**：会误杀日常 `pip install --upgrade loopx` 兼容小版本升级（违背 ADR-0010 与 Q3 方案 A）。
- **否决仅做版本号 WARN 或顶层 `--help` 粗粒度匹配**：无法拦截二级子命令 Flag 变更或 JSON `schema_version` 破坏性升级，存在 fail-open 隐患。
- **否决将 `$LOOPX_TMP_DIR/claims/<gid>--<tid>.json` 升格为持久化状态库或账本**：它仅是跨进程凭证缓存，不得拥有与 LoopX 并行的权威执行状态（严守 ADR-0008 底线）。
- **否决继续用无状态 Mock 替代本地 `loopx` 主路径测试**：历史教训已证明无状态假脚本会系统性掩盖真实 CLI 契约失配。

## 修订

- **PRD（[docs/prd/loopx-workflow.md](../prd/loopx-workflow.md)）**：
  - 修订 `REQ-LEASE-1`：删除旧手工 `task-lease inspect/acquire/release` 与代际 SHA-256 幂等键描述，替换为受管 `loopx todo claim/complete` 委托、`$LOOPX_TMP_DIR/claims/<gid>--<tid>.json` 五元组凭证缓存及 Q1 双分流停机恢复契约，并引用 `ADR-0015`。
  - 修订 `REQ-CAPABILITY-1`：补充上游锚点 `loopx-project/loopx@f4c5d6d7`、三层能力探针（`--help` 子命令签名 + `schema_version` 白名单 Fail-Closed + 版本号软提示 + 《LoopX 升级契约差异诊断卡》）、受管 Todo 能力口径对齐与隔离 Registry Real-CLI Canary 边界，并引用 `ADR-0015`。
- **设计（[docs/design/loopx-workflow-design.md](../design/loopx-workflow-design.md)）**：
  - 修订 §3 命令总表：`doctor` 与 `todo list|claim|done` 行同步 ADR-0015 口径；
  - 修订 §3.1「L0 命令契约与能力矩阵」：补齐缺失的「前置与后置条件」「证据契约」2 列（覆盖全部 13 条 L0 命令，正式关闭 ADR-0010 项 1），更新 `todo` 契约与三层探针/`schema_version` 白名单能力矩阵；
  - 新增 §3.2「L0 7 步执行协议及六结果语义」（补齐 ADR-0010 `REQ-L0-PROTOCOL-1` 正文，原 §3.2 环境治理节顺延为 §3.3）；
  - 修订 §10「失败矩阵」：按六结果语义补充结果列，退役旧手工 `task-lease` 条目，新增受管 Todo 五元组缓存、Q1 双分流停机恢复与三层能力/`schema_version` Fail-Closed 条目。
- **既有 ADR（[docs/adr/0010-command-contracts-and-execution-protocol.md](0010-command-contracts-and-execution-protocol.md)）**：
  - 在末尾「增补决策：`REQ-LEASE-1`」节显式标注 `Superseded by ADR-0015` 并附交叉引用链接（保留历史决策上下文不删）。
- **退役**：
  - 退役 `bin/loopx-flow` 手工 `task-lease inspect/acquire/release`、SHA-256 幂等键派生及无子命令 `loopx todo --status done` 的旧设计口径（对应代码删除在下游 `W3` `#41` 执行）。

## 不做什么

- 不在本 ADR（`W2` 纯文档批次）修改任何代码、脚本、测试或 `.loopx/` 运行态文件；`W3`（`#41`）与 `W4`（`#42`）须待人类 Maintainer 将本 ADR 签批置为 `Accepted` 后方可启动。
- 不在本 ADR 定义独立命令 `loopx-flow todo sync <feature>`、`04-contract.md` Story 执行表及双层写范围越界核验（归独立 `ADR-0016` / `W9` `#47` 与 `W10` `#48`）。
- 不在本 ADR 实现 `status --next` 只读投影（归 `W8` `#46`）或 `cmd_merge` 可选 `goal-acceptance` 校验开关（归 `W11b` `#51`，其将复用本 ADR 的三层探针与 `schema_version` 白名单）。
- 不修改 LoopX 上游控制面源码，也不在 LoopX 状态模型中假设或新增自定义字段。
- 不修改展示类 HTML 页面（`docs/guides/loopx-workflow-architecture.html`）。
