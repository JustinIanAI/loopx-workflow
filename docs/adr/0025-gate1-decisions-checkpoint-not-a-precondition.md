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

1. **前置改为「决策文件存在且可审阅」**：活跃路径 `specs/features/<feature>/01-decisions.md`，或归档路径 `specs/archive/<feature>/01-decisions.md`。两者都不存在 → 仍 fail-closed（`[FAIL-CLOSED] 未找到 01-decisions.md`）。
2. **落款仍由 `approve` 在人工授权通过后写入**，写入时机、格式与内容一字不改。Gate1 的授权事实依旧是 `user_gate` 记录 + GitHub `gate=1` 评论 + 契约 SHA 锁定三件套，本 ADR 不改变其中任何一件。
3. **删除 `gate1_decisions_approved` 死代码**：它只服务于被移除的前置，保留即为第二套判定口径。
4. **失败即停语义不变**：任一步失败非 0，不得留批准标记。

## 否决

- **要求人类先手工把决策改成 `APPROVED`**：等于让人手写一条本应由命令在核验后产生的授权记录，与 `user_gate` 审计事实脱节，且无法区分「人工批准」与「手抄文本」。
- **决策文件缺失也放行**：那会把 Gate1 的规格完整性检查整个掏空。本 ADR 只移除自指条件，不移除「必须有可审阅决策」这一实质要求。
- **在命令里自动生成 `APPROVED` 占位**：与「只有人工授权通过才写落款」的语义直接冲突，属于伪造授权痕迹。

## 影响与修订

- `bin/loopx-flow#cmd_approve`：前置改为存在性检查（活跃/归档两条路径），删除 `gate1_decisions_approved`。
- `AGENTS.md` 铁律 3：改为「核对 01-decisions 存在且内容可审阅（其 `APPROVED BY HUMAN` 落款由本命令在人工授权通过后写入，**不作前置**）」。
- `docs/design/loopx-workflow-design.md`：同步 Gate1 失败条件。
- `tests/unit/gate1-decisions-checkpoint.test.js`（3 例）：PROPOSED 决策可通过并写入落款；`--prepare` 只打印模板且决策文件逐字节不变；决策文件缺失仍 fail-closed。

## 不做什么

- 不改变 Gate1 的 authorization_mode 语义（`single_owner` / `independent`）。
- 不改变 Gate2 的审批与 `release-approve` 流程。
- 不改变契约 SHA 锁定与 `user_gate` 记录的写入顺序。
