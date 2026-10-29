# Feature Contract & Tasks: change-quality-failclosed

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-28 16:56:14
- **Feature Branch**: feature/change-quality-failclosed
- **LoopX Goal**: change-quality-failclosed-goal

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
/**
 * LoopX 严格质量门禁收据与语义审查数据契约
 */
export type RiskSeverity = 'blocker' | 'warning' | 'advisory';

export interface QualityRiskItem {
  lens: string;
  severity: RiskSeverity;
  summary: string;
  evidence_refs: string[];
}

export interface ValidationItem {
  name: 'typecheck' | 'lint' | 'build' | 'test';
  status: 'passed' | 'failed';
}

export interface ChangeQualityAgentResultV2 {
  schema_version: 'change_quality_agent_result_v2';
  reuse: {
    conclusion: string;
    safe_fix_applied: boolean;
  };
  simplification: {
    conclusion: string;
    safe_fix_applied: boolean;
  };
  risks: QualityRiskItem[];
  validation: ValidationItem[];
}

export interface QualityVerificationOutcome {
  feature: string;
  goalId: string;
  diffSha256: string;
  blockerCount: number;
  warningCount: number;
  allPassed: boolean;
  receiptStatus: 'VERIFIED' | 'FAILED';
  timestamp: string;
}

/**
 * 契约不变量 (Contract Invariants):
 * 1. [Inv-1]: 任何 QualityRiskItem 中只要存在 severity === 'blocker'，适配器和 check 命令必须以 Exit Code 1 阻断，严禁放行。
 * 2. [Inv-2]: loopx-flow check 严禁使用 '|| true' 忽略验证失败，必须严格向上向调用方透传非零退出码。
 * 3. [Inv-3]: 在未挂载外部评审报告时，语义分析器必须根据真实 git diff 执行 AST 与模式扫描，拒绝虚假静态放行。
 * 4. [Inv-4]: 05-evidence.md 中的 diffSha256 必须与当前 Git Diff 的 SHA256 哈希值绝对一致。
 */
```

## 2. 任务清单 (Tasks)

- [x] 【✅】t1: 移除 `bin/loopx-flow check` 中的 `|| true` 静默逃逸通道
- [x] 【✅】t2: 重构 `skills/code-review/scripts/ingest-to-loopx-quality.js` 支持真实 Git Diff 语义扫描与严格 Exit 1 熔断
- [x] 【✅】t3: 统一质量收据与 `05-evidence.md` 的 Diff SHA256 指纹回写
- [x] 【✅】t4: 编写 `tests/unit/change-quality-failclosed.test.js`（正向通过 + 缺陷注入熔断测试）
- [x] 【✅】t5: 执行四大硬门禁确保 100% 全绿并通过质量收据核验
