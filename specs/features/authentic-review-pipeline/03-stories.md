# Work Stories: authentic-review-pipeline

## S1 审查者调用器（Codex CLI）
**As** loopx-flow 编排器, **I want** 用 `codex exec`（默认模型）对 PR diff 执行真实审查并解析结构化结论, **so that** 5-Block 报告携带真实 findings 而非硬编码文案。
- AC1: 审查包 = `gh pr view/diff`（远端权威）+ head_oid + 胶囊契约摘要；prompt 要求输出 JSON（verdict/findings[]/evidence/model_declaration）。
- AC2: codex 缺失、超时（10min）、输出不可解析 → `NOT_VERIFIED` + 退出非 0（Fail-Closed）。
- AC3: 解析结果含 `runtime_reported` 声明与 head_oid，缺失即拒收。

## S2 5-Block 实心化与核验发布
**As** 报告读者, **I want** Block 3/4/5 注入真实门禁输出、审查 findings 与反熵证据, **so that** 报告可信且与上游同构。
- AC1: Block 3 = 四门禁真实执行输出（非硬编码 PASSED）；Block 4 = Codex findings 逐文件 + verdict；Block 5 = 反熵状态 + 复审核销状态。
- AC2: verdict 发布前经 `loopx pr-review --check-result`（或 packet 链路）一致性核验；核验失败不发。
- AC3: head 发布前重读 `gh pr view` 校验未漂移。

## S3 PR body 自动组装器
**As** PR 作者, **I want** `--from-capsule` 从胶囊 00~05 + 真实 diff 生成五段式 body, **so that** 提交报告达到 #7545 的叙述质量。
- AC1: 五段式：动机←02-prd、Approach←01-decisions/04-contract、逐文件讲解←diff 结构、风险矩阵←02-prd 红队面、Verdict←05-evidence。
- AC2: 缺失资产段落显式标注 `NOT_PROVIDED`，不静默留空。

## S4 复审与核销
**As** 复审者, **I want** head 变化后重跑审查并核销上轮 findings, **so that** 多轮迭代可追踪。
- AC1: 上轮 findings 存档于 `specs/features/<f>/05-evidence.md`（或审查包缓存）；复审 prompt 逐条要求 fixed/reproducible/obsolete 判定。
- AC2: 核销状态表进 Block 5；`reproducible` 未清 → verdict 上限 request_changes。

## S5 可选交叉验证（Claude CLI）
**As** 审查负责人, **I want** `claude -p`（默认模型）对 Codex 结论交叉核验, **so that** 分歧点显式呈现。
- AC1: 默认关闭（`--cross-validate` 开启）；claude 不可用时报告标注 `CROSS_VALIDATION_UNAVAILABLE`，不阻断。
- AC2: 分歧 findings 在 Block 4 标注 `DISPUTED`。

## S6 门禁与收据
**As** 流程守卫, **I want** 全链路通过四门禁 + 严格收据, **so that** 交付可信。
- AC1: `tests/unit/authentic-review-pipeline.test.js` 全绿并注册 `npm run test`。
- AC2: `loopx-flow check` 四门禁 + change-quality 严格核验 `ok=true`；05-evidence 回写。
