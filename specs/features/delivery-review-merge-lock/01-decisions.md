# Architecture Decisions: delivery-review-merge-lock
- **Status**: DRAFT (Pending Human Approval)
- **Feature**: delivery-review-merge-lock
- **Architectural Scope**: 动态 5-Block PR 审查生成与 LoopX 合并物理防偷跑锁实心化

## 1. 核心技术路线对比与权衡

### 分支 1: 保留静态 Markdown 模板，仅更新 PR ID
- **缺点**: 审查报告内容与实际代码变动脱节，无法向人类决策者披露真实的 Diff 范围与契约指纹。
- **结论**: 坚决否决。

### 分支 2: 动态 PR 元数据抽取 + 真实 LoopX 就绪度物理锁 【采纳方案】
- **实施策略**:
  1. **动态交付报告构建**:
     通过 `gh pr view --json title,headRefName,headRefOid,additions,deletions,changedFiles` 实时提取真实 PR 变动，并关联本地对应的 `specs/features/<feature>/04-contract.md` 与 `05-evidence.md`。动态组装 5-Block 审查报告（范围核验、契约一致性、四大门禁证据、爆炸半径与回滚预案），杜绝虚假文本。
  2. **合入就绪度物理防偷跑锁实心化**:
     彻底清理 `loopx-flow merge` 中 `loopx pr-review --check-merge-readiness` 的 `2>/dev/null || true` 掩耳盗铃机制。
     物理锁以 `${pr_id}@${head_oid}` 严格核验：若 PR 最新提交发生漂移（即审查后又偷偷推了新 commit 未经审批），或就绪度校验未通过，立即触发 Fail-Closed 熔断阻断合入。
- **收益**: 彻底打通 GitHub PR 页面审查与本地 LoopX 物理防偷跑闭环，杜绝代码偷跑与未经批准合并。
