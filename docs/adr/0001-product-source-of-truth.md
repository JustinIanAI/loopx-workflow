# ADR-0001：产品正文与增量决策

- **状态**：Accepted
- **日期**：2026-11-03

## 背景

仓库只有一份架构 spec（管线与胶囊目录），以及 9 份互相不引用的 feature 精简 PRD。`AGENTS.md` 要求产品材料只放在 `specs/features/<feature>/`，并明确不要 `docs/prd/` 这类跨特性文档。结果是没有一份可以修订的产品需求：下一个 feature 会再写一份小 PRD，而不是改同一份正文。

需要决定产品真相放在哪里，以及 feature 胶囊还留下什么。

## 决策

- 产品需求只在 `docs/prd/loopx-workflow.md`，需求编号为 `REQ-*`。
- 命令、阶段、失败条件和资产路径只在 `docs/design/loopx-workflow-design.md`。
- 对这两份正文的修订只通过 `docs/adr/NNNN-*.md`。行为变化先改 PRD；命令或失败条件变化同时改设计。然后才冻结 feature 契约。
- `specs/features/<feature>/` 继续保留，作为一次交付的故事、契约和证据。`02-prd.md` 只列出本胶囊覆盖的 `REQ-*` 或 ADR。`01-decisions.md` 只记录实现取舍并链接 ADR。
- 删除 `docs/design/coding-workflow-tools-spec.md`，不留跳转桩。
- 不为本次文档收口再创建一个 feature 胶囊。
- 不在本决策里给 `approve` / `gate` 增加“未引用 REQ 或 ADR 就失败”的检查。该检查是后续变更，必须引用 PRD 的 `REQ-TRACE-1` 与 `REQ-TRACE-2`。

## 否决

- **单文件大 PRD。** 需求与命令失败矩阵混在一起后，spec 会再次变成唯一文档，评审时分不清“承诺什么”和“命令怎么失败”。
- **产品 PRD 只做索引，feature `02-prd.md` 仍是规格。** 这保留了离散规格，正是要收口的问题。
- **另建 `docs/decisions/`。** 与 ADR 目录重复。历史胶囊里出现过的 `docs/decisions/` 路径不恢复。

## 修订

- PRD：新建 `docs/prd/loopx-workflow.md`，编号从场景门面到追溯。
- 设计：新建 `docs/design/loopx-workflow-design.md`。
- 退役：`docs/design/coding-workflow-tools-spec.md`。`AGENTS.md` 铁律 2 里“禁止跨特性产品文档、feature PRD 即产品 PRD”的句子删除，改为指向上述两份正文。`skills/design-grill/SKILL.md` 不再把决策写到 `docs/decisions/`。

## 不做什么

- 不重写 9 份历史 `02-prd.md` 正文，只加来源说明。
- 不修改 `docs/guides/loopx-workflow-architecture.html`。
- 不改 `bin/loopx-flow` 的退出码。设计里写明的现行为缺口（`doctor` 缺 LoopX、无 feature 的 `check`、合入后的全局退役、`issue` 不执行修复）保持为缺口，直到各自的 ADR。
