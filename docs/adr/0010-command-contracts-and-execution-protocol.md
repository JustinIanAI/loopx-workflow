# ADR-0010：命令体系与场景操作契约

- **状态**：Accepted
- **日期**：2026-11-12
- **批准**：严君 · 2026-11-12（实现验收 T1–T6 在 Verified 前跑）
- **关联**：[ADR-0008](0008-application-orchestration-layer.md)、[ADR-0009](0009-specification-authorization.md)、[discussion-minutes-templates.md](../research/discussion-minutes-templates.md) DB6、[state-evidence-boundary.md](../research/state-evidence-boundary.md) §6-§8
- **依赖**：ADR-0008 Accepted（定位/权威/Conductor）；ADR-0009 Accepted（authorization_mode 配置与 Gate1 授权契约）。

## 背景

DB6 已决议：保留场景命令门面，但每条命令必须是「研发最佳实践封装」，不是 LoopX 薄转发器；命令由 Conductor/Agent 调用，不是人手打。现行 [REQ-FACADE-1](../prd/loopx-workflow.md#L121) 列出 16 个命令，但缺少统一契约、能力兼容与执行协议；LoopX 升级会改变参数/默认值/Receipt/Gate 语义，单纯版本 WARN 不够；`REQ-FACADE-2` 目前容易被当成绕过编排的后门。

## 决策

1. **命令三层定位（L0/L1/L2）**：
   - **L0 Workflow Operations**：`feature`、`approve contract`、`todo`、`integrate`、`check`、`issue`、`gate verify`、`pr`、`review`、`respond`、`merge`、`archive`、`release-approve`；由 Conductor/Agent 调用，产生业务副作用。
   - **L1 Read-only Diagnostics**：`doctor`、`status`、`status --next`、`context`；只读，不修改业务状态。
   - **L2 Bootstrap**：`init`；项目接入与一次性/幂等初始化。
2. **L0 = 场景操作契约，不是 LoopX 转发器**：每条 L0 命令在 design §3 命令表中必须有字段——**原生能力映射 / Workflow 增强约束 / 前置与后置条件 / 失败与恢复策略 / 证据契约**。判断价值的标准是「是否固化了研发场景中容易遗漏的正确约束」，不是调用了多少条 LoopX 命令。
3. **加不减**：保留全部现有命令；修复参数完整性、owner/幂等、Issue Schema、Receipt 与 Merge 校验。新增：`status --next`（只读诊断）、`pr create --draft`、`pr ready`、`release-approve`（Mode B 交付授权，语义见 ADR-0012）。**不删除**有场景语义的命令；退役的是「薄转发器」语义。
4. **能力兼容（不 Pin 版本）**：引入 **Required Capability Set**，按能力契约而非版本号判断兼容。探测信号限定为可验证事实（子命令存在 / help / 契约版本）。**集合必须分两档并写死成员**：
   - **BLOCK（关键：缺失或 UNKNOWN 即阻断相关命令）**：`goal.bootstrap`（feature）、`todo.lease`（owner/idempotency-key）、`todo.user_gate`（task-class/decision-scope/decision-outcome/global-gate）、`change-quality.strict-receipt`（record/verify + strict flag）、`pr-review.merge-readiness`、`pr-review.check-result`、`goal.lifecycle`（stop + sync-global）、**`issue-fix.feasibility`（`issue` 的唯一语义，缺失即该命令非 0）**、**`integration-branch`（`integrate` 的唯一语义，缺失即该命令非 0）**；`gh` CLI 对 `pr/review/merge/issue/release-approve` 同样 BLOCK。
   - **WARN（非关键：缺失 → 披露降级，不阻断）**：`goal.acceptance`、`change-quality.safe-fix`、OCR/open-code-review、Lark/goal-channel。
   - `issue-fix.feasibility`/`integration-branch` 的 BLOCK **只对 `issue`/`integrate` 生效**；`doctor` 在检查其他命令时发现它们缺失，仅 WARN。
   - 版本不同但关键能力兼容 → WARN；关键能力探到 UNKNOWN → **BLOCK**；非关键能力缺失/UNKNOWN → WARN + 披露降级。`doctor` 输出「能力→探测信号→PASS/WARN/BLOCK」矩阵；`REQ-FACADE-2` 收紧为**受控降级**：必须披露绕过原因、记录实际调用与结果，且不得绕过 Goal/Gate/Receipt/Review/Merge 权威约束。
5. **统一 L0 执行协议（7 步）**：`Resolve Context → Validate Preconditions → Execute → Validate Postconditions → Persist Evidence → Commit Checkpoint → Return Result`。**Checkpoint = 本次操作的持久化产物**（LoopX Receipt / Git Commit / GitHub PR / 胶囊文件），不是独立日志/账本。
6. **统一结果语义（六种）**：`SUCCESS / FAILED / BLOCKED / PARTIAL / NEEDS_HUMAN / NOT_VERIFIED`。它们是 Conductor 的语义视图，**不是 6 个新 shell 退出码**；但**只有 `SUCCESS` 对应退出码 0**：`FAILED/BLOCKED/PARTIAL/NEEDS_HUMAN/NOT_VERIFIED` 一律非 0（PARTIAL 表示副作用已发生但未完成，必须由 Conductor 读回状态后补偿，不能当完成）。
7. **跨系统副作用恢复**：先读回真实状态，再决定重试/补偿/恢复；禁止重复创建 PR、重复合并、伪造完成。复用 `merge` 的可观测状态幂等；`feature` 重入先读 Goal 是否存在；`archive` 移动前判重；`approve` 重跑以新记录取代旧记录。
8. **`status --next` 语义**：只读投影 + 下一步操作建议（当前阶段、已完成、待办、阻塞、推荐命令、理由）；**不执行操作、不写文件、不改 Goal/Todo/Lease/Gate**；不得把建议当已授权动作。它不是独立 `resume` 的替代品；恢复执行由 Conductor 重读真实状态后显式调用命令。
9. **`authorization_mode` 由 `init`/`doctor` 承载**：`init` 确认并写入 `authorization_mode`（`independent|single_owner`，不静默默认），`doctor` 校验声明 vs 实际能力；`approve` 读取配置并 fail-closed（细节见 ADR-0009 决策 12）。
10. **命令契约字段落点**：写入 design §3 命令表（散文/表格），**不另建 YAML 机器契约**，避免第二份会漂移的正文。
11. **测试要求**：每个 L0 命令至少覆盖 成功/失败即停/部分副作用读回 三类；`status --next` 覆盖只读不变式；能力探测覆盖缺失能力 BLOCK/WARN。

12. **数据落点与探测规则（不假设 LoopX 新字段）**：
   - LoopX 原生：Goal/Todo/Lease/Receipt/readiness；Workflow 不得向 LoopX 增加字段或改 schema。
   - Workflow 配置：`loopx-workflow.config.json`（committed，由 `init` 写、`doctor` 校验）。
   - Workflow 工件：`.loopx/reviews/*.json`、`05-evidence.md`、胶囊文件（Git）。
   - GitHub 事实：PR/Review/CI/Merge（只读 gh API）。
   - **能力探测必须可验证**：Required Capability Set 的每一项都要有探测信号（子命令存在 / help / 契约版本），不能靠文档推断；**关键项探测为 UNKNOWN 即 BLOCK**，非关键项 UNKNOWN 按 WARN。`doctor` 输出「能力→探测信号→PASS/WARN/BLOCK」矩阵。
13. **实现验收（Implemented → Verified 前必须跑；不是 Accepted 门槛）**：
   - T1 `status --next` 只读：运行前后 registry/capsule/Git 无变化；
   - T2 用 PATH 注入的假 `loopx`/`gh` 可执行文件模拟关键能力缺失/UNKNOWN → 相关 L0 命令 BLOCK（用假 CLI，不是假测试结果）；
   - T3 缺非关键能力 → WARN + 披露降级；
   - T4 `REQ-FACADE-2` 降级调用必须留下披露记录，且绕 Gate/Receipt 的操作被拒；
   - T5 命令契约表覆盖全部 L0 命令（字段齐全）；
   - T6 `PARTIAL` 场景先读回真实状态、不重复创建/合并。


## 接受前复核（本次评审教训）

- **字段落点**：每个字段写明 LoopX 原生 / Workflow 配置 / Workflow 工件 / GitHub 事实；不假设 LoopX 新字段。
- **保证可观测**：每条 fail-closed 都有具体观测值（命令输出/状态文件/API 字段），不是软文本。
- **测试真实**：T1–T6 必须在隔离环境真实跑过（实现验收门，不是 Accepted 门槛）；能力探测用假 `loopx`/`gh` 二进制模拟，不能用伪造的测试结果。
- **范围不越级**：Gate2 前置（CI/分支保护）不塞进 Gate1 的阻断条件。

## 否决

- 删除 `todo/integrate/context/archive`（有事务语义，且违 REQ-FACADE-1/AGENTS 铁律 4/7）。
- 把命令做成纯 LoopX 转发器（薄门面）。
- Pin LoopX 版本号、只做版本 WARN 而不做能力探测。
- 新增 `workflow/*.yaml` 机器阶段/状态定义或 `adapters/` 目录（第二状态机/第 4 套兜底）。
- 用 `status --next` 自动执行、或新增可执行 `resume` 引擎。
- `REQ-FACADE-2` 作为绕过 Goal/Gate/Receipt/Review/Merge 的后门。

## 修订

- **PRD**：重写 `REQ-FACADE-1`（三层定位 + 加不减 + 新命令）；收紧 `REQ-FACADE-2`（受控降级 + 披露 + 不得绕权威约束）；新增 `REQ-CMD-CONTRACT-1`（L0 契约字段）、`REQ-CAPABILITY-1`（Required Capability Set 与三档兼容）、`REQ-L0-PROTOCOL-1`（7 步 + 六结果语义）、`REQ-STATUS-NEXT-1`（只读 + 建议）。
- **设计**：§3 命令表增契约字段与能力矩阵；§10 失败矩阵按六结果语义补充；新增 §3.2「L0 执行协议与结果语义」。
- **AGENTS.md**：铁律 7 的「优先 loopx-flow」补「受控降级披露」；命令入口说明改为 Conductor/Agent 调用。
- **退役**：纯参数转发的门面语义；「resume 独立命令」计划。**不退役 `status` 的现有行为**：`status` 仍只读，`loopx` 不可用时的退出码保持现状，不纳入失败即停。

## 不做什么

- 不在本 ADR 实现 Conductor 编排循环（只定义命令契约与协议）。
- 不新增第二状态库/checkpoint 日志；不改 LoopX 原生判定。
- 不改变现有命令的退出码契约（0/非 0）；六结果是语义视图。
- 不处理 Gate1/Gate2 授权实现细节（ADR-0009/0012）。
