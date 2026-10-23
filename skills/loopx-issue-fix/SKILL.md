---
name: loopx-issue-fix
description: GitHub Issue fix workflow manager using LoopX issue-fix capabilities. Handles feasibility triage (Fast-Path vs Standard PR), systematic 7-layer root cause diagnosis, failing repro test creation, surgical patch, regression, and closure.
---

# LoopX Issue Fix

Use this skill to resolve GitHub Issues with high precision, minimal diffs, and evidence closure.

## Workflow

### 1. Triage & Feasibility
Evaluate whether the issue qualifies for **Fast-Path** or requires **Standard PR-Path**:
```bash
loopx issue-fix feasibility \
  --repo <owner/repo> \
  --issue-ref <issue-id> \
  --reproduction-status confirmed \
  --scope-class bounded \
  --reproduction-label "Reproduction verified via isolated test case"
```

### 2. Route Execution

#### Path A: Fast-Path (Direct Fix, <=20 lines, zero API break)
Use when: Typo, docs, error log messages, isolated single-test fix, constants.
1. Apply surgical patch.
2. Run local gates: `npm run typecheck && npm run lint && npm run build && npm run test`.
3. Run code review: default `code-review` skill (optional OCR audit `./scripts/run-ocr-audit.sh` for high-risk escalation).
4. Push and settle with adaptive branch protection fallback:
   ```bash
   ./scripts/fast-fix-push.sh <ISSUE_ID> "fix(<scope>): <summary>"
   ```

#### Path B: Standard PR-Path (Complex Logic / State Bugs)
Use when: Business logic, state persistence, schema, concurrency, or >20 lines.
1. **Plan workflow**:
   ```bash
   loopx issue-fix workflow-plan --repo <owner/repo> --issue-ref <id> --base-branch main --issue-branch fix/issue-<id>
   git checkout -b fix/issue-<id>
   ```
2. **Systematic 7-Layer Root Cause Diagnosis (`systematic-debugging`)**:
   - Trace defect upward through observation altitudes:
     `L1 Symptom ➔ L2 Logic ➔ L3 System ➔ L4 Architecture ➔ L5 Contract ➔ L6 Platform ➔ L7 Spec Gap`
   - Locate the canonical owner. Do not attempt surface-level patches that merely suppress symptoms.
3. **Failing Repro First (MUST FAIL)**:
   - Add `tests/unit/issues/issue-<id>.test.ts`.
   - Confirm test FAILS by asserting on the canonical owner invariant.
4. **Surgical Patch & Anti-Entropy**:
   - Make minimal code changes at the canonical owner, confirm test PASS.
   - Apply `anti-entropy-governance` principles (`delete-first` for any superseded logic).
5. **All Gates & 4-Slot Fresh Verification Evidence**:
   - Run `npm run typecheck && npm run lint && npm run build && npm run test`.
   - Record fresh verification evidence (Action, Result, Covered, Uncovered/Residual Risk).
   - Execute `code-review` skill (escalate to `./scripts/run-ocr-audit.sh` for high-risk/complex changes).
6. **Create PR**: Include `Fixes #<id>`, 4-slot verification evidence, and reproduction logs.
7. **PR Review & Reconcile**:
   ```bash
   loopx pr-review --target-exact-head <PR_NUMBER>@<HEAD_OID>
   loopx issue-fix pr-lifecycle --goal-id <goal-id> --issue-ref <id>
   ```
