# 本次需求切片

产品正文仍是 `docs/prd/loopx-workflow.md`。本胶囊覆盖 REQ-FACADE-1/2、REQ-FAILCLOSED-1，复用 ADR-0003/0007；审批遵守 ADR-0009。

Before：用户只能调用原生 `loopx sync-global`。After：通过 `loopx-flow sync [--goal-id <gid>]` 完成同一同步，registry、重试与错误由既有所有者管理。

范围仅 Issue #6 第 4 项中尚未完成的独立入口。其他条目、feature/approve/merge 已关闭的失败即停、控制面重写、审批身份迁移均不在本次范围。不能关闭整个 Issue #6。

## 承重假设攻击（strategy-red-team）

| 优先级 | 假设 / Fails if | 最便宜验证与停止条件 |
| --- | --- | --- |
| 1 | 参数错仍触发同步，或 registry 路径含空格被拆开 | 真实入口 + argv 记录 mock；任一错误参数产生调用、或 argv 不一致则停止交付 |
| 2 | retry 在首次失败后错误放行 | 首次失败后成功、连续三败计数；最终非零、不得输出成功；任一不符停止 |
| 3 | 不带 Goal 被 branch 推断而改变作用域 | feature 分支和任意分支均验证无 --goal-id；不一致则停止 |
| 4 | 新命令误动审批或生命周期 | mock 拒绝 sync-global 以外调用，比较胶囊与源 registry；异常写入则停止 |

已有 LoopX 2.3.0 `sync-global --help` 确认 --goal-id 可选；不构造新 schema。真实网络/锁冲突尚未在本项测试，必须区分 mock 行为覆盖与真实控制面证据。
