# User Stories & Sizing: core-gates-hardening
- **Feature**: `core-gates-hardening`
- **Diff 约束**: 单 PR 变动 ≤ 500 行，无幽灵代码，严格执行 `delete-first`。

## 1. 故事拆分与工作量评估 (Job Stories)

### Story 1: 真实 TypeScript 编译底座配置
- **作为** 工作流开发者与 AI Agent，
- **我希望** 仓库具备标准 `tsconfig.json` 并引入轻量 `typescript` 开发依赖，
- **以便于** `npm run typecheck` 能对代码中的 TypeScript 接口、数据类型及测试样例执行真实的类型静态编译与报错拦截。
- **工作量评估**: ~30 行配置与依赖更新。

### Story 2: 专有 Lint 门禁脚本构建与 AST 检查
- **作为** 交付质量把关人，
- **我希望** `npm run lint` 运行专有的 `scripts/gate-lint.sh`，
- **以便于** 全面检测 Shell 脚本语法健全性、JavaScript 语法 AST 安全性以及契约格式规范，杜绝语法瑕疵与注入风险。
- **工作量评估**: ~60 行脚本实现。

### Story 3: 真实 Build 产物完整性与健康度校验
- **作为** 流水线执行器，
- **我希望** `npm run build` 运行 `scripts/gate-build.sh`，
- **以便于** 校验所有入口脚本可执行状态、CLI 命令连通性与模块依赖闭环。
- **工作量评估**: ~40 行脚本实现。

### Story 4: 门禁真实拦截能力与负向测试套件
- **作为** 质量审计人员，
- **我希望** 在 `tests/unit/gates-hardening.test.js` 中建立正向与负向测试用例，
- **以便于** 证明在类型错误、语法违背或脚本破坏时，四大门禁能够 100% 触发 Fail-Closed 熔断。
- **工作量评估**: ~80 行测试用例。
