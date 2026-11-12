# User Stories & Sizing: m0-application-orchestration

- **Story-01**: Gate1 规格授权与最终字节绑定
  - AC-01-1: `approve contract` 对“正文 + 固定批准标记行”计算 SHA256，评论、configure-goal、evidence、落盘共用同一 SHA。
  - AC-01-2: 缺 `loopx-workflow.config.json`、`single_owner` 缺风险接受、非 TTY、`--yes`、`independent` 缺有效评论时均非 0 且不留批准标记。
- **Story-02**: `gate verify contract` 只读执法
  - AC-02-1: 只解析 registry 与 evidence；缺键/模式不一致/契约被篡改时非 0；不访问 GitHub。
- **Story-03**: Gate2 双模式合入校验
  - AC-03-1: Mode A 校验非作者 APPROVED review 的 commit == head、`reviewDecision`；Mode B 校验 release 评论与当前 head/contract 一致且当前 head 有 Agent review 证据。
  - AC-03-2: readiness 分模式（A 认 `ready`；B 三档判定）并在合入前二次读 HEAD。
- **Story-04**: CI 与分模式分支保护
  - AC-04-1: CI workflow 以 `Four Gates` 为 required check 名；`doctor` 对保护缺失 WARN；`merge` 缺失非 0。
- **Story-05**: 证据消费真实退出码
  - AC-05-1: `check` 生成 `loopx_flow_gate_results_v0`；`ingest` 缺结果拒绝写 `passed`，四门禁不得 `not_applicable`。
- **Story-06**: Issue / Todo / Fast-Path 能力缺口
  - AC-06-1: `todo claim/done` 带 `--owner`/`--idempotency-key` 与 inspect 版本 CAS；`issue` 读 `decision.route`；`fast-fix-push.sh` 无直推 main。
