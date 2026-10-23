---
name: design-grill
description: Codebase-aware relentless plan and architecture stress-testing. First inspects codebase to answer facts, relentlessly interrogates user on 3-6 top decision branches, enforces First-Principles minimal complexity checks, and outputs a structured decision record.
---

# Design Grill

Use this skill before drafting PRDs or Specs to resolve design ambiguity, prevent speculative abstractions, and eliminate hidden trade-offs.

## Protocol

1. **Codebase-Aware Fact Probing**:
   - Before interrogating the user, inspect the repo (`rg`, `read`) to answer existing architectural facts (e.g. data structures, current configs, existing interfaces).
   - **Never ask the user a question that the codebase can answer.**

2. **Deconstruct 3-6 Top Decision Branches**:
   - Identify foundational design branches (concurrency model, data schema, error boundaries, compatibility).

3. **First-Principles & Complexity Minimality Check (Aegis Integration)**:
   - For every candidate design or architectural path, enforce First-Principles evaluation:
     - **Change Necessity**: Is a new abstraction/interface strictly necessary, or can an existing canonical owner absorb this?
     - **Fallback / Adapter Ceiling**: Are we adding a 4th fallback/adapter path instead of fixing the root cause? Never build speculative fallback layers.
     - **Anti-Entropy Consideration**: If introducing a new pattern, identify which legacy path or duplicate owner must be retired (`delete-first`).

4. **Relentless Interrogation Loop**:
   - For each decision branch:
     1. Provide your recommended choice and rationale/trade-offs first.
     2. Ask the targeted question.
     3. Wait for user consensus before moving to the next.
   - Stop only when there are no open "it depends" answers remaining.

5. **Emit Decision Record**:
   - Save decision outcomes to `docs/decisions/<feature>-decisions.md` containing:
     - Decision points
     - Considered alternatives & trade-offs
     - Selected choice & rationale
     - First-principles minimality justification
     - Impacted system components & retired paths
