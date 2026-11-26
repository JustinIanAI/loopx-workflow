# 开工与 Gate1 准备证据

本页当前仅记录开工事实；不是阶段 5/6 ingest 生成的质量通过凭据。

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 远端 main | passed | ls-remote = e17200a38c12ddf65926b99747455da90c79f9f0，本地 HEAD 相同 |
| 前置哨兵 | passed | 修复安装后 scripts/preflight-check.sh exit 0，6/6 |
| 原生同步签名 | passed | LoopX 2.3.0 sync-global --help 支持可选 --goal-id |
| Feature 初始化 | passed | bin/loopx-flow feature sync-command exit 0，sync-command-goal 注册及同步成功 |
| GitHub 身份读取 | passed | gh api user --jq .login = lhkkk；配置 single_owner accepted_by=JustinIanAI |
| 人类方案共识 | passed | TRE-143 评论 01a2170d-ce07-76b3-a02f-e8124150fe78 同意方案，限定 GitHub #6 第 4 项；01-decisions 已记录 APPROVED |
| 正式 Gate1 | blocked | 方案批准后补充 03-stories 的 AC 标签（验收含义未变），实跑真实 CLI/TTY 后 exit 1：`[-] [FAIL-CLOSED] 当前 gh login (lhkkk) 与 accepted_by (JustinIanAI) 不一致`；未输入签署确认、未写契约批准 marker |
| typecheck / lint / build / test | not_run | 未实施代码；本轮仅规格准备，不将体检的配置完整当成四门禁执行通过 |
| 实现行为 T1–T6 / 质量 Receipt | not_run | 审批后执行 |

账号边界：真实 approve 已执行到账号比较并拒绝。未切换到其他人的凭证，未改配置，未代填确认。需配置审批人 JustinIanAI 在合法登录环境执行正式授权，再 gate verify 通过；本卡方案同意已保存，无需重复方案审批。

本轮 main 复核仍为 e17200a；前置技能再次缺失，按原生安装指引修复后哨兵 exit 0。原生降级仅用于 workflow-skills/slash-commands 安装（门面无对应入口），未绕过 Goal/Gate/Receipt。实现仍 not_run。
