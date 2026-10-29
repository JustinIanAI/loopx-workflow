# Architecture Decisions: authentic-review-pipeline
- **Status**: PROPOSED (Pending Contract Approval)
- **Feature**: authentic-review-pipeline

## 1. 核心技术路线对比与权衡
- **分支 1（采纳）: 真实模型审查 agent（Codex CLI）+ LoopX pr-review 骨架**
  - 审查执行者 = `codex exec`（非交互模式，**默认模型，不指定 -m**）；输入为审查包（PR 元数据 + 完整 diff + 变更文件上下文 + 胶囊契约摘要），输出为结构化 JSON（verdict + findings[] + evidence）。
  - 交叉验证者 = `claude -p`（Claude Code CLI，默认模型）：可选第二审查者，对 Codex 结论做对抗性核验，分歧点显式标注在报告中。
  - 报告骨架 = `loopx pr-review` 原生链路（packet / fresh-audit-exact-head / check-result），审查结论必须过 `--check-result` 一致性核验后才发布。
  - PR body 由组装器从胶囊 00~05 + 真实 diff 自动生成五段式工程叙述（动机/Approach/逐文件讲解/风险矩阵/Verdict）。
- **分支 2（否决）: 增强 5-Block 模板 + 注入门禁输出** — 仅解决 Block 3/4 静态文案，审查语义仍由 bash 拼装，无法产出逐文件 findings 与可复现反例，不满足"与上游 #7545 同构"目标。
- **分支 3（否决）: 内嵌 LLM API 直调** — 重复造审查 agent 轮子，绕过 Codex CLI 的沙箱与工具链，且违背"不指定 LLM、使用默认"的用户约束。

## 2. 关键设计决策
- **D1 审查者外部化**: review 语义由外部 model agent（codex exec）产出，loopx-flow 只做编排、锚定与核验 — 与上游 loopx-project/loopx 的 model_agent 模式同构。
- **D2 Fail-Closed 报告**: codex 不可用/超时/输出不可解析 → 5-Block 输出 `NOT_VERIFIED` 且 `loopx-flow review` 退出非 0；严禁静默降级为伪 PASSED。
- **D3 head 锚定**: 审查包携带 `head_oid`；发布前重读 `gh pr view` 校验 head 未漂移，漂移则要求复审。
- **D4 复审核销**: head 变化后重跑审查，携带上一轮 findings 清单要求逐条核销（fixed/reproducible/obsolete），核销状态写入 5-Block Block 5。
- **D5 PR body 组装器**: `loopx-flow pr create` 路径提供 `--from-capsule` 组装（本 feature 范围：提供组装器与 review 路径的 body 重建；既有 PR 重建为手动触发）。
- **D6 无网络伪造**: 审查者声明的 model/provider 原样透传进报告（`Reviewer: codex; model=<codex 默认>; declaration=runtime_reported`），不伪造模型名。

## 3. 风险与缓解
- codex exec 非交互输出格式漂移 → 解析器宽容模式（JSON 块提取）+ 解析失败即 Fail-Closed。
- 大 diff 超上下文 → 审查包按文件分组投喂，单文件超限截断并显式标注 `TRUNCATED`。
- 审查耗时 → 超时 10 分钟，超时按 NOT_VERIFIED 处理并保留审查包供人工续审。

## 4. 验证矩阵
- `tests/unit/authentic-review-pipeline.test.js`：调用构造、findings 注入、Fail-Closed、body 组装、check-result 核验、复审核销。
- 真实验证：对 PR #7 执行 `loopx-flow review 7`，产出含真实 findings 的 5-Block 与重建后的 PR body。
