# ADR-0008：应用编排层定位与权威边界

- **状态**：Accepted
- **日期**：2026-11-11
- **批准**：严君 · 2026-11-11（决策已接受；PRD/design/AGENTS 修订待落）
- **关联**：[state-evidence-boundary.md](../research/state-evidence-boundary.md)、[application-orchestration-layer.md](../research/2026-11-11-application-orchestration-layer.md)、[discussion-minutes-templates.md](../research/discussion-minutes-templates.md)

## 背景

当前 PRD §1 把本仓库定位为「场景门面」，design §4 写「命令不会自动跑完阶段 1 到 4」。两轮调研与状态边界梳理确认：LoopX-workflow 不拥有与 LoopX 并行的权威执行状态，事实由三类权威来源裁决（Git=规范决策、LoopX=执行控制、GitHub/CI=交付审批），Workflow 是跨来源的研发流程协调层。需要把「应用编排层 + 完全复用 LoopX 控制面」的定位、对象模型、权威边界和 Conductor 形态固化为产品约束。

## 决策

1. **定位**：LoopX-workflow 是研发场景的**应用编排层（Application Orchestration Layer）**。要否决的是 **LoopX 薄转发器**与**第二控制面**，不是场景命令本身——场景命令保留（DB6 / REQ-FACADE-1），由 ADR-0010 收紧为场景操作契约。编排 = 决定与驱动「下一步做什么、在哪个上下文、如何校验产物」；Goal/Todo/Lease/Gate/Receipt 的权威与状态完全复用 LoopX。
2. **三类权威来源**：Git 权威（PRD/Design/ADR/Contract/Spec-Commit 等规范与决策事实）、LoopX 权威（Goal/Todo/Lease/Receipt/Change Quality 等执行控制事实）、GitHub/CI 权威（PR/Review/Approval/CI/Merge 等交付与审批事实）。**审批事实归 GitHub/CI**（Gate2 双模式实现见 ADR-0012），Workflow 只做跨来源绑定、校验、投影，**不裁决**。
3. **对象模型**：Feature=业务对象；Goal=执行与验收权威；Todo=工作单元；Feature Capsule=交付规格与证据快照（00-INDEX 是投影，非权威）；Receipt/Review=权威证据；PR=交付与审批界面。默认 **1 Feature : 1 Goal**，Story 不单开 Goal。依据（仅保留已成立的事实）：Gate1 的 `contract_revision`、Goal acceptance、Goal 生命周期收尾都是 **Goal 级单值**，多 Feature 共享 Goal 会使授权锚点互相覆盖、验收与收尾耦合；Story 与同 Feature 其他 Story 共用同一授权、同一交付与同一验收边界。**不做 Program-level Goal : N Features**（需 LoopX 提供 outcome 级授权与 contract revision 锚点）。
4. **状态边界**：Workflow 不维护与 LoopX 并行的权威执行状态。Workflow→LoopX 只有两类动作：**写入**与**只读读回投影**。写入再按语义分五类——业务绑定（feature）、授权绑定（approve contract）、执行控制（todo claim/done）、质量写入（check）、生命周期收尾（merge）；执行控制/收尾是 LoopX 原生控制操作，不是「把数据翻译成 Result Schema」。读回投影 = gate verify / check verify / merge readiness / status / doctor。禁止产生相互竞争的权威状态源。
5. **Conductor（编排建议层）**：以 Skill + Agent 指令 + 少量确定性脚本实现（不引入 Temporal/LangGraph）。Conductor 依据 LoopX/GitHub/Capsule 读回状态计算下一步、路由领域 Skill、校验产物、在 Gate 停；**非 Gate 步骤可连续执行，Gate 步骤（Gate1 approve、Gate2 审批/merge）必须显式人工触发**；Conductor 不拥有 Goal/Todo/Lease/Gate 权威。
6. **决策治理**：不引入 RFC 层。ADR 准入矩阵：仅「改变权威所有者/默认行为/非纯增量状态或 Schema/不可逆迁移/多能力共享契约」才立 ADR；普通 Feature/Bug/测试/文档不立 ADR，引用既有 REQ/ADR。ADR 模板可选字段（实现基线/证据引用）仅按需。
7. **命名**：路线用 M0~M5；不复用 R1~R4（既有补救批次）与 P0~P3（缺陷严重度/Todo 优先级）。
8. **ACTIVE_STATE 处置（运行态与快照分名）**：LoopX canonical state file 是**运行态**，不得作为 Git 版本化交付物与运行态形成双源。修订 `REQ-GOAL-1`：
   - **运行态**：文件名仍为 `ACTIVE_STATE.md`（LoopX canonical），存放于 LoopX runtime 管理的路径（不落胶囊、不入 Git）。
   - **归档快照**：胶囊归档只允许 `ACTIVE_STATE.snapshot.md`（独立文件名），带 `historical_snapshot: true`、生成时间、Goal ID、状态摘要，**不得作为当前权威恢复依据**，可入 Git。
   - `.gitignore` **只忽略运行态路径/文件名**（例如 `.loopx/**/ACTIVE_STATE.md`），不匹配 `ACTIVE_STATE.snapshot.md`。
   - 存量已跟踪文件在 M0 `git rm --cached`；**不自动迁移运行态**。

## 否决

- 升级为「研发应用层 + 自主工作流引擎」的叙事（会把编排读成拥有状态/裁决权，滑向第二控制面）。
- Workflow 自建权威执行状态、checkpoint 账本、五态迁移机、追溯登记/证据账本。
- 引入 RFC 目录 / Delivery Maturity 枚举 / Execution Ledger / Evidence Registry。
- 全自动连续推进阶段（绕 Gate、常驻调度）。
- 把 loopx-flow 定位为纯 LoopX 转发器（薄门面），或删除有场景语义的命令（命令面详见 ADR-0010）。

## 修订

- **PRD**：
  - §1 摘要、§4 目标、§6 价值主张：「场景门面」→「应用编排层」；「本仓库只做场景编排和证据落点」→「本仓库负责研发场景编排、证据落点与跨权威来源投影」。
  - 新增 `REQ-ORCHESTRATE-1`（编排层定位与边界）、`REQ-AUTHORITY-1`（三类权威来源与 Workflow 跨来源职责）、`REQ-CONDUCTOR-1`（Conductor 编排建议层：非 Gate 连续、Gate 显式、不拥有权威）。
  - §7.2 需求追溯补一句：ADR 准入矩阵（仅改变权威/默认行为/状态模型/共享契约/不可逆迁移才立 ADR）。
  - `REQ-NATIVE-1` 保留（编排器不另做第二套判断）。
  - 修订 `REQ-GOAL-1`：运行态 `ACTIVE_STATE.md` 放 LoopX runtime、不入 Git；胶囊只存独立命名的 `ACTIVE_STATE.snapshot.md`（`historical_snapshot: true`，不得作为当前权威恢复依据）。
- **设计**：§1 所有者表（Workflow 行→应用编排层/Conductor）；§2 运行结构（三类权威 + Conductor）；§4（阶段由 Conductor 依据读回状态建议推进，Gate 步骤显式）；§9（ACTIVE_STATE 处置与 Archive Snapshot 语义）。
- **AGENTS.md**：首段定位改为「应用编排层」；管线 A/B 的「命令不会自动跑完」改为 Conductor 口径（DB2）；铁律 2 补 ADR 准入矩阵（DB3）。
- **退役**：design §4「命令不会自动跑完阶段 1 到 4」绝对句 → 「非 Gate 步骤可连续执行、Gate 步骤必须显式」；PRD §1「场景门面」措辞（保留一处历史引用说明）；PRD `REQ-GOAL-1` 旧句「新特性的 LoopX 状态文件放在该特性胶囊内」；AGENTS 管线旧口径；胶囊内以 `ACTIVE_STATE.md` 同时充当运行态与归档快照的旧做法（归档改为 `ACTIVE_STATE.snapshot.md`）。

## 不做什么

- 不在本 ADR 实现 Conductor 代码或新增命令（命令契约/命令面归 ADR-0010）。
- 不引入 RFC 层、不建独立状态库/checkpoint 日志。
- 不处理 Gate1 授权实现（ADR-0009）与 Gate2 双模式/决策面（ADR-0012）。
- 不修改 `docs/guides/loopx-workflow-architecture.html` 展示页。
- 不重写历史胶囊 00-INDEX 正文（只纠偏活跃胶囊状态口径）。
- 不自动迁移/重写已跟踪的 `ACTIVE_STATE.md`；不建立运行态与历史快照的双向同步（存量文件 M0 处理）。
- 不在本 ADR 支持 Program-level Goal : N Features（需 LoopX outcome 级授权锚点）。
