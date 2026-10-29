# Architecture Decisions: cli-flow

## 1. 核心决策
- **决策 1**：采用极薄 Bash 编排器（`bin/loopx-flow`），直接透传统一的命令抽象，避免为用户引入新的语言运行时代价。
- **决策 2**：在命令执行前统一自动加载本地 `.loopx/registry.json`，减少全局路径传参负担。
