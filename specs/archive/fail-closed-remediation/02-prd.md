# Feature PRD Slice: fail-closed-remediation

- **Feature**: `fail-closed-remediation`
- **Goal**: `fail-closed-remediation-goal`
- **Product decisions**: ADR-0003、ADR-0004
- **Requirements**: `REQ-CHECKPOINT-1`、`REQ-FAILCLOSED-1`、`REQ-CHECK-IDENTITY-1`、`REQ-FACADE-2`

## 1. 切片范围

修复审批、体检、检查、同步的 Fail-Open 行为，并修复 issue #17 的 `feature` 预创建 state file 缺陷；不改质量扫描与 review 流水线。

## 2. 验收准则

1. `approve contract` 无 `loopx` 时 exit 1，契约文件不出现 APPROVED 标记。
2. `configure-goal` 失败时 exit 1，契约/决策/INDEX 回到审批前内容。
3. `doctor` 无 `loopx` 时 exit 1，并输出原因/影响/修复命令。
4. `check` 无 feature 且无 `--goal-id` 时 exit 1；有胶囊时先运行 `gate verify contract`。
5. `check` 成功文案不再打印不存在的 `05-evidence.md` 路径；无 feature 时用 goal 核验收据。
6. `ingest-to-loopx-quality.js` 无 feature/goal 时 exit 1，不再回退到 `entries[0]`。
7. `feature` 在 bootstrap 前不创建 `ACTIVE_STATE.md`；真实 bootstrap 成功后状态文件由 LoopX 创建。
8. `feature`/`approve` 的 `sync-global` 失败重试后仍失败则 exit 1。
9. 现有 `approve` 正常路径、`check` 正常路径、e2e pipeline 测试不回归。

## 3. 承重假设

- LoopX `bootstrap --state-file` 在文件不存在时创建 canonical storage。
- `configure-goal` 失败时不会部分修改 Goal 状态；本地回滚足够。
- `gate verify contract` 在 `approve` 成功后可通过。
