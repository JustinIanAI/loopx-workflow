# Feature Contract & Tasks: core-gates-hardening

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-28 16:37:05
- **Feature Branch**: feature/core-gates-hardening
- **LoopX Goal**: core-gates-hardening-goal

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
/**
 * 本地四大硬门禁实心化与执行状态契约
 */
export type GateName = 'typecheck' | 'lint' | 'build' | 'test';

export interface GateExecutionResult {
  gate: GateName;
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  timestamp: string;
}

export interface HardenedGateEvidence {
  feature: string;
  goalId: string;
  timestamp: string;
  allPassed: boolean;
  gates: Record<GateName, GateExecutionResult>;
  typecheckStrictness: {
    compiler: 'tsc';
    noEmit: boolean;
    configFile: string;
    checkedFilesCount: number;
  };
  lintCoverage: {
    shellScriptsCount: number;
    jsFilesAstChecked: number;
    syntaxErrors: number;
  };
  buildHealth: {
    executableBinChecked: boolean;
    depsResolved: boolean;
  };
}

/**
 * 契约不变量 (Contract Invariants):
 * 1. [Inv-1]: 任何 GateExecutionResult.exitCode !== 0 时，passed 必须严格为 false，不得发生逃逸。
 * 2. [Inv-2]: Typecheck 必须调用真正的 TypeScript 编译器 tsc，严禁使用非编译器模拟或纯文件存在性检测。
 * 3. [Inv-3]: Lint 门禁必须对全部 scripts/*.sh 和关键 JS/TS 脚本执行真实语法与 AST 解析，发现 SyntaxError 必须以非零码退出。
 * 4. [Inv-4]: Build 门禁必须校验 CLI 启动完整性与执行权限，退出码必须为 0 且产物可被直接调用。
 */
```

## 2. 任务清单 (Tasks)

- [x] 【✅】t1: 配置标准 `tsconfig.json` 并引入 `typescript` / `@types/node` 开发依赖
- [x] 【✅】t2: 编写真实 Lint 门禁脚本 `scripts/gate-lint.sh` 并接入语法/AST 扫描
- [x] 【✅】t3: 编写真实 Build 门禁脚本 `scripts/gate-build.sh` 并接入完整性校验
- [x] 【✅】t4: 更新 `package.json` 中的四大门禁 scripts 指向真实检查链路
- [x] 【✅】t5: 编写 `tests/unit/gates-hardening.test.js`（正向通过 + 负向拦截测试套件）
- [x] 【✅】t6: 执行四大硬门禁确保 100% 通过并产出 `05-evidence.md`
