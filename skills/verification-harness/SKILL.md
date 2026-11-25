---
name: verification-harness
description: "Drive and maintain real product surfaces (CLI, scripts, quality adapters) for loopx-workflow and downstream repos using Pstack's 5-dimension verification model (Surface / Run / Drive / Observe / Isolate), 4-H2 Feature Maps, and cold-start Proof artifacts. Adapted from pstack@0.15.46 (MIT License, Copyright (c) 2026 Lauren Tan) and aligned with ADR-0011 Real-vs-Mock & Freshness contracts."
---

# Verification Harness (LoopX-Workflow Real-Surface Verification & Maintenance)

> **Upstream Provenance & License**: Adapted from [`pstack@0.15.46`](https://github.com/cursor/plugins/tree/fbb86c09bbb4a25e490aaed136899ced1e9140e4/pstack) (`create-verification-skill`, `maintain-verification-skill`, `principle-prove-it-works`), MIT License, Copyright (c) 2026 Lauren Tan. Verbatim R0 upstream files are preserved in [`upstream/pstack-r0/`](upstream/pstack-r0/) alongside [`LICENSE`](LICENSE). See [`references/loopx-adaptation.md`](references/loopx-adaptation.md) for the exact LoopX-Workflow adaptation and [`ADR-0011`](../../docs/adr/0011-evidence-traceability-and-quality.md) alignment.

Unit tests that call internal helpers or over-mocked stubs can stay 100% green while real CLI entry points break on `argv` splitting, `CWD` drift, `ARG_MAX` limits, or `/tmp` artifact leaks. This skill enforces **real-surface verification** across **Design (Stage 4)**, **Execution (Stage 5~6)**, and **Maintenance (Stage 5~7)** without creating a parallel authority ledger or bypassing Gate 1 / Gate 2 human checkpoints.

## Launch

`loopx-workflow` is a short-lived CLI orchestrator (`bin/loopx-flow`, `scripts/*.sh`, and `skills/code-review/scripts/*.js`) rather than a long-running daemon. There is no persistent server to keep alive:

1. **Install / verify dependencies once** at the repository root:
   ```bash
   npm ci
   ./scripts/preflight-check.sh
   ```
2. **Per-drive disposable workspace**: Start each verification drive inside an isolated temporary directory allocated via `lib/paths.js#createRunDir('prove-cli-surface')` (which anchors under `LOOPX_TMP_DIR` or `<REPO_ROOT>/.loopx/tmp/`).
3. **Isolated control-plane state**: Initialize a disposable Git worktree/repo with explicit `HOME`, `LOOPX_TMP_DIR`, `LOOPX_REGISTRY`, and (when driving real `loopx`) `--runtime-root` inside the sandbox directory. Ready means `git rev-parse --is-inside-work-tree` returns `true` and `bin/loopx-flow --help` exits `0`.

## Doctor

Before driving any mapped feature — and immediately after any unexpected failure — run the read-only health check:

```bash
LC_ALL=en_US.UTF-8 ./scripts/preflight-check.sh
```

What Doctor confirms before a drive is trusted:
- `git`, `gh`, `node` (`>= 22.22.3`), and `npm` are reachable on `PATH`.
- Four Gate scripts (`typecheck`, `lint`, `build`, `test`) and `bin/loopx-flow` are executable and syntactically intact.
- When `loopx` (`2.3.x`) is installed locally, required skills, routes, and TypeScript control-plane runtime report ready. If `loopx` is absent (for example on minimal CI runners), real-`loopx` canary steps record `verified_unreachable` with the exact missing binary prerequisite rather than faking `passed`.

## Drive

Drive the **actual user-facing CLI entry points** as child processes (`spawnSync` / subshell) rather than importing private internal functions:

- **Primary CLI surface**: `bin/loopx-flow <subcommand> [flags]` invoked both from repository root and from nested subdirectories (`subdir/nested`) to verify dual-root path anchoring (`WORKFLOW_ROOT` vs `REPO_ROOT`).
- **Bootstrap & Sentinel scripts**: `scripts/preflight-check.sh`, `scripts/workflow-init.sh`, `scripts/gate-lint.sh`.
- **Boundary isolation rule**:
  - Local `bin/loopx-flow` and `lib/paths.*` **always run for real** (`Real-vs-Mock = real` or `real+contract_fake`).
  - Local `loopx` runs **for real** against an isolated `--registry` + `--runtime-root` whenever `loopx 2.3.x` is installed (`Real-vs-Mock = real`).
  - External network boundaries (`gh` GitHub API) or negative missing-capability fault injections use **Contract Fake CLIs** placed ahead on `PATH` that strictly record and validate exact `argv` arrays and `stdin` payloads (`Real-vs-Mock = real+contract_fake`).

Consult [`features/README.md`](features/README.md) and [`features/cli-surface.md`](features/cli-surface.md) for exact user-POV journeys and sub-feature recipes.

## Evidence

Every Prove run must capture observable action + resulting state + side-effect verification — never exit code `0` alone:

1. **Where Proof artifacts live**:
   - Feature Capsule delivery Proof: `specs/features/<feature>/proofs/cli-surface-proof.json` and `specs/features/<feature>/proofs/cli-surface-proof.md` (committed as auditable slice evidence, referenced from `05-evidence.md`).
   - Ad-hoc / unit-test verification Proof: caller-supplied `--output-dir <dir>` outside the disposable drive sandbox so Proof survives teardown.
2. **Required observations per step**:
   - Process exit status, `stdout` / `stderr` diagnostic cards (especially `[FAIL-CLOSED]` reasons on negative invariants).
   - File-system and Git side effects (`00-INDEX.md` ~ `05-evidence.md` creation, `04-contract.md` SHA-256 lock vs tamper rejection, `.loopx/tmp/claims/<gid>--<tid>.json` 5-tuple receipt creation & atomic removal).
   - Cross-process `argv` audit logs when crossing external CLI boundaries.
3. **ADR-0011 alignment**:
   - Proof artifacts feed `05-evidence.md` (`Oracle`, `Real-vs-Mock`, `Status`) and `change-quality` receipts; they **never** replace `loopx change-quality` judgment and **never** auto-approve Gate 1 or Gate 2.

## Cleanup

Teardown removes every temporary Git repo, mock binary directory, isolated `LOOPX_REGISTRY`, and isolated `--runtime-root` created during the run:

- All scratch state is allocated via `lib/paths.js#createRunDir('prove-cli-surface')` under `LOOPX_TMP_DIR` (never hardcoded `/tmp/<fixed>` or bare `os.tmpdir()`).
- Cleanup executes unconditionally in `try ... finally` (and `SIGINT` / `SIGTERM` hooks from `lib/paths.js`), even when an assertion fails mid-drive.
- Never kill processes by executable name; only clean up handles owned by the current run.
- **Post-cleanup survival & zero-residue check**: After removing the sandbox directory, explicitly verify:
  1. `sandbox_removed === true` (`!fs.existsSync(sandboxDir)`),
  2. `proof_survived_cleanup === true` (`fs.existsSync(proofJsonPath) && fs.existsSync(proofMdPath)`),
  3. Main checkout `.loopx/registry.json` and host `~/.loopx/registry.global.json` digests are byte-for-byte unchanged.

## Helpers

Executable cold-start Prove runner shipped with this skill:

```bash
# Run cold-start CLI surface Prove and write durable Proof JSON + Markdown report:
LC_ALL=en_US.UTF-8 node skills/verification-harness/scripts/prove-cli-surface.js \
  --output-dir specs/features/<feature>/proofs

# Inspect options:
node skills/verification-harness/scripts/prove-cli-surface.js --help
```

## Maintenance Loop (`Doc Drift` / `Harness Gap` / `Product Bug`)

Whenever `bin/loopx-flow` commands/flags change (Trigger 1), cross-process CLI invocations change (Trigger 2), or an Issue is fixed via Pipeline B (Trigger 3), run a maintenance pass modeled on [`upstream/pstack-r0/maintain-verification-skill/SKILL.md`](upstream/pstack-r0/maintain-verification-skill/SKILL.md):

1. Compare `features/cli-surface.md` against current source (`bin/loopx-flow`, `scripts/*.sh`, `lib/*.js`) and execute a live cold-start pass via `prove-cli-surface.js`.
2. Classify every discrepancy into exactly one of three buckets (see [`references/loopx-adaptation.md`](references/loopx-adaptation.md)):
   - **`Doc Drift`**: Feature map or skill text describes outdated flags, outputs, or preconditions while product behavior is intentional ➔ update `features/*.md` or `SKILL.md` within `skills/verification-harness/` and re-prove.
   - **`Harness Gap`**: Product behavior works, but `prove-cli-surface.js` or Contract Fake CLI cannot drive/observe it ➔ update the harness script within `skills/verification-harness/scripts/` and re-prove live.
   - **`Product Bug`**: Real CLI violates its frozen contract or Fail-Closed invariant ➔ **do not paper over it in docs or harness**; record the reproducible failure and route through Pipeline A/B with a failing unit test first.
