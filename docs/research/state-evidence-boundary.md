# LoopX-workflow 状态与证据边界（调研）

> **状态**：Research / Draft（调研文档，记录现状、源码证据、发现与推导；不承载决策）
> **日期**：2026-11-11
> **用途**：作为 ADR-0008（编排层定位/对象模型/状态边界）的决策输入；先固化「事实」，再在 ADR 固化「决策」。
> **关联**：[application-orchestration-layer.md](2026-11-11-application-orchestration-layer.md)、[discussion-minutes-templates.md](discussion-minutes-templates.md)

---

## 1. 研究范围与核心结论

- **范围**：厘清 LoopX-workflow 在 LoopX 之外持有哪些状态与证据、三类权威来源、绑定/投影的转换关系、以及现有边界泄露。
- **核心结论（一句话，候选 ADR 原则）**：

> LoopX-workflow **不维护与 LoopX 并行的权威执行状态**。它持有版本化规范、决策材料、过程性证据和可重建投影；LoopX 持有 Agent 执行控制状态；GitHub/CI 持有代码交付与审批事实。Workflow 通过**显式的权威写入绑定 + 只读读回投影**协调各系统，禁止产生相互竞争的权威状态源。

---

## 2. 对象与存储清单（当前实现）

| 对象 | 类别 | 路径 | 版本化 | 权威 |
|---|---|---|---|---|
| PRD / Design / ADR / AGENTS / Skills | 规范与决策 | docs/、skills/、AGENTS.md | Git ✓ | Git |
| 胶囊规格 | 决策/需求/故事/契约 | specs/features/<f>/01..04 | Git ✓ | Git |
| 胶囊证据索引 | 质量/验证收据索引 | specs/features/<f>/05-evidence.md | Git ✓ | 引用 LoopX 收据 |
| 审查产物 | 过程性证据（自产） | .loopx/reviews/<pr>@<head>.json | 本地未跟踪 | Workflow 自产，非权威 |
| PR 正文 / Review / 评论 | 交付汇总与审批事实 | GitHub | GitHub | GitHub / CI |
| 状态投影 | 可重建视图 | 00-INDEX.md、status、context、doctor、status --next | 部分 Git | **派生，非权威** |
| ⚠️ Goal 状态文件 | LoopX canonical state | specs/features/<f>/ACTIVE_STATE.md | Git（误） | LoopX |

---

## 3. Workflow 在 LoopX 之外的状态与证据分类

| 分类 | 内容 | 权威性 |
|---|---|---|
| 规范与决策 | PRD/Design/ADR（L1/L2）、AGENTS、Skills | Git 权威，回答「批准的规格/决策依据是什么」 |
| 胶囊规格 | 01-decisions、02-prd、03-stories、04-contract、Spec-Commit | Git 权威，回答「这次交付做什么」 |
| 过程性证据 | 05-evidence（索引）、.loopx/reviews（自产）、PR 正文（汇总） | **非裁决**；部分由 Workflow 产生，部分由 LoopX/GitHub/CI 产生，Workflow 做索引/引用 |
| 投影 | 00-INDEX 状态块、status/context/doctor/status --next | **可重建、非权威**，从 LoopX+GitHub 读回 |

> 关键：**Workflow 可以有过程性数据，但不拥有权威执行状态。** `.loopx/reviews/*.json` 是 Workflow 自产的审查产物，不是 Goal/Todo/PR 的权威；00-INDEX 的五态是可读投影，不是裁决依据。

---

## 4. LoopX 权威控制状态与 Evidence Schema

| LoopX 对象 | 权威内容 |
|---|---|
| Goal | 身份、activation、`progress_review.contract_revision`、change-quality 配置、write-scope、registered agents |
| Todo | status(open/done/blocked/deferred)、task-class、unblocks/successor、validation-command、evidence、decision-scope/outcome |
| Lease | owner、idempotency-key、TTL、write-scope |
| Receipt | `change_quality_agent_result_v2`：scope_fingerprint、reuse/simplification/risks/validation/guardrails/decision |
| pr-review | 只读判定：check-result、merge-readiness、approval-closeout |

- `contract_revision` = 契约 SHA256，是 **progress-review 的 observer pin**（progress-review mode grants no pause or gate authority），**只存版本**，不存授权人/时间/范围；执行者是本仓库 `gate verify contract`。
- `change-quality verify` = 按当前 diff **重算 scope_fingerprint + 复验 schema v2 + 重推 guardrails**；**不重跑四门禁**（四门禁真伪是 Workflow `ingest` 的职责）。

---

## 5. GitHub / CI 交付事实边界

| 事实 | 权威来源 |
|---|---|
| PR 当前 HEAD | GitHub |
| Review 是否由非作者批准 | GitHub |
| CI 是否通过 | CI / GitHub Checks |
| PR 是否已合并 | GitHub |

- `pr-review --check-merge-readiness` 的 blockers 覆盖 draft/head/review 结论/approval/CI/threads；approval 认 **formal APPROVED** 或 **author-owned 标题 COMMENTED**。
- **但它不强制「非作者分离」**——author-owned fallback 是单账号逃生口；真正的非作者分离只能由 GitHub 分支保护（DB5-R Mode A）保证，不是 LoopX readiness 的职责。

---

## 6. 三类权威来源 + Workflow 职责

| 需要判断的事实 | 权威来源 |
|---|---|
| Contract 当前版本 | Git |
| Gate1 的 Contract Revision 是否已绑定到 Goal | LoopX |
| Goal 激活 / Todo 完成 / Lease 有效 | LoopX |
| Change Quality 是否满足 LoopX 规则 | LoopX |
| PR HEAD / 非作者审批 / 合并 | GitHub |
| CI 通过 | CI / GitHub Checks |
| Feature 综合展示状态 | Workflow **派生投影** |

> **Workflow 不是新裁决系统，而是跨权威来源的研发流程协调层**：绑定、校验、投影；不裁决。

---

## 7. Workflow → LoopX 写入（两类：绑定 vs 控制操作）

| 类型 | 操作 | 语义 |
|---|---|---|
| 业务绑定 | `feature` | `bootstrap --goal-id --state-file`，创建 Goal + Feature 关联 |
| 授权绑定 | `approve contract` | 04-contract SHA → `configure-goal --progress-review-contract-revision` |
| 执行控制 | `todo claim/done` | `task-lease acquire/release` + `todo --status done` |
| 质量结果写入 | `check` | 四门禁 + findings → `change-quality record` |
| 生命周期收尾 | `merge` | `goal-lifecycle stop` + `retire-global-goal` + `sync-global` |

> 这五类是当前关键业务入口，**不是**"LoopX 唯一五种写入"——它是「把研发场景操作约束映射为 LoopX 原生控制操作」的当前清单。

---

## 8. LoopX / GitHub → Workflow 读回投影

| 动作 | 读回 → 投影 |
|---|---|
| `gate verify contract` | 读 registry `contract_revision` ↔ 04-contract SHA |
| `check` [3/3] | `change-quality verify`（指纹重算）→ 回写 05-evidence |
| `merge` | `pr-review --check-merge-readiness` → 决定合入 |
| `status` / `doctor` / `status --next` | `loopx status` + Goal/Todo + GitHub PR → 渲染 |

---

## 9. Evidence Freshness 与失效机制

| Workflow 证据 | LoopX/GitHub 指纹 | 失效判据 |
|---|---|---|
| 05-evidence 索引 | receipt `scope_fingerprint` | `change-quality verify` 重算指纹不一致 → stale |
| .loopx/reviews/<pr>@<head>.json | GitHub `headRefOid` | review 发布前二次读 HEAD 不一致 → 作废 |
| Gate1 授权 | `contract_revision` + `user_gate` 授权记录 | `gate verify contract`：SHA 不一致，或最新 user_gate 记录未覆盖当前 SHA/Spec-Commit → 作废 |

> 新鲜度 = 「Workflow 证据 ⇄ 权威指纹」的对齐，不是时间戳 TTL。

---

## 10. Gate1：Contract Revision Binding ≠ Authorization Record

**两个概念必须分开：**

| 概念 | 作用 | 现状 |
|---|---|---|
| Contract Revision Binding | 确定被授权执行的规格版本 | ✅ 已实现：`contract_revision` = SHA |
| Gate1 Authorization Record | 记录谁批准、哪个版本、何时、授权范围、是否撤销 | ⚠️ **未成立**：who/when 只是 Git 文本标记 |

- 现状证据：`cmd_approve` 计算带 `FROZEN & APPROVED BY <op>@<ts>` 标记的最终内容 SHA → `configure-goal --progress-review-contract-revision <sha>`；授权人/时间只写进 04-contract 与 01-decisions 的**软文本标记**（可被 Agent 改写、无签名）。
- **授权记录只能用 `user_gate`**（`role=user` + `task-class=user_gate` + `decision-scope` + `decision-outcome=approve`）；它会阻塞 Agent、消耗 decision authority，是**控制**不是日志。
- **`boundary-authority-*` 是 checkpointed write scope**（operator/controller 批准的写范围），**不是**「谁批准了规格包」，不能作 Gate1 记录。
- 结论：**版本绑定成立，授权审计未成立**。ADR-0009 裁定：版本绑定继续用 `contract_revision`；授权记录用 `user_gate`；胶囊/GitHub 只做投影。
- **2026-11-11 隔离实验**：非法 decision-scope 被拒；合法 `other:goal:<64hex>` 可 add；但同一凭证下已注册 agent 可 `todo complete --agent-id agent-a --decision-outcome approve` 完成 user_gate（甚至不带 outcome 也可）。故 user_gate 是审计记录，**不是人机隔离**；Gate1 人闸按 `authorization_mode` 配置：`single_owner` 由 wrapper TTY approve + 风险接受承担，`independent` 由第二审批身份承担；模式由 init 确认、doctor 校验。

---

## 11. 边界泄露与 `.loopx` 治理

### 11.1 ACTIVE_STATE.md 被 Git 跟踪

- 现状：`specs/features/review-pipeline-remediation/ACTIVE_STATE.md` 与 3 个归档胶囊的 ACTIVE_STATE.md 在 `git ls-files` 中。它是 LoopX canonical state file，被 Git 跟踪会形成**两个状态来源**（历史提交/其他分支/归档快照可能被误读为当前状态；切分支可能覆盖运行态）。
- 建议：当前运行态不入 Git；如需历史快照，用显式 **Archive Snapshot** 语义（`historical_snapshot: true`、生成时间、Goal ID、状态摘要，**不得作为当前权威恢复依据**）。

### 11.2 `.loopx` 下被 Git 跟踪的 9 个文件（实测性质）

| 文件 | 实测键 | 性质判定 |
|---|---|---|
| config/lark-collector.json | schema_version、enabled、identity、supervisor、routes、lark_cli_bin… | 集成配置，**含 identity（疑似本地身份）** → 需 secret 治理/本地化 |
| config/lark/e2e-pipeline-demo.json | schema_version、enabled、inbox_dir、capture_scope、reply | 采集器实例配置 → 项目/团队配置 |
| goal-channel*.json | schema_version、enabled / bindings | Goal 通知渠道配置/绑定 → 项目策略配置 |
| inbox/e2e-pipeline-demo/processed.json | schema_version、message_ids、last_processed_at | **运行时消息游标 → 不跟踪** |
| lark-kanban.json | schema_version、board、todo_records、updated_at | **看板同步状态 → 不跟踪** |

- 结论：**不能一刀切 `.gitignore`**。`inbox/*`、`lark-kanban.json` 是运行时状态（不跟踪）；`config/*`、`goal-channel*` 是集成/策略配置（按「共享 vs 本地/是否含 identity」再分 `shared/` 与 `local/`）。
- 建议目录治理规则（示意，非现状）：

`
.loopx/
├── config/{shared,local}   # 共享策略配置按需版本化；本地/含身份不跟踪
├── goals/ inbox/ channels/ locks/ reviews/ logs/   # 运行时状态，不跟踪
`

---

## 12. 现状 vs 目标差距 + ADR 决策输入

| 状态 | 内容 |
|---|---|
| 已实现 | contract_revision 绑定；change-quality record/verify 调用；merge 双 HEAD；review head-oid 幂等；merge 前向补偿 |
| 部分实现/有 bug | 四门禁真伪（ingest 硬编码 `passed`）；授权审计（who/when 软标记）；formal review 发布（只发 issue comment）；非作者审批（无分支保护/CI） |
| 设计意图 | 三类权威清晰边界；.loopx 治理；ACTIVE_STATE 脱轨；Gate1 授权记录 |

**写入 ADR 前待核实（4 点，已部分核实）**：

1. `contract_revision` 是否有独立人类授权审计记录 → **无**（仅 SHA；who/when 是 Git 软标记）。§10。
2. `change-quality verify` 裁决范围 → **只验新鲜度+schema+guardrails，不重跑四门禁**。§4。
3. `pr-review --check-merge-readiness` 是否覆盖非作者审批 → **覆盖审批状态，不强制非作者分离**（author-owned fallback）。§5。
4. `.loopx` config/channel/inbox 真实用途 → 已按键名分类（运行时 vs 集成配置）。§11.2。

**ADR 决策输入**：本调研 §6（三类权威）、§7（绑定 vs 控制）、§10（授权记录）→ ADR-0008；§10 的 Gate1 授权记录 + DB4 → ADR-0009；DB5-R 的非作者审批 → ADR-0012。
