# PRD：LoopX Workflow

- **状态**：Current baseline（按 `bin/loopx-flow` 与审查脚本的现行为归并）
- **详细设计**：[docs/design/loopx-workflow-design.md](../design/loopx-workflow-design.md)
- **增量决策**：[docs/adr/](../adr/README.md)
- **决策者**：严君（架构师）。编码由 Agent 推进，签字只发生在两个断点。
- **实现状态**：本版是目标需求；R1~R4 代码落地前，现码与目标的差异由 ADR-0002~0005 与 issue #15/#17 跟踪。

本文是产品需求的唯一正文。`specs/features/<feature>/02-prd.md` 只记录该胶囊覆盖哪些 `REQ-*` 或哪份 ADR，不再各写一份产品规格。

---

## 1. 摘要

LoopX Workflow 是给已经在用 LoopX 的人和编码 Agent 用的场景门面。它把需求澄清、契约冻结、实现、审查、合入收成 `loopx-flow` 的一组命令。人只在契约审批和 GitHub Approve 两处签字。质量裁决、租约、缺陷路由和预集成仍由 LoopX 控制面做出，编排器不另做一套。

现在做这件事，是因为产品行为已经散在一份 70 行架构 spec 和 9 份 feature 精简 PRD 里。后续变更如果继续各写一份 PRD，就没有一份可以修订的产品正文。

## 2. 干系人

| 人 | 角色 | 在本文里负责什么 |
|---|---|---|
| 严君 | 决策者 | 断点 1 执行 `approve contract`；断点 2 在 GitHub 点击 Approve |
| 编码 Agent | 执行者 | 只通过 `loopx-flow` 推进；新产品行为先对上 `REQ-*` 或 ADR |
| 仓库维护者 | 审查者 | 看 PR 上的原生五段式报告和真实 findings，不接受模板化的通过 |

## 3. 背景

LoopX 提供 `change-quality`、`pr-review`、`task-lease`、`integration-branch`、`issue-fix`、`goal-lifecycle` 等控制面能力。直接拼这些命令，Agent 会跳过人类断点，或在审查失败时仍写出“已通过”。

`loopx-flow` 把这些能力收成场景命令，并把一次交付的过程资产放进 `specs/features/<feature>/`。合入后整包移到 `specs/archive/`。

截至本文，仓库里同时存在：

- 一份只描述管线、不描述用户与成功标准的架构 spec（已退役，内容在详细设计）
- 9 个仍留在 `specs/features/` 的胶囊，各自一份精简 PRD

这些胶囊是交付证据，不是第二份产品定义。

## 4. 目标

让一次产品变更能回答三件事：做给谁、成功时世界变成什么样、这次改动对应哪条已有需求或哪份 ADR。

和策略的关系：LoopX 继续做控制面；本仓库只做场景编排和证据落点。

可核对结果：

1. 任意一条必须能力都能在本文找到 `REQ-*`。胶囊、ADR、设计文档只引用这些编号，不另起一条平行需求。
2. 承重命令在本文写明的失败条件下以非 0 退出。条件写在 `REQ-FAILCLOSED-*`、`REQ-CHECKPOINT-*`、`REQ-CONTRACT-LOCK-1`、`REQ-REVIEW-1`。
3. 改变产品行为的变更，在冻结契约之前已经有一份 ADR，并且 PRD（行为变化时还有详细设计）已经改完。

## 5. 用户分段

第一版只服务三段，按要完成的事划分。

**决策者。** 要放行或拒绝一次交付，但不想在终端里拼 `loopx` 子命令，也不想读散落的 feature PRD 才知道产品现在承诺什么。

**编码 Agent。** 要在长程任务里连续做分支、契约、实现、门禁、PR。强指令下它会跳过审批、手写审查通过、或在 `main` 上直接提交。

**维护者。** 要在 GitHub PR 上判断这次 diff 是否真被审查过，以及 Approve 之后 HEAD 有没有被换掉。

约束：本地执行，依赖本机的 `git`、`node`、`npm`、`gh`、`loopx`。不引入企业 IM 审批。阿里 OCR 只在调用方显式加上 `--with-ocr` 时运行。

## 6. 价值主张

### 决策者

- **谁**：要为仓库签字的架构师。
- **为什么**：要确认契约没被偷改、PR 没在未批准时合入。障碍是规则写在多份 feature 文档和脚本里，签字时对不齐。
- **以前**：读 `AGENTS.md`、架构 spec 和某个 `02-prd.md`，再对命令实际行为。
- **怎么做**：以本文为产品正文，以详细设计为命令和失败矩阵。签字动作仍是 `loopx-flow approve contract` 和 GitHub Approve。
- **之后**：一次变更对应 `REQ-*` 或 ADR。胶囊只说明它实现了哪几条。
- **替代**：继续让每个 feature 自带一份产品 PRD。那样会回到本文要收口的状态。

一句话：决策者签的是同一份产品正文上的增量，而不是第九份互不引用的特性说明。

### 编码 Agent

- **谁**：在本仓库执行 feature 或 issue 的 Agent。
- **为什么**：要完成从分支到合入的路径。障碍是底层命令多，失败可以被 `|| true` 或假报告吞掉。
- **以前**：手拼 `loopx`，或在审查不可用时仍发布通过结论。
- **怎么做**：只走 `bin/loopx-flow`。租约、路由、收据、预集成、合入锁由 LoopX 裁决；编排器传递结果，不改写。
- **之后**：缺控制面、未批准、契约指纹不一致、审查不可用时，命令停住并给出修复指令。
- **替代**：把 LoopX 再包一层自有状态机。那是第二套控制面，本产品不做。

一句话：Agent 用场景命令推进，失败就停，不另造一套通过。

### 维护者

- **谁**：在 GitHub 上看 PR 的人。
- **为什么**：要看到动机、改动、风险和真实审查结论。障碍是静态拼出来的“已通过”。
- **以前**：PR 正文临场手写，审查报告可以不依赖模型输出。
- **怎么做**：`loopx-flow pr` 从胶囊和真实 diff 组装四段正文和验证矩阵；`loopx-flow review` 只在 LoopX 原生 `review_template` 可用且审查结果核验通过时发布五段报告。
- **之后**：模板缺失、审查者不可用、输出不可解析时，结果是 `NOT_VERIFIED` 且进程非 0，不发布自造报告。
- **替代**：固定五段空话。维护者无法从中判断 diff。

一句话：维护者看到的报告要么来自原生模板加真实审查，要么明确未核验。

## 7. 方案

### 7.1 主路径

**管线 A，做特性。**

1. `loopx-flow doctor` / `init`：环境与仓库骨架。
2. `loopx-flow feature <name>`：切到 `feature/<name>`，建 `specs/features/<name>/`。
3. 阶段 1–4 写决策、需求切片、故事、契约。若行为不在本文，先写 ADR 并回写本文。
4. 断点 1：`loopx-flow approve contract <name>`。
5. `todo claim` / 实现 / `loopx-flow check`。
6. `loopx-flow integrate` 预演，`loopx-flow pr create` 开 PR，`loopx-flow review <pr>` 发审查。
7. 断点 2：人在 GitHub Approve 后，`loopx-flow merge <pr>`。

**管线 B，处理 Issue。**

`loopx-flow issue <id>` 读取 Issue，调用 `loopx issue-fix feasibility`，只接受 `fix_pr`、`comment_only`、`triage_only`。命令到此停止，并打印下一步。它不提交、不推送、不开 PR。

### 7.2 需求

#### 场景门面

- **REQ-FACADE-1** 场景操作通过 `bin/loopx-flow`。命令面以该脚本的 `usage()` 为准：`feature`、`approve contract`、`check`、`pr`、`review`、`respond`、`merge`、`issue`、`integrate`、`context`、`archive`、`gate verify`、`doctor`、`init`、`status`、`todo`。
- **REQ-FACADE-2** `loopx-flow` 尚无对应命令时，可以临时调用 `loopx`。交付说明必须写明实际命令，以及门面缺什么。同一变更里要补上场景命令，或写 ADR 说明为何不补。

#### 人类断点

- **REQ-CHECKPOINT-1** 进入实现前，决策者运行 `loopx-flow approve contract <feature>`。命令必须：要求本机 `loopx`；对带 `Contract-Status: FROZEN & APPROVED` 标记的最终内容计算 SHA256；`loopx configure-goal --progress-review-contract-revision` 成功后，才把标记原子写入契约文件；任一步失败非 0，且契约文件不得留下批准标记。控制面记下该文件的 SHA256（`progress_review.contract_revision`）。
- **REQ-CHECKPOINT-2** `loopx-flow merge` 只在 `gh` 报告的 `reviewDecision` 为 `APPROVED` 时继续。其他值非 0 退出，且不调用 `gh pr merge`。
- **REQ-CHECKPOINT-3** 批准之后，`merge` 用当时读到的 `headRefOid` 调用 `loopx pr-review --check-merge-readiness <pr>@<oid>`。核验后再读一次 HEAD；两次不一致则非 0 退出，不合入。

#### 执行胶囊

- **REQ-CAPSULE-1** 进行中的特性资产在 `specs/features/<feature>/`，文件为 `00-INDEX.md`、`01-decisions.md`、`02-prd.md`、`03-stories.md`、`04-contract.md`、`05-evidence.md`。`merge` 在 Goal 停机成功后把该目录整包移到 `specs/archive/<feature>/`。
- **REQ-CAPSULE-2** `01-decisions.md` 只记录本胶囊的实现取舍，并指向相关 ADR。`02-prd.md` 只列出本胶囊实现的 `REQ-*` 或 ADR 编号、本切片的验收与承重假设。产品级的谁、为什么、范围、非目标写在本文。

#### 需求追溯与变更治理

- **REQ-TRACE-1** 新的产品行为必须满足已有 `REQ-*`，或先合并一份 ADR，由该 ADR 修订本文；若命令、失败条件或不变量变了，同时修订详细设计。然后才冻结契约、写代码。
- **REQ-TRACE-2** 本次不在 `approve` 或 `gate` 里检查“胶囊是否引用了 REQ/ADR”。这是后续变更，它自己必须引用 `REQ-TRACE-1`。在该变更落地前，约束靠本文、ADR-0001 和 `AGENTS.md`。
- **REQ-DOC-TIER-1** 文档分为 L1 决策 (ADR)、L2 契约 (PRD、Feature Contract)、L3 说明 (README、QUICKSTART、GUIDES) 三层。改动产品行为或失败条件必须立 ADR 并经人类批准；L3 说明性文档仅做常规维护与静态链接检查，禁止为其单独立 ADR（ADR-0006）。
- **REQ-LIFECYCLE-5STATE-1** 交付生命周期统一使用五态模型：`Proposed` ➔ `Accepted` ➔ `Implemented` ➔ `Verified` ➔ `Released`。ADR/PRD 获批仅代表 `Accepted`，不代表代码 `Implemented` 或已交付；代码必须通过真实路径测试与质量收据融合才可标记 `Verified`；主干 Squash 合入且归档后才进入 `Released`。禁止未落地直接标 `DELIVERED`（ADR-0006）。
- **REQ-DOCS-DELIVERY-1** 纯 Markdown 文档类 PR 豁免 L2 代码对抗性审查（`loopx-flow review`）：不要求 `### 关键代码讲解`，不阻塞于缺失的 CI 状态（启用 `--no-pr-review-wait-for-ci`），不生成代码质量收据。门禁仅执行静态三项核验（ADR 元数据完整、PRD/Design 引用无死链、Markdown 语法合规）。日常特性研发采用契约与代码同分支单 PR 交付（ADR-0006）。

#### 失败即停

- **REQ-FAILCLOSED-1** 下列情况非 0 退出：`approve contract` 没有 `loopx`，或契约锁定失败；`doctor` 没有 `loopx`；`check` 已经解析出 feature 或 `--goal-id`，但本机没有 `loopx`，或 `loopx change-quality verify` 的 `ok` 不是 `true`，或没有可解析的 Goal 身份；`merge` 没有 `loopx`，或合入锁失败，或 `goal-lifecycle stop` 失败，或 `retire-global-goal`/`sync-global`/archive 失败；`issue` 没有 `loopx` 或 `gh`，可行性命令失败，路由为空或不是三个合法值；`integrate` 与 `todo` 没有 `loopx`，或对应 LoopX 命令失败；`feature`/`approve` 的关键 `sync-global` 重试后仍失败。
- **REQ-CHECK-IDENTITY-1** `check` 必须能从 `feature/<name>` 分支或显式参数解析 feature，或接受显式 `--goal-id`。两者都无时非 0，禁止跳过收据核验后打印成功。有 feature 胶囊且存在 `04-contract.md`（或归档副本）时，先运行 `gate verify contract`；无胶囊的 docs/治理交付可用 `--goal-id` 跳过契约门禁，但仍必须通过收据核验。
- **REQ-FAILCLOSED-2** `feature` 无法创建或切换 `feature/<name>` 时非 0 退出，不在当前分支创建胶囊。
- **REQ-CONTRACT-LOCK-1** `gate verify contract <feature>` 重算 `04-contract.md` 的 SHA256，并与 `.loopx/registry.json` 里该 Goal 的 `contract_revision` 比较。缺注册表、缺 Goal、缺指纹、指纹不一致，均非 0 退出。
- **REQ-MAIN-1** `loopx-flow init` 把 `scripts/git-hooks/pre-commit` 装到本仓库 `.git/hooks/pre-commit`。钩子拒绝当前分支为 `main` 或 `master` 的提交。未执行 `init` 的克隆没有这支钩子。

#### 门禁与收据

- **REQ-GATE-1** `check` 按顺序执行 `npm run typecheck`、`npm run lint`、`npm run build`、`npm run test`。前一个失败则不继续。
- **REQ-QUALITY-1** 默认审查由 `skills/code-review/scripts/ingest-to-loopx-quality.js` 写入 LoopX `change-quality` 收据，并回写 `05-evidence.md`。`--with-ocr` 才调用阿里 OCR。OCR 不是默认阻断项。收据的 `validation` 必须来自实际门禁结果；没有 feature 且没有 `--goal-id` 时非 0，不写任何胶囊。
- **REQ-ENV-1** `loopx-flow doctor` 必须前置暴露控制面路由问题：runtime root 与项目 `common_runtime_root`
  不一致、`~/.loopx` 半迁移残留、registry 中缺失 `state_file` 的 goal、运行时工件仍被 Git 跟踪。
  发现问题时给出“原因 / 影响 / 修复指令”，不因此阻断本地门禁，但必须可见。路由收敛只允许通过
  `loopx migrate-local-state` 执行，不得手改 registry。见 ADR-0007。
- **REQ-ENV-2** GitHub API 预算以官方上限的 50% 作为安全基线：core REST 2500 req/h、
  secondary 450 points/min、content-generating 40/min 与 250/h。`doctor` 通过
  `gh api rate_limit` 展示当前额度并在低于基线时告警；评审管线必须遵守 head-oid 幂等、
  comment upsert、合流窗口与 429/503 指数退避。见 ADR-0007。
- **REQ-ENV-3** 运行时工件（`.codex/**`、`.loopx/**/*.lock`、`.loopx/goals/**`）不得进入 Git 跟踪面；
  质量收据的 `reuse`/`simplification` 证据 refs 只能引用已提交 exact scope 文件并过滤运行时工件，
  缺陷扫描范围仍覆盖工作区 diff（`REQ-QUALITY-2`）。见 ADR-0007。

- **REQ-QUALITY-2** 质量扫描的范围是 `git merge-base origin/main HEAD` 或 LoopX scope base 到工作区的已提交+未提交 diff。高信号规则（`debugger`、硬编码密钥、关键路径 `|| true`、契约文件改动）为 blocker；不把“未声明变量”做成 diff 文本正则，交给 lint/类型检查。存在 blocker 时在 record 前非 0。
- **REQ-GATE-DECISIONS-1** `gate verify decisions <feature>` 要求 `specs/features/<feature>/01-decisions.md`（或已归档副本）存在，且带有可识别的 `APPROVED` 状态行。

#### 审查与 PR 正文

- **REQ-REVIEW-1** `review` 的报告结构只使用 LoopX `pr-review` 给出的 `review_template` 五段：动机、改动思路、具体改动、对主干的风险、我的整体评价。代码变更的「具体改动」包含 `### 关键代码讲解`。实现是 `skills/code-review/scripts/authentic-review.js`。原生模板不可用、审查者 CLI 不可用、输出不可解析、或 `check-result` 未通过时，输出 `NOT_VERIFIED` 且进程非 0，不发布自造报告。
- **REQ-RESPOND-1** `respond` 复用同一五段结构，实现是 `skills/code-review/scripts/respond-report.js`。发布前依次跑 typecheck、lint、build、test，任一失败则不发评论。找不到既有审查产物或格式不符时非 0 退出。本机有 `loopx` 时 `loopx status` 失败也不发评论；没有 `loopx` 时该步记为跳过，不因此退出。
- **REQ-PR-BODY-1** `loopx-flow pr` 调用 `authentic-review.js --generate-pr-body`。正文固定四段：动机、改动思路、具体改动、对主干的风险，外加验证矩阵。动机、思路、风险来自胶囊；文件列表来自真实 diff；逐文件说明必须来自真实 diff hunk/符号或模型输出，无法生成时写 `NOT_PROVIDED`，禁止固定映射或静态“已通过”。矩阵优先取 `05-evidence.md` 里已有的「验证矩阵」，否则现场执行四条 `npm run` 并写入退出结果。胶囊缺段时写 `NOT_PROVIDED`。这四段不是 `REQ-REVIEW-1` 的审查报告，审查报告另有第五段「我的整体评价」。

#### 控制面边界

- **REQ-NATIVE-1** `todo claim` / `todo done` 的租约、`issue` 的 `route`、`integrate` 的 sync/status，以 LoopX 输出为准。编排器不在这三个结果上做第二套判断。
- **REQ-GOAL-1** 新特性的 LoopX 状态文件放在该特性胶囊内。`merge` 以可观测状态做幂等：已 `MERGED` 时跳过合并与 readiness，只补未完成步骤；stop/retire 的“已执行”识别为成功；stop/retire/sync/archive 任一失败非 0，并打印“已合入、未闭环”与重跑命令；只有全部步骤完成才打印完成。合入后刷新本地 base 分支并提交/推送 archive 移动，push 失败同样非 0。

#### 明确不在本基线里的行为

下列情况是现码行为，**不是**已承诺的失败即停。要改变它们，走 ADR，并改 `REQ-FAILCLOSED-1` 或新增需求。

- `status`：没有 `loopx` 时列出 `specs/features/`；`loopx status` 失败被忽略。
- `issue`：只打印 `fix_pr` / `comment_only` / `triage_only`。`scripts/fast-fix-push.sh` 不会被这条命令调用。

`doctor`、无 feature 的 `check`、合入后的全局退役与同步已由 ADR-0002~0004 收紧，不再属于“不在基线”的行为。

### 7.3 技术边界

编排器是 `bin/loopx-flow`（bash）。审查发布在 `skills/code-review/scripts/authentic-review.js`。控制面状态在本机 `.loopx/`，该目录的注册表不作为产品契约提交进 Git。四大门禁是仓库自己的 `npm` 脚本，类型检查使用本机 `tsc`。

### 7.4 假设与未决

- **假设** 在 `REQ-TRACE-2` 的代码门禁落地前，Agent 会遵守 `AGENTS.md` 与 ADR-0001。若后续胶囊再次写出完整产品 PRD，这条假设失败，应优先做门禁而不是再加一份索引文档。
- **已决** `check` 的 Goal 身份、`merge` 后的全局退役与同步分别由 ADR-0004、ADR-0002 收紧；本版不再保留这两项“未决”。
- **backlog** 仍暴露的 LoopX 原生命令封装记录在 GitHub issue #15，由后续变更按 `REQ-FACADE-2` 逐步收敛。
- **历史漂移** `specs/features/hard-guard/02-prd.md` 仍写着 `docs/decisions/` 和 `.feat/specs/`。当前路径以 `REQ-CAPSULE-1` 为准。不回改那份历史正文。

## 8. 发布范围

**这一版（本文所描述的当前基线）**

- 一份产品 PRD、一份详细设计、ADR 作为增量入口。
- 上列 `REQ-*` 与“明确不在本基线里的行为”。
- 执行胶囊继续存在，角色改为引用产品正文。

**之后**

- 用代码拒绝“未引用 `REQ-*` 或 ADR 的契约审批”（实现 `REQ-TRACE-2`）。
- 本版已通过 ADR-0002~0006 收紧 `doctor`、无 feature 的 `check`、`approve`、合入后的全局退役/同步、质量扫描以及文档代码双轨生命周期治理；后续行为变化仍按 `REQ-TRACE-1` 先写 ADR。
- 仍暴露的 LoopX 原生命令封装作为 backlog 跟踪（issue #15），不阻塞本版。

**不做**

- 不替换 LoopX 控制面，不在编排器里重判可行性路由。
- 不把阿里 OCR 变成默认阻断。
- 不接企业 IM 作为第三个人类断点。LoopX可以对接IM，跟进Goal执行过程。
- 不把 9 个历史胶囊合并成一个目录，也不为“写这份 PRD”再开一个 feature 胶囊。
- 不在本变更里修改 `docs/guides/loopx-workflow-architecture.html`。该文件是展示页。
