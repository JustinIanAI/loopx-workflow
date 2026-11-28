# ADR-0020：受支持的 `authorization_mode` 切换（`config set`）

- **状态**：Proposed（待 Owner 接受）
- **日期**：2026-11-28
- **关联**：[ADR-0012](0012-delivery-authorization-and-recovery.md)（发布授权与恢复）、[ADR-0019](0019-gate-signature-via-github.md)（Gate 签名面）、[ADR-0014](0014-temp-artifact-path-remediation-and-history-sanitization.md)（`init --reconfigure` 挂账）、Issue #81（W14）

## 背景

`REQ-AUTH-MODE-1` 只写了「`init` 确认写入、`doctor` 校验」，没有写已有项目怎么改。结果是：`loopx-workflow.config.json` 一旦生成，切换模式只能手改 JSON——绕过风险接受、绕过原子写、绕过校验，且既有 Gate 授权的失效关系无人声明。ADR-0014 把 `init --reconfigure` 记为后续批次，但计划里没有命令面、失败条件和失效语义。

## 决策

1. **新增命令面** `loopx-flow config set authorization-mode <independent|single_owner>`；`config` 是唯一受支持的配置写入口，其它键未实现即非 0（不静默忽略）。
2. **人闸在 TTY，不在参数**：非 TTY 一律 Fail-Closed 并打印可在交互终端重跑的命令；不接受 `--yes` 或任何环境变量旁路。切换到 `single_owner` 必须由操作者在 TTY 输入 `YES` 接受风险，且 `accepted_by` 取自 `gh api user`；切换到 `independent` 必须输入 `independent` 确认。
3. **切换即失效既有 Gate 授权**：`single_owner` 写入 `single_owner_risk_acceptance`（`accepted_by` + `accepted_at` UTC），`independent` 删除该字段。既有 `user_gate` evidence 串里的 `authorization_mode` 与当前配置不一致时，`gate verify contract` 按 `REQ-GATE1-AUTH-1` 一律非 0，必须重新执行 `approve contract` / `release-approve`。命令在成功输出中显式声明这一后果。
4. **唯一写入者**：`lib/auth-config.js` 负责模式校验与原子写（同目录临时文件 + `rename`，失败清理），`init` 首次写入与 `config` 切换共用它；读侧校验仍是 `auth_require_config`。
5. **先读后写**：既有配置文件非法（JSON 坏、`schema_version` 不符、`single_owner` 缺风险接受）时先拒绝，不做覆盖写；目标模式与当前一致时幂等成功且不改动文件。

## 否决

- 否决 `init --reconfigure`：`init` 的语义是首次搭骨架（preflight、pre-commit、bootstrap），把授权迁移塞进去会让「重跑 init」与「改授权」两个动作不可分；W11 `#49` 的这一项由本 ADR 移出。
- 否决手改 JSON 作为受支持路径：无法保证风险接受、原子性与失效声明。
- 否决 `--yes` / `LOOPX_AUTH_MODE` 之类的非交互旁路：授权模式的变更本身就是人闸对象，自动化能改就等于没有模式约束。
- 本轮不引入「GitHub 评论签名改模式」：切换没有 PR 锚点可绑定（不像 Gate1/Gate2 有 `contract_sha`/`head`），强行设计会造出无法复算的评论协议；一次性维护动作保留 TTY 是更小的变更面。

## 安全边界（如实披露）

- TTY 不是强安全边界（ADR-0019 已论证），它只证明「有终端」。本命令的强度与 `init` 首次配置相同，属于账号级人闸。
- `independent` 只证明两个 GitHub login 不同，不证明自然人分离；切换到 `independent` 不产生任何新的分离证明。

## 修订

- **PRD**：`REQ-AUTH-MODE-1` 增补切换命令、Fail-Closed 条件与「切换即失效既有 Gate 授权」；`REQ-FAILCLOSED-1` 增补 `config` 非法模式/非 TTY/既有配置非法非 0。
- **详细设计**：第 3 节命令表新增 `config set` 行；第 5 节失败条件表新增两行（非 TTY、既有配置非法）。
