# 故事与执行顺序

| Story | 用户可观察结果 | AC | 依赖 |
| --- | --- | --- | --- |
| S1 | 从门面调用原生 configure，保留 refs、显式开关和 plan 路径 | AC1, AC2, AC6 | 规格完成后先写红测试，再实现 |
| S2 | 无效输入零调用；原生失败保留诊断且不报成功 | AC3, AC4, AC5 | S1 共用解析函数与 fake CLI |
| S3 | help/README/design 一致，旧 integrate 用例仍通过，提供检查证据 | AC7 | S1, S2 |

单一行为、同一 owner，一项功能一个提交/PR，不按层拆分。
本次先准备可审阅的规格与实现；契约授权、独立审查与合并授权分别由其实际 owner 完成，未完成项写入 evidence。
