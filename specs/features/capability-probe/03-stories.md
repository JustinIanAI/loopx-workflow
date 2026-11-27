# capability-probe 故事拆分

- **Goal**：`loopx-capability-probe-goal`
- **追溯**：`REQ-CAPABILITY-1`、ADR-0015 决策 4、ADR-0010 决策 4

## Story-1：三层探针核心

- **结果**：`probeCapabilities` 在任意真实 `--help` 文本上判定 PASS / WARN / BLOCK / UNKNOWN，并校验 `schema_version` 白名单与版本漂移。
- **AC**：AC-1、AC-2、AC-3
- **验证**：`tests/unit/capability-probe.test.js`（T2 / T3 / T5 / P2 回归）
- **依赖**：无

## Story-2：矩阵投影

- **结果**：`loopx-flow doctor` 与 `loopx-flow capabilities [--scope]` 输出「能力 → 探测信号 → 状态 → 说明」矩阵，`matrix` 视图恒 exit 0。
- **AC**：AC-4
- **验证**：`formatMatrix` + doctor 用例
- **依赖**：Story-1

## Story-3：L0 dispatch 能力门

- **结果**：`feature/check/pr/review/merge/release-approve` 在 dispatch 边界统一探测一次；BLOCK / UNKNOWN 在任何不可逆动作前非 0 并输出《LoopX 升级契约差异诊断卡》；成功路径 stdout 不含矩阵。
- **AC**：AC-5、AC-6、AC-7
- **验证**：`tests/unit/capability-gate-dispatch.test.js`
- **依赖**：Story-1、Story-2

## Story-4：负向回归与真实 CLI 金丝雀

- **结果**：缺 Flag / 缺子命令 / help 不可用 / 未知 schema / 版本漂移 / bash 5.3 变量展开均有回归；真实 `loopx 2.3.x` 下 BLOCK 能力全 PASS。
- **AC**：AC-8、AC-9
- **验证**：上述两个测试文件 + `tests/unit/todo-managed-execution.test.js`
- **依赖**：Story-1、Story-2、Story-3

## 排期

Story-1 → Story-2 → Story-3 → Story-4（串行；均已在 PR #73 交付，无剩余 Story）
