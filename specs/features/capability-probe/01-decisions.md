# capability-probe 实现取舍

- **Status**: PROPOSED（随 PR 独立审查；本切片不自行锁 Gate 1，契约来源为已 Accepted 的 ADR-0015）
- **关联**：[ADR-0015](../../../docs/adr/0015-todo-managed-execution-and-capability-probe.md) 决策 4、[ADR-0010](../../../docs/adr/0010-command-contracts-and-execution-protocol.md) 决策 4 / 12 / 13、`REQ-CAPABILITY-1`

## 取舍

1. **探针集中到 `lib/capability-probe.js`**：能力成员、探测信号、`schema_version` 白名单只此一处，`bin/loopx-flow` 只负责调用，避免每个命令各写一套 `--help | grep`。
2. **按真实帮助结构解析签名**：逐条调用真实子命令入口（`todo claim --help`、共享 `todo_parser`、`change-quality` 二级子命令树、`goal-lifecycle` / `sync-global`），并解析 `{stop,resume}` 这类选择集；不做顶层 `--help` 推断。
3. **`goal.lifecycle` 拆成两个真实入口**：`loopx goal-lifecycle --help` 校验 `--goal-id` / `--operation`（取值 `stop`、`resume`），`loopx sync-global --help` 校验 `--goal-id`；`--state-file` 属于 `loopx bootstrap --help`，归入 `goal.bootstrap`。ADR 中的 `stop / sync-global / --state-file` 因此映射到各自真实命令，而不是在同一份 `--help` 里做字符串拼接匹配。
4. **`change-quality.strict-receipt` 按实际参数探测**：`prepare`（`--goal-id`、`--base-ref`）、`record`（`--goal-id`、`--result-json`、`--execute`、`--base-ref`）、`verify`（`--goal-id`）。锚点 `loopx 2.3.0` 没有 `--strict` 选项，要求它会让 BLOCK 能力恒假。
5. **`matrix` 只诊断、`require` 才阻断**：`doctor` 用 `matrix`，始终 exit 0；`issue` / `integrate` / `todo claim|done` 用 `require`，BLOCK 或 UNKNOWN 一律非 0 并输出诊断卡。
6. **`issue-fix` / `integration-branch` 分级**：ADR-0010 规定仅对 `issue` / `integrate` 为 BLOCK，`doctor` 全局视角降级为 WARN。
7. **第 2 层复用既有解析入口**：`todo claim`（含 Q1 分流 A 补领）与 `todo done` 在解析前调用共享 `assert schema_version`，未知或缺失版本输出诊断卡后 fail-closed。
8. **第 3 层只软提示**：版本号偏离 `2.3.0` 且前两层通过时仅 WARN，不误杀上游小版本升级。

## 否决

- 否决版本 Pin（违背 ADR-0010 不 Pin 原则）。
- 否决 `doctor` 因 BLOCK 能力缺失而直接非 0（doctor 是诊断入口，阻断应发生在具体 L0 命令）。
- 否决用无状态 `echo ... && exit 0` 假 CLI 验证「能力存在」：Fake CLI 只用于负向注入，且帮助文本必须与锚点真实 usage 结构一致；真实签名另由一条 `loopx 2.3.x` 金丝雀用例守护。
