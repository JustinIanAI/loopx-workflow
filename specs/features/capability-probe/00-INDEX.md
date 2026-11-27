# capability-probe 审阅总览

- **Feature**：`capability-probe`
- **Goal**：`capability-probe-goal`（已由 `loopx bootstrap` 注册，change-quality 已启用）
- **Current Status**: APPROVED (Stage 5 TDD Ready)
- **Contract Status**: FROZEN & APPROVED
- **追溯**：`REQ-CAPABILITY-1`、ADR-0015 决策 4、ADR-0010 决策 4 / T2 / T3
- **PR**：#73（`feat/loopx-capability-probe-w4`）

## 资产

| 文件 | 作用 | 状态 |
|---|---|---|
| `01-decisions.md` | 本胶囊实现取舍 | APPROVED |
| `02-prd.md` | 切片验收与第 2 层覆盖边界 | 完成 |
| `03-stories.md` | 故事拆分与依赖顺序 | 完成 |
| `04-contract.md` | 冻结签名 + AC 矩阵 + Scope + Verification Plan | DRAFT（待 Gate1） |
| `05-evidence.md` | 四门禁与质量凭据 | 本地证据已记录；LoopX 收据 deferred |

## 门禁状态

| 门禁 | 状态 | 下一步 |
|---|---|---|
| Four Gates | 本地实测全绿（见 `05-evidence.md`） | 复审时在 head 上重跑 |
| Gate1 Specification Authorization | **待人类 TTY 确认** | `./bin/loopx-flow approve contract capability-probe` |
| Gate2 Delivery Authorization | 待人类批准 | Mode A：非作者 Approve；Mode B：Owner `release-approve` |

## 审阅入口

1. 先读 `02-prd.md` 的切片与「第 2 层 schema_version 覆盖边界」。
2. 再读 `04-contract.md` 的冻结签名与 AC 矩阵。
3. 代码：`lib/capability-probe.js`；`bin/loopx-flow` 的 `probe_loopx_capabilities` / `require_loopx_capabilities` / `assert_loopx_schema_version` / `read_loopx_json` / `dispatch_capability_scope`。
4. 测试：`tests/unit/capability-probe.test.js`、`tests/unit/capability-gate-dispatch.test.js`。
