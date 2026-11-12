# LoopX-workflow「应用编排层」定位评审报告

> **状态**：Research / Draft（讨论稿，非规范文档，不参与产品裁决）
> **日期**：2026-11-11
> **评审方式**：design-grill（代码库感知 + 第一性原理 + 复杂度治理）
> **待评审定位**：loopx-workflow 作为**应用编排层**，专用于研发场景的流程编排，底层**完全复用 LoopX** 来完成 Agent 的控制面能力。
> **流转约定**：本报告只做「冲突识别 + 建议吸收 + 决策分支」；逐项讨论形成决议后，才按 `REQ-TRACE-1` 走 ADR（改 `REQ-*`）或修改 PRD/design。**本报告本身不修改任何 PRD / ADR / design / 代码。**

---

## 0. 摘要与结论

1. 待评审定位与现有 PRD 的差异，实质只有**一处措辞 + 一处行为**：
   - 措辞：PRD 称「场景门面」（[PRD §1](docs/prd/loopx-workflow.md#L15)），本定位称「应用编排层」；
   - 行为：PRD 明确「命令不会自动跑完阶段 1 到 4」（[design §4](docs/design/loopx-workflow-design.md#L96)），而「流程编排」隐含 Conductor 自主推进。
2. 冲突共 **12 项**，集中在三类：① 编排层越界自建控制面状态（恢复协议 / 五态迁移机 / 追溯登记 / 证据账本 / 独立 spec revision）；② 照搬 LoopX 仓库的 RFC 制度；③ 命令面删减与命名复用。
3. 可吸收建议 **14 项**，核心价值是 6 条设计原则 + 证据真实性 + Gate 授权语义。
4. 需逐项讨论的**决策分支 6 个**（见 §4），每个都先给推荐。
5. 底线不变：编排器**不得**成为第二控制面、第二状态机、第二正文、第二质量引擎（[PRD §6](docs/prd/loopx-workflow.md#L82)、[ADR-0002](docs/adr/0002-merge-compensation.md#L12)）。

---

## 1. 判定基线：当前 PRD 是怎么划边的

现有正文已把「编排」与「控制面」分开，但用词是「门面」而非「编排层」：

| 来源 | 原文 | 行 |
|---|---|---|
| PRD §1 | 「LoopX Workflow 是给已经在用 LoopX 的人和编码 Agent 用的**场景门面**……质量裁决、租约、缺陷路由和预集成仍由 LoopX 控制面做出，**编排器不另做一套**。」 | [L15](docs/prd/loopx-workflow.md#L15) |
| PRD §4 | 「LoopX 继续做控制面；本仓库只做**场景编排和证据落点**。」 | [L44](docs/prd/loopx-workflow.md#L44) |
| PRD §6 | 「替代：把 LoopX 再包一层自有状态机。那是第二套控制面，本产品不做。」 | [L82](docs/prd/loopx-workflow.md#L82) |
| PRD §8 | 「不替换 LoopX 控制面，不在编排器里重判可行性路由。」 | [L218](docs/prd/loopx-workflow.md#L218) |
| design §1 | 「租约、收据、合入锁、可行性路由、Goal 停机 → LoopX CLI；`loopx-flow` 不得改写其结论。」 | owner 表 |
| design §4 | 「阶段是人读的顺序。**命令不会自动跑完阶段 1 到 4**。」 | [L96](docs/design/loopx-workflow-design.md#L96) |
| REQ-NATIVE-1 | 「`todo` 的租约、`issue` 的 route、`integrate` 的 sync/status，以 LoopX 输出为准。**编排器不在这三个结果上做第二套判断。**」 | [L179](docs/prd/loopx-workflow.md#L179) |

**判定基准（三句话）**：

1. **编排** = 决定并驱动「下一步做什么、在哪个上下文、如何校验产物」——业务层，本仓库职责；
2. **控制面** = Goal / Todo / Lease / Gate / Receipt 的权威与状态——LoopX 职责，完全复用；
3. **编排层不得**另建状态权威、另建决策正文、另建质量判定，否则退化为第二控制面。

---

## 2. 冲突清单（调研结果 vs 现行 PRD/ADR/design）

| # | 调研主张 | 冲突的现行条款 | 冲突性质 | 证据 |
|---|---|---|---|---|
| C1 | 定位为「研发应用层 / 自主工作流」 | PRD §1「场景门面」、§8「不替换 LoopX 控制面」 | 措辞级（可升级为「应用编排层」+ 一条边界 REQ） | [L15](docs/prd/loopx-workflow.md#L15)、[L218](docs/prd/loopx-workflow.md#L218) |
| C2 | 命令/阶段由 Conductor 自主推进 | design §4「命令不会自动跑完阶段 1 到 4」 | 行为级（需 ADR 决定「编排自主度」） | [L96](docs/design/loopx-workflow-design.md#L96) |
| C3 | 统一 Execute→Produce→Validate→Persist→Checkpoint→Continue 恢复协议 + resume 引擎 | ADR-0002「以可观测状态做幂等，**不新增独立状态机**」、REQ-GOAL-1 | 越界（第二控制面/第二状态机） | [L12](docs/adr/0002-merge-compensation.md#L12)、[PRD L180](docs/prd/loopx-workflow.md#L180) |
| C4 | 五态「证据绑定迁移」/ 状态账本 / 迁移机 | REQ-LIFECYCLE-5STATE-1（仅语义，无 owner/证据强制）；00-INDEX 应为投影 | 越界（第二状态机） | [L140](docs/prd/loopx-workflow.md#L140) |
| C5 | 引入 RFC / Delivery Maturity / Execution Ledger / Evidence Registry | ADR-0001「产品正文唯一、ADR 是唯一增量」；LoopX CLI 无对应一等对象 | 越界（第二决策体系） | [ADR-0001](docs/adr/0001-product-source-of-truth.md) |
| C6 | 胶囊新增 06-delivery.md / 拆 Decision-Execution-Evidence 三类资产 | REQ-CAPSULE-1 固定 00~05 六个文件 | 资产级 | [L132](docs/prd/loopx-workflow.md#L132) |
| C7 | 独立 Spec-Revision 清单 + gate verify spec | REQ-CONTRACT-LOCK-1「contract_revision 只比 04-contract」、REQ-CHECKPOINT-1 | 契约语义级 | [L148](docs/prd/loopx-workflow.md#L148)、[L126](docs/prd/loopx-workflow.md#L126) |
| C8 | 删除 todo / integrate / context / archive 命令门面 | REQ-FACADE-1（命令枚举）、REQ-NATIVE-1（点名 todo/integrate）、AGENTS 铁律 4/7 | 命令面 | [L121](docs/prd/loopx-workflow.md#L121)、[L179](docs/prd/loopx-workflow.md#L179) |
| C9 | Gate1 用 GitHub Draft PR / PR-0 承载授权 | ADR-0006「**否决**日常特性先发 PR-0」、REQ-CHECKPOINT-1 本地原子锁 | 决策面（第三断点风险） | [ADR-0006 L38](docs/adr/0006-document-code-change-governance.md#L38)、[L126](docs/prd/loopx-workflow.md#L126) |
| C10 | 「人只签两次」绝对化 | ADR-0006「L1 ADR 须人类 Accepted」、REQ-DOCS-DELIVERY-1「docs-only 人类 Approve」 | 授权清单 | [ADR-0006 L17](docs/adr/0006-document-code-change-governance.md#L17)、[L141](docs/prd/loopx-workflow.md#L141) |
| C11 | status 聚合 LoopX/GitHub/Capsule（默认轮询） | REQ-ENV-2 GitHub API 50% 预算基线、ADR-0007 | 成本/预算 | [L160](docs/prd/loopx-workflow.md#L160) |
| C12 | 路线命名 R1~R5 | PRD L7 / design L5 已有 R1~R4（补救批次）；P0~P3 为缺陷严重度 | 命名冲突 | [PRD L7](docs/prd/loopx-workflow.md#L7) |

---

## 3. 建议吸收清单

### A. 直接吸收（原则 / 文本，不改码或轻改）

| # | 建议 | 吸收形态 |
|---|---|---|
| A1 | 「设计被接受 ≠ 功能已交付」 | 映射为 ADR status + 五态；Accepted 仅代表设计获批，不含实现/验证/发布 |
| A2 | Goal 是执行权威，Feature≠Goal≠Todo | 写进 design 对象模型：Feature=业务对象，Goal=执行/验收权威，Todo=工作单元；Story 不单开 Goal |
| A3 | Todo 完成 ≠ 目标完成 | 五态迁移由证据驱动：Implemented 需代码+测试进入变更集、Verified 需 AC 证据、Released 需合并+收尾+归档 |
| A4 | 证据独立可证、not_run≠passed、区分真实 vs mock | 05-evidence 增 Oracle / Scope / Real-vs-Mock 列与 6 状态；Mock 必须标注 |
| A5 | PR 是交付证据汇总（六问） | 并入 buildBody：依据 REQ/ADR、关闭缺口、AC 映射、真实 vs mock、Head、未验证项；与既有 8 项表合并去重 |
| A6 | 恢复=读回真实状态、补齐未完成步骤 | status --next 只读诊断 + 现有 merge 前向补偿；不建 journal |
| A7 | 权威位置表（LoopX / Git / GitHub 分工） | 写进 design §1/§9：00-INDEX/证据表/PR 正文都是投影 |
| A8 | 四层架构 + Workflow Conductor | Conductor = skills/workflow-conductor/SKILL.md + 现有命令，move-not-copy，不建编排框架 |
| A9 | design-grill 自主收敛 / create-prd 只产品级 / user-stories 强制 ID | 分 tier：产品级决策仍问人类，feature 级 Agent 自主、用户意图问题集中到 Gate1 |
| A10 | 质量分工：Adapter 只翻译+机械护栏，LoopX change-quality 唯一裁决 | 修订 ADR-0005 定性；ingest 的 validation 必须实测 |

### B. 改造后吸收（需决议 + 立 ADR）

| # | 建议 | 吸收形态 |
|---|---|---|
| B1 | Gate1 升级为 Specification Authorization | AC / Scope / Verification Plan 写入 04-contract；approve 前置检查（decisions APPROVED、规格完整）；记录 Spec-Commit；不建 Spec-Revision 哈希 |
| B2 | Gate2 精确 head 绑定 | merge 校验 formal review commit_id==headRefOid、isDraft=false、author/fallback；补齐 CI + 分支保护 + 审批身份 |
| B3 | 证据 schema（6 状态 + Oracle + Freshness） | ingest 生成真实 05-evidence；Freshness 复用 scope_fingerprint，不建 TTL 账本 |
| B4 | Story→Todo 1:1 + 弱链 + 租约修复 | 用 LoopX todo add + unblocks/successor；修 todo claim（register-agent + owner + idempotency-key） |
| B5 | Issue Pipeline 复用同一 Goal/证据/Gate2 | Fast Path 不得绕过 Gate2；先修 fast-fix-push.sh 直推 main 与 pre-commit 矛盾 |

### C. 暂不吸收 / 拒绝

| # | 建议 | 理由 |
|---|---|---|
| C1 | RFC 体系 / Delivery Maturity 枚举 | 是 LoopX 仓库文档约定，非 LoopX CLI；repo 已用 ADR+五态，再造一层 = 第二决策体系 |
| C2 | 06-delivery.md | 与 PR/00-INDEX/05-evidence/archive 重复；用 00-INDEX Released 小节（由 merge 派生） |
| C3 | workflow/*.yaml、adapters/、独立 trace/freshness 脚本 | transitions=第二状态机；adapters=第 4 套兜底；脚本=第二质量引擎 |
| C4 | Spec-Revision 清单 + gate verify spec | 改 REQ-CONTRACT-LOCK-1 语义；hash 产品 PRD 会误伤所有契约 |
| C5 | trace registry / evidence ledger / freshness TTL | 第二状态存储；freshness 用指纹即可 |
| C6 | 可执行自动恢复 / checkpoint journal | 第二状态机；绕 Gate |
| C7 | 删除 todo/integrate/context/archive | 有事务语义（租约+状态、preview/execute、归档）；删是 churn，违 REQ-FACADE-1/铁律 4/7 |
| C8 | R1~R5 命名复用 | 与既有 R1~R4 / P0~P3 冲突 |
| C9 | 「全局只签两次」绝对化 | 实际有 L1 ADR 人类 Accepted + docs-only 人类 Approve |

---

## 4. 决策分支（先推荐，后提问）

> 逐项讨论时使用 [discussion-minutes-templates.md](discussion-minutes-templates.md)（每个 DB 一份填空模板 + 决议汇总表）。

**DB1 · 定位措辞**
- 推荐：PRD §1/§6 由「场景门面」改为「**应用编排层**」，并新增一条边界 REQ——「编排 = 决定与驱动下一步/上下文/校验；Goal/Todo/Lease/Gate/Receipt 的权威与状态完全复用 LoopX；编排器不得另建状态权威」。
- 否决：升级成「研发应用层 + 自主工作流引擎」的叙事（会把编排读成拥有状态/裁决权）。
- 问题：是否接受该措辞与边界 REQ？

**DB2 · 编排自主度（最关键）**
- 推荐：**编排建议层**——Conductor 依据 LoopX/GitHub/Capsule 读回状态，计算下一步、校验产物、在 Gate 停，但每个状态迁移仍以显式命令执行（人/Agent 按建议调用），**不引入常驻调度循环、不自动 approve/merge**。
- 否决：(a) 维持「命令不自动跑」，仅做命令面（不满足「编排层」）；(b) 全自动连续推进（绕 Gate、成第二控制面）。
- 问题：编排层是「建议下一步 + 校验 + 显式执行」，还是「自动连续推进多阶段」？

**DB3 · 决策治理（ADR vs RFC）**
- 推荐：不建 RFC 层；只吸收「设计接受 ≠ 交付成熟」「证据独立可证」两原则，映射到 ADR + 五态 + 胶囊。ADR 准入矩阵（改变权威/默认行为/非纯增量状态或 Schema/不可逆迁移/共享契约才立 ADR；普通 Feature/Bug 不立）。
- 否决：引入 RFC 目录/成熟度枚举/账本目录。
- 问题：是否同意「扩 ADR 模板可选字段（实现基线/证据引用），不建 RFC」？

**DB4 · Gate1 规格授权绑定**
- 推荐：只锁 04-contract（把 AC/Scope/Verification Plan 并入契约）+ 记录 Spec-Commit；approve 前置检查规格完整性；GitHub 侧用 Draft PR 展示 + 结构化 comment 镜像（gate=1、contract_sha、spec_commit），失败只 WARN。
- 否决：独立 Spec-Revision 清单 + gate verify spec；Gate1 用 PR Approve。
- 问题：是否同意「contract 承载规格 + Spec-Commit 追溯，不建 spec 哈希」？

**DB5 · Gate2 决策面与身份**
- 推荐：review 发布 formal review（gh api，Agent 发 COMMENT，**绝不代发 author-owned 批准标题**）；merge 校验 review commit_id==head；补齐 CI workflow、分支保护/ruleset、非作者审批身份（单账号需第二身份或显式接受风险）。
- 否决：Agent 生成 author-owned fallback 批准标题当 Gate2（假人审）。
- 问题：是否接受「Gate2 需要第二审批身份」这一基础设施前置？

**DB6 · 命令面与恢复形态**
- 推荐：命令**加不减**——保留全部命令，修 todo claim(#12)、issue schema；新增 pr create --draft、pr ready、status --next（resume 等价物，只读）。
- 否决：删除 todo/integrate/context/archive；新增独立 resume 可执行恢复命令。
- 问题：是否同意「只读诊断 + 显式执行 + 加不减」？

---

## 5. 决议流转规范（决议后执行）

1. 每项 DB 决议后，产出记录：决策点 / 否决方案 / 选定理由 / 最小复杂度说明 / 被退役的旧路径（design-grill 输出格式）。
2. 改**产品行为** → 立 ADR，修订 PRD REQ-*；改**命令/失败条件/不变量** → 同时修订 design；胶囊实现取舍 → 01-decisions.md 并链接 ADR。
3. 路线命名用 **M0~M5**；不复用 R1~R4、P0~P3。
4. 不得在决议前直接改 PRD/ADR/design；本报告与后续讨论纪要只作决策输入。

---

## 6. 附录：证据索引

### 6.1 LoopX 2.0.0 能力边界（决定方案形状）

| 能力 | 实测 | 含义 |
|---|---|---|
| Goal acceptance | 有 goal-acceptance，但 criteria 是 argv 命令、owner-only、需 promoted canonical authority；configure-goal 无 acceptance 字段 | AC 落 04-contract；Goal 验收只作可选机器校验 |
| Todo 依赖 | 无 DAG/父子/批量/模板，仅 unblocks/successor 弱链 | Story→Todo 1:1 + 弱链，不承诺任务图 |
| Lease | acquire 必须 --owner+--idempotency-key，owner 须已注册 Agent；hard_lease 原子释放需 promoted authority | 修 todo claim 是前置 |
| Spec revision | 无一等对象，仅 review 证据 spec_basis.spec_revision=commit | 不自建 spec 对象 |
| change-quality | receipt v2 含 scope_fingerprint；verify 按 diff 重算指纹，无 TTL | freshness 复用指纹 |
| pr-review | readiness blockers 完整；结论只认 formal review 或 author-owned 标题 COMMENTED；无发布 CLI | 发布 formal review 需 gh api 变通 |
| evidence registry / ledger / maturity | 无 CLI，仅 LoopX 仓库文档约定 | 不照搬制度 |

### 6.2 仓库现状缺口（本报告建议的 M0 前置）

- ingest 硬编码 validation=passed、05-evidence 硬编码退出码 0（违 ADR-0005）；
- review 只发 issue comment，LoopX readiness 不认（authentic-review.js）；
- 无 CI workflow（.github/workflows 不存在）；main 未设分支保护（gh api .../protection 404）；
- docs-only 豁免只写进 ADR-0006，代码未实现；
- todo claim 缺 --owner/--idempotency-key（issue #12）；issue 读 d.route 与真实 LoopX decision.route 漂移；
- 00-INDEX 生命周期漂移；cmd_archive mv 非幂等；feature 重跑无条件 bootstrap。
