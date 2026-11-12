# ADR-0009：Gate 1 规格授权（Specification Authorization）

- **状态**：Accepted
- **日期**：2026-11-12
- **批准**：严君 · 2026-11-12（决策已接受；正式 wrapper 实现后需用 T1–T9 复跑，见 [测试计划](../research/adr-0009-test-plan.md)）
- **关联**：[state-evidence-boundary.md](../research/state-evidence-boundary.md) §10、讨论纪要 DB4、[ADR-0008](0008-application-orchestration-layer.md)

## 背景

当前 Gate1 = `approve contract` 只对 04-contract 计算 SHA 并写入 `contract_revision`。需要修正四处认知：

1. `contract_revision` 是 progress-review 的 **observer pin**，不是 LoopX 的人类门禁；执法者一直是本仓库 `gate verify contract`。
2. 授权人/时间/范围只是 04-contract 与 01-decisions 里的**软文本标记**——版本绑定成立，授权审计未成立。
3. `boundary-authority-*` 是 **checkpointed write scope**，不是「谁批准了规格包」。
4. LoopX Todo 原生没有 `mode/approver/executor/risk_acceptance` 字段；这些**只能落在仓库级配置与 `--evidence` 字符串**里，由 wrapper 解析。**不得假设 LoopX 提供新字段。**

## 决策

**接受线（一句话契约）**：Gate1 同时做两件事，任一失败则非 0 且不写批准标记：① 把含 AC/Scope/Verification Plan 的 `04-contract` SHA 写入现有 `contract_revision`；② 用一条 `user_gate` 记录规格授权，`decision-scope = other:goal:<contract_sha>`，`decision-outcome=approve`，`--evidence` 使用下述固定键值串。不用 `boundary-authority`。胶囊和 GitHub comment 只做投影。新的 approve 取代旧记录；SHA 不一致则该授权失效。

1. **Gate1 = Specification Authorization**：人批准一份 Specification Package（Problem Statement / Existing Behavior / REQ 与 ADR 引用 / Stories + AC / Scope 与非目标 / Verification Plan / Contract），而不是只批一个 TypeScript 文件。审批主体由仓库级 `authorization_mode` 决定：`single_owner` 由本 ADR 支持；`independent` 按 ADR-0012 决策 10 的第二 GitHub 账号评论核验，**缺评论、评论作者 login 与执行者相同、或评论 `contract_sha` 不是当前 SHA → 非 0**（见决策 12）。
2. **契约承载规格**：`04-contract.md` 必须包含 AC 矩阵、Scope/非目标、Verification Plan、依赖顺序，并保留顶部冻结的接口与断言不变量。
3. **版本绑定不变（observer pin）**：对 04-contract 最终内容（含批准标记）计算 SHA256 → `configure-goal --progress-review-contract-revision <sha>`；`gate verify contract` 仍只比对该 SHA。**不建 Spec-Revision 哈希、不加 `gate verify spec`。** 不把 `contract_revision` 讲成 LoopX 授权门禁。
4. **授权记录 = LoopX `user_gate` + wrapper 证据字符串**：`approve` 创建并完成一条 owner 决策，**LoopX 原生只承载 `decision-scope` 与 `--evidence`**：
   - `loopx todo add --role user --task-class user_gate --decision-scope other:goal:<contract_sha> --global-gate [--unblocks-todo-id <implementation_todo>]`（多 agent Goal 必须显式 `--global-gate` 或 `--blocks-agent <agent>`；实验 E2 证明缺省会被拒）
   - `loopx todo complete --decision-outcome approve --evidence "<固定串>"`
   - **固定 evidence 串（缺键即非法）**：`authorization_mode=<mode>;contract_sha=<64hex>;spec_commit=<40hex>;feature=<feature>;principal=<accepted_by|approver_login>`；`single_owner` 还要 `;risk_acceptance=<accepted_by>@<accepted_at>`
   - `single_owner`：`principal` 必须等于 `single_owner_risk_acceptance.accepted_by`（后者必须是 `gh api user` 的 login），`risk_acceptance` 来自仓库配置。`independent`：`principal` 必须等于 ADR-0012 决策 10 评论里的 `approver` login；不写 `risk_acceptance`。两模式均在写入 evidence 前比对，不相等则非 0。
   - `spec_commit` 取 `git rev-parse HEAD`（40 位十六进制）。工作区不干净则非 0。它只作追溯，不和契约内容比对，也不参与 `gate verify`。
   - 只有 `role=user` + `task-class=user_gate` + `decision-outcome=approve` 的记录有效。
   - **add + complete 在同一 approve 中是「记录 owner 决策」，不是长期阻塞门**；人闸执行点是显式 `approve`。
   - **不宣称 user_gate 能阻止同凭证 agent 完成**：2026-11-11 实验证明已注册 agent 可完成它（甚至不带 outcome）。它是**审计记录**，不是人机隔离。
   - **不使用 `boundary-authority-*`**（写范围授权，不是规格签字）。
5. **原子性与规格完整性门禁**：顺序为「准备最终内容 → 规格完整性检查 → 锁版本 → 写授权记录 → 原子写入批准标记」。任一前置失败非 0 且不写标记：
   ⓪ **仓库配置存在且 Gate1 可用**（`authorization_mode` 合法；`single_owner` 必须有 `single_owner_risk_acceptance`；`independent` 必须有 ADR-0012 决策 10 的有效第二账号评论证明，否则非 0）；① `01-decisions` 有 APPROVED（`gate verify decisions`）；② 04-contract 含 AC/Scope/Verification Plan/依赖顺序；③ `03-stories.md` 里的每个 story id 在 `04-contract.md` 的 AC 矩阵中都有一行，缺行即非 0；④ 契约引用 ≥1 条 REQ/ADR；⑤ configure-goal 锁版本成功；⑥ user_gate 授权记录写入成功。
6. **数据落点（必须分清）**：
   - **仓库级配置**：`loopx-workflow.config.json`（committed）由 `init` 写入、`doctor` 校验。**风险接受在配置里，不在授权记录里。** 形状固定为：

```json
{
  "schema_version": "loopx_workflow_config_v0",
  "authorization_mode": "single_owner",
  "single_owner_risk_acceptance": {
    "accepted_by": "<gh api user login>",
    "accepted_at": "<ISO-8601>"
  }
}
```

     `schema_version` 不是 `loopx_workflow_config_v0`、`authorization_mode` 非法，或 `single_owner` 缺少非空 `accepted_by` / `accepted_at`，均为非 0。
   - **LoopX 授权记录**：只保存 `decision-scope=other:goal:<contract_sha>`、`decision-outcome=approve`、自由文本 `--evidence`。
   - **每次 approve 的 evidence**：复制上述固定串（mode/sha/spec_commit/feature/principal/risk_acceptance 引用）。
   - **投影**：胶囊标记、GitHub comment、Draft PR 只做投影，失败 WARN。
7. **授权执法（只解析 evidence）**：`gate verify contract` 同时校验——① 当前 04-contract SHA == `contract_revision`；② 最新 `user_gate` 记录的 `decision-scope == other:goal:<当前 SHA>`、`decision_outcome=approve`、未被 supersede；③ **解析 evidence 固定串**：`authorization_mode` 与仓库配置一致；`contract_sha` == 当前 SHA；`single_owner` 还要求 `principal == 配置 accepted_by`、`risk_acceptance == 配置 accepted_by@accepted_at`；`independent` 要求 `principal` 非空且等于 ADR-0012 评论的 approver（评论本身在 `approve` 时核验，`gate verify` 不重复 fetch GitHub）；**缺键/值不一致 → 非 0**。`spec_commit` 只作追溯，不参与门禁比对。`check` 继承该门禁。
8. **授权模式配置（Gate1 只校验本门所需）**：`authorization_mode ∈ {independent, single_owner}`，由 `init` 确认、`doctor` 校验；`single_owner` 必须有风险接受；`independent` 按 ADR-0012 决策 10 核验，缺有效评论才非 0。**Gate1 的 doctor 不校验 CI/分支保护**（那是 Gate2 前置，归 ADR-0012；仅显示 WARN，不 BLOCK）。
9. **TTY 交互确认**：`approve` 在 `single_owner` 下必须要求 TTY 确认，拒绝非 TTY 与 `--yes`；记录 principal。**它只挡住脚本，不挡住拥有 TTY 且能回答确认的 Agent**——残余风险如实披露，不宣称「Agent 不能代批」。
10. **Draft PR 的失败策略**：阶段 4 尝试 `pr create --draft` 呈现规格包；GitHub 不可用/失败 → WARN + `presentation=pending`；Gate1 授权不依赖 GitHub。`pr ready` / Gate2 必须有真实 PR。**Gate1 不用 PR Approve。**
11. **实现验收（Verified 前必须；不是 Accepted 门槛）**：T1–T9 已由 [tests/research/adr-0009-reference.test.js](tests/research/adr-0009-reference.test.js) 在隔离临时目录跑通（10/10，2026-11-12）；参考实现不等于正式 wrapper，正式实现后必须在 `bin/loopx-flow approve` 上用同一组用例复跑，通过后才可从 Implemented 进入 Verified：
    - T1 非 TTY `approve` → 非 0 且不写 `FROZEN & APPROVED`
    - T2 `approve --yes` → 非 0
    - T3 缺 `loopx-workflow.config.json` → 非 0
    - T4 `single_owner` 缺 `single_owner_risk_acceptance` → 非 0
    - T5a `authorization_mode=independent` 且无有效第二账号评论 → `approve` 非 0
    - T5b `authorization_mode=independent` 且有有效评论（作者 login ≠ 执行者、`contract_sha == 当前 SHA`）→ `approve` 通过并写 marker
    - T6 `gate verify contract` 遇到 evidence 缺键 → 非 0
    - T7 授权记录 `decision_outcome=reject` → 非 0
    - T8 contract SHA 变化 → 非 0
    - T9 配置 mode 与 evidence mode 不一致 → 非 0
    - **残余风险**：`single_owner` 下，同凭证、有 TTY 的 Agent 仍可完成确认；user_gate 是 typed 审计记录，不是密码学分离。账号级分离由 ADR-0012 的 `independent` 第二 GitHub 账号评论证明承担（只证明 login 不同，不证明自然人）。
12. **配置与独立模式边界**：`loopx-workflow.config.json` 由 `init` 写入（不静默默认）、`doctor` 校验。`independent` 的 Gate1 按 ADR-0012 决策 10 核验：Draft PR 上必须有另一 GitHub 账号的评论（`<!-- loopx-flow:gate1-authorization:<feature>@<contract_sha> -->`，正文 `gate=1;mode=independent;contract_sha=<sha>;spec_commit=<sha>;approver=<login>`），由 `gh api` 读回；**缺评论、作者 login 与执行者相同、或 `contract_sha` 不是当前 SHA → `approve` 非 0**；有效评论则通过并写入 `principal=<approver login>` 的 evidence。这是账号级分离，不是自然人证明。

## 否决

- 用 `boundary-authority-*` 作 Gate1 授权记录。
- 把 `mode/approver/executor/risk_acceptance` 当成 LoopX 原生字段。
- 把 `boundary-authority / user_gate / 胶囊 / GitHub comment` 写成「或」关系或允许掉回胶囊软文本。
- 只锁 contract、不写授权记录，却宣称「授权审计成立」。
- 独立 Spec-Revision 清单 + `gate verify spec`。
- Gate1 用 GitHub PR Approve。
- 把 `contract_revision` 讲成 LoopX 人类门禁。
- 在 `independent` 没有凭证外第二身份证明时就宣称支持。

## 修订

- **PRD**：扩展 `REQ-CHECKPOINT-1`；新增 `REQ-GATE1-AUTH-1`（user_gate + 固定 evidence 串）；新增 `REQ-AUTH-MODE-1`（`loopx-workflow.config.json` 由 init 确认、doctor 校验）；修订 `REQ-TRACE-2`；`REQ-CONTRACT-LOCK-1` 保持。
- **设计**：§4 阶段 4（规格包 + Draft PR 投影）；§5 契约双重锁定（补 approve 原子顺序、user_gate+evidence 解析、gate verify 三校验）；§3 init/doctor 配置校验。
- **退役**：approve 只写版本 + 软文本标记的旧路径；把 contract_revision 当授权门禁的表述；02/03/05 里重复的 AC/Scope 叙述改为指向 `04-contract.md`。

## 不做什么

- 不改 `contract_revision` SHA 语义，不引入第二指纹。
- 不把授权记录做成胶囊软文本或 GitHub comment 权威。
- 不引入第三个人工断点；Gate1 仍一次签字。
- 不在本 ADR 实现代码；不宣称 `independent` 提供自然人分离（只证明两个 GitHub login 不同）。
- 不宣称 user_gate 提供密码学人机分离，也不宣称 TTY 能阻止有 TTY 的 Agent。

## 实验记录（2026-11-11，LoopX 层）

**环境**：loopx 2.0.0；隔离 canonical workspace（官方 fixture `build_canonical_file_workspace`；temp home/runtime/registry）；未使用仓库真实控制面。

| # | 命令 | 结果 |
|---|---|---|
| E1 | `todo add ... --decision-scope spec-authorization:feature:abc --global-gate` | exit 1：`decision_scope must use kind:granularity:scope_key` |
| E2 | `todo add --task-class user_gate`（无 global-gate/blocks-agent） | 拒绝：`multi-agent user_gate requires an explicit scope` |
| E3 | `todo add --role user --task-class user_gate --decision-scope other:goal:<64hex> --global-gate` | ok，返回 todo_id |
| E4 | `todo complete --todo-id <id>`（无 actor） | 拒绝：`actor_required` |
| E5 | `todo complete --todo-id <id> --agent-id agent-a --decision-outcome approve` | ok（已注册 agent 完成 user_gate） |
| E6 | `todo complete --todo-id <id> --agent-id agent-a`（无 outcome） | ok（无 outcome 也能完成） |

**结论**：`user_gate` 是审计记录，不是人机隔离；人闸按配置承担：`single_owner` 由 TTY 确认 + 风险接受（过程控制），`independent` 由 ADR-0012 的第二 GitHub 账号评论承担（账号级分离，非自然人证明）。
