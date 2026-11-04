# User Stories & Sizing: fail-closed-remediation

- **Diff 目标**: ≤ 500 行（含测试）
- **Feature**: `fail-closed-remediation`

## Story 1: 审批不落假标记

**As** 决策者，**I want** 无 loopx 或锁失败时契约不被标成 APPROVED，**so that** 审批状态可信。

- AC1: 无 loopx → exit 1 且契约字节不变。
- AC2: configure-goal 失败 → 回滚，exit 1。

## Story 2: 体检/检查不假通过

**As** 交付 Agent，**I want** doctor 缺 loopx、check 无 Goal 时非 0，**so that** 缺失控制面不会继续交付。

- AC1: doctor 诊断卡 + exit 1。
- AC2: check 无 feature/goal → exit 1；有胶囊先 gate verify。

## Story 3: ingest 不写错胶囊

**As** 质量审计者，**I want** 无身份时 ingest 失败，**so that** 不会把证据写进第一个胶囊。

- AC1: 删除 entries[0] 回退。
- AC2: 无 feature/goal → exit 1。

## Story 4: feature 创建 canonical Goal

**As** 交付 Agent，**I want** `feature` 不在 bootstrap 前创建 state file，**so that** LoopX 2.0 能创建 canonical authority。

- AC1: 真实 bootstrap 可成功（issue #17 修复）。
- AC2: 无 loopx 时仍能生成本地模板（不注册 Goal）。

## Story 5: 同步失败即停

**As** 维护者，**I want** sync-global 失败有限重试后非 0，**so that** 全局状态不静默滞后。

- AC1: 3 次失败 → exit 1 + 修复命令。
