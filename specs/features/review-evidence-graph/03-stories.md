# Stories: review-evidence-graph

- **Feature**: review-evidence-graph
- **Diff 目标**: ≤500 行

## S1 证据图构建

- 读取 packet result_template + evidence requirements；
- 本地事实填充 + 模型语义合并；
- 缺失字段/非法 verdict → NOT_VERIFIED。

## S2 R4 PR body

- 真实 diff 逐文件说明；
- 无法解释的二进制/生成文件标 NOT_PROVIDED；
- validation_matrix 来自实际门禁，不硬编码。

## S3 回归

- 新增证据测试；
- check-result 基准 approval_consistent=true；
- 既有 review pipeline 测试不回归。
