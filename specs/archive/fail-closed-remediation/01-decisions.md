# Implementation Decisions: fail-closed-remediation

- **Status**: APPROVED BY HUMAN (freecisco_yan@2026-11-04 17:13:22)
- **Product decisions**: [ADR-0003](../../docs/adr/0003-approve-doctor-sync.md)、[ADR-0004](../../docs/adr/0004-check-goal-identity.md)
- **Feature**: fail-closed-remediation
- **Goal**: fail-closed-remediation-goal

## 1. 实现取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| approve 原子性 | 先写临时契约/备份，算最终 SHA，`configure-goal` 成功才原子替换 | 失败不留半状态 |
| approve 缺 loopx | 在写任何标记前 exit 1 | 无控制面不得本地“批准” |
| sync-global | 统一 helper，最多 3 次重试，仍失败非 0 | 全局同步是状态可见性承重路径 |
| doctor 缺 loopx | 结构化诊断卡 + exit 1 | PRD 要求非 0 |
| check 身份 | feature 或 `--goal-id` 必须有；有胶囊先 `gate verify contract` | 不再假通过 |
| ingest 无身份 | 直接失败，不再回退 `specs/features` 第一个目录 | 防止写错胶囊 |
| feature 状态文件 | 不预创建，交给 `loopx bootstrap --state-file` | 修复 #17 canonical authority 失败 |
| P2（R1 review） | 在 merge 切 base 前检查未提交文件；成功后尽量恢复原分支 | 减少本地脏工作区导致补偿失败 |

## 2. 明确不做

- 不改 `change-quality` 的扫描规则（R4）。
- 不改 review/PR 正文（R3/R4）。
- 不改变 GitHub Approve/readiness 语义。
