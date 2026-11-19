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
- PR 评论发布、comment upsert（`PATCH` 拆分为 `['-X', 'PATCH', endpoint, '-F', 'body=@-']`）与 `gh pr edit` 全链路改用 stdin 传递，不再产生临时正文文件。
