# Feature Contract: review-evidence-graph

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-11-05 16:22:56
- **Feature**: review-evidence-graph
- **Goal**: review-evidence-graph-goal

## TypeScript 契约

```ts
export interface EvidenceRequirement {
  readonly evidence_id: string;
  readonly fields?: readonly string[];
  readonly items_field?: string;
  readonly item_fields?: readonly string[];
  readonly item_count?: { readonly minimum?: number; readonly maximum?: number };
  readonly positive_field?: string;
  readonly positive_fields?: readonly string[];
  readonly negative_field?: string;
  readonly negative_fields?: readonly string[];
  readonly verdict_values?: readonly string[];
}

export interface EvidenceGraph {
  readonly [evidenceId: string]: {
    readonly status: 'verified' | 'unverified' | 'not_applicable';
    readonly [field: string]: unknown;
  };
}

export interface ValidationMatrixItem {
  readonly case_id: string;
  readonly invariant_or_case: string;
  readonly command_or_check: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'pending' | 'unverified' | 'not_applicable';
  readonly result: string;
  readonly required: boolean;
  readonly skip_or_failure_reason?: string;
}

export interface EvidenceBuildInput {
  readonly contract: { readonly evidence_requirements: readonly EvidenceRequirement[] };
  readonly plan: { readonly required_evidence_ids: readonly string[]; readonly result_template?: { readonly evidence?: EvidenceGraph; readonly review_policy_revision?: number } };
  readonly diff: string;
  readonly headOid: string;
  readonly pr: number;
  readonly motivation: string;
  readonly validation: readonly ValidationMatrixItem[];
  readonly modelEvidence?: EvidenceGraph;
}

/** 不变量
 * Inv-1: 仅按 packet 的 required_evidence_ids 构建，不额外发明 evidence id。
 * Inv-2: 每个 required id 必须有 status:verified 或 not_applicable，且 required fields 非空。
 * Inv-3: validation_matrix 必须来自实际执行结果；未执行的 required 检查标 unverified，不得写 passed。
 * Inv-4: 模型 evidence 只能补语义字段，不得覆盖本地 validation_matrix/changed_line_classification。
 * Inv-5: evidence 必须能通过 loopx pr-review --check-result，且无阻塞时 approval_consistent=true。
 * Inv-6: PR body 文件说明必须来自真实 diff；无法解释标 NOT_PROVIDED，不得套模板。
 */
```

## 任务清单

- [ ] t1: 新增 `skills/code-review/scripts/evidence-builder.js`。
- [ ] t2: authentic-review 使用 builder，合并模型 evidence。
- [ ] t3: 本地 validation_matrix + changed_line_classification + code_volume。
- [ ] t4: R4 describeFile/buildBody 真实 diff。
- [ ] t5: 证据/门禁测试 + check-result 基准。
- [ ] t6: 四门禁 + 收据 + PR。
