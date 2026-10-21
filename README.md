# LoopX AI-Native Coding Workflow

> 面向 Coding 场景的长程自主研发工作流。以 **LoopX 控制面** 为任务管理状态中枢，配合 **11 项常用 AI-Native Skills** 与 **GitHub 交付流**，提供从需求压力测试、方案设计、契约冻结、TDD 循环、分层代码审查到自动合并归档的端到端闭环研发管线。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![LoopX: v2.0](https://img.shields.io/badge/LoopX-2.0.0-green.svg)](https://github.com/loopx-project)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](package.json)

---

## 🌟 核心设计理念

1. **降低 LoopX 使用门槛**：提供轻量向导 CLI (`bin/loopx-flow`)，将底层复杂的任务租约、状态投影、就绪度自检与生命周期流转统一封装，开发者与 AI 均可通过极简指令开箱即用。
2. **长程任务全生命周期自闭环**：
   - **管线 A (Feature 8 阶段研发)**：前置体检 ➔ 方案研讨 (`design-grill`) ➔ 精益 PRD (`create-prd` + `strategy-red-team`) ➔ 模块拆分 ➔ 契约冻结 (`tasks.md`) ➔ TDD 红绿实现 ➔ 本地门禁与 L1 审查 (`code-review`) ➔ 交付审查 (L2) ➔ 人工核验合并 (L4) 与 Goal 归档。
   - **管线 B (GitHub Issue 双分支修复)**：智能分流 Fast-Path（微修复自适应直推）与 Standard PR-Path（先红后绿标准 PR 交付）。
3. **关键节点明确“看什么、怎么看”**：沉淀专属《关键节点质量审查与验收手册》，在决策备忘录、PRD 承重假设、契约声明及 GitHub PR 页面提供显式审查标准与 8 项事实核验清单，防止质量滑坡。
4. **多 Agent 并行防冲突**：集成 LoopX `task-lease` 任务排他锁与 `loopx integration-branch` 预集成本地检测，杜绝多 Agent 任务踩踏与合并冲突。
5. **完全支持工程自举 (Dogfooding)**：本工作流自身的优化迭代、开源发布与脚本门禁，全部由本工作流自身驱动与验证。

---

## 🏗️ 架构全景图

```
======================================================================================================
                         LoopX × GitHub 多 Agent 全生命周期 Coding Workflow
======================================================================================================

 [阶段 0: 前置环境准入与脚手架]
   │
   └─► loopx-flow doctor ➔ 验证 Git, CLI (gh/loopx/ocr), 四大门禁, 目录骨架与就绪度
   │
 [需求研讨与方案冻结]
   │
   ├─► 阶段 1: 方案研讨与压力测试 ──► 工具: design-grill ➔ 产出: docs/decisions/<feature>-decisions.md
   ├─► 阶段 2: 精益 PRD 与红队对抗 ──► 工具: create-prd + strategy-red-team ➔ 产出: docs/prd/<feature>-prd.md
   ├─► 阶段 3: 模块拆解与优先级 ──► 工具: user-stories + prioritize-features ➔ 产出: docs/stories/<feature>-stories.md
   └─► 阶段 4: 契约冻结与实体对账 ──► 工具: tasks.md 契约顶部固化 + loopx start-goal / todo 实体创建
   │
 [多 Agent 并行调度与执行层]
   │
   ├─► LoopX 排他锁机制: loopx-flow todo claim <tid> (task-lease acquire)
   │
   ├─► 【管线 A: Feature 8 阶段研发】
   │     └─► 阶段 5: TDD 循环实现 ──► 工具: test-driven-development ➔ 四大硬门禁 100% 全绿
   │     └─► 阶段 6: 代码级审查 (L1) ──► 工具: code-review (默认) / open-code-review (提升) ➔ 0 阻断
   │     └─► 阶段 7: 交付级审查 (L2) ──► 工具: loopx-flow review <pr> ➔ 顶置 5-Block 报告至 PR
   │     └─► 阶段 8: 人工核验与归档 (L4) ──► 工具: loopx-flow merge <pr> ➔ 8项核验 ➔ Squash合入 ➔ 自动归档 Goal
   │
   └─► 【管线 B: GitHub Issue 修复】
         ├─► 分类判定: loopx-flow issue <id> (按改动行数、接口破坏性判定)
         ├─► 路径 A: Fast-Path ──► 改动 ≤ 20 行 ➔ 单测最小修复 ➔ 尝试直推 main (遇保护自适应降级 PR 自动合入)
         └─► 路径 B: Standard PR ──► Failing Repro 先行 (必先红) ➔ 修复变绿 ➔ PR 5-Block 审查 ➔ 人类核验合入
```

---

## ⚡ 5 分钟极速上手

### 1. 检出与环境就绪体检
```bash
git clone https://github.com/loopx-project/loopx-workflow.git
cd loopx-workflow

# 运行全维体检
./bin/loopx-flow doctor
```

### 2. 存量项目一键接入
若需要将现有存量项目接入本流水线：
```bash
# 在现有项目根目录下执行
/path/to/loopx-workflow/bin/loopx-flow init
```

### 3. 开发一个新 Feature
```bash
# 1. 开启新特性管线 (自动建分支、创建 LoopX Goal、建立 tasks.md 契约模版)
./bin/loopx-flow start user-auth

# 2. 领用任务排他锁
./bin/loopx-flow todo claim t1

# 3. 运行本地四大硬门禁 (Typecheck, Lint, Build, Test)
./bin/loopx-flow check

# 4. 查看当前任务看板与状态
./bin/loopx-flow status
```

---

## 📖 核心命令速查 (CLI Cheat-Sheet)

| 命令 | 说明 | 对应底层 LoopX / 脚本能力 |
|---|---|---|
| `loopx-flow doctor` | 前置体检与 LoopX 就绪度全维评分 | `preflight-check.sh` + `loopx doctor` |
| `loopx-flow init` | 为当前仓库注入规范目录与 LoopX 状态 | `workflow-init.sh` + `loopx bootstrap` |
| `loopx-flow start <feature>` | 开启特性管线并创建 Goal 实体 | `git checkout -b` + `loopx start-goal` |
| `loopx-flow todo list [gid]` | 列出当前 Goal 下的全部待办任务 | `loopx todo list` |
| `loopx-flow todo claim <tid>` | 申领任务排他租约防踩踏 | `loopx task-lease acquire` |
| `loopx-flow todo done <tid>` | 标记任务完成并回写对账证据 | `loopx todo complete` |
| `loopx-flow check` | 执行本地四大硬门禁与质量准入 | `npm run ...` + `loopx change-quality` |
| `loopx-flow review <pr_id>` | 执行 L2 交付审查并顶置报告至 PR | `loopx pr-review` |
| `loopx-flow merge <pr_id>` | 核验 Approved 决议、Squash 合入并归档 Goal | `loopx-pr-merge` + `loopx goal-lifecycle` |
| `loopx-flow issue <issue_id>` | GitHub Issue 智能分流与修复向导 | `loopx issue-fix feasibility` |
| `loopx-flow status` | 查看当前 Goal 进度与注意力队列 | `loopx status` |

---

## 🧭 关键节点审查指南 (“看什么、怎么看”)

项目提供了详尽的专供技术负责人与评审员的审查验收手册：
- **查看完整指南**：👉 [`docs/guides/reviewer-inspection-guide.md`](docs/guides/reviewer-inspection-guide.md)
- **审查重点速览**：
  1. **阶段 1 研讨**：查阅 `docs/decisions/`，确保 3~6 个顶层分支无悬而未决的“it depends”。
  2. **阶段 2 PRD**：查阅 `docs/prd/`，确认承重假设矩阵与反驳用例能够经受攻击。
  3. **阶段 4 契约**：查阅 `.trae/specs/<feature>/tasks.md`，确认顶部 TypeScript 签名固化。
  4. **阶段 6 L1 审查**：查阅 `/tmp/l1-review-evidence.md`，确认 0 Actionable Defects。
  5. **阶段 8 PR 合并**：在 GitHub PR 页面严格核验 **8 项事实**（改动规模、契约、门禁、L1证据、预集成、元数据、HEAD SHA、Squash准入）后点击 Approve。

---

## 🧰 核心 Skills 资产清单

位于 `skills/` 目录，涵盖 11 项 AI Agent 核心能力：
- `code-review`: [L1 默认] 基于参与者契约的高精度语义代码审查。
- `design-grill`: [阶段 1] 代码库感知架构方案压力测试与决策备忘录提取。
- `create-prd`: [阶段 2] 8 板块精益 PRD 快速生成工具。
- `strategy-red-team`: [阶段 2] 业务与架构承重假设红队攻击引擎。
- `user-stories`: [阶段 3] 用户故事拆解与清晰 Write Scope 划定。
- `prioritize-features`: [阶段 3] 需求价值/成本优先级评估。
- `test-driven-development`: [阶段 5] 严格红绿重构与测试驱动开发。
- `loopx-pr-review`: [阶段 7] GitHub PR 交付级 5-Block 审查报告生成器。
- `loopx-pr-merge`: [阶段 8] SHA 一致性核验、Squash 原子合入与 Goal 自动归档器。
- `loopx-issue-fix`: [管线 B] GitHub Issue 双分支分流与闭环修复管理。
- `open-code-review`: [L1 提升] 阿里开源 Open Code Review 深度扫描门禁。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
