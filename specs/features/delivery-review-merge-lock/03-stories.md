# User Stories & Sizing: delivery-review-merge-lock
- **Feature**: `delivery-review-merge-lock`
- **Diff 约束**: 单 PR 变动 ≤ 500 行，无幽灵代码，严格执行 `delete-first`。

## 1. 故事拆分与工作量评估 (Job Stories)

### Story 1: 动态 5-Block 双语交付审查报告生成
- **作为** 交付审查员与 GitHub PR 协作者，
- **我希望** `bin/loopx-flow review <pr_id>` 能够动态读取 PR 的标题、分支、Diff 增删行数与特性胶囊契约，
- **以便于** 自动生成真实反映变动范围、契约符合性与门禁收据的 5-Block 双语审查报告并评论至 PR。
- **工作量评估**: ~45 行脚本实现。

### Story 2: 激活 loopx pr-review 物理防偷跑锁
- **作为** 合并准入把关人，
- **我希望** `bin/loopx-flow merge <pr_id>` 在调用 `loopx pr-review --check-merge-readiness` 时彻底移除 `2>/dev/null || true`，
- **以便于** 强制校验目标 PR 的精确 HEAD SHA 是否符合已审批基线，一旦就绪度失败立即退出 1 阻断合并。
- **工作量评估**: ~20 行脚本调整。

### Story 3: 交付审查与合并物理锁综合测试套件
- **作为** 质量工程师，
- **我希望** 在 `tests/unit/delivery-review-merge-lock.test.js` 中编写测试，
- **以便于** 验证动态 5-Block 报告内容的正确生成，以及物理防偷跑锁在异常或未就绪时的 Fail-Closed 阻断能力。
- **工作量评估**: ~70 行测试用例。
