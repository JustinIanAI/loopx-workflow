# 架构决策备忘录：CLI 与脚本硬熔断守卫体系 (Hard Enforcement Guard)

- **特性代号**：`hard-guard`
- **方案状态**：`Status: APPROVED BY HUMAN`
- **确认时间**：2026-10-21
- **决策审批人**：Human Tech Lead

---

## 一、 决策背景
在 AI-Native 研发流水线中，AI Agent 在执行高并发长程任务时，容易因“任务执行狂热”跳过既定的架构研讨、契约冻结与 GitHub PR 审批流程。为确保“Human-in-the-Loop”质量底线绝不被架空，必须在 CLI、底层脚本和 Git 钩子中植入物理级 Fail-Closed 硬熔断守卫。

---

## 二、 核心决策分支与选型矩阵

### 决策分支 1：合入操作的硬熔断 (Merge Fail-Closed Gate)
- **选定方案**：**选项 A（绝对物理阻断，Fail-Closed）**
- **技术规范**：
  - `bin/loopx-flow merge <pr_id>` 检查 GitHub PR 状态时，若 `reviewDecision !== "APPROVED"`，抛出错误并强制 `exit 1`，立即终止合并。
  - 若为无 Remote 的离线单机测试，严禁静默合入；必须显式传入 `--offline-approved-by="<user>" --reason="..."`，并在 `.loopx/audit.log` 记录审计凭证。
- **否决备选**：选项 B（终端简单确认），因无法杜绝非交互式 Agent 会话自动确认。

### 决策分支 2：阶段流转守卫机制 (Stage Transition Gate)
- **选定方案**：**选项 A（显式签名检查器 `loopx-flow gate verify <stage>`）**
- **技术规范**：
  - **阶段 4 准入前**：检查 `docs/decisions/<feature>-decisions.md` 是否存在且包含 `Status: APPROVED BY HUMAN`，否则拒绝生成后续任务与代码骨架。
  - **阶段 5 编码准入前**：检查 `.trae/specs/<feature>/tasks.md` 是否存在且包含 `Contract-Status: FROZEN & APPROVED`，否则四大门禁脚本与构建工具直接抛错。
- **否决备选**：选项 B（仅在 PR 集中校验），中途无断点会导致返工成本过高。

### 决策分支 3：Git 主干直接提交拦截 (Git Pre-Commit Hook)
- **选定方案**：**选项 A（挂载 Git `pre-commit` 钩子）**
- **技术规范**：
  - 在 `.git/hooks/pre-commit` 及 `scripts/git-hooks/pre-commit` 中部署主干防直推脚本。
  - 当 `git branch --show-current` 为 `main` 时，直接拦截 `git commit`（输出错误提示：严禁直接向 main 分支提交代码，必须在 feature/* 或 fix/* 分支走 PR 流程）。
- **否决备选**：选项 B（仅依赖 CLI 检查），无法防御终端原生 `git commit` 操作。

---

## 三、 影响范围与组件
1. `bin/loopx-flow`：增强 `cmd_merge` 逻辑（由 Warning 改为硬阻断），新增 `cmd_gate` 子命令。
2. `scripts/git-hooks/pre-commit`：新增主干保护钩子，并在 `scripts/workflow-init.sh` 中自动挂载。
3. `package.json`：门禁脚本增加对阶段契约签名的前置守卫调用。
4. `tests/unit/guard.test.js`：增加对硬熔断逻辑的单测套件。
