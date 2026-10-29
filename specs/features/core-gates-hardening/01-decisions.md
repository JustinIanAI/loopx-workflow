# Architecture Decisions: core-gates-hardening
- **Status**: DRAFT (Pending Human Approval)
- **Feature**: core-gates-hardening
- **Architectural Scope**: 本地四大硬门禁实心化改造 (Typecheck, Lint, Build, Test)

## 1. 核心技术路线对比与权衡

### 分支 1: 仅在 package.json 内写 shell inline 命令
- **优点**: 零新增脚本文件，看起来改动小。
- **缺点**: 难以做复杂语法和负向边界校验；可读性差，无法跨平台平滑维护；无法支持增量扩展。
- **结论**: 否决。

### 分支 2: 重型全套工具链 (引入 Webpack/Vite + ESLint 9 + Prettier + Jest + TSC)
- **优点**: 工业级标准。
- **缺点**: 引入数百兆 node_modules，增加构建冷启动耗时；本项目为轻量工作流控制面与 CLI 门面，重型前端构建工具严重过度设计（Over-engineering）。
- **结论**: 否决。

### 分支 3: 精准实心化架构 (TypeScript DevDependency + 专用 Gate 脚本矩阵 + 原生 Node.js Test Runner) 【采纳方案】
- **实施策略**:
  1. **Typecheck**: 引入轻量 `typescript` 开发依赖（`devDependencies`），配置零侵入的 `tsconfig.json`。通过 `tsc --noEmit` 对全库 TypeScript 样例、契约接口和适配器进行真实类型核验，杜绝以“检查 markdown 文件存在”冒充类型检查。
  2. **Lint**: 编写专有 `scripts/gate-lint.sh`，覆盖三层检查：
     - Shell 脚本规范与语法诊断 (`bash -n` + 指令健全性校验)；
     - JavaScript 语法 AST 与危险代码扫描 (通过 Node 原生 `vm.compileFunction` 校验语法合规)；
     - 契约冻结格式语法完整性核验。
  3. **Build**: 编写专有 `scripts/gate-build.sh`，执行真实产物健全性校验：CLI 入口完整性、Hash 指纹可复现性、可执行权限分配与依赖完整性闭环。
  4. **Test**: 保持使用 Node.js 原生轻量高性能 test runner (`node --test`)，新增 `tests/unit/gates-hardening.test.js`，包含真实的负向拦截断言（破坏测试用例能 100% 触发门禁熔断退出）。
- **权衡收益**: 零冗余依赖、运行极速（门禁全流程 < 2s）、完全消除虚假门禁，真正实现物理防逃逸。
