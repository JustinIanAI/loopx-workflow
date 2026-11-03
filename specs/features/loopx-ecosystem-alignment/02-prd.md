# Lean PRD: loopx-ecosystem-alignment

## 1. 核心目标与用户旅程 (Problem Statement & Journey)

### 核心痛点
1. **PR 评审与提交协议脱节**：当前的 PR 描述与交付报告缺少 LoopX PR #7545 所要求的动机深度剖析、架构思路、关键代码逐文件讲解、主干风险与量化验证矩阵，审查裁决缺乏 `delivery`、`long_horizon`、`user_experience` 三维体系化裁决。
2. **LoopX Goal 脱节与脱管状态**：`.loopx/registry.json` 被 git 跟踪触发边界风险；`state_file` 孤立于 `.codex/` 导致全局巡检报 `state_file_missing`；缺少自动 `sync-global` 与 `retire-global-goal` 导致全局注册表残留历史僵尸 Goal。

### 目标用户旅程
- **开发者/Agent**：执行 `loopx-flow feature <feat>` 时，Goal 状态文件直接落入特性胶囊（`specs/features/<feat>/ACTIVE_STATE.md`），自动与全局注册表同步，`loopx status` 保持 100% 绿态。
- **发起 PR 时**：自动从胶囊生成严格对齐 PR #7545 规范的自评报告。
- **审查与回复时**：审查模型输出三维评价与 Verdict；作者使用 `loopx-flow respond <pr_id>` 自动生成逐项修复与再验证矩阵汇报。
- **合入归档时**：`cmd_merge` 自动注销控制面 Goal 并退役全局状态，零僵尸残留。

## 2. 承重假设与红队攻击矩阵 (Critical Assumptions & Red Team Attack)

| 假设编号 | 承重假设内容 | 红队攻击角度 (Strategy Red Team) | 架构防御与缓解策略 |
|---|---|---|---|
| A1 | 解除 `.loopx/registry.json` 的 Git 跟踪不会影响本地工作流读取 | 如果开发者 clone 仓库，本地无 `.loopx/registry.json`，工作流会崩溃吗？ | 在 `bin/loopx-flow doctor` 与 `workflow-init.sh` 中增加自动引导；若本地缺少 registry，由 `loopx bootstrap` 首次自动创建，不依赖 Git 提交私有文件。 |
| A2 | 将 `state_file` 置于胶囊目录能解决 `state_file_missing` 报错 | 当特性完成并移动到 `specs/archive/<feat>/` 后，LoopX 能否继续定位该 state-file？ | 在 `cmd_merge` 阶段同时调用 `loopx retire-global-goal`，注销该 Goal 的全局活跃追踪，使已归档目标不再被作为活跃 Goal 巡检。 |
| A3 | PR 模板自动生成的 4-Part 内容具有足够的工程真实性 | 自动化提炼的内容是否会沦为空洞的套话或格式模板？ | PR Body 生成器必须直接读取 `01-decisions.md`（动机/方案权衡）、`04-contract.md`（接口不变量）、以及真实 Git Diff 的文件列表进行合成，严禁填充静态假数据。 |
| A4 | 模型 Adversarial Review 支持三维打分不会增加解析失败率 | 复杂的评价结构是否会导致 JSON 提取或解析失败（INV1 违规）？ | 维持 `authentic_review_result_v1` 协议扩展字段（`dimensions: { delivery, long_horizon, user_experience }`），并在解析层提供严格类型降级与容错。 |

## 3. 验收准则 (Acceptance Criteria)

1. **AC-1 (边界合规)**：`.loopx/`（除必要模板配置外）被 `.gitignore` 忽略，`git ls-files .loopx/registry.json` 为空，`loopx --registry .loopx/registry.json status` 不再报 `registry boundary risk: registry_tracked_but_not_push_allowed`。
2. **AC-2 (Goal 纳管闭环)**：新特性的 `state_file` 位于 `specs/features/<feat>/ACTIVE_STATE.md`；`loopx status` 不再对新特性报 `state_file_missing`；状态变更后自动触发 `loopx sync-global`。
3. **AC-3 (PR 7545 PR 描述)**：`gh pr create` 或 `authentic-review.js --rebuild-body` 输出的标准 PR Body 具备 `## 动机 / Motivation`、`## 改动思路 / Approach`、`## 具体改动 / Changes`、`## 对主干的风险 / Risks` 与 `### 验证矩阵`。
4. **AC-4 (三维 Review 与 Verdict)**：`loopx-flow review` 产出的 Block 4 包含 `delivery`, `long_horizon`, `user_experience` 评估与双语整体裁决。
5. **AC-5 (标准化 Respond 汇报)**：提供 `loopx-flow respond <pr_id>` 指令，生成标准的针对 Review 意见的更新与验证汇报表格。
