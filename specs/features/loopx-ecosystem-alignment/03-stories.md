# User Stories & Sizing: loopx-ecosystem-alignment

## 1. 故事拆分与工作量估算 (User Stories & Sizing)

### Story 1: LoopX Goal 全生命周期管控与注册表边界合规
- **As a** 流水线操作者与开发者,
- **I want** `.loopx/` 处于正确的私有注册表边界，并且特性 Goal 的 `state_file` 持久化于特性胶囊内，自动与全局控制面同步并在合并时彻底注销,
- **So that** `loopx status` 彻底消除 `registry boundary risk`、`state_file_missing` 与 `stale_source_registry`，实现 Goal 100% 纳管。
- **Acceptance Criteria**:
  - `.gitignore` 包含 `.loopx/` 私有文件规则，Git 停止跟踪 `.loopx/registry.json`。
  - `bin/loopx-flow feature` 创建 Goal 时传递 `--state-file specs/features/$feature/ACTIVE_STATE.md`。
  - `cmd_approve`、`cmd_check` 等状态变更后自动执行 `loopx sync-global --goal-id <gid>`。
  - `cmd_merge` 执行 `loopx goal-lifecycle stop` 后联动执行 `loopx retire-global-goal --goal-id <gid> --execute`。
- **Diff 预估**: ~60 行

### Story 2: 对齐 PR #7545 标准的 PR 描述自动聚合器
- **As a** 交付审查者与人类决策者,
- **I want** 发起 PR 时自动从特性胶囊聚合生成符合 PR #7545 规范的自评报告,
- **So that** PR 包含详尽的动机背景、改动思路、逐文件关键代码讲解、主干风险与量化验证矩阵。
- **Acceptance Criteria**:
  - `skills/code-review/scripts/authentic-review.js` 中的 `buildBody` 重构为 PR #7545 的双语 4-Part 体系。
  - 动态从 `01-decisions.md` 提取动机与技术权衡，从 `04-contract.md` 提取接口不变量，从 Git Diff 提取变更文件结构，从本地测试提取验证矩阵。
- **Diff 预估**: ~120 行

### Story 3: 增强 Adversarial Review 三维准则与双语整体裁决
- **As a** 架构审查者,
- **I want** 模型审查不仅罗列 findings，而且按照 LoopX 官方标准输出 `delivery`、`long_horizon`、`user_experience` 三维打分与双语 Verdict,
- **So that** 交付能够明确区分局部语法测试与长程端到端闭环，杜绝假闭环。
- **Acceptance Criteria**:
  - Review 提示词注入 LoopX 三维评价规范（delivery: complete/fragmented, long_horizon: proven/not_yet_proven, user_experience: clear/regression）。
  - Block 4 渲染三维评价结果与包含英文 Verdict 的整体结论块。
- **Diff 预估**: ~90 行

### Story 4: 实现 `loopx-flow respond <pr_id>` 结构化回复流水线
- **As a** 开发者,
- **I want** 在修复 Review 指出的缺陷后运行一条指令自动生成标准更新汇报,
- **So that** 能够像 PR #7545 作者一样输出 `### 针对 Review 意见的更新与验证汇报 (Commit <sha>)`，闭环每项阻塞问题并呈报最新验证矩阵。
- **Acceptance Criteria**:
  - `bin/loopx-flow` 新增 `respond <pr_id>` 子命令。
  - 自动读取最新 Commit SHA、比对前一轮 review-carryover、提取修复点与最新四大门禁实测结果，调用 `gh pr comment` 置顶更新汇报。
- **Diff 预估**: ~80 行
