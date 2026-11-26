# TRE-143 / sync-command — Gate1 审阅包

- 状态：READY FOR HUMAN REVIEW；尚未授权实施。
- Feature：`sync-command`；分支：`feature/sync-command`；Goal：`sync-command-goal`。
- 范围：[GitHub Issue #6 第 4 项](https://github.com/JustinIanAI/loopx-workflow/issues/6)，仅新增独立 sync 命令。
- 基线：`origin/main@e17200a38c12ddf65926b99747455da90c79f9f0`（2026-11-26 核对远端 main）。

## 审阅顺序

1. [实现取舍](01-decisions.md)
2. [需求切片与假设](02-prd.md)
3. [故事与排期](03-stories.md)
4. [待冻结契约、文件清单及测试矩阵](04-contract.md)
5. [当前证据](05-evidence.md)

## 开工检查

已读本卡与触发线程、GitHub Issue #6 原文、仓库 AGENTS.md、ADR-0003/0009、PRD 与详细设计。main 已有 feature/approve 的 `sync_global_required`，merge 保有自身补偿流程；缺独立 sync 路由。

开放 PR #73/#74/#75/#76/#77 的标题、文件列表与正文已核对，未发现同项实现。#73 修改 CLI 与设计，#76 修改产品文档，实施前需重取 main 并检查冲突；它们不是本项功能依赖。#75 的验证技能可选，本项不等待它合入。Issue 无显式前置阻塞。

`preflight-check.sh` 首次因 LoopX skills/routes 缺失 exit 1；`--fix` 未修复该项。按工具指引执行 `loopx workflow-skills --install`、`loopx slash-commands --install` 后重跑，6/6 exit 0；LoopX 2.3.0。此原生降级仅修复安装，无 loopx-flow 安装技能入口，未绕过 Gate。

`bin/loopx-flow feature sync-command` exit 0，已注册 Goal 并同步；未改实现代码、未 claim 实施任务、未签 Gate1。

## 审批操作（由人类执行）

1. 审阅以上五份文件；可在 TRE-143 明确回复方案修改或批准意向。
2. 正式 Gate1 需在有该 Goal registry 的 checkout 中操作，不能仅用本卡评论代替。当前仓库为 `single_owner`，配置 accepted_by=`JustinIanAI`；本运行环境 `gh api user` 实际为 `lhkkk`。Multica 发言身份不等于 GitHub 审批身份。未替任何人签署，也未更改风险接受配置。
3. 若你有配置审批账号的合法访问权限，在自己的终端 `gh auth switch --user JustinIanAI`，再用 `gh api user --jq .login` 核实。否则请由 JustinIanAI 操作；如需改授权模式，应另行显式决定，不在本卡自动更改。
4. 检出 `feature/sync-command`、审阅后将 `01-decisions.md` 的 Status 改成 APPROVED 并提交，确保工作区干净。运行 `./scripts/preflight-check.sh`。不同机器须先通过 `bin/loopx-flow feature sync-command` 建立本机 Goal；显式 registry 可用全局 `--registry <path>`，勿把别机 runtime 当成本机权威。
5. 在真实终端执行 `bin/loopx-flow approve contract sync-command`，阅读提示后手动输入 yes。禁止 `--yes`、非 TTY 和 Agent 代填确认。
6. 执行 `bin/loopx-flow gate verify contract sync-command`，将结果回复 TRE-143，并提交/推送审批后的胶囊。只有正式校验通过才进入 claim/TDD。

本轮停止在待审批状态。工具实际报错与未执行的账号检查分开记录在证据页；本包不伪造批准标记。
