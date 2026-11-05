# Implementation Decisions: review-evidence-graph

- **Status**: APPROVED BY HUMAN (freecisco_yan@2026-11-05 16:22:56)
- **Feature**: review-evidence-graph
- **Links**: 旧 issue #25、R4、ADR-0006

## 取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| 证据 schema 来源 | LoopX packet 的 `review_plan.result_template` + `review_execution_contract.evidence_requirements` | 不手写第二套 schema |
| 事实类证据 | 本地确定性合成：validation_matrix、changed_line_classification、code_volume、diff_sha256 | 不把可测事实交给模型编 |
| 语义类证据 | 模型输出 evidence，脚本补齐缺失字段并校验 shape | 模型负责架构/风险判断 |
| check-result | 证据图完整后必须 `approval_consistent=true` 才允许 APPROVE | 不再用“封顶 REQUEST_CHANGES”兜底 |
| PR body | 从真实 diff 生成逐文件说明；无法解释标 NOT_PROVIDED | R4 |

## 不做

- 不伪造未执行的 validation；未跑的命令标 not_applicable/unverified。
- 不为通过门禁而删除字段。
