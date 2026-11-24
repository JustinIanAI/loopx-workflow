## 变更概述 (Summary)
<!-- 简要说明本次 PR 的背景、改动范围与解决的问题 -->

Fixes #<!-- 可选：关联的 GitHub Issue 编号，例如 Fixes #123 -->

---

## LoopX 准入三大核心判据 (Admission Criteria: Outcome, Spec & Boundary)
> LoopX 遵循「结果锚定 + 证据核验 + 边界声明」审查准入范式，**不按代码行数（LOC）评判质量或阻断有效 PR**；任何测试文件超过 500 行的提示仅作为人工 Review Prompt，绝非自动门禁。

- **结果锚定 (Outcome Anchoring)**：
  - 交付业务结果：`<!-- 明确本次 PR 交付的具体业务/工程结果 -->`
  - 可观察变化 (`before -> after`)：`<!-- 改动前行为 -> 改动后行为及可观测验证方式 -->`
- **规格对齐 (Spec Alignment & Evidence)**：
  - 逐条核对需求/契约并标注 `implemented` / `deferred` / `out_of_scope` / `not_met`（**杜绝 `not_met`**，每条附验证证据或说明）：
    - `[ ] <REQ / AC / Story>`：`implemented` | `deferred` | `out_of_scope` — 证据：`<!-- 命令 / 测试用例 / 产物路径 -->`
- **边界声明 (Scope & Increment Boundary)**：
  - **反切碎原则**：禁止纯粹为减小代码行数而人为切碎完整变更，无无关文件改动。
  - **增量 PR 边界声明**（若本 PR 为分阶段增量交付，必填；单次完整交付写 `N/A - 完整交付`）：
    - 剩余 gap：`<!-- 尚未覆盖的明确缺口 -->`
    - 下一 owner：`<!-- 负责收口的后续 Issue / Agent / Maintainer -->`
    - 独立可测性：`<!-- 说明本 PR 合并后可独立验证与运行，不引入半成品死锁 -->`

---

## 流水线与 LoopX 关联元数据 (Pipeline Context)
<!-- 机器元数据：用于 loopx-pr-merge 自动提取 goal_id 并核销 Goal，请勿删除或修改格式 -->
<!-- loopx-meta: {"goal_id": "<GOAL_ID>", "todo_id": "<TODO_ID>"} -->

- **所属特性 / 修复**：`<!-- 如: feature/auth-flow 或 fix/issue-42 -->`
- **研发阶段**：`阶段 7: 交付级审查 (L2) ➔ 阶段 8: 人工合并与自动归档`

---

## 本地四大硬门禁自检结果 (Gates Evidence)
- [ ] `npm run typecheck` (类型与接口签名检查通过)
- [ ] `npm run lint` (代码规范与静态检查通过)
- [ ] `npm run build` (构建与权限检查通过)
- [ ] `npm run test` (单元测试 / 回归测试 100% 通过)

---

## L1 代码级审查凭据 (L1 Review Evidence)
- **审查工具**：`code-review` 技能 (默认) / `./scripts/run-ocr-audit.sh` (高危提升)
- **审查结论**：`0 Actionable Defects`
- **证据文件**：`specs/features/<feature>/05-evidence.md`（已合入归档到 `specs/archive/<feature>/`；严禁落在系统 `/tmp`）

---

## 人类审批员 8 项事实核验检查表 (8-Point Inspection Checklist)
> 审批人在点击 GitHub 页面 **Approve** 前请确认以下 8 项事实：

1. [ ] **结果锚定与边界声明**：明确交付业务结果与可观察的 `before -> after`；规格逐条标注 `implemented` / `deferred` / `out_of_scope`（零 `not_met`）；无无关文件变更；禁止按代码行数（LOC）拒绝有效 PR 或为减小行数切碎代码；增量 PR 已明确声明剩余 gap、下一 owner 与独立可测性。
2. [ ] **契约一致性**：未随意破坏既有对外 API 契约或持久化数据模型。
3. [ ] **门禁事实**：本地四项门禁全部全绿，用例只增不减。
4. [ ] **L1 审查闭环**：代码审查指出的问题已就地修复，零阻断遗留。
5. [ ] **分支与预集成**：已通过 `loopx integration-branch` 预校验，无潜在合并冲突。
6. [ ] **元数据完整**：上方 `<!-- loopx-meta: ... -->` 已正确填入目标 Goal ID。
7. [ ] **HEAD SHA 吻合**：PR 页面当前 commit SHA 与 L2 审查报告基准一致。
8. [ ] **原子合并准入**：本变更通过 Squash 合入后即可安全触发 Goal 自动归档。
