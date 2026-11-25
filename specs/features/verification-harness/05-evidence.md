# Stage A Verification & Proof Summary: verification-harness

> **Note (`ADR-0011` Boundary Disclosure)**: Because this clean nested Multica checkout has no live workspace `.loopx/registry.json` or TTY-authorized `verification-harness-goal`, `loopx-flow check` / `ingest-to-loopx-quality.js` was not invoked here (preventing unapproved Goal/Registry writes). Per `ADR-0011`, this file records actual Stage A local gate & cold-start Prove exit codes without fabricating a `change_quality_receipt_v2` signature.

- **Goal ID**: `verification-harness-goal`
- **Feature**: `verification-harness` (`#43` / `TRE-91`)
- **Linked ADR / REQ**: `ADR-0011`, `REQ-EVIDENCE-1`, `ADR-0007`, `ADR-0014`
- **Cold-Start Proof Artifacts**:
  - [`proofs/cli-surface-proof.json`](proofs/cli-surface-proof.json) (`loopx_verification_harness_proof_v1`)
  - [`proofs/cli-surface-proof.md`](proofs/cli-surface-proof.md)
  - 已提交的两份 Proof 是**宿主机环境（装有 `loopx 2.3.0`）**的产物；最小 CI runner 无 `loopx`，同一脚本产出 `overall_status: partial`（4 步 `passed` + 1 步 `verified_unreachable` + `harness_gap=1`），二者都是合法结果，测试按 `steps` 派生期望而不是写死 `passed`。

## Local Gates & Cold-Start Prove Matrix

| Evidence Ref | Type | REQ / ADR | Story / AC | Oracle Command | Real-vs-Mock | Status |
|---|---|---|---|---|---|---|
| `ADR-0011/gate/typecheck` | Gate | `ADR-0011` | `Story-3 / AC-4` | `npm run typecheck` | `real` | `passed` (exit `0`) |
| `ADR-0011/gate/lint` | Gate | `ADR-0011`, `ADR-0014` | `Story-3 / AC-4` | `npm run lint` | `real` | `passed` (exit `0`, 5/5 checks) |
| `ADR-0011/gate/build` | Gate | `ADR-0011` | `Story-3 / AC-4` | `npm run build` | `real` | `passed` (exit `0`) |
| `ADR-0011/gate/test` | Gate | `ADR-0011` | `Story-1..3 / AC-1..4` | `npm run test` | `real` | `passed` (exit `0`, 314/314 on PR branch — host and minimal CI runner) |
| `REQ-EVIDENCE-1/Story-3/AC-3/prove-cli-surface` | Surface Proof | `REQ-EVIDENCE-1`, `ADR-0011` | `Story-3 / AC-3` | `LC_ALL=en_US.UTF-8 node skills/verification-harness/scripts/prove-cli-surface.js --output-dir specs/features/verification-harness/proofs` | `real` (2/5 steps: `cli-help-surface`, `cli-todo-managed-canary`) + `real+contract_fake` (3/5 steps: `cli-init-and-subdir-anchor`, `cli-feature-and-gate1-negative`, `cli-gate1-approve-and-tamper-detect`) | `passed` — host with `loopx 2.3.0`: exit `0`, `overall_status: passed`, 5/5 steps；minimal CI (no `loopx`): exit `0`, `overall_status: partial`, 4/5 steps + `cli-todo-managed-canary: verified_unreachable`, `harness_gap=1`。两者均 sandbox removed、caller repo + host zero residue |
| `REQ-EVIDENCE-1/Story-3/AC-4/prove-binding` | Surface Proof Binding | `ADR-0011`, `ADR-0014` | `Story-3 / AC-4` | `node --test --test-name-pattern='Missing loopx\|Dirty source' tests/unit/verification-harness.test.js` | `real` (child-process prove runs + fail-closed negatives) | `passed` (Proof carries `source_head` / `source_dirty` / `diff_fingerprint` / `contract_revision`; missing `loopx 2.3.x` → `overall_status: partial`; dirty workspace → exit non-zero, no Proof) |
