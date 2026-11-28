# ADR-0023：Issue 修复的影响分级与交付检查

- **状态**：Accepted（JustinIanAI，2026-11-28：Owner 明确接受本 ADR 的 impact 分级与 Issue 交付检查。本 ADR 由同一 PR 引入，因此 Accepted 的生效证据不是这行作者声明，而是 Owner 在 PR #115 发布的 `gate=2` 授权评论中的 `adr-accepted: docs/adr/0023-issue-impact-levels-and-fix-delivery.md` 行与 `head=<oid>` 绑定；`loopx-flow merge` 合入前强制核验该评论，缺评论即 fail-closed）
- **日期**：2026-11-28
- **关联**：[ADR-0006](0006-document-code-change-governance.md)、[ADR-0011](0011-evidence-traceability-and-quality.md)、[ADR-0012](0012-delivery-authorization-and-recovery.md)、[ADR-0022](0022-merge-requires-quality-receipt.md)、`REQ-ISSUE-PIPELINE-1`

## 背景

管线 B 文档写了 `fix_pr` 复用 Goal/Todo/Evidence/Gate2，但实现只做了 `issue-fix feasibility` 分诊。与此同时，`AGENTS.md` 的 Fast-Path 用「改动 ≤ 20 行」作为准入，导致两个后果：

1. 20 行被误当成整条 Issue 管线的规模边界，行为级修复被迫伪装成 `fix/*` 手工路径，绕过 `check` 收据与 Gate2。
2. 没有影响分级，R2（Gate/授权/状态机/持久化/并发/公共契约）要么被塞进 Feature 胶囊，要么没有任何额外检查。

本 ADR 只解决「Issue 修复怎么分级、每级要什么交付证据」，不新增管线，也不改变 Gate1/Gate2 的授权模型。

## 决策

1. **影响分级使用 `impact:R0/R1/R2`，它是 impact 命名空间，不是路线命名。** 路线仍使用 M0~M5；不得把 `R0/R1/R2` 当作里程碑或补救批次编号（ADR-0008 已禁止复用 R1~R4 作为路线名）。
2. **R0 Isolated**：纯文档、模板、Typo、错误日志、无行为影响的隔离配置。
   - 纯文档/模板 PR 按 ADR-0006 不建 Goal、不跑 `loopx-flow check`，但仍必须走 Gate2。
   - 只要改动包含任何代码文件，R0 豁免立即失效，回到 R1 的 Goal + Receipt + Gate2。
3. **R1 Behavioral**：有行为变化，但未触及 Gate、授权、状态机、持久化、并发或公共契约。
   - 必须有每 Issue 的 Goal；复现测试先 FAIL；四门禁全绿；`loopx-flow check --goal-id` 生成 LoopX Receipt；Gate2 合入。
4. **R2 Critical**：触及 Gate、授权、状态机、持久化、并发或公共契约。
   - **留在 Issue 管线**，不强制 Feature 胶囊；必须有回归证据、回滚说明、LoopX readiness 与 review-thread 检查。
   - 只有 `contract_impact=changed` 时才要求 Accepted ADR；`contract_impact=none` 允许无 ADR，但必须在 PR 中书面说明为何不改契约。
   - 被 PR 自身新增/修改的 ADR 不能自证：除 head 上为 `Accepted` 外，还必须由 Owner（`accepted_by`）在 PR 上发布含 `adr-accepted: <path>` 与 `head=<oid>` 的授权评论（`release-approve --prepare` 自动生成该行）；作者自写 `Accepted` 不构成授权。
   - R2 不额外要求第二个 GitHub 账号；`independent` 模式的 Gate2 审批要求仍由 `authorization_mode` 决定。
5. **机器可读标记**：Issue 与 PR body 使用
   `<!-- loopx-impact: {"level":"R1","issue":123,"contract_impact":"none","adrs":[],"regression":["tests/unit/issues/issue-123.test.js"],"rollback":"revert the fix commit"} -->`。
   `loopx-flow pr create --issue` 负责写入该标记；`loopx-flow merge` 在 PR head 上解析并检查。标记缺失时按 R1 处理并告警，非法值 fail-closed。
6. **Issue 修复不创建 Feature 胶囊、不写 `05-evidence.md`。** 证据以 Issue、PR、LoopX Receipt、CI 与四门禁为准；禁止为修复伪造空胶囊或空收据。
7. **Fast-Path 不再是一条独立管线。** 删除「≤20 行」准入；`scripts/fast-fix-push.sh` 只保留为受控的分支+PR 快捷方式，不得直推 `main`、不得绕过 Gate2/Receipt。

## 否决

- **新增第三条「Remediation」管线**：Standard PR-Path 已存在，新增管线只会增加治理复杂度。
- **继续用 20 行作为规模边界**：LOC 不是风险度量；按行数拒绝有效 PR 或切碎代码都违背 `REQ-PR-BODY-1` 的结果锚定原则。
- **把所有 R2 强制塞进 Feature 胶囊**：Issue 修复没有 Feature 规格包；强制胶囊会制造第二份 PRD 或伪造证据。
- **无 Goal 时静默跳过收据**：ADR-0022 要求 fail-closed；唯一例外是 R0 纯文档，且必须显式标注。
- **建 program Goal**：使用每 Issue Goal 或复用所属 Feature Goal，避免长期 Goal 漂移。

## 修订

- **PRD**：扩展 `REQ-ISSUE-PIPELINE-1`（impact 分级、Goal 绑定、`check`/`merge --goal-id`、Issue 路径不写 05-evidence）。
- **设计**：§7 管线 B 重写 `cmd_issue` 为 end-to-end；补 `--goal-id`/`--execute`/`--init-goal`/impact 失败条件。
- **AGENTS.md**：管线 B 删除 20 行准入，改为 R0/R1/R2；路径 B 使用 `.test.js`。
- **退役**：QUICKSTART 与 Issue 模板中的 Fast-Path 20 行文案；`fix_pr` 走 Feature 胶囊的旧提示。

## 不做什么

- 不实现 contract-revision、Gate2 五组证据矩阵、Q1。
- 不做 UI；Decision Brief 只以文本/CLI 呈现。
- 不改变 `1 Feature : 1 PR` 的 Feature 生命周期。
- 不把 R2 的 readiness 检查变成第二套授权状态机；Gate2 仍是唯一交付授权。
