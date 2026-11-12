# Lean PRD: m0-application-orchestration

## 1. 本切片覆盖的产品正文
- `REQ-CHECKPOINT-1` / `REQ-GATE1-AUTH-1` / `REQ-AUTH-MODE-1`：Gate1 规格授权（single_owner / independent）。
- `REQ-CHECKPOINT-2` / `REQ-CHECKPOINT-3` / `REQ-GATE2-MODE-1`：Gate2 双模式、readiness 与二次 HEAD。
- `REQ-CI-PROTECTION-1`：CI 与分模式分支保护为 Gate2 前置。
- `REQ-QUALITY-1` / `REQ-EVIDENCE-1`：`ingest` 消费真实门禁退出码并生成 `05-evidence.md`。
- `REQ-NATIVE-1` / `REQ-ISSUE-PIPELINE-1`：Todo 租约、`decision.route`、Fast-Path 不直推 main。
- 承接决策：ADR-0008 / ADR-0009 / ADR-0010 / ADR-0011 / ADR-0012。

## 2. 本切片验收
- `approve contract` 在缺配置、缺风险接受、非 TTY、`--yes`、独立模式缺有效第二账号评论时非 0；成功时评论 SHA、锁定 SHA、落盘 SHA 三者一致。
- `gate verify contract` 只读 registry + evidence，不访问 GitHub。
- `merge` 按 Mode A/B 校验授权、readiness、分支保护与二次 HEAD，失败不调用 `gh pr merge`。
- `release-approve` 非 TTY / `--yes` / principal ≠ accepted_by / Draft 时非 0。
- `check` 四门禁任一失败即非 0；`ingest` 缺 gate-results 拒绝写 passed。
- `issue` 缺 `decision.route` 非 0；`fast-fix-push.sh` 无直推 main 路径。

## 3. 承重假设
- 本机 `gh` 已认证，TTY 由人工/本机终端承担；CI 与分支保护在真实仓库执行。
- LoopX 原生能力不变：`user_gate` 是审计记录，不提供密码学人机分离（ADR-0009 残余风险）。
