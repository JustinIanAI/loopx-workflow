# 本次交付的需求切片

产品正文仍为 `docs/prd/loopx-workflow.md`；本文件只限定 GitHub #6 第 3 项的交付。

## 1. 核心目标与用户旅程

Part of #6，仅实现第 3 项。此前 `integrate configure ...` 被旧解析器忽略并误走 sync；现在首参数 configure 调用原生配置，非法参数直接拒绝。用户可在同一门面完成配置预演，并在显式 --execute 后落盘。

- REQ-FACADE-1 / REQ-FACADE-2：用户可用 `loopx-flow integrate configure` 准备或执行预集成配置。
- REQ-NATIVE-1：配置决策与落盘由原生 integration-branch configure 独占。
- REQ-FAILCLOSED-1：参数不合法零调用；原生失败不得输出成功。
- ADR-0007：沿用现有路径锚定，项目根取自实际目标仓库，非安装目录；registry 使用现有全局选项及环境变量路径。

## 2. 承重假设与风险

原生 CLI 必须保持 configure 参数契约；所有选项均为单值或布尔开关；`--execute` 仅在显式传入时出现。用 fake argv 逐项证明转发，用原生 help 证明能力存在，不修改真实集成配置。新增本地参数检查只作用于 configure，旧 integrate 分支保持不变并有回归测试。剩余交付风险是 Gate1、严格 Receipt 与最新 head 的独立审查尚待完成，由 JustinIanAI / 独立审查 owner 继续。

切片验收映射至 04-contract AC1–AC7。其他 backlog 项、旧 integrate 行为、approve/merge/check/todo 失败语义均 out_of_scope。
