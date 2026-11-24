# capability-probe 切片验收

- **Goal**: `loopx-capability-probe-goal`
- **追溯**：`REQ-CAPABILITY-1`、ADR-0015 决策 4、ADR-0010 决策 4 / T2 / T3

## 切片

1. `probe_loopx_capabilities` 三层探针：真实子命令 `--help` 必填 Flag 签名、`schema_version` 白名单、版本号软提示。
2. `loopx-flow doctor` 输出「能力 → 探测信号 → PASS / WARN / BLOCK / UNKNOWN」矩阵；`loopx-flow capabilities [--scope]` 提供同一矩阵的按命令视图。
3. L0 命令前置 Fail-Closed：`issue`、`integrate`、`todo claim/done` 在 BLOCK / UNKNOWN 时非 0 并输出《LoopX 升级契约差异诊断卡》。
4. Contract Fake CLI 负向测试覆盖缺 Flag、`issue-fix` / `integration-branch` 缺失、help 不可用（UNKNOWN）、未知 `schema_version`、版本漂移软提示。

## 验收

- [x] 缺必需子命令 / Flag → `require` 非 0 + 诊断卡（触发命令、期望、实际、影响范围、适配定位）。
- [x] 未知 / 缺失 `schema_version` → 非 0 + 诊断卡。
- [x] 非关键能力（`issue-fix` / `integration-branch` 在 `doctor` 视角、`goal-acceptance`）→ WARN 披露降级，不阻断。
- [x] 版本漂移但签名与白名单兼容 → 软提示，不阻断。
- [ ] Four Gates 全绿（见 PR 验证矩阵；`npm run typecheck` / `lint` / `build` / `test`）。
