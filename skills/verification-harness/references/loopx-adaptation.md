# Pstack Verification Skill -> LoopX-Workflow Adaptation Guide

> **Source Attribution**: Derived from [`pstack@0.15.46`](https://github.com/cursor/plugins/tree/fbb86c09bbb4a25e490aaed136899ced1e9140e4/pstack) (`MIT License`, Copyright (c) 2026 Lauren Tan; verbatim R0 copies in [`../upstream/pstack-r0/`](../upstream/pstack-r0/)). Aligned with [`ADR-0007`](../../../docs/adr/0007-environment-governance.md), [`ADR-0008`](../../../docs/adr/0008-application-orchestration-layer.md), [`ADR-0011`](../../../docs/adr/0011-evidence-traceability-and-quality.md), and [`ADR-0014`](../../../docs/adr/0014-temp-artifact-path-remediation-and-history-sanitization.md).

---

## 1. Why Adaptation Is Needed

Upstream Pstack (`create-verification-skill` and `maintain-verification-skill`) targets interactive Cursor sessions generating `.cursor/skills/verify-<app>/` and using `/tmp/<app>-verify-$RUN_ID` scratch directories. Direct, unmodified execution inside `loopx-workflow` would conflict with four repository invariants:

1. **Gitignore & Tracked Asset Boundary**: `.cursor/` is gitignored in `loopx-workflow` (Issue `#21` / W1); repository-shared workflow skills live in `skills/<skill-name>/`.
2. **Temp Sandbox Hygiene (`ADR-0007` / `ADR-0014` / `gate-lint.sh`)**: Production scripts under `skills/` are forbidden from hardcoding `/tmp/...`, calling `os.tmpdir()` directly, or invoking bare `mktemp`. All disposable workspaces must allocate through `lib/paths.js` (`LOOPX_TMP_DIR` / `<REPO_ROOT>/.loopx/tmp/`).
3. **Single Control-Plane Authority (`ADR-0008`)**: Verification proofs are **evidence inputs** into `05-evidence.md` and LoopX `change-quality`, never a second task ledger or an automated substitute for Gate 1 (`approve contract`) or Gate 2 (`release-approve` / human PR approval).
4. **Evidence Schema & Six-State Mapping (`ADR-0011`)**: `05-evidence.md` requires explicit `Oracle`, `Scope`, `Real-vs-Mock` (`real` vs `mock`), and `Freshness` tied to `scope_fingerprint` / `headRefOid` / `contract_revision`.

---

## 2. Five-Dimension Model Mapping (`Surface / Run / Drive / Observe / Isolate`)

| Dimension | Upstream Pstack Question | LoopX-Workflow Instantiation | Contract (`04-contract.md`) & Evidence (`05-evidence.md`) Anchor |
|---|---|---|---|
| **1. Surface** | What does a user actually touch? | Primary: `bin/loopx-flow <subcmd>` (from repo root, nested subdirectories, linked worktrees, and non-TTY pipes). Secondary: `scripts/preflight-check.sh`, `scripts/workflow-init.sh`, `scripts/gate-lint.sh`, and `skills/code-review/scripts/*.js`. | `04-contract.md` `Verification Plan` names the exact CLI/script surface; internal helper calls cannot claim `real`. |
| **2. Run** | How does the app start locally from an empty state? | Short-lived CLI model: dependencies installed once (`npm ci`), then each scenario runs against a fresh disposable Git repository + isolated `.loopx/` config initialized from scratch. | `05-evidence.md` `Oracle` column records the exact reproducible command line. |
| **3. Drive** | How does an agent interact with it programmatically? | `child_process.spawnSync` executing `bin/loopx-flow` with controlled `cwd`, `env`, and `stdin`. Real `loopx 2.3.x` CLI drives managed `todo claim/done` against isolated `--registry`/`--runtime-root`; Contract Fake `gh`/`loopx` stubs isolate network & fault-injection edges. | `Real-vs-Mock` marks `real` for real binary execution, `real+contract_fake` in Proof details (mapped to `real` CLI entry or `mock` unit stub per `ADR-0011` scope). |
| **4. Observe** | What external artifacts and state transitions prove it worked? | Exit status + `[FAIL-CLOSED]` stderr diagnostics + Git branch/status + Feature Capsule files + SHA-256 contract lock / tamper rejection + `$LOOPX_TMP_DIR/claims/<gid>--<tid>.json` 5-tuple receipt + Fake CLI `argv` logs. | Every AC binds at least one state/artifact observation beyond `exitCode === 0`, plus a negative Fail-Closed invariant check. |
| **5. Isolate** | Can concurrent runs execute side-by-side without corrupting host or user state? | `lib/paths.js#createRunDir` creates unique PID/random directories under `LOOPX_TMP_DIR`; overrides `HOME`, `LOOPX_REGISTRY`, `LOOPX_TMP_DIR`, and `--runtime-root`. Proof output is written outside the sandbox so teardown deletes 100% of runtime scratch while preserving Proof files. | Verified before/after digest equality on `<REPO_ROOT>/.loopx/registry.json` and `~/.loopx/registry.global.json`. |

---

## 3. Pipeline Stage Integration (Stages 4, 5, 6, 7)

### Stage 4 — Contract Verification Plan (`Create / Align`)
Before requesting Gate 1 (`loopx-flow approve contract <feature>`):
- Ensure `04-contract.md` specifies `Surface`, `Run / Drive`, `Observe`, `Negative Invariant (Fail-Closed)`, and `Real-vs-Mock` for each story/AC.
- If a new user-facing command or script is introduced, add or update its entry under `skills/verification-harness/features/`.

### Stage 5 & 6 — Implementation, Cold-Start Prove & Receipt Ingestion (`Prove & Bind`)
1. Run maintenance triggers against `git diff origin/main...HEAD`:
   - **Trigger 1 (`CLI Surface Change`)**: Added/changed `bin/loopx-flow` subcommand or flag ➔ update `features/cli-surface.md` and `usage()` parity checks.
   - **Trigger 2 (`Cross-Process Boundary Change`)**: Modified `spawnSync`/`execFileSync` calls to `loopx`, `gh`, `git`, `codex`, or `claude` ➔ verify exact `argv` token splitting and `stdin` piping.
   - **Trigger 3 (`Pipeline B Bug Fix`)**: Fixed a production bug ➔ encode its root-cause invariant into `gate-lint.sh` or `tests/unit/` + Feature Map `Gotchas`.
2. Execute cold-start Prove (`node skills/verification-harness/scripts/prove-cli-surface.js --output-dir specs/features/<feature>/proofs`) and confirm Proof survives sandbox teardown.
3. Feed gate exit codes and Proof references into `loopx-flow check` / `ingest-to-loopx-quality.js` to populate `05-evidence.md` and LoopX `change-quality` receipts.

### Stage 7 — Maintenance & Review Audit (`Triage`)
During independent review or periodic harness upkeep, classify every observed discrepancy into three strict categories:

> Automated scope note: the `prove-cli-surface.js` runner only auto-populates `triage.harness_gap` (from `verified_unreachable` steps). `Doc Drift` and `Product Bug` are human-reviewed classification slots — when either is hit mid-pass, the runner's assertion throws and Prove fails closed (exit `1`) without emitting a Proof.

| Triage Category | Definition | Allowed Action & Edit Scope | LoopX Status / Gate Impact |
|---|---|---|---|
| **`Doc Drift`** | Product CLI behaves intentionally per PRD/ADR, but `SKILL.md` or `features/*.md` has stale flags, paths, or missing preconditions. | Edit `skills/verification-harness/` markdown files only; re-run live Prove to confirm `clean`/`changed`. | Non-blocking once map is updated and re-proved. |
| **`Harness Gap`** | Product CLI works per contract, but `prove-cli-surface.js` or Contract Fake CLI lacks coverage or mis-observes output. | Edit `skills/verification-harness/scripts/` (keeping executable bit & hygiene compliance); re-drive live before shipping. | Must re-prove `passed` before marking verification complete. |
| **`Product Bug`** | Product CLI violates frozen contract, corrupts state, leaks temp files, or fails open on invalid input. | **Never hide in `Gotchas` or weaken assertions.** Report failure (`failed`) and fix via TDD (`test-driven-development` / `systematic-debugging`) in product scope. | Blocks delivery (`check` / Gate 2 fail-closed) until fixed and re-proved. |

---

## 4. Explicit Non-Goals (Guardrails Against Scope Creep)

- **No Second State Store**: Proof JSON/Markdown files are immutable verification evidence snapshots, never an execution queue or Todo authority.
- **No Gate Bypass**: Passing `prove-cli-surface.js` never grants Gate 1 (`Contract-Status: FROZEN & APPROVED`) or Gate 2 merge readiness.
- **No Upstream R0 Tampering**: Files under `skills/verification-harness/upstream/pstack-r0/` and `skills/verification-harness/LICENSE` remain byte-for-byte identical to `pstack@0.15.46` (`cursor/plugins@fbb86c09bbb4a25e490aaed136899ced1e9140e4`), enforced by SHA-256 unit test assertions.
