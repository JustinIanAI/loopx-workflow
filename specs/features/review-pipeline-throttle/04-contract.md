# Review Pipeline Throttle 契约（阶段 4 · 断点 1）

Contract-Status: DRAFT → PENDING-APPROVAL (check 门禁实测已全绿；收据回写受 LoopX 控制面锁环境阻断，见 05-evidence.md)

## 目标

降低 `loopx pr-review` 评审管线在同一 PR / 同一 head 上重复消耗 GitHub API 的频次，
消除「push → 评审 → 评论 → 重 push → 再评审」正反馈循环对账号 rate-limit / abuse 阈值的冲击。

三项承重改动：

1. **head-oid 幂等**：同一 `pr@head_oid` 若已存在有效评审 artifact（`.loopx/reviews/<pr>@<head>.json`）
   且其 `native_check.ok === true`，则 `authentic-review.js` 直接复用既有 artifact 并短路到发布阶段，
   不再重跑 `gh pr view` / `gh pr diff` / `loopx pr-review` 模型执行。
   **短路仅在编排器显式开启 `REVIEW_SHORTCIRCUIT=1` 时生效**（避免本地残留 artifact 误触发、保持默认行为不变），
   `--force-recheck` 始终强制绕过。

2. **comment upsert**：发布评审报告时，先通过 `gh api` 按唯一标记行检索本管线已发布的 comment；
   命中则 `PATCH`（edit）该 comment，未命中才 `POST`（新增）comment。
   标记行格式：`<!-- loopx-flow:review:<pr>@<headOid> -->`，置于报告正文首行（HTML 注释，页面不可见）。
   该路径**始终生效**（不受短路开关影响）：短路发布与完整管线发布共用同一 upsert 逻辑。

3. **客户端节流**：管线进程级限流——同一 `pr@head` 两次完整执行间隔不足
   `REVIEW_DEBOUNCE_SECONDS`（默认 60s）时，短路路径直接复用第一次的 artifact；
   `gh api` 调用收到 429/503 时按 `Retry-After` 指数退避（上限 120s），最多 3 次重试。

## TypeScript 契约（签名冻结）

```ts
interface ReviewThrottleConfig {
  shortCircuit: boolean;         // 短路开关（REVIEW_SHORTCIRCUIT=1），默认 false
  debounceSeconds: number;       // 默认 60（短路窗口）
  maxRetries: number;            // 429/503 退避次数，默认 3
  backoffBaseMs: number;        // 默认 1000
}

interface ReviewArtifactRef {
  pr: number;
  headOid: string;               // 小写完整 40 字符
  artifactPath: string;          // .loopx/reviews/<pr>@<head>.json
}

declare function headIdempotentShortCircuit(pr: number):
  ReviewArtifact | null;   // 最近一次 native_check.ok 的 artifact；短路仅在 config.shortCircuit 时生效

declare function withinDebounceWindow(artifact: ReviewArtifact, cfg: ReviewThrottleConfig):
  boolean;                  // reviewed_at 距 now < debounceSeconds 且在 shortCircuit 开启时

declare function publishReviewCommentUpsert(opts: {
  repo: string;
  pr: number;
  headOid: string;
  body: string;                  // 已含标记行
}): Promise<{ mode: 'updated' | 'created'; commentId: number | null }>;  // 短路/完整管线共用，始终生效

declare function ghApiWithBackoff(path: string, opts: {
  method?: 'GET' | 'PATCH';
  retries?: number;
}): Promise<unknown>;
```

## 不变量

- INV-T1: 短路复用不得改变最终发布结果——同一 head 无论跑 1 次还是 N 次，发布的 comment 正文一致。
- INV-T2: upsert 标记行必须包含 `pr@headOid`，保证 head 漂移后旧 comment 不匹配、新 comment 被创建。
- INV-T3: 节流与退避失败时一律 fail-closed（非零退出），不静默吞掉。

## 验收

- 单测：同一 head 连续执行 2 次，第二次走短路且 `gh pr view/diff/loopx pr-review` 调用次数为 0；
  comment 第二次为 `updated` 模式。
- 既有 `authentic-review-pipeline.test.js` 全绿不回归。
