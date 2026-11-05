# Feature PRD Slice: review-evidence-graph

- **Feature**: `review-evidence-graph`
- **Requirements**: `REQ-REVIEW-1`、旧 issue #25、R4
- **Goal**: `review-evidence-graph-goal`

## 范围

1. 从原生 packet 提取 `result_template` 与 evidence requirements，构建完整 `pull_request_review_result_v1.evidence`。
2. 本地自动合成 validation_matrix（typecheck/lint/build/test）、changed_line_classification、code_volume 与 diff SHA。
3. Prompt 要求模型逐项输出 architecture_flow / change_proportionality / walkthroughs 等语义证据。
4. 合并本地事实 + 模型语义，提交 `loopx pr-review --check-result`，目标 `ok=true` 且 `approval_consistent=true`。
5. R4：质量扫描覆盖 base..head + 未提交变更；高信号 blocker；validation 不硬编码；PR body 逐文件真实说明。

## 验收

- 新增 `tests/unit/authentic-review-evidence.test.js`；
- 无阻塞 PR 基准上 check-result `approval_consistent=true`；
- 四门禁 + `loopx-flow check` 收据通过；
- diff ≤ 500 行。
