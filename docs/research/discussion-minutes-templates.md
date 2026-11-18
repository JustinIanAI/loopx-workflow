# LoopX-workflow 定位评审 · 讨论纪要

> **用途**：配合 [2026-11-11-application-orchestration-layer.md](2026-11-11-application-orchestration-layer.md) 记录 6 个决策分支（DB1～DB6）的决议。
> **状态**：**DB1～DB6 已全部决议**（DB5 含 DB5-R 双模式；DB6 = A′ 修订版）。
> **约定**：决议落地时改产品行为走 ADR（改 `REQ-*`）、改命令/失败条件同步改 design、胶囊取舍写 `01-decisions.md`。

---

## 通用填写说明

- **决议状态**：待定 / 采纳 / 采纳-修改 / 否决。
- **退役路径**：填写「delete-first」要删除或替换的旧措辞/旧路径/旧命令。
- **ADR 编号**：决议落地时按 `NNNN` 递增；多 DB 可合并进同一份 ADR。

---

## DB1 · 定位措辞 —— ✅ 已决议

- **关联**：报告 **C1**。
- **决议**：**采纳方案 B**。
  - PRD §1/§6「场景门面」→「**应用编排层**」；新增边界 REQ（建议 `REQ-ORCHESTRATE-1`）：「编排 = 决定与驱动下一步/上下文/校验；Goal/Todo/Lease/Gate/Receipt 的权威与状态完全复用 LoopX；编排器不得另建状态权威」。
- **决议影响**：改 PRD §1/§4/§6/§8 + 新增 `REQ-ORCHESTRATE-1`；design §1/§2；AGENTS 首段。
- **退役路径**：PRD 中「门面」措辞统一替换（保留一处历史引用说明）。
- **ADR 占位**：`0008`。

---

## DB2 · 编排自主度 —— ✅ 已决议

- **关联**：报告 **C2**。
- **决议**：**采纳「编排建议层」**，并明确三层分工：
  1. **Conductor = 调度层**：决定"下一步做什么、调用哪个 skill、如何校验"，依据 LoopX/GitHub/Capsule 读回状态推进；
  2. **底层执行层 = 对应 skills**：实际领域动作由 design-grill / create-prd / user-stories / TDD / code-review 等 skill 执行；
  3. **实现形态 = Skill + Agent 指令 + 少量确定性脚本**，不引入 Temporal/LangGraph 等编排框架。
  - **允许非 Gate 步骤连续执行**；Gate 步骤（Gate1 approve、Gate2 approve/merge）必须显式人工触发。
- **决议影响**：design §4 改为「阶段由 Conductor 依据读回状态**建议/调度**推进，Gate 步骤仍显式」；新增 Conductor 相关 REQ（只读/调度，不拥有状态）。
- **退役路径**：design §4「命令不会自动跑」绝对句 → 改为「非 Gate 步骤可连续执行、Gate 步骤必须显式」；AGENTS 管线 A/B 迁至 `skills/workflow-conductor/`。
- **ADR 占位**：`0008`。

---

## DB3 · 决策治理（ADR vs RFC） —— ✅ 已决议

- **关联**：报告 **C5**。
- **决议**：**采纳方案 B，但更轻**——不引入 RFC（太重）；方案讨论线下为主，不强制新文档。
  - 只吸收两个原则：「设计接受 ≠ 交付成熟」「证据独立可证」，映射到 ADR status + 五态 + 胶囊；
  - ADR 模板可选字段（实现基线/证据引用）**仅按需**，不设为必填；
  - ADR 准入矩阵写进 AGENTS（改变权威/默认行为/非纯增量状态或 Schema/不可逆迁移/共享契约才立 ADR；普通 Feature/Bug 不立）。
- **决议影响**：AGENTS 铁律 2 补准入矩阵；docs/adr/README.md 模板按需加可选字段。
- **退役路径**：无（若已建 `docs/rfc/` 草稿目录则删除）。
- **ADR 占位**：`0008`（准入矩阵并入）。

---

## DB4 · Gate1 规格授权绑定 —— ✅ 已决议

- **关联**：报告 **C7**。
- **决议**：**采纳方案 B**——只锁 04-contract（承载 AC/Scope/Verification Plan）+ 记录 Spec-Commit；不建 Spec-Revision 哈希。
  - `approve` 前置检查：decisions APPROVED + 规格完整（AC/Scope/Verification Plan 存在、Story 有 AC、REQ 引用非空）；
  - **授权记录 = LoopX `user_gate`**（`role=user` + `task-class=user_gate` + `decision-scope other:goal:<contract_sha>` + `decision-outcome=approve`；spec_commit 与 principal 放 `--evidence` 做追溯，不参与门禁）；**不用 `boundary-authority`**（那是写范围授权）；新 approve 取代旧记录，SHA 不一致则旧授权失效；**隔离实验证明同一凭证 agent 可完成 user_gate**，故它是审计记录、不是人机隔离；Gate1 人闸按 `authorization_mode` 配置承担：`single_owner` 由 wrapper 显式 TTY approve + 风险接受，`independent` 由第二审批身份；模式由 init 确认、doctor 校验；
  - `gate verify contract` 扩展为「SHA 绑定 + 最新 user_gate 授权记录」双校验；
  - GitHub 侧 Draft PR 展示 + 结构化 comment 镜像（`gate=1`、contract_sha、spec_commit），失败只 WARN，离线仍可批；**投影不得替代 user_gate**。
- **决议影响**：REQ-CHECKPOINT-1 扩展；新增 REQ-GATE1-AUTH-1；修订 REQ-TRACE-2；04-contract 模板；cmd_approve 前置检查与授权记录；gate verify contract 双校验；00-INDEX 规格包清单。
- **退役路径**：02/03/05 中重复的 AC/Scope 叙述 → 改为指向 contract。
- **ADR 占位**：`0009`。

---

## DB5 · Gate2 决策面与身份 —— ✅ 已决议（A + DB5-R 双模式）

- **关联**：报告 **C9/C10**。
- **决议**：**采纳方案 A**（正式模式）+ **DB5-R 双模式策略**（解决单人仓库的非作者审批问题）。
  - `review` 发布 formal review（`gh api`，Agent 发 COMMENT，**绝不代发 author-owned 批准标题**）；
  - `merge` 校验 formal review `commit_id==headRefOid`、`isDraft=false`、author/fallback；
  - 补齐 CI workflow、分支保护/ruleset、审批身份。

### DB5-R · 非作者审批与单人仓库降级策略

- **核心**：采用双模式，**不把技术身份隔离等同于人员职责分离**。

| 项目 | 正式模式（Mode A） | 单人维护模式（Mode B） |
|---|---|---|
| 适用条件 | 有独立审批人员 | 只有一个实际维护者 |
| Agent Review | 必须 | 必须 |
| 人类授权 | 非作者真实人员 | 仓库 Owner 本人 |
| GitHub Approval | 必须 | 不宣称满足 |
| Merge 执行 | 受保护分支约束 | 受控授权后执行 |
| 职责分离 | 已实现 | 未实现 |
| 风险披露 | 常规审计 | 必须显式记录 |

- **Mode A（正式 Gate2）**：非作者真实团队成员 GitHub `APPROVE`；分支保护/Ruleset 强制 `Require a pull request + Required approving reviews ≥1 + Require approval of most recent push + Dismiss stale approvals + 禁止管理员绕过`；合入前校验审批覆盖的 head 与当前 HEAD 一致。
- **Mode B（Owner Release Authorization，受限）**：不建第二个自控账号、不让 Bot/App 冒充审批人；Agent Review 完成后，Owner 本人执行**显式 Release Authorization**（新增 L0 命令 `release-approve`，交互式确认 + 记录授权人/head/contract/reason），并显式记录风险接受；**不宣称满足非作者审批、不具备双人职责分离**。
- **Mode C（GitHub App）**：定位为**授权执行器（Authorization Enforcer）**，非审批主体——校验 Gate2 授权记录/PR/HEAD/Contract/CI/Findings 后执行 Merge 并留审计；禁止用 App 自动 `APPROVE` 冒充审批人。

- **强制约束**：① 第二账号只有由另一位真实人员独立控制才可作审批主体；② Bot/App 不得作人类审批主体；③ Mode B 必须记录风险接受声明，不得伪造 Non-author Approval；④ 不得通过普通命令/Agent 指令/App 自动化绕过正式模式审批；⑤ 从 Mode B 转 Mode A 时必须启用正式分支保护。

- **授权证据模型**（Mode A 以 GitHub 自身 review 记录为权威；Mode B 由 `release-approve` 落库）：

```
release_authorization:
  mode: independent_approval | single_owner
  pr_number / head_sha / contract_sha
  agent_review: {status, findings_resolved}
  human_authorization: {principal, decision, timestamp}
  separation_of_duties: {required, satisfied}   # 派生字段，永不由 Agent 自声明
  risk_acceptance: {required, accepted_by, reason}  # 仅 Mode B
```

- **落档微调（3 条）**：
  1. Mode B 的 `release-approve` 是**过程控制**（人机交互式确认），非密码学分离——如实声明，不冒充 Non-author Approval；
  2. `separation_of_duties.satisfied` 必须**派生**自可观测事实（reviewDecision + reviewer≠author + 分支保护读取），Agent 不得自行声明；Mode B 下恒为 false；
  3. Mode 是**仓库级显式配置**（不自动推断），`doctor` 校验「声明模式 vs 实际 GitHub 保护配置」一致性，失配 fail-closed；`merge` 仍做 head 绑定（纵深防御）。

- **实现任务**：DB5-R1（正式模式保护规则，无独立审批人时 Merge 必被阻止）；DB5-R2（单人模式 `release-approve` 授权 + 风险记录）。
- **决议影响**：REQ-CHECKPOINT-2/3 扩展（+Mode 分支）；新增 `release-approve`（并入 DB6「加不减」）；review 发布通道；doctor 前置检查；.github/workflows。
- **退役路径**：authentic-review 的 issue-comment-only 发布；PR 模板 8 项表与生成正文重复；「单账号风险写进 ADR 即成立」的旧表述。
- **ADR 占位**：`0008`（Gate2 绑定）+ `0012`（决策面/CI + DB5-R）。

---

## DB6 · Workflow 命令体系与场景封装定位 —— ✅ 已决议（A′ 修订版）

- **决议**：**A′——保留场景命令门面，定位为 Agent/Conductor 使用的研发最佳实践封装**；不删除命令，收紧命令契约、只读诊断与版本兼容边界。
- **最终原则**：LoopX-workflow 保留场景命令，但每条命令必须体现研发最佳实践，而不是重复暴露 LoopX 原生接口。

### 1. 命令三层定位

| 层级 | 命令 | 调用者 | 职责 |
|---|---|---|---|
| **L0 Workflow Operations** | feature / approve contract / todo / integrate / check / issue / gate verify / pr / review / respond / merge | Conductor / Agent | 封装研发场景最佳实践，组合 LoopX 原生能力、Skills、Agent 和 GitHub 操作；产生业务副作用 |
| **L1 Read-only Diagnostics** | doctor / status / status --next / context | 人 / Agent | 读取真实状态、环境诊断和下一步建议，**不修改业务状态** |
| **L2 Bootstrap** | init | 人 / Agent | 初始化项目接入配置与必要骨架（一次性/幂等） |

> L0 命令**不是** LoopX CLI 的简单转发器，而是具有独立研发场景语义的操作契约（前置条件 / 原生能力映射 / 执行约束 / 后置条件 / 失败策略 / 证据要求）。例如 `review` 调用 Review Skill/Agent 产出 Findings 再接入 LoopX 质量验证，`merge` 组合 GitHub 审批 + Merge Readiness + HEAD 一致性 + 收尾。

### 2. 设计原则「包装 = 最佳实践编码」

- 不以调用 LoopX 原生命令的数量判断价值，而以是否固化研发场景中容易遗漏的正确约束判断。
- design §3 命令表增加字段：**LoopX 原生能力映射 / Workflow 增强约束 / 前置条件与后置条件 / 失败与恢复策略 / 证据契约**。
- 示例（易遗漏 → 应固化）：feature 的 Goal 类型+严格收据配置；todo 的 owner+幂等+依赖；check 的真实验证+Receipt 映射（禁止假通过）；merge 的审批身份+双 HEAD+幂等收尾。

### 3. LoopX 版本兼容（不 Pin，改为能力探测）

- 不强制 Pin LoopX 版本；`doctor` 检查版本、CLI/API 能力与关键契约兼容性。
- 三档：兼容但版本不同 → **WARN**；缺非关键能力 → **WARN + 披露降级**；缺关键授权/质量/安全能力或语义不兼容 → **BLOCK**。
- 引入 **Required Capability Set**（必需能力集合），按能力契约而非版本号判兼容。
- REQ-FACADE-2 收紧为「应用层场景封装能力不足时**受控降级**到原生能力」：必须披露绕过原因、记录调用与结果，且**不得绕过 Goal/Gate/Receipt/Review/Merge 等权威控制约束**。

### 4. 命令保留与新增

- 全部现有命令**保留**（feature / approve contract / todo / integrate / check / issue / gate verify / pr / review / respond / merge / doctor / status / context / init）。
- 新增：`status --next`（只读分析当前状态 + 下一步推荐 + 原因，不执行）、`pr create --draft`、`pr ready`。
- 恢复能力：**不设独立 `resume` 命令**；恢复由 Conductor 重读真实状态后自动完成，`feature <name>` 支持识别已有 Goal 并进入恢复路径（幂等重入）。
- 修复：todo claim(#12)、issue schema、archive/feature 幂等、质量 Receipt、Merge 校验。

### 5. 统一 L0 执行协议

所有 L0 命令遵守：

`Resolve Context → Validate Preconditions → Execute → Validate Postconditions → Persist Evidence → Commit Checkpoint → Return Result`

统一结果：`SUCCESS / FAILED / BLOCKED / PARTIAL / NEEDS_HUMAN / NOT_VERIFIED`。
跨系统副作用必须先读回真实状态，再决定重试/补偿/恢复，避免重复创建、重复合并、伪造完成。

### 6. PR 生命周期与双 Gate

`pr create --draft`（Gate1 前，呈现规格与决策材料）→ Gate1（批准 Specification Package，锁 Contract + Spec-Commit）→ 同 PR 内实现/验证 → Agent Review（COMMENT，不等同审批）→ `pr ready`（进入最终审阅，不代表合并授权）→ Gate2（非作者身份正式批准）→ `merge`（校验审批身份 + Merge Readiness + 双 HEAD 后合入）。

### 落档微调（采纳时附加，4 条）

1. **「Commit Checkpoint」措辞**：checkpoint = 本次操作的**持久化产物**（LoopX Receipt / Git Commit / GitHub PR / 胶囊文件）作为恢复依据；**不新增独立 checkpoint 日志/账本**（守住 ADR-0002）。
2. **六结果状态是 Conductor 语义视图，非 6 个新退出码**：shell 契约仍 0/非 0；BLOCKED/PARTIAL/NEEDS_HUMAN/NOT_VERIFIED 由输出 + 真实状态读回推导，避免破坏既有 fail-closed 契约与测试。
3. **Required Capability Set 必须落在可探测信号**（子命令存在 / help / 契约版本），且最小化（只列承重能力）；写 design §3 + doctor 常量，不建通用能力注册表。
4. **命令契约字段作为 design §3 命令表字段（散文/表格），不另建 YAML 机器契约**（避免与 design 漂移的第二正文）。

### 最终定位（一句话）

LoopX 是通用 Agent 执行控制面；LoopX-workflow 是研发领域的最佳实践应用层；Conductor 是应用层调度者；Skills 是领域能力实现单元；L0 命令是可复用的场景操作契约；GitHub 是规格审阅、代码交付与人工决策界面。

- **ADR 占位**：`0010`（命令契约/能力兼容/统一执行协议）+ `0012`（PR 生命周期/决策面）。

---

## 决议汇总表

| DB | 状态 | 日期 | ADR 编号 | PRD/design 变更 | 退役路径 |
|---|---|---|---|---|---|
| DB1 定位措辞 | ✅ 采纳 B | 2026-11-11 | 0008 | PRD §1/§4/§6/§8 + REQ-ORCHESTRATE-1；design §1/§2；AGENTS 首段 | 统一替换「门面」措辞 |
| DB2 编排自主度 | ✅ 采纳（编排建议层） | 2026-11-11 | 0008 | design §4 + Conductor REQ；AGENTS 管线迁至 skill | design §4 绝对句 |
| DB3 决策治理 | ✅ 采纳 B（更轻） | 2026-11-11 | 0008 | AGENTS 铁律2 准入矩阵；ADR 模板可选字段按需 | 无 |
| DB4 Gate1 绑定 | ✅ 采纳 B | 2026-11-11 | 0009 | REQ-CHECKPOINT-1；04-contract 模板；cmd_approve | 02/03/05 重复 AC/Scope → 指向 contract |
| DB5 Gate2 身份 | ✅ 采纳 A + DB5-R | 2026-11-11 | 0008 + 0012 | REQ-CHECKPOINT-2/3 + Mode 分支；release-approve；review 发布通道；CI/保护 | issue-comment-only；PR 模板 8 项表重复；「单账号即成立」旧表述 |
| DB6 命令体系 | ✅ 采纳 A′ | 2026-11-11 | 0010 + 0012 | design §3 命令契约字段 + REQ 能力兼容/统一执行协议 | 无删除；「薄转发器」语义退役 |
