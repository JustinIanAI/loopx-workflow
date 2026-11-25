# LoopX-Workflow Verification Map

This directory is the maintained source for driving and proving the real user-facing surfaces of `loopx-workflow`. Read this index first, then follow the matching feature file as an executable cold-start recipe.

## Baseline Preconditions

- Repository dependencies are installed (`npm ci`) and `./scripts/preflight-check.sh` passes from the repository root.
- Every verification drive allocates its disposable workspace through `lib/paths.js` under `LOOPX_TMP_DIR` (default `<REPO_ROOT>/.loopx/tmp/`), overriding `HOME`, `LOOPX_TMP_DIR`, and `LOOPX_REGISTRY` so concurrent runs never touch the main checkout's `.loopx/registry.json` or host `~/.loopx/registry.global.json`.
- Proof artifacts are written to an explicit `--output-dir` outside the disposable sandbox (for example `specs/features/<feature>/proofs/`) and verified to survive sandbox cleanup.
- Each feature file uses the exact Pstack 4-H2 layout in order:
  1. `Sub-features`
  2. `How to get to it (user POV)`
  3. `Driving it with <harness>`
  4. `Gotchas`

## Features

- [CLI Surface (`bin/loopx-flow`)](./cli-surface.md) covers help/usage discovery, `init` + nested subdirectory root anchoring, `feature` capsule scaffolding + Gate 1 fail-closed negative guards, `approve contract` (`independent` mode) + SHA-256 tamper detection, and real `loopx 2.3.x` managed `todo claim` / `todo done` execution in an isolated registry.
