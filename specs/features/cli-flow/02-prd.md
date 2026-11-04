# Lean PRD: cli-flow

> 历史切片。产品需求以 [docs/prd/loopx-workflow.md](../../../docs/prd/loopx-workflow.md) 为准。本文件只保留当时的验收与假设，不另立产品规格。见 [ADR-0001](../../../docs/adr/0001-product-source-of-truth.md)。

## 1. 背景与目标
降低 LoopX 在日常研发流中的使用门槛，提供类似 git-flow 的开发者直觉命令行界面。

## 2. 核心功能
- `doctor`、`init`、`feature`、`check`、`merge`、`issue` 等一站式操作。
