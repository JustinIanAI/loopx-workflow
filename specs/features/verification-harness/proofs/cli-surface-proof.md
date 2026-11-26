# Cold-Start CLI Surface Proof (`features/cli-surface.md`)

- **Schema Version**: `loopx_verification_harness_proof_v1`
- **Feature Map**: `skills/verification-harness/features/cli-surface.md`
- **Upstream Baseline**: `cursor/plugins@fbb86c09bbb4a25e490aaed136899ced1e9140e4 (pstack@0.15.46, MIT)`
- **Source Head**: `e4fa307238b66ab89f409f65df8636a436bd9296`
- **Source Dirty**: `false`
- **Diff Fingerprint**: `53ba2c2c90af4e3d2702c6e990f950f3f7ae26533f5687f09d0e47e4bb375f4d`
- **Contract Revision**: `43c434152297966b7a91616a44d755d66f6ab66fa6cebfaf615532cfd67d8a1b`
- **Overall Status**: `passed`
- **Generated At**: `2026-11-26T07:12:15.445Z`
- **Sandbox Removed**: `true`
- **Proof Survived Cleanup**: `true`
- **Main Repo Registry Unchanged**: `true`
- **Host Global Registry Unchanged**: `true`
- **Caller Repo Git Status Unchanged**: `true`
- **Caller Repo `.loopx` Manifest Unchanged**: `true`

## Sub-feature Verification Results

| Sub-feature ID | Status | Real-vs-Mock | Command / Surface | Key State & Side-Effect Observations |
|---|---|---|---|---|
| `cli-help-surface` | `passed` | `real` | `bin/loopx-flow --help` | exit_code === 0<br>stdout contains orchestrator banner + core subcommand signatures (approve contract / gate verify / todo claim / todo done) |
| `cli-init-and-subdir-anchor` | `passed` | `real+contract_fake` | `bin/loopx-flow init + bin/loopx-flow status --next (from subdir/nested)` | non-TTY init without config rejected fail-closed (exit=1)<br>init with explicit config created repo-root .loopx tmp sandbox and .git/hooks/pre-commit (exit=0)<br>status --next from subdir/nested anchored REPO_ROOT cleanly with zero subdir/nested/.loopx leak |
| `cli-feature-and-gate1-negative` | `passed` | `real+contract_fake` | `bin/loopx-flow feature + pre-commit main guard + gate verify/approve (negative)` | pre-commit hook blocked direct main commit (exit=1)<br>switched to branch feature/demo-slice and generated all 6 capsule files<br>premature gate verify contract exited 1 and approve contract exited 1 with zero FROZEN & APPROVED leak |
| `cli-gate1-approve-and-tamper-detect` | `passed` | `real+contract_fake` | `bin/loopx-flow approve contract + gate verify contract (lock & tamper detect)` | locked bytes === golden fixture; registry contract_revision === on-disk SHA-256 c251991ee4103d85... (exit=0)<br>gate verify contract passed (exit=0) when intact and blocked with CONTRACT_TAMPERED (exit!=0) after 1-line edit<br>audited 5 cross-process gh CLI invocations |
| `cli-todo-managed-canary` | `passed` | `real` | `bin/loopx-flow todo claim + todo done (real loopx 2.3.0)` | real loopx 2.3.0 bootstrap/register-agent/todo add succeeded in isolated runtime<br>todo claim wrote 5-tuple receipt (hard_lease) and todo done completed + removed cache (exit=0) |

## Triage Summary (`Doc Drift` / `Harness Gap` / `Product Bug`)

- **Outcome**: `clean`
- **Doc Drift**: None (0)
- **Harness Gap**: None (0)
- **Product Bug**: None (0)

