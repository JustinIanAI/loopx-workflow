# Review Pipeline Throttle 契约（阶段 4 · 断点 1）

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-11-05 14:39:52

## 目标

降低 `loopx pr-review` 评审管线在同一 PR / 同一 head 上重复消耗 GitHub API 的频次，
消除「push → 评审 → 评论 → 重 push → 再评审」正反馈循环对账号 rate-limit / abuse 阈值的冲击。

三项承重改动：

1. **head-oid 幂等**：先以 1 次 `gh pr view` 取当前 head；若 `.loopx/reviews/<pr>@<当前head>.json`
   存在且 `native_check.ok === true`，则复用该 artifact 并短路到发布阶段，
   **不再取 `gh pr diff`、不再跑 `loopx pr-review` 模型执行、不再堆叠新评论**。
   只认同 head：**跨 head 绝不复用**（否则会把旧 head 的结论当作新 head 发布，属 fail-open）。
   该路径仅在编排器显式开启 `REVIEW_SHORTCIRCUIT=1` 时生效（避免本地残留 artifact 误触发、
   保持默认行为与改造前完全一致），`--force-recheck` 始终强制绕过。

2. **comment upsert**：发布评审报告时，先通过 `gh api` 按唯一标记行检索本管线已发布的 comment；
   命中则 `PATCH`（edit）该 comment，未命中才 `POST`（新增）comment。
   标记行格式：`<!-- loopx-flow:review:<pr>@<headOid> -->`，置于正文**尾部**（HTML 注释，页面不可见），
   避免破坏正文首行结构与既有断言。幂等复用路径始终走 upsert；完整管线发布受
   `REVIEW_UPSERT_PUBLISH=1` 控制（默认关闭 → 与改造前一致的 `gh pr comment`）。
   `loopx-flow respond` 侧同理，标记行 `<!-- loopx-flow:respond:<pr>@<shortSha> -->`。

3. **客户端节流**：同一 PR 的完整管线执行间隔不足 `REVIEW_DEBOUNCE_SECONDS`（默认 60s）时，
   **有界等待**（最多 debounce 秒）合并突发，而不是拒绝执行——避免 push→评审热循环打爆限流；
   `gh api` 收到 429/503 时按 `Retry-After` 指数退避（上限 120s），最多 `REVIEW_MAX_RETRIES`（默认 3）次重试。

## TypeScript 契约（签名冻结）

```ts
interface ReviewThrottleConfig {
  shortCircuit: boolean;         // REVIEW_SHORTCIRCUIT=1，默认 false
  debounceSeconds: number;       // REVIEW_DEBOUNCE_SECONDS，默认 60
  maxRetries: number;            // REVIEW_MAX_RETRIES，默认 3
  backoffBaseMs: number;         // REVIEW_BACKOFF_BASE_MS，默认 1000
}

interface ReviewArtifactRef {
  pr: number;
  headOid: string;               // 小写完整 40 字符
  artifactPath: string;          // .loopx/reviews/<pr>@<head>.json
}

declare function loadReviewArtifact(pr: number, headOid: string): ReviewArtifact | null;
  // 仅 schema_version === 'loopx_flow_review_artifact_v0' 且 native_check.ok === true 时返回

declare function listReviewArtifactsForPr(pr: number): ReviewArtifact[];
  // 仅供节流计算上次完整执行时间；禁止用于跨 head 复用

declare function throttleRemainingMs(pr: number): number;
  // 距上次完整执行还需等待的毫秒数；窗口外/无记录/禁用时返回 0

declare function publishReviewCommentUpsert(opts: {
  repo: string;
  pr: number;
  headOid: string;
  body: string;
  useUpsert: boolean;            // false → 直接 gh pr comment（改造前行为）
}): { mode: 'updated' | 'created'; commentId: number | null };

declare function ghApiWithBackoff(apiArgs: string[], opts?: { repo?: string }):
  { ok: boolean; out: string };  // 429/503 指数退避；非重试类错误立即返回 ok:false

declare function sleepSync(ms: number): void;
```

## 不变量

- INV-T1: 短路复用不得改变最终发布结果——同一 head 无论跑 1 次还是 N 次，发布的 comment 正文一致。
- INV-T2: upsert 标记行必须包含 `pr@headOid`，保证 head 漂移后旧 comment 不匹配、新 comment 被创建。
- INV-T3: 节流与退避失败时一律 fail-closed（非零退出），不静默吞掉。

## 验收

- T1：同一 head 连续执行 2 次 → 第 2 次仅 1 次 `gh pr view`，`gh pr diff` / 模型执行次数不增加，
  发布走 upsert（`updated` 或 `created`，不新增堆叠 comment）。
- T1b：head 已漂移时**不得**命中幂等，必须重新执行评审。
- T2：`REVIEW_UPSERT_PUBLISH=1` 下无标记 → `POST`；有标记 → `PATCH`，且不再 `gh pr comment`。
- T3：同 PR 上次完整执行 < debounce 且 head 已漂移 → 有界等待后再执行；debounce=0 → 不等待。
- T3b：`gh api` 首次 429 → 退避重试后成功，不中断发布。
- 既有 `authentic-review-pipeline.test.js` 26/26 全绿不回归；`npm run test` 96/96 全绿。
