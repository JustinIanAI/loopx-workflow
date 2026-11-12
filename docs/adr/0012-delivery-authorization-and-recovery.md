# ADR-0012：交付授权、决策面与跨系统恢复

- **状态**：Accepted
- **日期**：2026-11-12
- **批准**：严君 · 2026-11-12（Mode B 三档判定；实现验收 T1–T9 在 Verified 前跑）
- **关联**：[ADR-0006](0006-document-code-change-governance.md)、[ADR-0008](0008-application-orchestration-layer.md)、[ADR-0009](0009-specification-authorization.md)、[ADR-0010](0010-command-contracts-and-execution-protocol.md)、讨论纪要 DB5-R
- **依赖**：ADR-0008 Accepted；ADR-0009/0010（authorization_mode 与命令契约）；Gate2 实现前必须先补 CI/分支保护（M0）。

## 背景

Gate2 当前结构性不可达：`main` 未设分支保护、无 CI workflow、历史 PR `reviewDecision` 全空；`review` 只发 issue comment，LoopX `--check-merge-readiness` 只认 formal review（或 author-owned 标题 COMMENTED）；`merge` 只检查 `reviewDecision`，不校验 review 的 `commit_id == head`。DB5-R 已决议双模式：正式模式（非作者真实审批）与单人维护模式（Owner Release Authorization），且技术身份不得冒充人类授权。Issue 管线目前只做 feasibility 路由，Fast-Path 直推 main 与 pre-commit 矛盾。

## 决策

1. **Gate2 双模式复用 `authorization_mode`**（与 Gate1 同一仓库配置，由 `init` 确认、`doctor` 校验）：
   - **Mode A（independent）**：非作者真实人员 GitHub `APPROVE`；分支保护/ruleset 强制 `Require a pull request` + `Required approving reviews ≥1` + `Require approval of most recent push` + `Dismiss stale approvals` + 禁止管理员绕过；合入前校验审批覆盖的 head == 当前 HEAD。
   - **Mode B（single_owner）**：不建自控第二账号、不让 Bot/App 冒充审批人；Agent Review 照跑；Owner 执行 `release-approve`（与 `approve` 同一人闸：非 TTY/`--yes` 非 0；principal 取 `gh api user` login，必须等于配置 `single_owner_risk_acceptance.accepted_by`）。分支规则**只保留「必须走 PR」+「Require status checks（必须过 CI）」**，**不要求 approving review**（否则 `gh pr merge` 会被 GitHub 拒绝）；**CI 检查不允许管理员绕过**。**不宣称 Non-author Approval / separation_of_duties**。
   - **Mode C（GitHub App）不是第三种 `authorization_mode`**：它是执行器（Authorization Enforcer）；没有 Mode A 的 formal review 或 Mode B 的 `release-approve` 记录，就不得 merge；禁止自动 `APPROVE` 冒充审批人。
2. **Gate2 绑定与防继承**：`merge` 必须同时校验——① `isDraft == false`；② **Mode A**：formal review `commit_id == headRefOid`、author ≠ PR author、`reviewDecision == APPROVED`；**Mode B**：当前 head 上有 Agent 的 COMMENT，且 `release-approve` 评论的 `head`、`contract_sha` 与当前 PR 一致；③ **readiness 分模式**：
   - **Mode A**：调用 `loopx pr-review --check-merge-readiness <pr>@<head>`，**以 JSON 的 `ready` 字段为准**；`ready != true`（含进程退出码 1）→ 非 0；**不按 blockers/blocking_reasons 过滤**。
   - **Mode B**：解析 readiness JSON 的 `blocking_reasons`（顶层或 `readiness_observation.blocking_reasons`），**三档判定**：命中允许列表 → 非 0；命中忽略列表 → 跳过；两者都不在、`blocking_reasons` 缺失或 JSON 解析失败 → 非 0。允许列表：`pull_request_not_open`、`draft_pull_request`、`remote_head_mismatch`、`status_checks_missing`、`status_checks_failed`、`status_checks_pending`、`status_checks_incomplete`、`review_threads_incomplete`、`unresolved_review_threads`、`merge_state_requires_update`、`merge_state_unverified`；忽略列表：`current_head_review_missing_or_invalid`、`current_head_conclusion_not_approval`、`github_review_decision_not_approved`、`repository_merge_state_blocked`。当前 head 的 Agent COMMENT 仍由第 ② 步单独检查，不依赖 readiness 的审批结论。
   ④ 二次读 HEAD 与锁定一致。Gate1 的批准不得继承为 Gate2；**只有 Mode A 不得用同一凭证自批；Mode B 就是同一个人批，`separation_of_duties` 恒为 false**。Mode A 的授权记录就是 GitHub review 本身，**不要求 `gate=2` 评论**；`gate=2` 只属于 Mode B 的评论正文。
3. **PR 生命周期**：阶段 4 `pr create --draft` 呈现规格包（Gate1 前，正文缺代码证据写 `NOT_PROVIDED`）→ Gate1 → 同一 PR 内实现/验证 → `pr ready`（阶段 7，进入最终审阅，不代表合并授权）→ Gate2 → `merge`。Draft PR 只是投影；Gate1 不使用 PR Approve；`review`/`merge` 拒绝 draft。
4. **Review 发布通道**：`review` 通过 `gh api` 发布 formal review（Agent 发 COMMENT/REQUEST_CHANGES，正文含精确 head + 五段 + verdict）；**自动化绝不生成 author-owned 批准标题**；人类审批只能由 Mode A 非作者或 Mode B `release-approve` 产生。`respond` 只基于对应 HEAD 的 review artifact，精确 head 缺失 fail-closed。
5. **CI 与分支保护是交付基础设施（Gate2 前置，不阻塞 Gate1）**：新增 CI workflow（typecheck/lint/build/test）；`doctor` 检查分支保护/ruleset、审批身份、CI、rate_limit，输出「原因/影响/修复指令」。**这些是 Gate2 的条件**：Gate1 上下文只 WARN，不 BLOCK，避免「没配分支保护就批不了契约」；`merge` 缺失时 fail-closed。**管理员的约束分模式**：Mode A 由 ruleset 禁止管理员绕过；Mode B 的 `release-approve` 只约束 `loopx-flow merge`，挡不住 GitHub 网页合入——网页合入按 T9 做审计告警，不要宣称已被阻止。
6. **恢复**：`status --next` 只读诊断 + `feature` 幂等重入 + `merge` 可观测状态前向补偿；跨系统副作用先读回真实状态再重试；不建 checkpoint journal/第二状态机。
7. **Issue Pipeline 复用同一套能力**：`issue-fix feasibility` 路由后，`fix_pr` 走同一 Goal/Todo/Evidence/Gate2；Fast Path 不得绕过 Gate2；`fast-fix-push.sh` 移除直推 main 路径（改为分支+PR 或显式受控操作），并修 `issue` 的 `decision.route` schema 漂移。
8. **收尾**：`merge` 后执行 `goal-lifecycle stop` + `retire-global-goal` + `sync-global` + archive 移动；失败非 0 并打印「已合入、未闭环」重跑命令；archive 目录存在时判重不嵌套；Goal acceptance 可选（`goal-acceptance` 仅作可选机器校验，当前 owner-only/promoted）。
9. **授权证据模型**：`release_authorization` = mode / pr / head_sha / contract_sha / agent_review（Mode B 要求当前 head 的 Agent COMMENT）/ human_authorization（Mode A review 或 Mode B release-approve 评论）/ separation_of_duties（派生，Mode B 恒 false）/ risk_acceptance（仅 Mode B）。`separation_of_duties` 由配置与可观测身份派生，Agent 不得自声明。

10. **数据落点与可观测定义（不假设 LoopX 新字段）**：
   - **GitHub 事实**（只读 gh API）：`isDraft`、`headRefOid`、`reviewDecision`、`reviews[].commit_id/author.login/state/submittedAt`、checks、mergeable。
   - **LoopX**：`pr-review --check-merge-readiness`、`--check-approval-closeout` 只做检查，不存 Gate2 授权字段。
   - **Workflow 配置**：`loopx-workflow.config.json`（`authorization_mode` + `single_owner_risk_acceptance`）。
   - **Mode A 授权记录**：GitHub formal review 本身（`commit_id==head`，author ≠ PR author）；不需要额外评论。
   - **Mode B 授权记录**：`release-approve` 在 TTY 确认后向 PR 发结构化评论，标记行 `<!-- loopx-flow:release-authorization:<pr>@<head> -->`，正文固定键值串 `gate=2;mode=single_owner;head=<sha>;contract_sha=<sha>;principal=<login>;approved_at=<ts>;risk_acceptance=<accepted_by@accepted_at>`；`principal` 取 `gh api user` login，**`single_owner_risk_acceptance.accepted_by` 也必须等于该 login**（两字符串不一致 → `release-approve` 非 0）；`merge` 用 gh 读回评论并校验 head/contract/mode/author。**这是 Workflow 记录，不是 LoopX 新字段。**
   - **independent Gate1 第二身份证明（ADR-0009 决策 12 交由此处定义）**：`approve` 在 `independent` 下要求 Draft PR 上存在**另一 GitHub 账号**的评论，标记 `<!-- loopx-flow:gate1-authorization:<feature>@<contract_sha> -->`，正文 `gate=1;mode=independent;contract_sha=<sha>;spec_commit=<sha>;approver=<login>`；`approve` 用 `gh api` 校验评论作者 login ≠ 执行者 `gh` login、且 `contract_sha == 当前契约 SHA`（旧 SHA 评论无效）。**这只证明两个 GitHub login 不同，不证明两个自然人；因此是「账号级分离」，不是「真分离」。**
   - `separation_of_duties` 由上述可观测值派生（Mode A review author≠PR author；Mode B false；independent Gate1 comment author≠executor），**Agent 不得自声明**。
11. **实现验收（Implemented → Verified 前必须跑；不是 Accepted 门槛）**：
   - T1 Mode A 的 review `commit_id != headRefOid` → `merge` 非 0；
   - T2 review 落在旧 head（新 commit 后未复审）→ `merge` 非 0；
   - T3 Mode B 缺 `release-authorization` 评论或 head/contract 不匹配 → `merge` 非 0；
   - T4 Gate1 的批准不得继承为 Gate2（gate=1 记录不能当 gate=2）→ `merge` 非 0；
   - T5 Draft PR 状态 → `review`/`merge` 非 0；
   - T6 缺 CI / 分支保护失配 → `merge` 非 0，并给修复指令；
   - T7 `independent` 无第二 GitHub 账号 gate1 评论 → `approve` 非 0；
   - T8 自动化不得生成 author-owned 批准标题；出现即测试失败；
   - T9 网页/管理员合入绕过 `loopx-flow merge`：Mode A 由 ruleset 阻止；Mode B 挡不住，必须记审计告警（不宣称已阻止）。


## 接受前复核（本次评审教训）

- **字段落点**：Gate2 记录只落在 GitHub formal review（Mode A）或结构化 PR 评论（Mode B）；LoopX 只做检查，不存授权字段。
- **保证可观测**：审批绑定用 `reviews[].commit_id` / PR `headRefOid` / `isDraft` / `author.login` 等真实 API 字段，不用软文本。
- **测试真实**：T1–T9 必须真实跑过（实现验收门，不是 Accepted 门槛）；独立模式必须有凭证外账号的评论证明（账号级分离，不是自然人证明）。
- **范围不越级**：Gate1 不被 Gate2 的 CI/分支保护前置卡住（仅 WARN）。

## 否决

- 为单人仓库创建自控第二账号、让 Bot/App 冒充审批人。
- Agent 生成 author-owned fallback 批准标题当 Gate2（假人审）。
- 仅依赖 `reviewDecision` 不校验 review commit / 不区分 Gate1 批准。
- 独立的 PR-0 串行流程（ADR-0006 已否决；本 ADR 用同一 Draft PR）。
- **Mode A** 管理员手合/自动 merge 绕过 ruleset；**Mode B 的网页合入不在本否决范围**，按 T9 记审计告警（不宣称已被阻止）。
- 为恢复新建 checkpoint 账本/第二状态机。
- Fast Path 绕过 Gate2。

## 修订

- **PRD**：扩展 `REQ-CHECKPOINT-2/3`（review commit==head、isDraft、author/fallback、Mode 分支）；新增 `REQ-GATE2-MODE-1`（双模式与不可继承）、`REQ-PR-LIFECYCLE-1`（draft/ready/同一 PR）、`REQ-CI-PROTECTION-1`（CI/分支保护前置）、`REQ-ISSUE-PIPELINE-1`（Issue 复用 + Fast Path 不绕 Gate2）、`REQ-RECOVERY-1`（只读诊断 + 幂等补偿）。
- **设计**：§4 阶段 4/7/8；§6 合入（Mode 分支、review commit 校验）；§7 Issue（真 Pipeline）；§8 审查发布通道；§10 失败矩阵。
- **AGENTS.md**：管线 B 的 Fast-Path 改为分支+PR、Gate2 不豁免；阶段 8 补 Mode A/B。
- **退役**：quickstart/PR 模板中的 `gh pr create --fill` 绕过；`fast-fix-push.sh` 直推 main；issue-comment-only 审查发布。

## 不做什么

- 不引入第三个人工断点；Gate2 仍一次授权。
- 不把 GitHub 变成第二控制面；App 只做执行器。
- 不自动 approve/merge；不伪造人类审批。
- 不在本 ADR 实现代码（M0/M5 落地）。
