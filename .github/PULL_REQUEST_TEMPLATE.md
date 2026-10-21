## 变更概述 (Summary)
<!-- 简要说明本次 PR 的背景、改动范围与解决的问题 -->

Fixes #<!-- 可选：关联的 GitHub Issue 编号，例如 Fixes #123 -->

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
- **证据文件**：`/tmp/l1-review-evidence.md`

---

## 人类审批员 8 项事实核验检查表 (8-Point Inspection Checklist)
> 审批人在点击 GitHub 页面 **Approve** 前请确认以下 8 项事实：

1. [ ] **改动范围**：单 PR 增删行数符合精益原则（建议 ≤ 500 行，无无关文件变更）。
2. [ ] **契约一致性**：未随意破坏既有对外 API 契约或持久化数据模型。
3. [ ] **门禁事实**：本地四项门禁全部全绿，用例只增不减。
4. [ ] **L1 审查闭环**：代码审查指出的问题已就地修复，零阻断遗留。
5. [ ] **分支与预集成**：已通过 `loopx integration-branch` 预校验，无潜在合并冲突。
6. [ ] **元数据完整**：上方 `<!-- loopx-meta: ... -->` 已正确填入目标 Goal ID。
7. [ ] **HEAD SHA 吻合**：PR 页面当前 commit SHA 与 L2 审查报告基准一致。
8. [ ] **原子合并准入**：本变更通过 Squash 合入后即可安全触发 Goal 自动归档。
