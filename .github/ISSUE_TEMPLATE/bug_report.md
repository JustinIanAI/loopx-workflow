---
name: Bug Report (缺陷汇报)
about: 报告工程中发现的问题或缺陷，触发 Issue 修复管线
title: "[BUG] "
labels: ["bug"]
assignees: ""
---

### 缺陷描述 (Description)
<!-- 简要描述该缺陷的现象与影响范围 -->

### 复现步骤 (Reproduction Steps)
1. 
2. 
3. 

### 预期行为 vs 实际行为 (Expected vs Actual)
- **预期**：
- **实际**：

### 影响分级与根因 (Impact & Root Cause)
- **Impact**: R1  <!-- 只保留一个值：R0 | R1 | R2；判据见 AGENTS.md 管线 B -->

| 级别 | 判据 |
|---|---|
| R0 Isolated | 纯文档 / Typo / 错误日志 / 模板 / 无行为影响的隔离配置 |
| R1 Behavioral | 有行为变化，但未触及 Gate/授权/状态机/持久化/并发/公共契约 |
| R2 Critical | Gate/授权/状态机/持久化/并发/公共契约 |

- **根因层级（L1-L7）**：
- **是否改变公共契约/默认行为**：否 / 是（是则先立 ADR）
- **回归测试路径**：`tests/unit/issues/issue-<id>.test.js`
- **回滚方式**：

### 环境信息 (Environment)
- OS:
- Node.js Version:
- LoopX Version:
