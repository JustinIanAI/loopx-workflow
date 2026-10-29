# Lean PRD: delivery-review-merge-lock
- **Feature**: `delivery-review-merge-lock`
- **Goal ID**: `delivery-review-merge-lock-goal`

## 1. 核心目标与问题陈述
* **核心目标**: 实现真实的交付级（L2）审查动态报告生成，并在合入时严格激活 LoopX 原生合入就绪度物理锁（Fail-Closed），彻底杜绝代码偷跑与未经批准合并。
* **用户场景旅程**:
  1. 开发者/Agent 发起 GitHub PR 后，运行 `loopx-flow review <pr_id>`。
  2. 命令动态分析 PR 的实际变动行数、文件清单与冻结契约指纹，组装结构化的 5-Block 双语交付报告并顶置评论至 PR 页面。
  3. 人类决策者在 GitHub PR 页面核验 8 项事实后点击 Approve。
  4. 开发者/Agent 运行 `loopx-flow merge <pr_id>` 时，系统首先核验 GitHub Approve 决议；接着调用 `loopx pr-review --check-merge-readiness "${pr_id}@${head_oid}"` 物理核验代码未偷跑篡改。
  5. 任何一项校验未通过立即非零退出熔断；双核验通过后执行原子 Squash 合并与资产包归档。

## 2. 承重假设与反驳矩阵 (Assumption Refutation Matrix)

| 假设编号 | 承重假设描述 | 潜在风险 / 证伪场景 | 缓解与反驳方案 |
|---|---|---|---|
| **A1** | 能够从 `gh pr view` 稳定解析 PR 元数据并定位特性胶囊 | PR 标题或分支命名不符合规范导致无法映射 | 增加容错回退机制：优先从 `headRefName` 解析 `feature/<feat>`，解析失败时提示用户指定特性名称。 |
| **A2** | 移除 `2>/dev/null \|\| true` 后遇到非 LoopX 管理的外部 PR 会直接报错 | 针对未初始化 Goal 的 PR 执行合并 | 在检测到 `loopx` 可用时执行强制物理锁核验；若未安装 loopx，输出带安全保护的明确提示。 |
| **A3** | 严格物理防偷跑锁能有效阻断 Approve 后的未授权新提交 | 攻击者在人类 Approve 后偷推恶意 commit | 物理锁参数强制包含 `${head_oid}`，一旦远端最新 HEAD SHA 与审批通过时的 SHA 不一致，物理锁立即报错阻断。 |
