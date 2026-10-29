# Lean PRD: core-gates-hardening
- **Feature**: `core-gates-hardening`
- **Goal ID**: `core-gates-hardening-goal`

## 1. 核心目标与问题陈述
* **核心目标**: 彻底根除 v2 流水线中的“伪门禁”与虚假检查，建立可审计、真实编译、带负向拦截熔断能力的四大硬门禁基线。
* **用户场景旅程**:
  1. 开发者/Agent 运行 `npm run typecheck` 时，由真实的 TypeScript 编译器 `tsc` 执行静态类型检查，若类型定义或签名违背，立即阻断。
  2. 运行 `npm run lint` 时，触发真实脚本语法、AST 语义合规与契约规范扫描，发现隐患立即报错。
  3. 运行 `npm run build` 时，不仅对文件赋权，还校验所有 CLI 符号表、执行依赖完整性与自检哈希。
  4. 运行 `npm run test` 时，不仅验证正向功能通过，还必须证明负向异常注入时门禁具备 100% 熔断拦截能力。

## 2. 承重假设与反驳矩阵 (Assumption Refutation Matrix)

| 假设编号 | 承重假设描述 | 潜在风险 / 证伪场景 | 缓解与反驳方案 |
|---|---|---|---|
| **A1** | 安装轻量 `typescript` 开发依赖不会影响现有零依赖环境的简洁性 | 网络受限或 node_modules 体积膨胀 | 仅引入 `typescript` 与 `@types/node` 极简类型包，配置 `noEmit: true`，构建零残留。 |
| **A2** | 门禁能够对语法或类型错误实施物理阻断 | 门禁脚本中存在静默错误吞没 (`\|\| true` 或不合规退出码) | 门禁脚本强制启用 `set -euo pipefail`，在单测中专门增加负向拦截用例验证非零退出码。 |
| **A3** | 重构门禁后向后兼容现有 `workflow.test.js` 和 `guard.test.js` | 旧测试断言与新的真实检查逻辑冲突 | 在 `tests/unit/gates-hardening.test.js` 统一验证四大门禁并保证原有用例 100% PASS。 |
