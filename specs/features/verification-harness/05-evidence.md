# Stage A Verification & Proof Summary: verification-harness

> **Note (`ADR-0011` Boundary Disclosure)**: `loopx-flow check` / `ingest-to-loopx-quality.js` was **attempted** at this PR's final source-scope head and failed closed (exit `1`) before any receipt could be produced — this isolated checkout has no bootstrapped `verification-harness-goal` registry, and Gate 1 (`04-contract.md`) is still `DRAFT (Pending Approval)`. Per `ADR-0011`, this file records the actual command, exit code, and stderr verbatim below, and does **not** fabricate a `change_quality_receipt_v2` signature.

- **Goal ID**: `verification-harness-goal`
- **Feature**: `verification-harness` (`#43` / `TRE-91`)
- **Linked ADR / REQ**: `ADR-0011`, `REQ-EVIDENCE-1`, `ADR-0007`, `ADR-0014`
- **Cold-Start Proof Artifacts**:
  - [`proofs/cli-surface-proof.json`](proofs/cli-surface-proof.json) (`loopx_verification_harness_proof_v1`)
  - [`proofs/cli-surface-proof.md`](proofs/cli-surface-proof.md)
  - Regenerated at the final Stage A-R5 source-scope head; the committed Proof is byte-consistent with a fresh `git rev-list` / `git diff` recomputation on `HEAD` (see freshness guard).

## Freshness invariant (`ADR-0011` decision 5)

The Proof is a projection of the source; its own artifacts must never participate in their own binding, otherwise committing a freshly generated Proof would always invalidate the one already committed. Therefore (B1, content-addressed, aligned to `ADR-0011` decision 5's `scope_fingerprint`):

- `scope_fingerprint` = SHA-256 of `git diff --no-color --binary <empty-tree>..HEAD` computed with the pathspec
  `-- . ':(exclude)specs/features/verification-harness/proofs'`. The **empty tree** is a fixed, content-addressed
  baseline, so the fingerprint depends only on the current source-scope **content (tree)** — never on `HEAD`'s commit
  SHA, commit history, or the moving `origin/main` ref.

Committing a regenerated Proof only touches the proof artifacts directory and therefore never changes the fingerprint, so the freshness guard (`tests/unit/verification-harness.test.js` test 7) recomputes the exact same value from `HEAD`. **Squash/merge stability (B1)**: merging the PR into `main` produces a NEW commit with the SAME source-scope tree, so `scope_fingerprint` is unchanged and test 7 does **not** false-positive (previously the commit-SHA / merge-base binding reddened `main`'s CI immediately after merge). Mutation verification: swapping the committed `scope_fingerprint` to a stale value reddens test 7 with the expected-vs-actual mismatch; restoring the committed value greens the guard. A dedicated squash/merge regression (`test 9`) simulates `git commit-tree` (same tree, new commit SHA) and asserts the fingerprint is byte-stable.

### 已知限制 (Known Limitations)

- **内容寻址（B1）**：`scope_fingerprint` 使用空树基线，与 `origin/main` 无关，故**无 `origin/main` 的浅检出**与完整检出得到相同 fingerprint，test 7 的独立 Oracle 在任意完整 git 树上均可复算（不再存在浅检出口径分叉）。
- **工作区解耦（P5）**：当 `specs/features/verification-harness/proofs/` **以外**存在未跟踪/已修改的本地草稿时，驱动 Prove 的 test 3 / 4 / 5 / 7 / 8 一致地明确 `skip`（附原因），整包 `npm run test` 仍 exit 0；当脏改动位于 Proof 目录**内**时，test 3 / 7 **照常执行** freshness 评估，绝不 skip，避免已提交 Proof 被篡改后静默跳过；干净树（CI）下 9/9 全量执行、0 skip。
- **Triage 真实语义（N2）**：`prove-cli-surface.js` 的每一步只会产出 `passed` 或 `verified_unreachable`；Doc Drift / Product Bug 一旦在 pass 中被观察到，断言即抛出并使 Prove fail-closed（exit 1）**不写 Proof**。因此自动 Proof 中 `overall_status` 只会是 `passed` / `partial`，`triage.outcome` 只会是 `clean` / `changed`，`triage.doc_drift` / `triage.product_bug` 恒为 `[]`（人工三分类登记槽）。
- **`approve contract` golden 字节耦合（N3）**：step 4 的 `GOLDEN_LOCKED_CONTRACT_TEXT` / `GOLDEN_LOCKED_CONTRACT_SHA256` 把 `approve contract` 的落盘字节格式耦合进 harness。若产品侧**合法变更**该输出格式，step 4 会以 `independent Oracle mismatch` 整体 fail-closed（exit 1）且不产出 Proof —— 此时需同步更新 golden 常量后再复证。这是保留独立 Oracle（不自证）的必要代价，刻意不降级为语义校验以免放宽 fail-closed。

## Local Gates & Cold-Start Prove Matrix

| Evidence Ref | Type | REQ / ADR | Story / AC | Oracle Command | Real-vs-Mock | Status |
|---|---|---|---|---|---|---|
| `ADR-0011/gate/typecheck` | Gate | `ADR-0011` | `Story-3 / AC-4` | `npm run typecheck` | `real` | `passed` (exit `0`) — `en_US.UTF-8` & `C.UTF-8` |
| `ADR-0011/gate/lint` | Gate | `ADR-0011`, `ADR-0014` | `Story-3 / AC-4` | `npm run lint` | `real` | `passed` (exit `0`, 5/5 checks) — `en_US.UTF-8` & `C.UTF-8` |
| `ADR-0011/gate/build` | Gate | `ADR-0011` | `Story-3 / AC-4` | `npm run build` | `real` | `passed` (exit `0`) — `en_US.UTF-8` & `C.UTF-8` |
| `ADR-0011/gate/test` | Gate | `ADR-0011` | `Story-1..3 / AC-1..4` | `npm run test` | `real` | `en_US.UTF-8`: `passed` (exit `0`, **317/317**)；`C.UTF-8`: **309/317** — 8 pre-existing Gate1/auth locale failures identical to the `e17200a` baseline (baseline = 308 tests / 8 same failures; +9 = the verification-harness suite) |
| `REQ-EVIDENCE-1/Story-3/AC-3/prove-cli-surface` | Surface Proof | `REQ-EVIDENCE-1`, `ADR-0011` | `Story-3 / AC-3` | `LC_ALL=en_US.UTF-8 node skills/verification-harness/scripts/prove-cli-surface.js --output-dir specs/features/verification-harness/proofs` | `real` (2/5 steps) + `real+contract_fake` (3/5 steps) | `passed` — exit `0`, `overall_status: passed`, 5/5 steps on host with `loopx 2.3.0`; sandbox removed, caller repo + host zero residue |
| `REQ-EVIDENCE-1/Story-3/AC-4/prove-binding` | Surface Proof Binding | `ADR-0011`, `ADR-0014` | `Story-3 / AC-4` | `node --test tests/unit/verification-harness.test.js` | `real` | `passed` — 9/9 (binding / fail-closed negatives / loopx absent vs unsupported / freshness guard / squash-merge regression) |
| `REQ-EVIDENCE-1/Story-3/check-receipt` | Quality receipt | `ADR-0011` | `Story-3 / AC-3` | `LC_ALL=en_US.UTF-8 ./bin/loopx-flow check verification-harness` | `N/A` | `FAIL-CLOSED` (exit `1`) — no bootstrapped Goal registry + Gate 1 still `DRAFT`; stderr verbatim below; **no `change_quality_receipt_v2` forged** |

## `loopx-flow check` attempt (verbatim)

```text
$ LC_ALL=en_US.UTF-8 ./bin/loopx-flow check verification-harness
exit code: 1

stderr:
[-] [FAIL-CLOSED] 本地 LoopX registry 缺失: <checkout>/.loopx/registry.json
    修复指令: loopx bootstrap --project "<checkout>"（或通过 --registry / LOOPX_REGISTRY 显式指定）
```

Blocking reason: this isolated checkout has no bootstrapped `verification-harness-goal`, and `04-contract.md` is `DRAFT (Pending Approval)` (Gate 1 not frozen). Producing a `change_quality_receipt_v2` requires Gate 1 approval, which is outside this ticket's authorization — therefore no receipt is fabricated and none is asserted.
