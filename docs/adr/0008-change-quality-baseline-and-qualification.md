# ADR-0008：change-quality 基线解析与 Goal 资格前置诊断

- **状态**：Accepted
- **日期**：2026-11-16
- **关联**：GitHub Issue #13

## 背景

`loopx-flow check` 在四大硬门禁全绿后卡在质量收据阶段：

1. `change-quality prepare` 依赖 loopx 原生默认值 `origin/main`。业务仓库远程主干为 `origin/master` 且无 `origin/main` 时，`git rev-parse origin/main^{commit}` 报 `fatal: Needed a single rev`，收据无法生成。
2. Goal 未启用 change-quality 资格时，`record` 阶段才报 `qualification is disabled for this goal`；用户已白跑全套测试，且错误信息没有修复指令。

本仓库 `env-governance` 测试早已用 `trunkBase()`（顺序 `origin/HEAD`、`origin/master`）处理同类问题，但 change-quality 调用链未同步。

## 决策

1. 以 `skills/code-review/scripts/ingest-to-loopx-quality.js#discoverBaseRef()` 为**单一事实源**，按 `origin/HEAD` → `origin/main` → `origin/master` 解析真实存在的远程默认基线；`bin/loopx-flow` 通过 node 委托该函数，不另写一套解析逻辑。
2. 把解析结果作为 `--base-ref` 显式传给 loopx 原生 `change-quality prepare` / `record` / `verify` 与 OCR 脚本。原生 CLI 已支持该参数，无需改 loopx 本体；这是边界核实后的能力复用，不是降级。
3. 通过 `prepare` 返回的 `status === "disabled"` 或 `policy.enabled === false` 在 `check` 前置阶段 fail-closed，`doctor` 输出同类诊断卡；两者均给出 `loopx configure-goal --goal-id <goal> --change-quality-enabled --execute`（必须带 `--execute`，否则 configure-goal 仅干跑预览、不写回 registry，无法解除阻断）。
4. 三种基线均不存在时非 0 并提示 `git fetch origin && git remote set-head origin -a`，禁止伪造远程基线。

## 否决

- **否决伪造 `origin/main` 或改业务侧测试绕过**：掩盖真实配置缺陷，且与 `env-governance` 测试的显式禁令冲突。
- **否决在 loopx 原生命令内改硬编码**：loopx 已暴露 `--base-ref`，属于能力复用；改上游超出本仓库改动面。
- **否决让 `doctor` 硬阻断**：doctor 是阶段 0 体检，沿用现有控制面检查的 WARN 语义；真正的 fail-closed 落在 `check` 前置阶段。

## 修订

- PRD：新增 `REQ-QUALITY-3`。
- 设计：第 10 节失败矩阵新增三行（master 主干、基线全缺、资格未启用）。
- 退役：`ingest-to-loopx-quality.js` 中 `baseRef` 的 `origin/main` 硬编码默认值作废。

## 不做什么

- 不修改 loopx 原生 `change-quality` 实现。
- 不改变资格本身的授予流程（仍由 Goal owner 通过 `configure-goal` 决定）；本决策只负责让未启用状态提前可见、可修复。
