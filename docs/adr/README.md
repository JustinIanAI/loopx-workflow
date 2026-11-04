# ADR

产品行为的增量只放这里。一份 ADR 修订 [产品 PRD](../prd/loopx-workflow.md) 里的 `REQ-*`；若命令、失败条件或不变量变了，同时修订 [详细设计](../design/loopx-workflow-design.md)。

Feature 胶囊的 `01-decisions.md` 只记录该胶囊怎么实现，并链接到相关 ADR。不要在胶囊里新写一套产品决策。

## 编号

`NNNN-短横线标题.md`，四位递增。`0001` 已用于确立本文档体系。

## 模板

```markdown
# ADR-NNNN：标题

- **状态**：Proposed | Accepted | Superseded by ADR-MMMM
- **日期**：YYYY-MM-DD

## 背景

什么产品行为对不上现有 REQ，或现有 REQ 的哪条假设失败了。

## 决策

选了什么。

## 否决

否决了什么，为什么不再加一条平行路径。

## 修订

- PRD：改或新增哪些 `REQ-*`；哪条句子删除
- 设计：改了哪一节；没有则写「不改设计」
- 退役：哪份旧说明作废

## 不做什么

本决策明确不实现的邻近能力。
```

Accepted 之前，不要把对应行为写进契约并开始实现。
