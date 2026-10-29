# Lean PRD: authentic-review-pipeline

## 1. 问题陈述
`loopx-flow review` 当前产出的是"静态拼装"的 5-Block 报告（Block 3/4 为硬编码 `PASSED`/`delete-first applied`），PR body 为临场手写 — 与上游 loopx-project/loopx 的 model_agent 对抗式审查（锚定 head SHA、逐文件 findings、可复现反例、多轮复审）存在代差。用户无法从 loopx-flow 的报告中获得真实审查洞察。

## 2. 目标用户与场景
- 使用 `loopx-flow` 承载 feature 全生命周期交付的 Agent 与开发者；
- 需要 PR 描述与审查反馈达到上游 #7545 同构质量（结构锚定 + 真实 findings）的仓库维护者。

## 3. 目标（可验收）
- G1 `loopx-flow review <pr>` 调用 `codex exec`（默认模型）执行真实审查，5-Block Block 4 注入逐文件 findings（含可复现反例），verdict 经 `loopx pr-review --check-result` 核验后发布。
- G2 审查者不可用/超时/输出不可解析 → 报告 `NOT_VERIFIED` 且命令退出非 0（Fail-Closed，禁止伪 PASSED）。
- G3 PR body 组装器从胶囊 00~05 + 真实 diff 自动生成五段式工程叙述（动机/Approach/逐文件/风险/Verdict）。
- G4 head 变化后复审：携带上轮 findings 逐条核销（fixed/reproducible/obsolete），核销状态进 Block 5。
- G5 可选交叉验证：`claude -p` 作为第二审查者，与 Codex 分歧点显式标注。

## 4. 非目标
- 不改 `--check-merge-readiness` 合并锁语义（PR #6 已交付）；
- 不要求多审查者并发编排（单审查者 + 可选交叉即可）;
- 不指定/封装任何特定 LLM 型号 — 审查者一律使用 CLI 默认模型。

## 5. 红队攻击面
- 伪造审查输出（手写 JSON 冒充 codex）→ 解析器校验输出必须含 `runtime_reported` 声明块与 head_oid 一致性，缺失即拒。
- 审查包投毒（diff 被本地篡改）→ 审查包 diff 直接取自 `gh pr diff`（远端权威），不使用本地 working tree。
- 长审查静默丢弃 → 超时按 NOT_VERIFIED Fail-Closed，保留审查包续审路径。

## 6. 成功判据
25+ 单测全绿；对 PR #7 实测产出含真实 findings 的报告与重建 body；四大硬门禁 + 严格收据全链路 `ok=true`。
