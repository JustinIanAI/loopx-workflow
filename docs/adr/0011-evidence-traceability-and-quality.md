# ADR-0011：证据契约、追溯与质量裁决

- **状态**：Accepted
- **日期**：2026-11-12
- **批准**：严君 · 2026-11-12（实现验收 T1–T6 在 Verified 前跑）
- **关联**：[ADR-0005](0005-quality-scan-pr-body.md)、[ADR-0007](0007-environment-governance.md)、[ADR-0009](0009-specification-authorization.md)、[state-evidence-boundary.md](../research/state-evidence-boundary.md) §9、讨论纪要 A4/A5/B3
- **依赖**：ADR-0009（Gate1 规格完整性）；ADR-0010（命令/协议）。本 ADR 的完整追溯在 Gate1 子集之后落地。

## 背景

当前 05-evidence 与 Receipt 存在三类问题：① `ingest-to-loopx-quality.js` 把 `validation` 硬编码为 passed、05-evidence 硬编码退出码 0（违 ADR-0005）；② review artifact 绑 head，但 `respond` 在精确 head 缺失时回退旧 artifact；③ 追溯链 REQ→Story→AC→Contract→Test→Diff→Evidence 未建立，`REQ-TRACE-2` 只做了 Gate1 的「引用非空」子集。Freshness 缺统一失效矩阵，容易被误读为时间 TTL 或需要新账本。

## 决策

1. **证据契约**：`05-evidence.md` 由 `ingest` 生成（禁止手写覆盖），包含列：Evidence Ref（由既有 REQ/Story/AC/Test 拼接，不新开 `EVID-01` 编号）/ Type / REQ / Story / AC / Test / Goal / Contract SHA / Commit / Diff Fingerprint / Status / Oracle / Scope / Real-vs-Mock / Freshness / Linked Receipt。
2. **六种证据状态**：`passed / failed / blocked / not_run / not_applicable / deferred`。禁止把 `not_run/blocked/deferred` 自动变 `passed`；`deferred` 必须带 owner + 期限（**期限只是索引字段，到期不会自动失效；失效仍按 freshness 矩阵**）；`not_applicable` 必须带理由；Mock 验证必须标 `mock`；真实入口验证标 `real`。**四门禁（typecheck/lint/build/test）不得标 `not_applicable`：它们必须 `required: true` 并出现在 LoopX `validation` 行；`not_applicable` 只用于非门禁证据。**
3. **独立 Oracle 与门禁来源**：每条证据必须有可复跑命令/独立断言作为 Oracle；禁止「被测实现自己产生预期」。`ingest` **不重复运行四门禁**：它消费 `check` 已拿到的 typecheck/lint/build/test 退出码与实测输出；缺这四份结果时拒绝写 `passed`（可写 failed/not_run 并让 `check` 非 0）。
4. **质量裁决归属**：Review Engine/Skill 负责发现 Findings；Adapter 只做格式翻译 + 机械前置护栏 + 实测 validation；**LoopX `change-quality` 是唯一质量裁决**。Adapter 不得新增独立判定规则/第二质量引擎；`change-quality verify` 只验指纹/ schema/guardrails，不重跑四门禁；**`ingest` 只把 `check` 的退出码原样写入，缺结果就拒绝写 `passed`**（以决策 3 为准，不另加判断）。
5. **Freshness（复用指纹，不建账本）**：05-evidence ↔ receipt `scope_fingerprint`；review artifact ↔ PR `headRefOid`；Gate1 ↔ `contract_revision`。失效矩阵：contract SHA 变 → Gate1 授权失效；head 变 → review/respond 失效；scope diff 变 → 证据失效；**纯 docs 变更不使代码证据失效——判据：diff 全部落在 `docs/**` 与非契约 `*.md`；`04-contract.md` 变化只走 Gate1 的 SHA**；依赖变化 → **`package.json` / `package-lock.json` 的 blob 变化使全部 Test 行证据失效（按 blob SHA 比对；锁文件 blob 分不出哪个测试受影响）**。**不引入 TTL / freshness 数据库**。
6. **追溯引用（不新造编号）**：沿用既有编号——产品需求用 `REQ-*`，Story 用 `03-stories.md` 的既有编号/标题，AC 行用 `04-contract.md` 的既有条目；链为 REQ→Story→AC→Contract→Todo→Test→Diff→Evidence→PR。Gate1 前：**用 ADR-0009 的 AC 矩阵**阻断（不在 `02-prd.md` 找第二份 AC）；实现期：Todo 无 Story、Test 无 AC → `check` **WARN**；Receipt 指纹与当前 scope 不一致 → **阻断**。**不建 trace registry/图数据库，不新增 `<feature>-REQ-01` 这类本地编号**。
7. **PR 正文六问**：并入 `buildBody`——依据哪个 Goal/REQ/ADR、关闭哪个缺口、AC 哪些满足、哪些真实入口 vs Mock、当前 Head、哪些未验证/后续。验证矩阵增 `Real-vs-Mock` 列；无法生成写 `NOT_PROVIDED`。与 `.github/PULL_REQUEST_TEMPLATE.md` 的 8 项表**合并去重**，只保留一份生成正文。
8. **Failure semantics**：收据缺失/失效/未验证 → 非 0 且不得推进；`respond` 精确 head 缺失时 **fail-closed**，不得回退旧 artifact；review/PR 正文缺段写 `NOT_PROVIDED`，禁止静态「已通过」。
9. **证据引用边界**：`evidence_refs` 只引用已提交 exact scope 的公开安全文件；过滤运行时工件（ADR-0007）；缺陷扫描仍覆盖工作区 diff。

10. **数据落点与六状态映射（LoopX schema 是硬约束）**：
   - LoopX `validation.status` 只有 `passed / failed / skipped`；`validation` 数组**不能省略**（schema 层要求）。
   - 固定映射：`passed→passed`；`failed→failed`；`not_run/blocked/deferred→skipped` 且 `required: true`（进入 `blocking_codes`，`check` 非 0）；**`not_applicable` 不写进 LoopX `validation` 行**，只留在 `05-evidence.md` 索引（不写成 skipped+required:false，那只会产生 risk 不阻挡）。
   - Evidence Ref / Oracle / Real-vs-Mock / Freshness 是 Workflow 工件字段，由 Workflow 生成与解析；`gate verify` 读取 Workflow 文件与 LoopX 收据，不假设 LoopX 认识这些字段。
   - `scope_fingerprint` / `headRefOid` 是外部可观测值；证据新鲜度只比对这些值。
11. **实现验收（Implemented → Verified 前必须跑；不是 Accepted 门槛）**：
   - T1 `check` 的四门禁失败时 `ingest` 非 0，05-evidence 写 failed/not_run，不写 PASSING；缺四门禁结果时 `ingest` 拒写 passed；
   - T2 四门禁通过但 Receipt 缺失/失效 → `check` 非 0；
   - T3 `not_run/blocked/deferred` 不得被转换成 passed；
   - T4 改 head/diff 后旧 review/receipt 失效，`respond` 精确 head 缺失时非 0；
   - T5 追溯缺失（Story 无 AC / Todo 无 Story / Test 无 AC）按阻断/WARN 分级生效；
   - T6 PR 正文六问全部来自真实数据，缺段为 `NOT_PROVIDED`。


## 接受前复核（本次评审教训）

- **字段落点**：六状态/ID/Oracle 是 Workflow 工件字段，不假设 LoopX schema；Receipt 只用 LoopX 接受的枚举。
- **保证可观测**：证据有效性只对齐 scope_fingerprint / headRefOid / contract SHA，不引入时间 TTL。
- **测试真实**：T1–T6 必须真实跑过（实现验收门，不是 Accepted 门槛；含负向：缺证据/旧 head 必须非 0）；不可用伪造的门禁结果代替真实退出码。
- **范围不越级**：不把 Gate2 的审批前置塞进证据契约。

## 否决

- 独立 trace registry / 追溯图数据库 / `docs/traceability.md` 作为需求源。
- Evidence Ledger / Freshness TTL / 独立证据状态库。
- Adapter 扩张为第二质量引擎；`change-quality verify` 重跑四门禁。
- `respond` 回退旧 artifact；PR 正文另起面板或静态通过。
- 把 01/02/03 全哈希进契约（ADR-0009 已否决）。

## 修订

- **PRD**：扩展 `REQ-QUALITY-1`（validation 实测/Adapter 分工/六状态）；新增 `REQ-EVIDENCE-1`（证据契约与 Oracle）、`REQ-EVIDENCE-FRESH-1`（失效矩阵）；实现 `REQ-TRACE-2` 的完整追溯（由本 ADR 承担，新增 `REQ-TRACE-3` 引用与校验规则，不新增本地编号体系）；扩展 `REQ-PR-BODY-1`（六问 + Real-vs-Mock）；收紧 `REQ-RESPOND-1`（精确 head）。
- **设计**：§8 审查/证据；新增 §8.2「Evidence Contract 与 Freshness」；§10 失败矩阵补 stale/缺失/回退行。
- **AGENTS.md**：铁律 6 补「validation 实测、六状态、不得伪造」；阶段 6 补 05-evidence 生成口径。
- **退役**：ingest 静态 `passed`/乐观 PASSING；respond 回退旧 artifact；PR 模板重复 8 项表。

## 不做什么

- 不引入外部 Evidence Registry / Execution Ledger。
- 不改变 LoopX Receipt schema；只在 Workflow 证据索引层扩展字段。
- 不新建质量引擎或第二套 blocker 判定。
- 不在本 ADR 实现代码（M4 落地）。
