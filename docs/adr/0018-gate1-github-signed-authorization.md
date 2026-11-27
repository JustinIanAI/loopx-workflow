# ADR-0018：Gate1 授权通道与 GitHub 评论签名

- **状态**：Proposed
- **日期**：2026-11-27
- **关联**：[ADR-0009](0009-specification-authorization.md)（Gate1 主体与固定 evidence 串）、[ADR-0012](0012-delivery-authorization-and-recovery.md) 决策 10（`independent` 第二账号评论）、GitHub #82（W15/P0）、#86 + #87（发布前置）、#75（Proof 新鲜度）
- **编号说明**：`0016`（#47 独立 todo sync）与 `0017`（#79 审查管线异步执行）已被未落库工作项预留，本 ADR 取 `0018`，不占用这两个编号。

## 背景

Gate1（`approve contract`）现在只有一条可用的授权路径：`single_owner` 下强制真实 TTY（`bin/loopx-flow:1106-1107`）。`independent` 虽然已有 GitHub 评论校验（`find_gate1_independent_comment`，`bin/loopx-flow:732`），但它只服务第二账号模式，且实现上存在四个具体缺口：

1. **模式与通道耦合**。`single_owner` 分支完全不读评论；要在远程/CI/Agent 会话里签一次契约，只能切回终端。而 TTY 并不是强边界——`script -q`、`tmux` 或任何 PTY 包装都能满足 `[[ -t 0 ]]`，它只证明"有终端"。
2. **PR 定位写死且只认 Draft**。评论查找用 `branch="feature/$1"`（`:733`）并 `select(.isDraft == true)`（`:736`）；发布前置（#87）却按**当前分支**找 PR。实际分支是 `feat/*`、`fix/*`，两个路径指向不同 PR：前置能过，评论永远找不到，`independent` 模式在这些 PR 上直接 fail-closed。
3. **签署对象审批人看不见**。`contract_sha` 是对"把 `Contract-Status` 改写成 `FROZEN & APPROVED` 之后"的字节取哈希（`:1095-1104`）。审批人在 PR 上读到的是 DRAFT 版本，**无法独立复算该值**，只能相信执行者打印的串。签名签的是自己验不了的值，就退化为背书。
4. **授权记录与来源脱钩**。评论校验通过后写本地 `user_gate`（`:1155` 起），`gate1_verify_authorization`（`:798`）只解析 evidence、不访问 GitHub（这是 ADR-0009 / REQ-GATE1-AUTH-1 的刻意约束）。于是评论事后被编辑、删除、PR 被关闭，本地授权照样有效。

同时，`release-approve` 已经证明"结构化 PR 评论 + 固定标记 + 键值串"这套模式在本仓库可运行（`bin/loopx-flow:1800` 起，标记 `<!-- loopx-flow:release-authorization:<pr>@<head> -->`），Gate1 可以直接复用同一形状，而不必发明第二套格式。

## 决策

### D1：授权模式与授权通道是两条正交轴

- `authorization_mode`（不变，ADR-0009）：**谁有资格批**——`single_owner` | `independent`。
- 新增 `authorization_channel`（本 ADR）：**在哪里签**——`github_comment`（默认）| `interactive_tty`（过渡保留一个发布周期）。

| mode \ channel | `github_comment` | `interactive_tty` |
| --- | --- | --- |
| `single_owner` | `approver == accepted_by`（自签，异步可审计） | 现状：TTY + 输入 `yes` |
| `independent` | `approver ∉ {accepted_by, 执行者 gh login}`（账号级分离） | 不支持（该模式本就不需要 TTY） |

新增通道不新增模式，避免把"谁有资格"和"在哪签"混成一个枚举。`authorization_channel` 写入 `loopx-workflow.config.json`；缺省视为 `github_comment`，`doctor` 对缺键给出提示。

**关键推论**：`github_comment` 通道下，`single_owner` 不再要求"执行者 `gh login == accepted_by`"，而要求"**评论作者** == `accepted_by`"。执行者可以是任意人/CI/Agent，只要它拿不到 `accepted_by` 的账号就发不出这条评论。

### D2：签署对象改为可复算的 `authorization_digest`

定义（对 `specs/features/<feature>/04-contract.md` 的字节）：

```
normalize(text):
  1. 按 UTF-8 解码，去 BOM
  2. CRLF / CR → LF
  3. 逐行 rstrip 空格与制表符
  4. 删除第 1 处「包含 Contract-Status（不区分大小写）」的整行
  5. 去掉尾部空行，补一个 "\n"

authorization_digest = sha256(normalize(bytes))   # 64 位小写十六进制
```

第 4 步必须与 `approve` 的改写严格对应：现有实现是 `text.replace(/.*Contract-Status.*$/m, line)`，**单次替换第一处**。两边用同一"首处删除"谓词，才能保证恒等式

```
normalize(approve 改写前) == normalize(approve 改写后)
```

文中后续再出现 `Contract-Status` 的行（例如现有 `specs/features/hard-guard/04-contract.md:37` 引用该标记说明）属于正文，**不参与删除**，也不构成歧义。

守卫：第 1 处匹配必须位于文件首个 `## ` 标题之前（元数据块内）。若首个 `##` 之后才出现该标记，`approve` 与 `--prepare` 均 fail-closed——否则现有 `replace` 会改写正文行，而 digest 两侧"一致地错"。

性质：**改写状态行不改变 digest**。审批人从 PR 上的 DRAFT 文件算出的值，与执行者在 `approve` 改写后算出的值相同。

同时保留原有 `contract_sha`（含状态行的全字节 SHA256），继续作为 LoopX `contract_revision` 的口径——它只做 observer pin，不再承担"人可验证"的职责。评论只绑 `authorization_digest` + `spec_commit`；`contract_sha` 不必出现在评论里。

### D3：PR 定位统一为"当前分支 + 精确 head"

`approve`、`--prepare`、评论查找三条路径共用同一函数：

```
gh pr view <当前分支> --json number,state,isDraft,headRefOid,url
```

要求：`state == OPEN`、`headRefOid == spec_commit(HEAD)`；**Draft 与 Ready 均可**（与 #87 的发布前置一致）。取消 `feature/<name>` 硬编码与 Draft-only 约束。同分支存在多个 OPEN PR 时 fail-closed（歧义不做猜测）。

### D4：评论格式 v2 与授权记录的锚定

评论标记：

```
<!-- loopx-flow:gate1-authorization:v2:<feature>@<authorization_digest> -->
gate=1;version=2;mode=<single_owner|independent>;authorization_digest=<64hex>;spec_commit=<40hex>;approver=<login>;assurance=account_level
```

`user_gate` evidence（在 ADR-0009 固定键基础上**追加**，不改既有必填键）：

```
authorization_mode=<mode>;contract_sha=<64hex>;spec_commit=<40hex>;feature=<feature>;principal=<approver>
authorization_channel=github_comment;authorization_digest=<64hex>;assurance=account_level
pr=<number>;comment_id=<id>;comment_author=<login>;comment_created_at=<ISO8601>
verifier=<执行 approve 的 gh login>
```

`gate verify contract` **保持离线**（不访问 GitHub），既有键校验逻辑不变；新增键对它透明。

`gate1_reverify_authorization` 只在 **Gate2（`cmd_merge`）** 调用，`channel=github_comment` 时按 `comment_id` 取回评论并复验：

- 评论仍存在且含 v2 标记；
- 评论作者 == `comment_author` == 该模式的合法 approver；
- `authorization_digest` == 当前 `04-contract.md` 的 digest；
- `spec_commit` == 当前 PR `headRefOid`，PR 仍 `OPEN`。

任一不符 → 非 0，不调用 `gh pr merge`，并打印"重新 `approve --prepare` → 重新签署"的修复指引。

### D5：TTY 通道的过渡与退役

- `interactive_tty` 保留**一个发布周期**，仅兼容存量用户；启用时打印 `[WARN] TTY 通道将于下个版本退役`。
- 同一发布周期内删除 `find_gate1_independent_comment` 的 v1 解析（`gate=1;mode=independent;contract_sha=<sha>`），由 v2 取代，**不做双解析**（反熵增：不留第三套兜底）。
- 迁移成本为零：已核验本仓库 7 个 OPEN PR（#74/#75/#76/#77/#85/#87/#88）的全部评论，不存在任何真实 `gate1-authorization` 授权评论（仅 PR #75 的评审正文提到该标记，非授权记录）。

### D6：安全边界必须如实披露

- 本机制证明"**持有 `accepted_by`（或独立第二账号）GitHub 会话的人批准了该 digest**"，属**账号级**保证，不证明自然人。
- 持有 owner token 的 Agent 理论上可代发评论；TTY 同样可被 PTY 包装伪造，二者不存在"更强的那个"，因此披露而非否认。
- `single_owner` + `github_comment` 是**自签**，不等于第二人复核；PR 正文与 `05-evidence.md` 必须写出 `authorization_channel` 与 `assurance=account_level`。
- 真正的分离只有 `independent`；GPG/SSH 签名评论作为后续 `assurance=signature` 升级，不在本 ADR。

## 不变量

1. **I1 可复算**：任何人在 PR 上对 `04-contract.md` 执行同一 `normalize` 都能得到评论里的 `authorization_digest`。
2. **I2 状态行中立**：`approve` 改写 `Contract-Status` 不改变 digest；批准不使自己的签署对象失效。
3. **I3 离线校验**：`gate verify contract` 永不访问网络；远端复验只发生在 Gate2。
4. **I4 无第二授权库**：GitHub 评论是授权事实，`user_gate` 是投影，`04-contract.md` 的标记是落盘结果；三者不一致时以"更严格者失败"为准。
5. **I5 单一来源**：同一 `(feature, authorization_digest)` 若出现**不同作者**的多条有效评论 → fail-closed，不做"取最新"。
6. **I6 换头即失效**：PR `headRefOid` 前进而未重新签署 → 直接失效。

## 失败条件

| 场景 | 命令 | 结果 |
| --- | --- | --- |
| `--prepare` 时无 OPEN PR / `headRefOid != HEAD` | `approve --prepare` | `BLOCKED`，非 0，只读、不写任何状态 |
| 第 1 处 `Contract-Status` 出现在首个 `## ` 之后 | `approve`、`--prepare` | `BLOCKED`，非 0（禁止误改正文行） |
| 无有效 v2 评论 | `approve` | `BLOCKED`，非 0，不写 `user_gate`、不留批准标记 |
| 评论作者不满足模式（`single_owner`：≠`accepted_by`；`independent`：==`accepted_by` 或 ==执行者） | `approve` | `BLOCKED`，非 0 |
| 评论 `authorization_digest` ≠ 当前 digest | `approve` | `BLOCKED`，非 0 |
| 评论 `spec_commit` ≠ 当前 HEAD | `approve` | `BLOCKED`，非 0 |
| 同一 digest 出现不同作者的评论 | `approve` | `BLOCKED`（歧义不做猜测） |
| 评论事后被删除 / 编辑 / PR 关闭 / head 前进 | `merge`（Gate2 复验） | `BLOCKED`，非 0，不调用 `gh pr merge` |
| `channel=interactive_tty` 且非 TTY | `approve` | 维持现状：`BLOCKED` |
| `authorization_channel` 非法值 | `approve`、`merge`、`doctor` | `BLOCKED`，非 0（不静默回落默认值） |

## 测试计划（先红后绿）

| # | 用例 | 断言 |
| --- | --- | --- |
| T1 | `normalize` 单元：CRLF / BOM / 行尾空白 / 单行 `Contract-Status` | digest 与手工期望一致；改写状态行前后相同 |
| T2 | 首个 `##` 之后才出现 `Contract-Status`（正文提及型） | `approve` 与 `--prepare` 均非 0；而 `hard-guard` 式"头部有、正文再提及"正常通过 |
| T3 | `--prepare` 无 TTY、有 OPEN PR | 输出 digest/spec_commit/模板，零写入 |
| T4 | `single_owner` + 合法评论 + 无 TTY | `approve` 成功，`user_gate` 含 `comment_id`/`authorization_digest` |
| T5 | 评论作者 ≠ `accepted_by` | 非 0，无批准标记 |
| T6 | 契约内容被改后 digest 不匹配 | 非 0 |
| T7 | 分支名 `feat/x`（非 `feature/x`） | 能定位 PR（缺口 2 回归） |
| T8 | PR 为 Draft | 允许（与 #87 一致） |
| T9 | 评论被删除后 `merge` | 复验非 0，不合并 |
| T10 | 模式从 `single_owner` 切到 `independent` 后旧评论 | 非 0（与 #81 的失效语义一致） |
| T11 | 同一 digest 两条不同作者评论 | 非 0（I5） |
| T12 | `--channel interactive_tty` 非 TTY | 非 0 + 退役告警 |

全部用例在隔离临时目录运行，主仓 `.loopx/registry.json` 零残留（沿用 `tests/unit/adr-0009-gate1-auth.test.js` 的 sandbox 模式）。

## 否决

- **继续只用 TTY**：不解决远程/CI 场景，且 TTY 本身可伪造，收益只有"仪式感"。
- **改用 GitHub PR Approve 代替评论**：`REQ-PR-LIFECYCLE-1` 明确规定 Gate1 不用 PR Approve，且 Approve 绑定的是 commit 而非"规格内容"，仍需额外解析；评论更显式、可 grep、可复验。
- **新增第三种 `authorization_mode`（如 `github`）**：会把"谁有资格"和"在哪签"耦合，四人矩阵退化成互斥枚举；用 `authorization_channel` 正交拆分。
- **让 `gate verify` 访问 GitHub 做复验**：破坏 ADR-0009 的离线只读不变量，且让一个纯校验命令依赖网络与凭据。
- **保留 v1 评论解析并追加 v2**：等于维护两套格式，按反熵增原则在同一提交内替换。

## 修订

- **PRD**（`docs/prd/loopx-workflow.md`）：
  - `REQ-CHECKPOINT-1`：删除"`single_owner` 需 TTY 确认 + 其 `accepted_by` 必须等于当前执行者 login"，改为"按 `authorization_channel` 核验授权主体：`github_comment` 要求评论作者为合法 approver（`single_owner` 为 `accepted_by`，`independent` 为不同于 `accepted_by` 与执行者的第二账号）；`interactive_tty` 保留 TTY 确认"。
  - `REQ-GATE1-AUTH-1`：追加 `authorization_channel` / `authorization_digest` / `comment_id` / `comment_author` / `comment_created_at` / `assurance` 六个键；明确评论只绑 digest 不绑 `contract_sha`；明确 `gate verify` 仍离线、复验只在 Gate2。
  - `REQ-AUTH-MODE-1`：新增 `authorization_channel ∈ {github_comment, interactive_tty}`，缺省 `github_comment`。
- **设计**（`docs/design/loopx-workflow-design.md`）：改 `approve contract` 行（通道二选一、`--prepare` 子命令）、`merge` 行（Gate2 前 `gate1_reverify_authorization`）、Gate1 段落（去 TTY 唯一化）；`gate verify` 行只补"不访问网络"的复述。
- **退役**：`find_gate1_independent_comment` 的 v1 标记解析；`AGENTS.md` 铁律 3 与阶段 8 中"TTY 确认"的唯一路径表述改为"GitHub 评论签名（或 `--channel interactive_tty` 过渡）"。

**回写状态（2026-11-27）**：PRD 的 `REQ-CHECKPOINT-1`、`REQ-GATE1-AUTH-1`、`REQ-AUTH-MODE-1` 与两个流程条目，以及设计的 `init` / `approve contract` / `gate verify` / `merge` / 阶段 0 / Gate1 段落 / 失败条件表已同步。本 ADR 仍为 **Proposed**；`AGENTS.md` 与实现改动待 Owner 接受后执行。注意 `REQ-CHECKPOINT-1` 所在行与 PR #87（发布前置）重叠，两者合并时需人工解冲突。

## 不做什么

- **不改 `contract_revision` 口径**。本 ADR 只解决"签署对象可复算"，不把状态行排除出 LoopX `contract_revision`；因此 PR #75「批准即让 Proof 失效」**不在本 ADR 解决**，由 W5 在 `scope_fingerprint` 侧排除状态行，或在 `approve` 后自动 re-prove —— 那需要另立 ADR。
- **不改 Gate2 授权通道**。`release-approve` 仍在 TTY；统一到评论是后续工作。
- **不做自然人身份、不强制 GPG/SSH 签名**、不引入第二授权状态库、不新增 `gate verify spec`。
- **不处理 PR body 的审批可读性**。规格包审阅视图（`--prepare` 是否把 00-INDEX/04-contract 摘要贴到 PR）是相邻改进，单独评估。
