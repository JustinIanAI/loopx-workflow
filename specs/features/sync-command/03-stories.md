# 故事与顺序

## Story-1：独立重试同步

作为仓库维护者，我要从 loopx-flow 发起全部或单个 Goal 的全局同步，以便补偿同步失败而不重跑 feature/approve/merge。

Conversation：设计见 01-decisions，规格见 04-contract。单个可独立验证的交付，不按层拆 issue/PR。

Confirmation：无参同步全部；显式 Goal 精确透传；参数错误不调用底层；缺环境与持续失败非零；重试后成功才输出成功；文档与 usage 一致。

顺序：人类确认方案 → 正式 Gate1 → todo claim → 行为测试先红 → 薄入口实现与文档 → 测试变绿及四门禁 → check/审查/后续 Gate2。

排期按此依赖顺序推进，本轮只到 Gate1 申请，不创建或认领实施 todo。
