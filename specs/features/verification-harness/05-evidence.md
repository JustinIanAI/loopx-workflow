# Stage A Verification & Proof Summary: verification-harness

> **Note (`ADR-0011` Boundary Disclosure)**: Because this clean nested Multica checkout has no live workspace `.loopx/registry.json` or TTY-authorized `verification-harness-goal`, `loopx-flow check` / `ingest-to-loopx-quality.js` was not invoked here (preventing unapproved Goal/Registry writes). Per `ADR-0011`, this file records actual Stage A local gate & cold-start Prove exit codes without fabricating a `change_quality_receipt_v2` signature.

- **Goal ID**: `verification-harness-goal`
- **Feature**: `verification-harness` (`#43` / `TRE-91`)
- **Linked ADR / REQ**: `ADR-0011`, `REQ-EVIDENCE-1`, `ADR-0007`, `ADR-0014`
- **Cold-Start Proof Artifacts**:
  - [`proofs/cli-surface-proof.json`](proofs/cli-surface-proof.json) (`loopx_verification_harness_proof_v1`)
  - [`proofs/cli-surface-proof.md`](proofs/cli-surface-proof.md)

## Local Gates & Cold-Start Prove Matrix

| Evidence Ref | Type | REQ / ADR | Story / AC | Oracle Command | Real-vs-Mock | Status |
|---|---|---|---|---|---|---|
| `ADR-0011/gate/typecheck` | Gate | `ADR-0011` | `Story-3 / AC-4` | `npm run typecheck` | `real` | `passed` (exit `0`) |
| `ADR-0011/gate/lint` | Gate | `ADR-0011`, `ADR-0014` | `Story-3 / AC-4` | `npm run lint` | `real` | `passed` (exit `0`, 5/5 checks) |
| `ADR-0011/gate/build` | Gate | `ADR-0011` | `Story-3 / AC-4` | `npm run build` | `real` | `passed` (exit `0`) |
| `ADR-0011/gate/test` | Gate | `ADR-0011` | `Story-1..3 / AC-1..4` | `npm run test` | `real` | `passed` (exit `0`, 312/312) |
| `REQ-EVIDENCE-1/Story-3/AC-3/prove-cli-surface` | Surface Proof | `REQ-EVIDENCE-1`, `ADR-0011` | `Story-3 / AC-3` | `LC_ALL=en_US.UTF-8 node skills/verification-harness/scripts/prove-cli-surface.js --output-dir specs/features/verification-harness/proofs` | `real` (`loopx 2.3.0` + `bin/loopx-flow`) | `passed` (exit `0`, 5/5 sub-features, sandbox removed, host zero residue) |
