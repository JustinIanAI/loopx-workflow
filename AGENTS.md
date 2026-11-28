# AGENTS.md: LoopX AI-Native 场景化研发与交付协议 (v2.0)

本项目是研发场景的**应用编排层**：Git 管版本化规格与决策，LoopX 管 Agent 执行控制，GitHub/CI 管代码交付与审批事实；编排器只做跨来源绑定、校验与投影。Conductor（规划中的 `skills/workflow-conductor`；落地前由本文件管线规程承担）作为调度层选择下一步并路由领域 Skill，执行由对应 Skill/Agent 完成；任何实现都不能另建并行的权威执行状态。所有在此仓库工作的 Agent 必须严格遵守以下工程规范。

---

## 核心工作铁律 (Core Axioms)

0. **前置环境哨兵先行 (Pre-flight Sentinel First)**：
   - 任何 Agent 在开始编码或进入管线前，必须首先执行 `./scripts/preflight-check.sh` 或 `loopx-flow doctor`。
   - 确保 Git 仓库、Remote、CLI（`gh`/`node`/`npm`/`loopx`）、四大门禁脚本及工作流目录骨架 100% 就绪；未就绪时执行 `./scripts/preflight-check.sh --fix` 自动补齐，严禁在未就绪环境中裸跑。
1. **先思考后写代码 (Think Before Coding)**：
   - 严禁隐瞒模糊需求。进入编码前必须通过 `design-grill` 消除所有“it depends”。
   - 严禁向用户询问可通过读代码库（`rg`/`read`）解答的事实性问题。
2. **产品正文唯一，Feature 胶囊只承载一次交付 (Product Source of Truth)**：
   - 产品需求只写在 `docs/prd/loopx-workflow.md`（`REQ-*`）。命令、阶段、失败条件与资产路径只写在 `docs/design/loopx-workflow-design.md`。
   - 改变产品行为或失败条件时，先写 `docs/adr/NNNN-*.md` 并回写上述正文，再冻结契约。禁止为同一行为再写一份产品级 PRD。
   - `specs/features/<feature>/` 只保留这一次交付的执行资产：
     - `00-INDEX.md`（审阅总览看板）
     - `01-decisions.md`（本胶囊的实现取舍，并链接相关 ADR；不是产品决策正文）
     - `02-prd.md`（本胶囊覆盖的 `REQ-*` 或 ADR 编号、切片验收与承重假设；不是第二份产品 PRD）
     - `03-stories.md`（阶段 3 故事拆分与排期）
     - `04-contract.md`（阶段 4 TypeScript 契约与任务图）
     - `05-evidence.md`（阶段 5/6 门禁实测与 LoopX 质量凭据）
   - 规则来源是 `docs/adr/0001-product-source-of-truth.md`。**ADR 准入矩阵**：仅改变权威所有者/默认行为/非纯增量状态或 Schema/不可逆迁移/共享契约才立 ADR；普通 Feature/Bug/测试/文档不立，引用既有 `REQ-*`/ADR。`approve`/`gate verify contract` 已按 `REQ-TRACE-2` 检查契约至少引用一条 REQ/ADR；完整追溯按 `REQ-TRACE-3` 分级执行。
3. **断点 1 契约冻结与审批先行 (Contract Freeze & Checkpoint 1 Approval)**：
   - 在 `specs/features/<feature>/04-contract.md` 顶部必须冻结不可变 TypeScript 接口签名与断言不变量。
   - Gate1 = **Specification Authorization**：`loopx-flow approve contract <feature>` 读取 `loopx-workflow.config.json` 的 `authorization_mode`；`single_owner` 默认核验 `accepted_by` 的 GitHub `gate=1` 评论（`--prepare` 打印模板，`--interactive` 回退 TTY）+ 风险接受，`independent` 需 Draft PR 上另一 GitHub 账号的 `gate=1` 评论；核对 01-decisions APPROVED、04-contract 的 AC/Scope/Verification Plan/依赖顺序、每个 story id 在契约 AC 矩阵中的一行、至少一条 REQ/ADR；锁定 04-contract SHA256（`configure-goal --progress-review-contract-revision`）并写 `user_gate` 授权记录后，才写 `Contract-Status: FROZEN & APPROVED`。任一步失败非 0，不得留批准标记。
4. **多 Agent 任务排他锁与反熵增 (Multi-Agent Concurrency & Anti-Entropy)**：
   - 并行工作时，必须先通过 `loopx-flow todo claim <todo-id> --goal-id <gid>` 锁定租约（内部完成 register-agent + task-lease acquire --owner --idempotency-key），严禁争抢同一任务。
   - 多特性分支开发时，合并前必须通过 `loopx integration-branch` 在本地隔离 worktree 提前探测并解决冲突。
   - **反熵增与代码退役 (anti-entropy-governance)**：替换旧逻辑时严格执行 `delete-first`，彻底清理废弃变量、旧分支与孤儿代码，严禁堆砌无意义的第 4 套兜底层。
5. **本地四大硬门禁与新鲜证据链 (Verifiable Gates & Fresh Evidence)**：
   - 任何交付前，本地四大门禁必须 100% 全绿，用例只增不减：
     ```bash
     npm run typecheck && npm run lint && npm run build && npm run test
     ```
6. **Code Review 深度融入 LoopX 质量门禁 (Receipt Binding & Optional OCR)**：
   - 阿里 OCR 为**选配能力**，仅在用户显式要求时在 `open-code-review` 技能内部进行自检、安装与扫描，不作为默认阻塞。
   - 默认执行基于跨边界语义契约的 `code-review` 技能。
   - **临时文件与交付物沙箱 (Temp & Artifact Sandbox)**：业务脚本严禁硬编码系统 `/tmp/<固定名>`（多 Agent/多进程会互相覆写，重启或清理后证据丢失，macOS `/private/tmp`、Linux `/tmp`、Windows `%TEMP%` 不可移植）。临时工件一律写入项目本地已忽略沙箱 `.loopx/tmp/`（`loopx-flow init` 创建，可用 `LOOPX_TMP_DIR` 覆盖），文件名必须带 PID/UUID/feature 唯一标识；持久化审查/PR/Issue 交付物写入 `specs/features/<feature>/` 或 `specs/archive/<feature>/`；单测使用 `os.tmpdir()` + `fs.mkdtempSync()` 并在 `after`/`finally` 清理。详见 `docs/agents/temp-artifacts.md`。
   - 审查交付物严禁割裂存放在系统临时目录：必须通过 `skills/code-review/scripts/ingest-to-loopx-quality.js` 统一编译为 LoopX `change_quality_agent_result_v2`，写入带有确切 Git Diff SHA 签名的不可篡改 Receipt，并同步沉淀在 `specs/features/<feature>/05-evidence.md`。
   - `loopx change-quality verify` 严格检验：若存在未解决的 Blocker 缺陷或代码偷跑篡改，一票否决阻断交付。
   - `05-evidence.md` 由 `ingest` 生成：Evidence Ref 用既有 REQ/Story/AC/Test 拼接；六状态 `passed/failed/blocked/not_run/not_applicable/deferred`；四门禁不得标 `not_applicable`；`ingest` 只消费 `check` 的退出码，缺结果拒绝写 `passed`；LoopX `validation` 只映射 `passed/failed/skipped`。
7. **PR 执行期命令治理 (LoopX-Workflow First & LoopX Fallback Disclosure)**：
   - 整个 PR 生命周期（`gate` → `check` → `pr` → `review` → `respond` → `merge`）必须优先通过 `bin/loopx-flow` 场景化命令管理；禁止绕过编排器直接用 ad-hoc 脚本拼接状态变更。
   - 当 loopx-flow 场景封装缺少能力时，允许**受控降级**到 LoopX 原生 `loopx` CLI，但必须在交付报告与 PR 评论中披露：(a) 实际命令与结果；(b) 能力缺口与绕过原因；且**不得绕过 Goal/Gate/Receipt/Review/Merge 权威约束**。`issue-fix.feasibility`/`integration-branch` 缺失时 `issue`/`integrate` 直接非 0，不得降级为静默成功。
   - 降级是临时手段而非终点：一旦确认能力缺口，必须在同一次交付中补上 `loopx-flow` 场景化命令或登记该缺口，逐步收敛降级路径（anti-entropy）。
   - 评审报告格式以 LoopX `pr-review` 返回的 `review_template`（动机 / 改动思路 / 具体改动 / 对主干的风险 / 我的整体评价）为唯一权威，严禁任何自造 Block 模板；代码类变更必须在「具体改动」下提供 `### 关键代码讲解`。`loopx-flow review` 与 `loopx-flow respond` 均复用该原生格式。
   - PR 准入对齐 LoopX 原生「**结果锚定 + 证据核验 + 边界声明**」范式：明确可观察的 `before -> after`、逐条标注 `implemented`/`deferred`/`out_of_scope`（杜绝 `not_met`）、禁止按代码行数（LOC）拒绝有效 PR 或为减小行数切碎代码；增量 PR 必须显式声明剩余 gap、下一 owner 与独立可测性；测试文件超过 500 行仅作人工 Review Prompt，绝非自动阻断门禁。

---

## 管线 A: Feature 研发管线 (8 阶段场景化闭环)

> **生效状态说明（2026-11-25）**：本文件管线规程**当前生效**（由 Agent / 人工按此执行，Gate1 / Gate2 必须显式人工触发）；以下能力处于**规划中、尚未落地**，文中涉及处均按目标态描述：
> - **Conductor 自动化调度** `skills/workflow-conductor`（W7 `#45`，未解锁）——落地前由本文件管线规程承担；
> - **实现期五维验证** `skills/verification-harness`（W5 `#43`，未解锁）——落地前由 TDD 与 `code-review` 既有流程承担。
>
> 其余引用的 `loopx-flow` 命令与 `skills/` 下 10 项技能均已存在并生效。技能 `description` 常驻于 Agent 上下文（**非 0 Token**），正文与脚本按需加载——"不调用即占 0 Token"的说法不成立。

- **阶段 0：前置体检** ➔ 运行 `loopx-flow doctor` 确保 Git、CLI、认证、四大门禁与目录就绪；首次接入由 `loopx-flow init` 确认 `authorization_mode`（`independent`/`single_owner`）与风险接受，`doctor` 校验配置。
- **阶段 1：方案研讨** ➔ 调用 `design-grill` 排除事实疑问。产品级取舍写入 `docs/adr/` 并修订 `docs/prd/loopx-workflow.md` 与必要时的详细设计。`specs/features/<feature>/01-decisions.md` 只记录本胶囊的实现取舍并链接该 ADR。
- **阶段 2：需求切片** ➔ 对照产品 PRD 列出本胶囊要满足的 `REQ-*`。行为不在 PRD 中则先完成阶段 1 的 ADR，禁止在 `02-prd.md` 另立产品需求。`strategy-red-team` 只攻击本切片的承重假设。
- **阶段 3：特性拆分** ➔ `user-stories` / `prioritize-features`，按独立可验证的业务结果与边界拆分（不设 PR/Feature Diff 行数上限，禁止纯粹为减小行数切碎代码；增量 PR 必须声明剩余 gap、下一 owner 与独立可测性），产出 `specs/features/<feature>/03-stories.md`。
- **阶段 4：规格包与断点 1 审批** ➔ 在 `04-contract.md` 固化 TypeScript 签名 + AC 矩阵/Scope/Verification Plan/依赖顺序；`00-INDEX.md` 作为规格包视图；可按 `REQ-PR-LIFECYCLE-1` 创建 Draft PR 展示；人类执行 `loopx-flow approve contract <feature>`：校验规格完整性、单账号评论/第二账号/TTY、锁 SHA 并写 `user_gate` 授权记录后放行。
- **阶段 5：TDD 循环实现与反熵增** ➔ `loopx-flow todo claim` 认领排他租约 ➔ 红绿重构（单测先写先红）➔ 依 `anti-entropy-governance` 清理退役旧逻辑 ➔ 四大门禁全绿。
- **阶段 6：代码审查与质量收据融合** ➔ 执行 `loopx-flow check`，运行语义审查（选配 OCR）并通过适配器写入 LoopX `change-quality` 严格 Receipt，回写 `specs/features/<feature>/05-evidence.md`。
- **阶段 7：预集成与交付审查 (L2)** ➔ `loopx-flow integrate` 本地预集成 ➔ `loopx-flow pr ready <pr>` 将阶段 4 的 Draft PR 转为 Ready（不代表合并授权）➔ `loopx-flow review <pr_id>` 发布 formal review（Agent 发 COMMENT，不发 author-owned 批准标题）。
- **阶段 8：断点 2 审批、原子合入与归档** ➔ **Mode A**：人类非作者在 GitHub 页面点击 Approve；**Mode B**：Owner 执行 `loopx-flow release-approve <pr>`（默认校验 `accepted_by` 的 GitHub `gate=2` 评论；`--prepare` 打印模板，`--interactive` 走 TTY）→ 运行 `loopx-flow merge <pr_id>`：按模式校验审批/readiness（Mode B 用 `blocking_reasons` 三档判定）与二次 HEAD → Squash 合入 → 资产包原子移入 `specs/archive/<feature>/` → Goal 收尾。

---

## 管线 B: GitHub Issue 修复管线 (impact 分级)

针对接收到的 GitHub Issue，运行 `loopx-flow issue <id> [--goal-id issue-<id>-goal] [--impact R0|R1|R2] [--execute]`。默认 dry-run：调用 `loopx issue-fix feasibility` 读取 `decision.route` 与 `decision.reason_codes[]`；`fix_pr` 再调用 `issue-fix workflow-plan` 输出计划，不建分支、不写 domain state。`--execute` 必须已绑定 Goal（或 `--init-goal`），才调用 `issue-fix caller-repo-branch --issue-branch fix/issue-<id>` 建/领分支；修复仍由 Agent 执行。

### 影响分级（impact，不是路线命名）
- **R0 Isolated**：纯文档 / Typo / 错误日志 / 模板 / 无行为影响的隔离配置。纯文档 PR 按 ADR-0006 不建 Goal、不跑 `check`，但仍必须 Gate2；出现任何代码文件即回到 R1。
- **R1 Behavioral**：有行为变化但未触及 Gate/授权/状态机/持久化/并发/公共契约。必须有每 Issue Goal、先 FAIL 的复现测试、`loopx-flow check --goal-id` Receipt、Gate2。
- **R2 Critical**：Gate/授权/状态机/持久化/并发/公共契约。留在 Issue 管线，不强制 Feature 胶囊；必须有回归证据、回滚说明、LoopX readiness 与 review-thread 检查；只有 `contract_impact=changed` 时才要求 Accepted ADR。R2 不额外要求第二个 GitHub 账号。

### 执行命令（R1/R2 共用）
1. 首次 `loopx-flow issue <id> --init-goal`，或显式 `--goal-id issue-<id>-goal`；不建 program Goal。
2. **七层根因因果诊断 (`systematic-debugging`)**：从 L1 症状持续下探至 L7 规格缺口，定位根本所有者 (Canonical Owner)。
3. **Failing Repro 先行**：在 `tests/unit/issues/issue-<id>.test.js` 下新增针对根本所有者的复现用例，**验证必须先 FAIL**。
4. 实施外科手术修复与代码退役（`delete-first`），验证用例变绿；不碰邻近无关代码。
5. 四门禁全绿 → `loopx-flow check --goal-id issue-<id>-goal` 生成 Receipt；Issue 路径不写 `05-evidence.md`。
6. `loopx-flow pr create --issue <id> --goal-id issue-<id>-goal` 生成带 `loopx-meta` 与 `loopx-impact` 的 PR；按 `authorization_mode` 走 Gate2（Mode A 非作者 Approve / Mode B `release-approve`）后，由 `loopx-flow merge <pr_id> --goal-id issue-<id>-goal` 合并核销。
7. 禁止网页合入后补账；已网页合入只做审计告警，不宣称 `loopx-flow merge` 已执行。

`scripts/fast-fix-push.sh` 仅保留为受控的分支+PR 快捷方式，不得直推 `main`、不得绕过 Gate2/Receipt；Fast-Path 不再是独立管线。

---

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`JustinIanAI/loopx-workflow`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage state roles map 1:1 to their label strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
