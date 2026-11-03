---
feature: loopx-ecosystem-alignment
updated_at: "2026-11-03 14:40:00"
status: APPROVED
approved_by: freecisco_yan
approved_at: "2026-10-30 15:44:18"
approval_source: "checkpoint-1 contract freeze (04-contract.md FROZEN & APPROVED)"
decisions:
  - id: ADR-001
    question: "如何对齐 LoopX PR #7545 官方 PR 描述规范？"
    options:
      - key: A
        label: "落地双语 4-Part 体系（动机/思路/关键代码讲解/主干风险/验证矩阵），由流水线自动从胶囊与 Diff 聚合"
      - key: B
        label: "维持现有精简 5-Block 文本占位"
    evidence:
      - "PR #7545 表明 LoopX 官方要求深入的 Agent 软件工程痛点剖析、架构不变式及详尽实测验证矩阵"
      - "简陋的 PR 描述无法提供足够的工程上下文以支撑严肃的交付决策"
    recommendation: "A"
    reason: "确保 PR 说明具备生产级工程严肃性，提供可追溯的承重假设与量化验证数据"
    impacted_components:
      - "skills/code-review/scripts/authentic-review.js"
      - "bin/loopx-flow (cmd_review / cmd_pr)"
    retired_paths:
      - "废弃无深度上下文的简版 PR Body 模板"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-002
    question: "如何对齐 LoopX 官方三维评价准则与 Adversarial Review 裁决模式？"
    options:
      - key: A
        label: "在模型审查中注入 delivery/long_horizon/user_experience 三维打分与结构化 Verdict 裁决"
      - key: B
        label: "仅输出零散的 findings 列表"
    evidence:
      - "PR #7545 官方 Review 严格按三维指标裁决并区分 P1/P2/Blocker 与 Concrete Repro"
      - "单一 findings 无法给出长程交付与用户体验的综合研判"
    recommendation: "A"
    reason: "形成与 LoopX 官方完全一致的严谨评审标准，杜绝仅有单测但实际脱管的假闭环"
    impacted_components:
      - "skills/code-review/scripts/authentic-review.js"
    retired_paths:
      - "废弃非结构化、无三维准则的 Review 结论块"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-003
    question: "如何规范作者针对 Review 意见的结构化自评与修复汇报？"
    options:
      - key: A
        label: "新增 loopx-flow respond <pr_id> 命令，按 PR #7545 模式生成 Item-by-item 修复汇报与验证矩阵"
      - key: B
        label: "人工随意在 GitHub PR 评论回复"
    evidence:
      - "PR #7545 作者每轮提交均附带结构化修复汇报与矩阵表格，清晰闭环每项阻塞点"
    recommendation: "A"
    reason: "使 Review 意见修复成为可审计、可自动回溯的标准化工程动作"
    impacted_components:
      - "bin/loopx-flow"
      - "skills/code-review/scripts/authentic-review.js"
    retired_paths:
      - "废弃非标准化的零散交互回复"
    human_approval: REQUIRED
    decision_result: "A (Selected)"

  - id: ADR-004
    question: "如何彻底消除 LoopX Goal 脱管状态并实现全生命周期纳管？"
    options:
      - key: A
        label: "解除私有注册表 Git 跟踪、胶囊绑定 state-file、强一致 sync-global 及 merge 全局 retire"
      - key: B
        label: "维持现有临时目录孤立生成与本地单向标记"
    evidence:
      - "loopx status 诊断明确报出 registry boundary risk、state_file_missing 与 stale_source_registry"
      - "历史 Goal 残留导致全局注册表累积大量僵尸状态"
    recommendation: "A"
    reason: "从数据边界、状态持久化、控制面同步与归档核销四端彻底合规，使 Goal 100% 纳入 LoopX 生态管控"
    impacted_components:
      - "bin/loopx-flow"
      - ".gitignore"
    retired_paths:
      - "废弃孤立的 .codex/goals/<gid> 脱节路径"
    human_approval: REQUIRED
    decision_result: "A (Selected)"
---

# Architecture Decisions: loopx-ecosystem-alignment

## 1. 架构决策总览
- **特性名称**: `loopx-ecosystem-alignment`
- **核心目标**: 全面重构 PR 提交/审查/回复协议以严格对齐 LoopX PR #7545 官方标准，同时彻底治理 Goal 生命周期，消除脱管状态。

## 2. 决策要点摘要
- **ADR-001**: PR 描述对齐 PR #7545 双语 4-Part 体系（动机、思路、关键代码逐文件讲解、主干风险、实测验证矩阵）。
- **ADR-002**: 模型交付审查对齐 LoopX 官方三维准则（`delivery`, `long_horizon`, `user_experience`）及结构化双语 Verdict。
- **ADR-003**: 新增 `loopx-flow respond <pr_id>` 指令，提供标准的 Review 意见逐项闭环与再验证汇报协议。
- **ADR-004**: LoopX Goal 深度纳管：解绑 Git 私有注册表、自包含胶囊 state-file、强一致自动 sync-global、merge 联动 retire 全局注销。

## 3. 变更规模与回滚关系 (Governance Record)

- **回滚基线**：`main@d91ed6b` 为 `revert: rollback unauthorized PR #10 and subsequent commits to restore pre-review baseline`。本分支 `feature/loopx-ecosystem-alignment` 是从该基线重新发起的正式 PR 提交（首位提交 `0ee793e chore(capsule): unarchive capsule back to specs/features for formal PR review`），并非绕过回滚，而是按正式评审流程重新提交。
- **变更规模**：本 PR 聚合评审管线原生格式重构 + `loopx-flow` 场景化命令治理 + fail-closed-hardening 胶囊，`git diff origin/main..HEAD` 约 +2202/−1017、27 files，超过「单 Feature Diff ≤ 500 行」的经验阈值。
- **豁免决定（人类决策者 freecisco_yan，2026-11-03）**：不拆分 PR。理由：拆分将重置已完成的契约冻结、质量收据与评审历史，且两部分改动共享 `authentic-review.js` / `bin/loopx-flow` 同一组文件，强行拆分会产生互相依赖的半成品 PR。豁免以本记录 + 00-INDEX 状态看板为审计凭证。
- **格式权威**：评审与回复报告统一复用 `loopx pr-review` 的 `review_template`（动机/改动思路/具体改动/对主干的风险/我的整体评价），旧自造 Block 模板已退役（anti-entropy，delete-first）。
