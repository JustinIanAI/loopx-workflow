# ADR-0021：Gate2 签名在 base 前进后的重绑（以改动指纹替代 head 精确匹配）

- **状态**：Proposed（机制已落地并被单测覆盖，**默认关闭**；启用需 Owner 在配置里显式写 `gate2_rebind`）
- **日期**：2026-11-28
- **关联**：[ADR-0012](0012-delivery-authorization-and-recovery.md)（决策 10：release-authorization 绑定 head）、[ADR-0019](0019-gate-signature-via-github.md)（评论签名）、`REQ-GATE-SIGNATURE-1`、`REQ-CHECKPOINT-2`

## 背景

`main` 开了 `strict`（`required_status_checks.strict = true`：head 必须与 base 同步才能合入）。而 `gate=2` 评论签名绑定 `headRefOid`（ADR-0012 决策 10）。

两者叠加产生签名雪崩：

1. 合入任意一个 PR → `main` 前进；
2. 其余所有开放 PR 立刻变成 `BEHIND`，`gh pr merge` 一律 fail-closed（`head branch is not up to date`）；
3. 要为某个 PR 解除 `BEHIND`，只能更新分支 → **head 换了**；
4. head 一换，作者已签的 `gate=2` 全部作废，必须重新签字 —— 而签的仍是**同一份改动**。

2026-11-28 的实测：`#95` 合入后，其余 8 个开放 PR 同时 `BEHIND`；作者为 9 个 PR 签的 Gate2 一次性失效，只剩“逐个改、逐个签、逐个合”的串行路径。这不是安全收紧，而是**授权对象选错**：作者批准的是这份交付的内容，不是某个 commit id。

## 决策

1. **新增可选配置 `gate2_rebind`**，当前唯一合法值 `"patch_id"`；**字段缺失即关闭**，行为与今天完全一致（head 必须精确匹配）。
2. 开启后，`release_authorization_ok` 在 head 精确匹配失败时，收集“其余字段（`gate`/`mode`/`principal`/`contract_sha`/`risk_acceptance`）全部对齐、只有 `head` 不同”的候选签名，交由 `lib/gate2-rebind.js` 判定：
   - 计算 `git patch-id --verbatim` of `git diff -U0 $(git merge-base <base> <sha>) <sha>`：
     `-U0` 剥掉 hunk 上下文（base 前进导致改动在文件内位移不影响指纹），
     `--verbatim` 保留空白（只改缩进/空白也算改动，必须重新签字）；
   - 新旧 head 的改动指纹相同 → 签名继续有效，并打印 `[WARN] Gate2 重绑（ADR-0021）` 审计行；
   - 任一环节不成立（commit 不在本地、空改动、patch-id 不同）→ 退回 fail-closed，要求重新签字。
3. **判定实现单点化**：`lib/gate2-rebind.js` 承载语义与边界，`bin/loopx-flow` 只读配置 + 调用；单测直接覆盖模块。
4. **不做任何放宽的第二档**：不接受“祖先关系即有效”“同一作者后续 PR 自动继承”等推断；只有改动指纹相等一条通道。

## 安全边界（必须如实披露）

- 授权对象从「commit」变为「改动内容」。指纹相同意味着**增删行文本（忽略 hunk 行号与上下文行、保留空白）**完全相同；空白与缩进敏感，因为四空格在 Markdown 里是代码块、在 YAML/Makefile 里能改变语义。
- **不覆盖** commit message、提交作者、parent 拓扑、rebase 顺序；这是刻意选择——Gate 授权的是交付内容，不是提交流水。
- **触发条件是「head 变了、改动指纹没变」，不校验 base 是否真的前进。** 因此同 base 上的 rebase / force-push（commit id 变、内容不变）同样可以重绑；本 ADR 的动机是 base 前进，但实现的判定面比动机更宽——这是有意为之的等价类（授权对象是内容），不是缺陷。
- 仍然要求：评论作者 `== accepted_by`、`contract_sha` 一致、`risk_acceptance` 一致、`mode` 一致。任何一项不满足都不到达 patch-id 判定。
- 冲突手工解决会改变 diff 文本 → 指纹改变 → 必须重新签字。仅空白/缩进调整同样改变指纹。这是设计意图，不是缺陷。
- **边界：签名 head 必须仍能解析出该 PR 的改动。** 判定需要 signed head 在本机对象库中可从 `merge-base(base, signedHead)` 取到 diff；`gh pr update-branch` 的 merge commit 会保留旧 head 为祖先，主场景可用。若 Owner 采用 **rebase 后 force-push**，旧 head 可能已不可达且未 fetch → `isCommit` 失败 → 指纹不可得 → 静默退回「重新签字」（fail-closed，不会误放行）。这条路径上的签名雪崩未被消除。
- **重绑只复用人类签名，不放宽 Agent 评论**：`merge` 之后仍要求 `agent_comment_ok` 绑定**当前 head** 的 Agent 评审评论。`gh pr update-branch` 换 head 后，Owner 虽不必重签 `gate=2`，但仍须重跑一次 `loopx-flow review` 让新 head 有 Agent 评论，否则 merge 仍 fail-closed（显式非 0，不是静默放行）。
- 与 ADR-0019 一致：该路径仍是**账号级**证明，不宣称自然人分离。

## 否决

- **否决 GitHub merge queue**：需要组织级能力与排队基础设施，本地编排器无法接管排队事实，也无法与 `loopx change-quality` 收据绑定。
- **否决 `gh pr merge --admin` 绕过 strict**：直接放弃分支保护，比放宽签名的风险高一个量级。
- **否决“一次预签 N 个 PR”**：每个 PR 合入后其余 PR 的 head 仍会变，签名照样过期；只是把 N 次签字提前批量做，治不了根因。
- **否决按 PR 编号绑定**（“该 PR 的任何 head 都算”）：等于取消 head 绑定，任何 push 都能复用授权。

## 启用方式（Owner 动作）

`loopx-workflow.config.json` 增加一行：

```json
{ "gate2_rebind": "patch_id" }
```

未写入该字段时，`release_authorization_ok` 保持“head 精确匹配”的原始语义；仓库默认值不变。

## 修订

- **PRD**：新增 `REQ-GATE2-REBIND-1`；`REQ-CHECKPOINT-2` 的失败条件补一句“head 不一致且未启用重绑或改动指纹不等 → 非 0”。
- **设计文档**：`release-approve` / `merge` 行补充重绑判定与开关。
- **代码**：`lib/gate2-rebind.js`（判定）、`bin/loopx-flow`（`gate2_rebind_mode` / `gate2_rebind_allowed` / `release_authorization_ok` 候选路径）、`tests/unit/gate2-rebind.test.js`。
