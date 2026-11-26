# 开工与 Gate1 准备证据

本页当前仅记录开工事实；不是阶段 5/6 ingest 生成的质量通过凭据。

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 远端 main | passed | ls-remote = e17200a38c12ddf65926b99747455da90c79f9f0，本地 HEAD 相同 |
| 前置哨兵 | passed | 修复安装后 scripts/preflight-check.sh exit 0，6/6 |
| 原生同步签名 | passed | LoopX 2.3.0 sync-global --help 支持可选 --goal-id |
| Feature 初始化 | passed | bin/loopx-flow feature sync-command exit 0，sync-command-goal 注册及同步成功 |
| GitHub 身份读取 | passed | gh api user --jq .login = lhkkk；配置 single_owner accepted_by=JustinIanAI |
| 人类方案共识 | not_run | 01-decisions DRAFT，等待本卡审批 |
| 正式 Gate1 前置检查 | blocked | 实跑 `bin/loopx-flow approve contract sync-command` exit 1：`[-] [FAIL-CLOSED] 01-decisions.md 未标记 APPROVED`；未写批准 marker，账号检查尚未到达 |
| typecheck / lint / build / test | not_run | 未实施代码；本轮仅规格准备，不将体检的配置完整当成四门禁执行通过 |
| 实现行为 T1–T6 / 质量 Receipt | not_run | 审批后执行 |

账号边界：当前实际身份不同于仓库 accepted_by；approve 源码会在 TTY 检查后比较二者。未登录或冒用请求人的 GitHub 账号，未更改配置，未伪造该分支实际错误。人类可按索引步骤实跑并把实际 stderr 回贴。
