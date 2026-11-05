# 阶段 0：前置体检已通过（preflight-check.sh 全绿，gh 认证 WARN 不影响本地测试）
# 阶段 1：方案研讨已完成——用户确认采纳「head-oid 幂等 + comment upsert + 客户端节流」三项改动
# 阶段 2/3：本切片为评审管线降载微修复，承重假设已在对话中通过数据（3053 会话、每会话 4 次 gh 调用、峰值 69 会话/分钟）论证
# 阶段 4：契约冻结于 specs/features/review-pipeline-throttle/04-contract.md
# 阶段 5：TDD 实现——测试先行（tests/unit/review-pipeline-throttle.test.ts）
