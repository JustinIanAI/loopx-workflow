# ADR-0022：合入前核验 change-quality 严格收据（默认关闭，按 feature 胶囊生效）

- **状态**：Proposed（机制已落地并被单测覆盖，**默认关闭**；启用需 Owner 在 `loopx-workflow.config.json` 写 `"merge_require_quality_receipt": true`）
- **日期**：2026-11-28
- **关联**：[ADR-0011](0011-evidence-traceability-and-quality.md)（决策 4：LoopX `change-quality` 是唯一质量裁决；决策 8：收据缺失/失效/未验证 → 非 0 且不得推进）、[ADR-0012](0012-delivery-authorization-and-recovery.md)（Gate2 交付授权）、`REQ-QUALITY-3`、`REQ-CHECKPOINT-2`

## 背景

`loopx-flow check` 会在交付前生成并核验 LoopX `change-quality` 严格收据（`change-quality prepare/record/verify`，ADR-0011 决策 4）。

但 `loopx-flow merge` 完全不碰收据：`cmd_merge` 的四步分别是 Gate2 授权核验、`--check-merge-readiness` 物理锁、二次 HEAD 校验、Squash 合入 + 胶囊归档。`grep -n "change-quality" bin/loopx-flow` 命中的每一处都在 `cmd_check` / `cmd_doctor` 的诊断路径里，**合入路径一次都没有**。

后果：只要跳过 `check`（或 `check` 的收据后来失效），PR 可以带着未生成、已过期或未通过核验的质量收据被合入主干。ADR-0011 决策 8 写的是「收据缺失/失效/未验证 → 非 0 且**不得推进**」——推进到主干正是最需要它的那一步，而它恰好不在这里。

这是**实现缺口**，不是新决策；缺的是「由哪一步执行、覆盖哪些 PR」这两个边界，本 ADR 只把它们写清楚。

## 决策

1. **新增可选开关 `merge_require_quality_receipt`**，类型布尔；**字段缺失或非 `true` 即关闭**，行为与今天完全一致。
2. 开启后，`cmd_merge` 在「就绪度核验通过、二次 HEAD 一致」之后、`gh pr merge` 之前，调用一次
   `loopx change-quality verify --goal-id <feature>-goal --repo-path <PROJECT_ROOT> --base-ref <base> --format json`，
   要求 `ok === true`；否则 fail-closed 非 0，不进入合并。
3. **生效范围限定为可解析出 feature 胶囊的 PR**。修复分支（`fix/<slug>`，没有 `specs/features/<feature>/` 与对应 Goal）不在本开关范围内：
   - 若 `feature` 为空却开启了开关 → fail-closed 并提示 `--feature <name>` 或关闭开关，**不做静默放行**；
   - 这条豁免是显式的、写进文档的，不是「解析不到就跳过」的隐式降级。
4. **只验收据，不重跑门禁**：`change-quality verify` 只核指纹/schema/guardrails（ADR-0011 决策 4），合入路径不得因此重跑四大门禁或二次审查。
5. **判定单点化**：解析与判定收敛在 `merge_quality_receipt_ok`，`cmd_merge` 只读开关 + 调用；单测直接驱动 `bin/loopx-flow merge` 的沙箱路径。

## 与既有门禁的关系

| 门禁 | 位置 | 判据 |
| :--- | :--- | :--- |
| Gate1 | `approve contract` | 人工授权 + 契约 SHA 锁定 |
| 四门禁 + 质量收据 | `check` | `npm run typecheck && lint && build && test` + `change-quality verify` |
| Gate2 | `release-approve` / 页面 Approve | 人工授权绑定 head |
| 就绪度物理锁 | `merge` `[2/4]` | `--check-merge-readiness` + 二次 HEAD |
| **质量收据（本 ADR）** | `merge` `[2.5/4]` | `change-quality verify` `ok === true` |

本开关是给「`check` 可以被绕过」这个缺口打的补丁，不替代 `check`，也不替代 Gate2。

## 否决

- **否决默认开启**：会立刻改变所有现存 feature PR 的合入失败条件，且 `verify` 依赖本地检出与被审查提交一致；在 Owner 未确认前默认开启属于擅自收紧交付门禁。
- **否决在 `merge` 里重跑四大门禁**：`verify` 的契约就是「只验指纹，不重跑」（ADR-0011 决策 4）；重跑会把合入变成第二次 CI，成本与语义双错。
- **否决对 `fix/*` 分支伪造 Goal/收据**：修复分支没有胶囊就没有可绑定的 `scope_fingerprint`，伪造一个空收据等于取消这条门禁。
- **否决把开关做成环境变量**：交付门禁的取值必须随仓库走（可审计、可 diff），不能靠 shell 环境隐式改变。

## 启用方式（Owner 动作）

```json
{
  "schema_version": "loopx_workflow_config_v0",
  "authorization_mode": "single_owner",
  "merge_require_quality_receipt": true
}
```

启用前置：目标 feature 的 Goal 必须已启用 change-quality 资格（`loopx configure-goal --goal-id <feature>-goal --change-quality-enabled --execute`），否则 `verify` 会 fail-closed（诊断卡与 `check` 一致）。

## 安全边界（必须如实披露）

- 开关只读**布尔 `true`**：字符串 `"true"`、`1`、缺失一律视为关闭，避免配置歧义被当成开启。
- `verify` 在本机 `PROJECT_ROOT` 上执行，因此它核验的是**本地检出**对应的收据；本地检出与 PR head 不一致时，本开关不会假装自己核验了那个 head。它与 `check` 的绑定关系不变（head 变 → 收据失效，ADR-0011 决策 5）。
- 关闭时行为与今天逐字节一致：不新增任何 loopx 调用。
