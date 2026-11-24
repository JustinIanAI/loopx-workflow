# capability-probe 实现取舍

- **Status**: PROPOSED（随 PR 独立审查，issue-fix 路径不另行 Gate 1 锁）
- **关联**：[ADR-0015](../../../docs/adr/0015-todo-managed-execution-and-capability-probe.md) 决策 4、[ADR-0010](../../../docs/adr/0010-command-contracts-and-execution-protocol.md) 决策 4/12/13、`REQ-CAPABILITY-1`

## 取舍

1. **探针集中到 `lib/capability-probe.js`**：能力成员、探测信号、`schema_version` 白名单只此一处，`bin/loopx-flow` 只做调用，避免再散落 `--help | grep`。
2. **`matrix` 只诊断、`require` 才阻断**：`doctor` 用 `matrix`，始终 exit 0；`issue` / `integrate` / `todo` 用 `require`，BLOCK 或 UNKNOWN 一律非 0 并输出诊断卡。
3. **`issue-fix` / `integration-branch` 分级**：ADR-0010 规定仅对 `issue` / `integrate` 为 BLOCK，`doctor` 视角降级为 WARN。
4. **`schema_version` 复用既有解析入口**：`todo claim` / `todo done` 的解析脚本调用共享 `assertSchemaVersion`，未知版本输出诊断卡后 fail-closed。
5. **第 3 层只软提示**：版本号偏离 `2.3.0` 且前两层通过时仅 WARN，不误杀上游小版本升级。

## 否决

- 否决版本 Pin（违背 ADR-0010 不 Pin 原则）。
- 否决 `doctor` 因 BLOCK 能力缺失而直接非 0（doctor 是诊断入口，阻断应发生在具体 L0 命令）。
