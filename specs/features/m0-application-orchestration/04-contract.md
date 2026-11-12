# Feature Contract: m0-application-orchestration

- **Contract-Status**: DRAFT (Pending Approval)
- **Feature Branch**: feature/m0-application-orchestration
- **LoopX Goal**: m0-application-orchestration-goal
- **引用**: REQ-CHECKPOINT-1, REQ-CHECKPOINT-2, REQ-CHECKPOINT-3, REQ-GATE1-AUTH-1, REQ-GATE2-MODE-1, REQ-CI-PROTECTION-1, REQ-QUALITY-1, REQ-EVIDENCE-1, REQ-ISSUE-PIPELINE-1, REQ-NATIVE-1；ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0012。

## 1. 冻结契约（命令行为不变量）

### 1.1 Gate1 `approve contract <feature>`
- 最终字节 = 契约正文中 `Contract-Status` 行被替换为固定行 `- **Contract-Status**: FROZEN & APPROVED`（不得含审批人/时间）。
- `contract_sha = sha256(最终字节)`；`configure-goal --progress-review-contract-revision`、user_gate `--evidence` 的 `contract_sha`、最终落盘必须使用同一 SHA。
- `independent` 评论标记：`<!-- loopx-flow:gate1-authorization:<feature>@<contract_sha> -->`；正文键值：`gate=1;mode=independent;contract_sha=<sha>;spec_commit=<40hex>;approver=<login>`；approver 必须 ≠ 执行者 login。
- evidence 固定串必含：`authorization_mode`、`contract_sha`、`spec_commit`、`feature`、`principal`；`single_owner` 另含 `risk_acceptance=<accepted_by>@<accepted_at>`。
- 失败即停：缺配置、规格不完整、未授权、TTY/第二账号不满足、configure-goal 或 user_gate 写入失败 → 非 0 且不写批准标记。

### 1.2 `gate verify contract <feature>`
- 只读 `.loopx/registry.json` 与 user_gate evidence；**不访问 GitHub**。
- 校验：SHA 双锚定、`decision-scope=other:goal:<sha>`、`decision_outcome=approve`、模式与配置一致、模式必填键齐全。

### 1.3 Gate2 `merge <pr> [feature]`
- Mode A（`independent`）：非作者 APPROVED formal review 且 `commit_id==headRefOid`、`reviewDecision=APPROVED`、PR 非 Draft；readiness JSON `ready===true`。
- Mode B（`single_owner`）：`<!-- loopx-flow:release-authorization:<pr>@<head> -->` 评论的 `head/contract_sha/principal/risk_acceptance` 与当前 PR 一致，且当前 head 存在 Agent review 证据；readiness 按 `blocking_reasons` 三档判定（允许列表 → 非 0；忽略列表 → 跳过；未知/缺失/解析失败 → 非 0）。
- 分支保护：`scripts/setup-branch-protection.sh --check --mode <mode>` 退出 0 才继续；required check context 固定 `Four Gates`。
- 合入前二次读 HEAD；不一致非 0；已 MERGED 时只做前向补偿并对绕过路径记审计告警。

### 1.4 `release-approve <pr>`
- 仅 `single_owner`；拒绝非 TTY、`--yes`、Draft、`principal != accepted_by`。
- 评论正文键值：`gate=2;mode=single_owner;head=<sha>;contract_sha=<sha>;principal=<login>;approved_at=<ts>;risk_acceptance=<accepted_by>@<accepted_at>`。

### 1.5 `check` / `ingest` 证据契约
- gate-results JSON schema：`{"schema_version":"loopx_flow_gate_results_v0","gates":[{"name":"typecheck|lint|build|test","command":str,"exit_code":int|null,"status":"passed|failed|not_run"}]}`。
- `ingest` 缺 gate-results / 四门禁缺项 / 任一非 0 时拒绝写 `passed`、不记录通过收据，并退出非 0。

## 2. AC 矩阵

| AC | Story | 验证 |
|---|---|---|
| AC-01-1 | Story-01 | `tests/unit/adr-0009-gate1-auth.test.js` T5b（评论 SHA == configure-goal 参数 == 落盘 SHA） |
| AC-01-2 | Story-01 | 同文件 T1–T4、T5a |
| AC-02-1 | Story-02 | 同文件 T6–T9、T0 |
| AC-03-1 | Story-03 | `tests/unit/adr-0012-gate2.test.js` T1–T5、T7、Agent review 证据用例 |
| AC-03-2 | Story-03 | 同文件 T2、T8、T9（审计告警） |
| AC-04-1 | Story-04 | `tests/unit/ci-workflow.test.js`、`tests/unit/fastpath-protection.test.js` |
| AC-05-1 | Story-05 | `tests/unit/ingest-gate-results.test.js`、`tests/unit/change-quality-failclosed.test.js` |
| AC-06-1 | Story-06 | `tests/unit/native-dispatch.test.js`、`tests/unit/fastpath-protection.test.js` 静态断言 |

## 3. Scope / 非目标
- **Scope**: `bin/loopx-flow`、`skills/code-review/scripts/ingest-to-loopx-quality.js`、`scripts/fast-fix-push.sh`、`scripts/setup-branch-protection.sh`、`.github/workflows/ci.yml`、对应单测与 PRD/设计/ADR 回写。
- **非目标**: `review` formal review 通道改造（下一批）；分支保护 `--apply` 的真实执行（需仓库管理员）；M1 文档收口。

## 4. Verification Plan
- `npm run typecheck && npm run lint && npm run build && npm run test` 全绿。
- Gate1 负向/正向：`node --test tests/unit/adr-0009-gate1-auth.test.js tests/unit/fail-closed-remediation.test.js`。
- Gate2：`node --test tests/unit/adr-0012-gate2.test.js`。
- 真实 TTY：本机终端执行 `loopx-flow approve contract m0-application-orchestration` 与 `loopx-flow release-approve <pr>`。

## 5. 依赖顺序
- AC-01（最终字节 SHA 绑定）→ AC-02（gate verify 只读）→ AC-03（Gate2 双模式）→ AC-04/AC-05/AC-06。
