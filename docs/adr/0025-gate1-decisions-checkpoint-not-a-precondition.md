# ADR-0025：Gate1 决策落款不再作为 `approve` 的前置

- **状态**：Proposed（实现与单测已落地；置 `Accepted` 需人类 Maintainer 在 PR 的 Gate2 签批）
- **日期**：2026-11-28
- **关联**：[ADR-0009](0009-specification-authorization.md)（Gate1 规格授权）、[ADR-0012](0012-delivery-authorization-and-recovery.md)（Gate2 交付授权）、[ADR-0018](0018-gate1-github-signed-authorization.md)（GitHub 签名的 gate=1 评论）、`REQ-CHECKPOINT-1`

## 背景

`loopx-flow approve contract <feature>` 要求 `specs/features/<feature>/01-decisions.md` **已经是** `APPROVED`（旧实现里的 `gate1_decisions_approved` 前置）。而全仓唯一写这个落款的地方，就是同一条命令在人工授权通过之后：

```bash
# cmd_approve 尾部：人工授权通过后才写落款
echo "- **Status**: APPROVED BY HUMAN ($operator@$timestamp)" >> "$decision_file"
```

也就是说，**这条命令把只有它自己才能产生的输出，当成了自己的输入**。三条互相独立的事实：

1. `grep -rn "APPROVED BY HUMAN" bin lib skills scripts` 只命中一个写入者：`cmd_approve`。
2. 现存已批准胶囊的落款格式与 `cmd_approve` 的写入格式逐字符一致（含 `(<op>@<ts>)`）。
3. 测试夹具一律预置 `- **Status**: APPROVED`，所以 394 条用例从未暴露该路径。

后果是 Gate1 在任何「决策文件尚为 PROPOSED/DRAFT」的胶囊上必然失败——而这恰好是所有新胶囊的初始状态。人类按 `--prepare` 模板在 GitHub 留下 `gate=1` 评论也无法推进，因为命令在到达授权核验之前就已经退出。这是「异步 Gate1 卡住开发主线」的直接成因之一。

## 决策

1. **前置改为「决策文件存在、可审阅、且未被否决」**：文件必须位于 `specs/features/<feature>/01-decisions.md`（契约文件已要求在 `specs/features/`，归档胶囊在更早处退出，故不再保留 `specs/archive` 分支）。「可审阅」是机器义务：除标题/分隔线外至少有一行正文，0 字节或只有标题的文件直接 fail-closed（`decisions_has_content`）。状态判定按黑名单阻断：`status:`（frontmatter）、`- **Status**:` 与 `- **方案状态**：` 三种写法里的 `REJECTED` / `DEFERRED` / `SUPERSEDED` / `DECLINED` 一律 fail-closed，其余状态（`PROPOSED` / `DRAFT` / `APPROVED`）才继续走人工授权。
   - 为什么必须带这一层：只判断「文件存在」会让本次批准**覆盖人类显式表达的否决**，并把 `APPROVED BY HUMAN` 的语义稀释成「文件在就有」。这是 #109 评审的 P1。
2. **落款仍由 `approve` 在人工授权通过后写入**，写入时机、格式与内容一字不改。Gate1 的授权事实依旧是 `user_gate` 记录 + GitHub `gate=1` 评论 + 契约 SHA 锁定三件套，本 ADR 不改变其中任何一件。
3. **删除 `gate1_decisions_approved` 死代码**：它只服务于被移除的前置，保留即为第二套判定口径。
4. **失败即停语义不变**：任一步失败非 0，不得留批准标记。决策落款写失败同样是硬失败——否则会留下「契约已冻结、`user_gate` 已写、决策未落款」的半成品，下游 `gate verify decisions` 会判未批准。
5. **`gate verify decisions` 与 `approve` 同一口径**：先判否决（`APPROVED` 与 `REJECTED` 并存判 FAIL），再判 `APPROVED`（大小写无关、带词界）；修复提示改为指向命令（`loopx-flow approve contract <feature>`），不再教人手工写 `status: APPROVED`。GATE PASS 行注明这是**文本校验**，权威授权事实是 `gate=1` 评论 + `user_gate`。

## 否决

- **要求人类先手工把决策改成 `APPROVED`**：等于让人手写一条本应由命令在核验后产生的授权记录，与 `user_gate` 审计事实脱节，且无法区分「人工批准」与「手抄文本」。
- **决策文件缺失也放行**：那会把 Gate1 的规格完整性检查整个掏空。本 ADR 只移除自指条件，不移除「必须有可审阅决策」这一实质要求。
- **在命令里自动生成 `APPROVED` 占位**：与「只有人工授权通过才写落款」的语义直接冲突，属于伪造授权痕迹。

## 影响与修订

- `bin/loopx-flow#cmd_approve`：前置改为存在性检查（只读 `specs/features/<feature>/01-decisions.md`；归档胶囊在契约文件检查处已提前退出），删除 `gate1_decisions_approved`。
- `bin/loopx-flow` 新增单一口径解析 `decisions_status_lines` / `decisions_is_vetoed` / `decisions_is_approved`，`cmd_approve` 与 `cmd_gate`（`gate verify decisions`）共用，删除 `cmd_gate` 原有的第二套正则。
- `gate verify decisions` 是只读文本校验，不核验 `user_gate`；因此提示语中的「不得手工改写」是修复指引而非可执行禁令，权威授权事实仍是 `gate=1` 评论 + `user_gate` 记录。要在 gate 阶段物理禁止手工落款，需核验 `user_gate`，超出本切片范围。
- 阶段 2 证据对齐（`authentic-review.js` 的 `buildEvidenceGraph` 重建）继续传递 `headAnchored`：本地不在被审 head 时取到的 `test_path` 仍判 `unverified`，不得在他版代码上取证。
- `AGENTS.md` 铁律 3：改为「核对 01-decisions 存在且内容可审阅（其 `APPROVED BY HUMAN` 落款由本命令在人工授权通过后写入，**不作前置**）」。
- `docs/prd/loopx-workflow.md` `REQ-CHECKPOINT-1`：前置从「`01-decisions` APPROVED」改为「存在、可审阅且未被否决」，与实现一致。
- `docs/design/loopx-workflow-design.md`：同步 Gate1 失败条件。
- `tests/unit/gate1-decisions-checkpoint.test.js`（13 例）：PROPOSED 决策可通过并写入落款；`--prepare` 只打印模板且决策文件逐字节不变；项目符号 `REJECTED`、frontmatter `status: REJECTED`、`方案状态：DEFERRED` 三种否决形态均 fail-closed；`approve` 与 `gate verify decisions` 共用解析（frontmatter `APPROVED` / `APPROVED BY HUMAN` 通过，`DISAPPROVED` 不被误判）；决策文件缺失仍 fail-closed；gate 在 `APPROVED`+`REJECTED` 混合时判 FAIL；小写 `status: approved` 判通过；0 字节与只有标题的决策文件被 approve 拒绝。
- `tests/unit/authentic-review-pipeline.test.js`：新增阶段 2 锚定回归（本地不在被审 head + 阶段 2 给出 `test_path` → 该行仍 `unverified`），修复前实测为 `passed`（先红后绿）。

## 不做什么

- 不改变 Gate1 的 authorization_mode 语义（`single_owner` / `independent`）。
- 不改变 Gate2 的审批与 `release-approve` 流程。
- 不改变契约 SHA 锁定与 `user_gate` 记录的写入顺序。
