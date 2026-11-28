# ADR-0013：审查管线回归 LoopX 原生文件契约与两阶段解耦

- **状态**：Accepted
- **日期**：2026-11-18
- **批准**：严君 · 2026-11-18（回归 LoopX 原生哲学，文件/流输入与两阶段解耦）
- **关联**：[ADR-0001](0001-product-source-of-truth.md)、[ADR-0008](0008-application-orchestration-layer.md)、[ADR-0010](0010-command-contracts-and-execution-protocol.md)、[ADR-0011](0011-evidence-traceability-and-quality.md)
- **依赖**：ADR-0008（应用编排层定位与权威边界）；ADR-0011（证据契约与真实性）。

## 背景

在 PR #10、PR #23、PR #27 的审查实践中发现，`skills/code-review/scripts/authentic-review.js` 存在严重的架构偏离与工程坏味道：
1. **违背 LoopX 原生定位与工件契约**：LoopX 官方核心能力（`pr_review_queue`）采用基于文件路径的协议设计（`--packet file.json`、`--check-result file.json`），并不直接调用 LLM，更不负责单轮文本组装。`loopx-workflow` 作为应用编排层，为了追求无交互的纯函数自动化，自行将原生 packet、diff、门禁输出、evidence commands 全部读入内存并强行拼装成数十万字符的巨型单轮 Prompt。
2. **触碰操作系统物理红线与人工硬截断**：通过 CLI argv（`spawnSync(agentBin, ['exec', prompt])`）传参，直接撞击 macOS/Linux 的 `ARG_MAX`（macOS 上为 1MB）物理上限；过去为了防止 `E2BIG` 崩溃，代码中增加了 `formatDiffForPrompt(diff, 240000)` 人工截断逻辑，导致大 PR 审查时尾部测试与关键文件被丢弃。
3. **单轮任务超载与注意力崩溃**：要求模型在单轮内一边写出数千字的高质量五段式 Markdown 评审报告（含关键代码讲解），一边机械填写 17 项庞大且深度嵌套的结构化 JSON Schema。导致模型在长文本生成后注意力衰减，易在尾部字段留空，或撞上大模型 4k/8k Max Output Tokens 限制。
4. **缺乏不适用字段的标准化免除机制**：对于无 Feature Flag 的普通缺陷修复（如 PR #10、PR #27），`default_off_isolation` 等字段根本无开关可谈。模型因无物可写而留空，本地校验器将其判定为 `unverified`，进而触发 LoopX 原生 `approval_contradicts_evidence` 封顶死锁。

需要确立 `loopx-workflow` 审查管线回归 LoopX 原生哲学、基于文件/流传递契约、以及两阶段审查解耦的统一设计规范。

## 决策

1. **统一设计哲学：底层以 LoopX 原生工件契约为基准**
   - `loopx-workflow` 是研发流程的应用编排层，绝不自建第二套控制面或文本拼接规约。
   - 彻底废除将巨型 Prompt 作为 CLI argv 命令行参数传递的实现方式。
   - 输入全面迁移为**沙箱文件留证 + 标准输入（stdin）**：将组装的审查上下文写入项目本地已忽略沙箱 `.loopx/tmp/review-prompt-<pr>-<head>.md`（遵循临时文件沙箱规范，严禁落系统根 `/tmp/`），通过 stdin 管道输送给审查 CLI（`codex exec -` / `claude -p`）。
   - **彻底废除任何人工字符截断限制**（删除 240,000 字符写死限制），由底层大模型的原生上下文窗口（Context Window）自然容纳。

2. **审查执行两阶段解耦（Separation of Concerns）**
   - **阶段 1：主观对抗审查（Adversarial Review & Prose Generation）**
     - 输入完整的 PR 上下文、原生 motivation 与关键证据。
     - 审查模型专注于对抗性缺陷挖掘、五段式报告撰写（`## 动机` / `## 改动思路` / `## 具体改动 (### 关键代码讲解)` / `## 对主干的风险` / `## 我的整体评价`）、`findings` 列表与初评 `verdict`。
     - 彻底释放模型推理能力与输出 Token 预算，不再被数百行机械 JSON Schema 绑架。
   - **阶段 2：静态事实自动装配与主观证据结构化对齐（Evidence Graph Assembly）**
     - **主机能算的全由主机算**：文件列表、代码增删行数分类（`changed_line_classification`）、代码体量（`code_volume`）、四门禁实测结果与退出码（`validation_matrix`）、精确符号行号定位（`symbol_map` 的 path+line），直接由主机基于 Git Diff 与测试结果精确装配并核查。
     - **主观判断项精准对齐**：仅从模型阶段 1 的结构化产物或定向轻量抽取补齐主观证据项，严禁强迫模型单轮机械手写全量 JSON。

3. **非适用字段一等公民免除（Not-Applicable Normalization）**
   - 针对 `default_off_isolation`、`domain_neutrality`、`authority_semantics` 等与特定 PR 改动性质不相关的证据项，在 Prompt 契约与本地校验规则（`isValidJudgmentRow`）中确立标准化的免除模板：
     ```json
     {
       "status": "not_applicable",
       "verdict": "not_applicable",
       "reason": "Direct logic/configuration fix; no feature toggle or conditional execution path exists."
     }
     ```
   - 只要给出合理事实理由，校验器与 LoopX 结果检查即视为合规放行，严禁强迫审查者构造虚假的反事实推理。

4. **保持 LoopX 原生 `check-result` 权威核验**
   - 装配完成的最终审查报告与证据结果，继续严格通过 `loopx pr-review --check-result <result> --packet <packet>` 进行离线收据核验。
   - 仅当 LoopX 原生核验 `ok === true` 且无阻断错误时，才允许通过 `gh api` 发布 formal review。

## 否决

- **否决在 `authentic-review.js` 中继续打补丁（如多段启发式 diff 分片/压缩算法）**：分片压缩只是掩盖了命令行 argv 传参和单轮过载的根本缺陷。
- **否决为满足门禁而弄虚作假（Fake Evidence Filling）**：主机绝不预填伪造的 verified 数据，未核实项如实保留 `unverified`；但必须提供合法的 `not_applicable` 正常通道。
- **否决将审查命令细节直接追加到 `AGENTS.md`**：保持 `AGENTS.md` 宪法级精简，技术契约沉淀于 `docs/design/`，业务需求沉淀于 `docs/prd/`。

## 修订

- **PRD**：修订 `docs/prd/loopx-workflow.md` 中的 `REQ-REVIEW-1`，新增 `REQ-REVIEW-2`（文件流式输入与两阶段解耦）。
- **设计**：修订 `docs/design/loopx-workflow-design.md` §7 与 §8，更新审查管线输入规范、解耦机制与退出条件。
- **退役**：废弃 `authentic-review.js` 内的 240,000 字符截断规则与 CLI argv 巨型字符串传递。

## 不做什么

- 不修改 LoopX 官方 Python 核心包（`loopx`）的代码与校验策略。
- 不改变 PR 五段式评审报告的版式与字数硬性要求。

## 2026-11-19 修订（运行目录隔离与留证策略）

- 阶段 1/2 提示词、packet、`result.json` 与 `check-result.json` 统一落盘在 `$LOOPX_TMP_DIR/review-pr<N>-XXXXXX/` 独立运行目录中，不再使用按 PR 号固定的裸文件名（消除多进程覆写）。
- 遵循“成功即清理、失败即留证”原则：正常退出（exit 0）自动清理本次运行目录；失败退出或显式设置 `REVIEW_KEEP_PROMPT=1` / `LOOPX_KEEP_TMP=1` 时保留运行目录并打印目录路径。

## 2026-11-23 修订（沙箱文件路径只读传参与截断 Fail-Closed 守卫）

- 大上下文工件（`packet.json`、`pr.diff`、`evidence-output.md`、`remote-checks.txt`、`prior-findings.md`，阶段 2 另加 `stage1-review.md`）落在 `$LOOPX_TMP_DIR/review-pr<N>-XXXXXX/`。`stdin` 只带紧凑引导、原生 `review_template` / `evidenceContract` 与路径及字节/行数清单。有清单时远端检查与上轮 findings 只留 1 行计数或 id 摘要。完整 diff 与证据正文不再内联，也不再做静默截断。
- 原「禁止读文件」改为：审查 Agent 只可只读读取本次清单中的工件，禁止改工作区、禁止写工具与破坏性命令。本机 `codex exec --help` 中 `--add-dir` 是可写附加目录，因此 codex 使用 `--sandbox read-only`、`--skip-git-repo-check`、`--ephemeral` 与 `-C <runDir>`。`claude -p` 使用 `--tools Read`、`--permission-mode dontAsk` 与 `--add-dir <runDir>`。
- 内联 stdin 有字节上限（`REVIEW_STDIN_BYTE_LIMIT`，默认 65536）：超限直接拒绝调用，而不是把 diff 截短后继续。输出命中宿主标记 `[... N bytes omitted ...]` 且该标记未原样出现在本次 `pr.diff` 时打印 `[NOT_VERIFIED]`、非 0 退出、保留 `runDir`，并且不调用 `gh` 发布。`codex` 在退出码为 0 且模型输出非空时不把 stderr 工具回显当作截断。未带该方括号字节标记的审查正文不拦截。
- PR 评论发布、comment upsert（`PATCH` 拆分为 `['-X', 'PATCH', endpoint, '-F', 'body=@-']`）与 `gh pr edit` 全链路改用 stdin 传递，不再产生临时正文文件。

## 2026-11-25 增补决策（Agent 反向验伪治理：沙箱 V2 与证据透明化）

> 本增补节是对本 ADR 两阶段解耦哲学的增量演进，不改变已 Accepted 的权威边界。完整调研与波次排期见 [2026-11-25 对抗性伪证治理稿](../research/2026-11-25-agent-adversarial-falsification-governance.md)（Research Draft）；P0（G2 锚定纠偏）已由 PR #74 实施，P1a/P1b/P2/P3 按调研稿波次推进。

### 增补决策 1：审查输入沙箱 V2 与精确 head 物化

- 在 `$LOOPX_TMP_DIR/review-pr<N>-XXXXXX/` 下新增只读 `repo/` 子目录，用 `git worktree add --detach` 物化 LoopX packet 中的权威 `headRefOid`；本地对象已命中（`git cat-file -e`）时零网络拉取，未命中时 `git fetch` 并以 `FETCH_HEAD === headRefOid` 硬校验（不一致 Fail-Closed）。
- `gates()` 与 `buildEvidenceGraph` 由本机 cwd 改为锚定 `runDir/repo/`；主机与审查 Agent 读取同一字节快照，根治"本地 cwd 未检出该 head 时把对的判成 unverified"（G2）。P0 先行：`localGateAnchor` 在本地 `HEAD` 与目标 `headRefOid` 不一致时跳过本地实测、仅保留远端 CI 证据并输出 WARN（宁缺毋假）。
- `meta/artifact-index.json` 提供按路径的按需加载清单；`stdin` 仍受 `REVIEW_STDIN_BYTE_LIMIT` 约束。澄清：该守卫语义是"检测超限即 Fail-Closed 报错"，不是截断内容丢弃，与本 ADR 决策 1"彻底废除人工字符截断"不冲突（废除的是静默截断）。

### 增补决策 2：Stage 2 Fail-Closed 与证据核验清单投影

- 废除 Stage 2 的静默吞错：超时、非 0、截断标记、JSON 不可解析一律输出 `[NOT_VERIFIED]`、非 0 退出、保留 `runDir` 留证，且不得调用 `gh` 发布；`[VERDICT CAPPED]` 不得携带空白证据发出。
- 封顶透明化：`capVerdictInBody` 触发时，将 LoopX `pr-review --check-result` 的 `approval_blockers` 完整明细**机械投影**为第 5 段 `### 证据核验清单（LoopX 契约投影）`（数据 100% 来自 `check-result.json`/`result.json`，位于 `## 我的整体评价` 之前），注入后二次过 `check-result`，人类在 GitHub PR 页面可见"应审 N / 通过 X / 未通过 Y + 逐项原因"。
- Stage 2 改为由 `check-result` 报错驱动的分域靶向补证（≤3 个内聚域、≤2 轮有界收敛）；客观锚点（`spec_ref@rev`/`reviewed_head`/`symbol_map` 落 diff 范围）任一失配即回退 `unverified` 并记录精确原因。

### 增补决策 3：双模式路由与人工断点不变量

- `single_owner`：本机 LoopX 收据经 `scope_fingerprint` 匹配与 ADR-0011 Freshness 失效矩阵校验后复用，过期/缺失强制补跑；审查成本重点投向 L2 反向验伪与双因子不变量实测。
- `independent`（P3 条件触发，非当前仓库默认）：他人 PR 不含作者本机运行态证据，零信任隔离 `LOOPX_REGISTRY` 完整重跑与交叉比对为**目标态设计**，触发条件为 `authorization_mode` 切换或出现第一个真实他人 PR。通用物化机制（fetch 硬校验、隔离 `runDir/repo/`）在 P1a 提前落地。
- **编排层不裁决红线**：任何交叉比对或实测结论，编排层只输出差异 `finding` 与实测 evidence，最终阻断动作由 LoopX `check-result` 的 `approval_blockers` 机制执行（ADR-0008 决策 2）。

### 增补决策 4：不变量到 REQ 的追溯映射

| 不变量 | 含义 | 挂靠 REQ |
| :--- | :--- | :--- |
| INV2 | 发布前复核 `headRefOid` 防漂移，命中截断 Fail-Closed | `REQ-RESPOND-1` |
| INV4 | 复审强制逐条核销上轮 findings（carryover） | `REQ-EVIDENCE-1` |
| INV5 | 缺宿主运行态观测时 `declaration_source` 锁死 `self_reported` | `REQ-REVIEW-2`（本增补扩展） |

### 反熵增验收约束

1. `meta/test-audit-hints.json` 的 Mock/Skip/空断言扫描复用/扩展 `evidence-builder.js` 既有 Real-vs-Mock 逻辑，禁建第四套独立扫描器。
2. 第 5 段核验清单与 W6 作者侧 PR 六问共享同一 LoopX 契约源，投影/渲染逻辑只写一份。
3. `--check-result` 的缓存幂等短路、预检导航、终检发布三处调用收敛为单一封装函数的显式调用点。
