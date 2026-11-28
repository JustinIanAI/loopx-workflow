# ADR-0017：审查管线可靠性、复用边界与原生能力消费

- **状态**：Proposed
- **日期**：2026-11-27
- **关联**：Issue [#79](https://github.com/JustinIanAI/loopx-workflow/issues/79)（W13 专项）、[#78](https://github.com/JustinIanAI/loopx-workflow/issues/78)（超时硬编码）、PR [#80](https://github.com/JustinIanAI/loopx-workflow/pull/80)（第一批实现）、[ADR-0008](0008-application-orchestration-layer.md)（应用编排层权威边界）、[ADR-0011](0011-evidence-traceability-and-quality.md)（证据契约与新鲜度）、[ADR-0012](0012-delivery-authorization-and-recovery.md)（交付授权）、[ADR-0013](0013-align-review-architecture-with-loopx-philosophy.md)（审查架构与两阶段解耦）
- **编号说明**：本编号由 Issue #79 预留；ADR-0018 已让位使用，不冲突。

## 背景

PR #73 在交付能力探针时为跑通 `loopx-flow review`，夹带了 6 个审查管线提交（约 +962 行）。这些改动解决了真实缺陷（#78：stage1 `spawnSync` 600s 硬编码，实测真实评审约 23m30s），并由 PR #80 合并进主干，但：

1. 没有 REQ/ADR 承接，`specs/features/capability-probe/02-prd.md` 未覆盖；
2. 引入了新的本地状态语义 `loopx_flow_review_stage_state_v1`（阶段 state、`pipeline.log`、心跳、超时重试、salvage、跨进程续跑）；
3. 评审方连续 3 轮判定 `change_proportionality: not_yet_proven` / `disproportionate`。

同时，2026-11-27 对原生 `loopx pr-review` 的静态契约核对发现四处同域但不同性质的缺口：Goal 身份未绑定、结论复用语义三层并行、证据双引擎无交叉引用、四门禁锚点不一致。它们与 #79 的可靠性专项共用 `REQ-REVIEW-2` 与设计 §8，若不在同一份 ADR 收口，会两次改写同一段正文并产生冲突。

因此本 ADR 做两件事：**把已合并的运行语义契约化（D1–D5）**，并**锁定与原生能力的分工边界（D6–D7）**。本 ADR 不扩大 #79 已声明的范围，只为其补上前置约束。

## 决策

### D1：阶段状态是一等本地状态，有 schema、生命周期与清理所有权

`loopx_flow_review_stage_state_v1`（`skills/code-review/scripts/authentic-review.js:170`）正式成为审查管线的本地状态契约，不再是实现细节。

| 字段组 | 字段 | 语义 |
| :--- | :--- | :--- |
| 身份 | `pr`、`stage`、`head_oid`、`prompt_sha256`、`agent_bin`、`selection_hash`、`selection_model`、`selection_reasoning_effort` | 任一项变化即视为不同身份，旧状态作废并记 `state_discard` |
| 进度 | `attempt`、`attempts_total`、`status`、`started_at`、`updated_at`、`elapsed_ms`、`deadline_at`、`timeout_ms` | `status ∈ {running, ok, failed, retried}`；`attempts_total` 跨进程累计带 forward |
| 产物 | `output_path`、`output_bytes`、`partial_output_path`、`partial_output_bytes`、`salvage` | 产物路径必须落在本进程运行目录内 |
| 故障 | `error_class ∈ {ETIMEDOUT, TRUNCATED, OTHER}`、`error_detail` | 只有 `ETIMEDOUT` 可重试；`TRUNCATED`/结构失败一次即终 |

- **生命周期**：创建于第一次 `runStageWithState`；每次尝试原子写（tmp + rename）；成功/最终失败后由运行目录清理策略收尾。
- **所有权**：状态只由持有该运行目录的进程写入；跨进程只读发现（D5），不跨进程写。
- **清理**：只删除本进程创建的子目录与空父目录；共享父目录 `review-pr<N>/` 永不整体删除。成功且无 `REVIEW_KEEP_PROMPT=1` / `LOOPX_KEEP_TMP=1` 时清理；失败保留留证。
- **观测面失败不阻断主流程**：`pipeline.log` 写入失败只告警（`:249-255`），不得反过来使审查失败。

### D2：超时、重试与总预算必须同时有上限，且跨进程累计计入

现状：单次预算 `REVIEW_TIMEOUT_MS`（默认 600000）、硬上限 `REVIEW_TIMEOUT_MS_MAX`（默认 7200000）；单进程最多 `MAX_STAGE_ATTEMPTS = 3` 次（`:173`）；但 `attempts_total = carriedAttempts + attempt`（`:433`、`:454`）在跨进程续跑时**不设总上限**，每次新进程都能再获得 3 次预算，构成 3×N 的预算放大。

决策：

- **单次预算**：保持现有默认与合法域（`> 0` 且 `<= REVIEW_TIMEOUT_MS_MAX`），非法值 fail-closed（`:72-76`）。
- **单 head 总尝试上限**：新增 `REVIEW_MAX_TOTAL_ATTEMPTS`，默认 **3**，硬上限 **6**。`carriedAttempts + attempt` 达到上限即停止重试并 fail-closed，不再因新进程而重置。
- **单 head 总时间预算**：新增 `REVIEW_MAX_TOTAL_MS`，默认 `REVIEW_TIMEOUT_MS × REVIEW_MAX_TOTAL_ATTEMPTS`，硬上限 `REVIEW_TIMEOUT_MS_MAX × REVIEW_MAX_TOTAL_ATTEMPTS`。超限后即使还有余留尝试也 fail-closed。
- **只允许超时类重试**：`ETIMEDOUT` 以外（CLI 缺失、stdin 超限、截断、结构失败）一次即终，沿用 `classifyStageFailure`（`:324-328`）。
- 所有拒绝、重试、放弃都必须写 `pipeline.log`，含触发条件与前后状态。

### D3：salvage 只接受"语义可核验"的完整结果，且必须披露

现状：`readPartialStageOutput`（`:339-362`）只要能从部分输出解析出 `review_body` **或** `evidence` 其中之一，就标记 `salvaged: true` 并按成功返回（`:531-543`）。该事实只写入 state 与日志，**未进入 review 正文**，存在"语义不完整的输出被当作成功发布"的风险（#79 剩余 gap 2）。

决策：

- **接受判据收紧为三件齐全**：`review_body`、`verdict`、`declaration` 必须同时存在且可解析；缺任一即视为结构失败，按 `TRUNCATED` 处理并 fail-closed。理由：五段正文、结论与声明是原生 `--check-result` 的最小可核验单元，缺一必然被拒，提前接受只会浪费一次发布往返。
- **披露到正文**：被接受的 salvage 必须在 `## 我的整体评价` 中增加一行机械披露（`本次结果由超时/中断后的部分输出恢复，恢复范围：<字段清单>`），并写入 `05-evidence.md` 的对应证据行，`Status` 不得因 salvage 而升为 `passed`。
- **不得静默**：salvage 接受、拒绝与恢复字段清单均写 `pipeline.log`。
- **与 Fail-Closed 的关系**：salvage 不是放宽门禁，而是"从已产生的完整产物中恢复"；凡不能恢复成可核验三件套的，一律 `NOT_VERIFIED`。

### D4：并发隔离采用"进程子目录 + 目录锁"，不再只靠 pid 命名

现状：同一 PR 的多进程落在 `review-pr<N>/<pid>-<random>/`（`:178-196`），避免互相覆盖；但 `discoverPriorStateDir`（`:207-227`）只按 mtime 选最新含 state 的子目录，**无锁、无陈旧判定**。两个进程可能同时发现并写同一目录。

决策：

- 每个运行子目录的认领是 `owner.lock/` 目录，内含 `owner` 文件（JSON `{pid, host, started_at}`）。**发布必须原子**：先在唯一临时目录写好 `owner`，再 `rename` 成 `owner.lock/`；目标已存在即失败，视为输给并发发布者并另建子目录。先建目录再写内容会留下「读不到持有者」的窗口，读取方会把空内容当陈旧并把目录搬走，导致双持有——这正是原 ENOENT 故障类的成因。
- **陈旧判定**：持有者 `pid` 不存在、或认领目录 mtime 超过 `REVIEW_STATE_STALE_MS`（默认 `2 × REVIEW_TIMEOUT_MS_MAX`，可用同名环境变量覆盖）时视为陈旧；`owner` 缺失（只可能来自旧版本崩溃残留）时，超过 1s 宽限期才按陈旧处理，否则一律放手。活跃锁目录不得被其他进程写入。
- **跨主机**：`host` 与本机不同时无法核验对方存活，只有认领 mtime 超过 `REVIEW_STATE_STALE_MS` 才可抢占，并必须落 `event=claim_takeover reason=foreign_host_stale` 审计行；共享临时目录下新鲜的外机认领一律不得抢占。
- **新建目录同样认领**：新建运行子目录时也发布 `owner.lock`，与复用目录共用同一套所有权口径；按目录名 `pid` 判活只作兜底（`pid` 复用或目录 mtime 超 `REVIEW_STATE_STALE_MS` 时视为陈旧可接管/可清理）。
- **抢占原子性**：陈旧认领只允许用 `rename` 搬走（两个进程只有一个能搬走）后再重新发布，禁止先 `unlink` 再创建——那会让两个进程同时认为自己持有。
- **清理所有权**：只删本进程认领的子目录（自有认领或认领持有者已死）；发现候选目录必须跳过活跃认领；父目录 `review-pr<N>/` 的删除仅限「已空」。

### D5：三层复用语义分工，结论有效性只认原生

当前同一 head 存在三种"复用"：

| 层 | 机制 | 管什么 | 权威性 |
| :--- | :--- | :--- | :--- |
| 阶段状态 | `sameIdentity && prior.status === 'ok'`（`:415-431`） | 同 head + 同 prompt + 同模型身份的**模型调用**可跳过 | 性能续跑，不产生结论 |
| 审查缓存 | `.loopx/cache/reviews/<pr>@<head>.json` + `REVIEW_SHORTCIRCUIT` | 同 `pr@head` 的**整轮审查**可短路 | 可丢弃缓存；命中必须重跑 `--check-result`（已有） |
| 原生审计 | `loopx pr-review --fresh-audit-exact-head` | **结论是否仍然有效**、是否允许复用 | 唯一权威 |

决策：

- 阶段状态与审查缓存都不得作为"结论有效性"的依据；发布前仍必须对当前 packet + 当前 head 重跑 `loopx pr-review --check-result`（`ok === true`）。
- 阶段状态复用必须同时满足身份三元组（head、prompt、model/effort）；任一变化即 `state_discard` 并重跑。
- 审查缓存命中必须校验 `native_check.ok === true` 与 `result_payload.schema_version === pull_request_review_result_v1`（`:109-120`），否则 cache miss。
- `--force-recheck` 的语义统一为"跳过所有本地短路并显式请求新审计"；实现上应调用或对齐原生 `--fresh-audit-exact-head`，不得只清本地缓存。
- 不允许为了省预算而跨 head、跨模型或跨 prompt 复用阶段输出；也不允许把 salvage 产物写入缓存当作 `ok`。

### D6：Goal 身份是审查前置，不是可选项

现状：`authentic-review.js` 拉取原生 packet 时不带 `--goal-id`（`:598`），而 `merge` 的 readiness 带（`bin/loopx-flow:998`、`:1985`）。原生 `--goal-id` 决定该 Goal 的 PR review 配置，缺失时回落到机器默认。

决策：

- `loopx-flow review` 必须解析 Goal 身份（`feature/<name>` → `<name>-goal`，或显式 `--goal-id`），并以 `--goal-id` 传给 `loopx pr-review`；无法解析时 fail-closed，不得静默使用机器默认。
- 原生 packet 与 `--check-result` 必须使用**同一个** Goal 配置与同一个 packet 文件；换 Goal 即视为换审查身份，必须重跑。
- 本 ADR 自身以 `loopx-review-pipeline-reliability-goal` 组织验收；若 Goal 身份未传递，该 Goal 的审查策略（含证据要求、超时策略）不会生效，canary 回执不能证明 Goal 语义。

### D7：证据交叉引用与门禁锚点必须可机械核对

现状：`check` 走 `loopx change-quality` receipt（`bin/loopx-flow:1203` 起），`review` 走 `loopx pr-review --check-result`（`authentic-review.js:1307`），两者无交叉引用；四门禁在 `check` 锚定 `PROJECT_ROOT`，在审查的 `gates()` 中锚定 `runDir/repo/`（ADR-0013 增补决策 1）。

决策：

- `05-evidence.md` 必须同时记录：本轮 `check-result` 的摘要（`ok`、`approval_blockers` 计数、`reviewed_head`）与 `change-quality` receipt 标识（goal、diff SHA、receipt 路径/ID）；两者绑定同一 `headRefOid` 与同一 `scope_fingerprint`。
- 四门禁结果以"锚定精确 head 的只读代码树"为准：`runDir/repo/` 的 `headRefOid` 与本机 `HEAD` 不一致时，本地实测行标 `unverified` 并保留远端 CI 证据（ADR-0013 P0），不得把本机 `PROJECT_ROOT` 的结果投影为该 head 的证据。
- `check` 与 `review` 对同一 head 的门禁结论不一致时，以锚定该 head 的结果为准，并输出一条差异 `finding`；最终阻断仍由原生 `--check-result` 的 `approval_blockers` 执行（ADR-0008 决策 2）。

## 否决

- **否决继续把运行语义留在 PR #73/#80 的代码里不写契约**：#79 的三轮 `change_proportionality` 判定已证明"能跑"不等于"可审计"。
- **否决用本地缓存或阶段状态替代原生 `fresh-audit` 作为结论有效性判定**：那会形成第二个权威源，违反 ADR-0008。
- **否决不设总预算的跨进程重试**：每次新进程重置 3 次预算，预算放大不可审计。
- **否决 salvage 静默接受**：语义不完整的输出进入正式 review，比 fail-closed 更贵。
- **否决为并发控制引入外部数据库或分布式锁**：本地目录锁 + 陈旧判定足够，且可移植。
- **否决把本 ADR 扩张为"原生能力全量接管"**：队列、`review-batch`、`autonomous-observation` 属后续增量，不在本 ADR。

## 修订

- **PRD**：修订 `REQ-REVIEW-2`，增补阶段状态 schema、超时/重试总预算、salvage 接受判据与披露、并发/续跑边界、Goal 身份前置、证据交叉引用六项。
- **设计**：在 §8.2.1 之后新增 §8.2.2「审查管线可靠性契约」（D1–D5）；新增 §8.3「原生 pr-review 能力消费矩阵」（D6–D7 与静态核对结果）；将现有 §8.1「纯文档 PR 的审查豁免」重排到 §8.2 之前，使 §8 小节编号有序。
- **ADR-0013**：在增补决策节标注与本 ADR 的衔接关系（可靠性、复用边界、Goal 身份）。
- **退役**：无。PR #80 的实现保留，本 ADR 只收紧未定义的语义（总预算、salvage 判据、锁与陈旧判定）。

## 不做什么

- 不修改 LoopX 官方 Python 核心包的校验策略与 `pr-review` schema。
- 不改变五段式报告版式与 `REQ-REVIEW-1` 的发布条件。
- 不接管原生队列能力（`--state`、`--review-order`、`--since`、`--limit`、`--autonomous-observation`）与 `review-batch`；这些登记在 §8.3 的后续项。
- 不把 `--check-approval-closeout` 纳入本 ADR；审批收尾属 ADR-0012 的 Gate2 事实源。
- 不引入新的重型依赖或后台守护进程。

## 验收

- [ ] `REQ-REVIEW-2` 六项增补落库，设计 §8.2.2 / §8.3 与正文一致。
- [ ] 总尝试/总时间预算有单测：跨进程 `carriedAttempts` 达到上限即 fail-closed。
- [ ] salvage 三件齐全判据有单测：缺 `verdict` 或 `declaration` 时不得按成功返回。
- [ ] 目录锁与陈旧判定有真实子进程回归（`tests/unit/review-pipeline-stage-state.test.js` 扩展）。
- [ ] `review` 传递 `--goal-id`，缺失时 fail-closed，有单测。
- [ ] `05-evidence.md` 同时含 `check-result` 摘要与 `change-quality` receipt 标识。
- [ ] 真实 `codex` / `loopx 2.3.x` 端到端 canary 与四门禁回执（`npm run typecheck && npm run lint && npm run build && npm run test`）。
