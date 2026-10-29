# Feature Contract & Tasks: authentic-review-pipeline

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-10-28 18:35:28
- **Feature Branch**: feature/authentic-review-pipeline
- **LoopX Goal**: authentic-review-pipeline-goal

## 1. 契约冻结 (TypeScript Interfaces & Invariants)
```typescript
// ---------- 审查者调用层 ----------
export interface ReviewAgentInvocation {
  /** 审查包来源：远端权威 diff（gh pr diff），禁止本地 working tree */
  prId: number;
  headOid: string;
  /** codex exec | claude -p；一律使用 CLI 默认模型，禁止 -m/--model 指定 */
  agent: 'codex' | 'claude';
  prompt: string;            // 含 head_oid、胶囊契约摘要、JSON 输出协议要求
  timeoutMs: number;         // 默认 600_000
}

export interface ModelDeclaration {
  reviewer: string;          // 'codex' | 'claude'
  model: string;             // runtime_reported：由 CLI 输出透传，禁止伪造
  declaration: 'runtime_reported' | 'self_reported';
}

export interface ReviewFinding {
  file: string;
  line?: number;
  severity: 'blocker' | 'major' | 'minor' | 'advisory';
  summary: string;
  repro?: string;            // 可复现反例（命令/输入/期望 vs 实际）
}

export interface AuthenticReviewResult {
  schemaVersion: 'authentic_review_result_v1';
  headOid: string;
  verdict: 'approve' | 'request_changes';
  findings: ReviewFinding[];
  declaration: ModelDeclaration;
  /** 复审核销表：head 变化后逐条判定 */
  carryover?: Array<{
    finding: ReviewFinding;
    status: 'fixed' | 'reproducible' | 'obsolete';
  }>;
}

// ---------- Fail-Closed 不变量 ----------
// INV1: codex 缺失/超时/输出不可解析/声明块缺失 → NOT_VERIFIED + exit≠0
// INV2: 发布前 head 重读 gh pr view 必须与 headOid 一致（防漂移）
// INV3: verdict 必须经 loopx pr-review --check-result（或 packet）核验后发布
// INV4: reproducible 未清零 → verdict 上限 request_changes

// ---------- 报告与组装层 ----------
export interface FiveBlockReport {
  block1Metadata: { prId: number; branch: string; headOid: string; diffStats: string };
  block2Contract: { feature: string; contractSha256: string | 'NOT_FOUND'; goalId: string };
  block3Gates: { typecheck: string; lint: string; build: string; test: string }; // 真实输出，非硬编码
  block4Review: { verdict: string; findings: ReviewFinding[]; disputed?: ReviewFinding[] };
  block5Hygiene: { antiEntropy: string; carryover?: AuthenticReviewResult['carryover'] };
}

export interface PRBodyAssembler {
  /** 胶囊资产 → 五段式 body；缺失段落输出 NOT_PROVIDED，禁止静默留空 */
  fromCapsule(feature: string): string;
}

// ---------- 交叉验证 ----------
export interface CrossValidation {
  enabled: boolean;          // 默认 false，--cross-validate 开启
  unavailableIsBlocking: false; // claude 不可用 → 标注 UNAVAILABLE，不阻断
}
```

## 2. 任务清单 (Tasks)
- [x] 【DELIVERED】t1: 阶段 1 架构决策落实 (`01-decisions.md`) — D1~D6
- [x] 【DELIVERED】t2: 阶段 2 精益 PRD 与红队攻击 (`02-prd.md`)
- [x] 【DELIVERED】t3: 阶段 3 特性故事拆解 (`03-stories.md`) — S1~S6
- [x] 【DELIVERED】t4: 阶段 5 TDD 核心实现与单测（S1 调用器 / S2 实心化 / S3 组装器 / S4 核销 / S5 交叉验证）— `skills/code-review/scripts/authentic-review.js` + `cmd_review` 切换至真实管线
- [x] 【DELIVERED】t5: 阶段 6 代码质量与审查收据（四门禁 + 严格 change-quality 核验）— check 全链路 ok=true（strict_receipt 已启用）
- [x] 【DELIVERED】t6: 阶段 7 交付 PR 发起与实测验证 — PR #8 真实 codex 审查（model=gemini-3.8-flash-high, verdict=request_changes）+ body 重建 + 报告发布；check-result 完整适配缺口登记于 review-carryover.json（INV4 封顶兜底）
