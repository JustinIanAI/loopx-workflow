---
name: open-code-review
description: "Alibaba Open Code Review (ocr CLI) escalated deep scan. Optional capability self-contained with auto-check, auto-install, scan, and ingestion into LoopX change-quality engine. High/Medium defects block delivery."
---

# Open Code Review (OCR)

Use this skill as an **选配深度审查与跨模型二次审计能力 (Optional Escalated Deep Scan)**.
Default review uses the zero-dependency native `code-review` skill. Activate this skill only on high-risk concurrency, persistence, security boundaries, or when explicitly requested by user.

## Self-Contained Lifecycle

This skill is fully self-contained:
1. **Self-Check**: Checks if `ocr` CLI is installed in the local environment.
2. **Auto-Install**: Automatically installs `@alibaba-group/open-code-review` if missing.
3. **Scan Execution**: Runs deep cross-model scan from target `base-ref` to `HEAD`.
4. **LoopX Ingestion**: Translates findings into LoopX `change_quality_agent_result_v2`, writes a tamper-proof Receipt, and syncs evidence into `specs/features/<feature>/05-evidence.md`.

## Execution

Run via the bundled self-contained script:
```bash
./skills/open-code-review/run-ocr.sh [BASE_REF] [FEATURE]
```

Or trigger through the orchestrator:
```bash
loopx-flow check --with-ocr
```

## Blocking Rule
- **High / Medium defects**: Mapped to LoopX `risks[].severity = "blocker"`. The LoopX Quality Receipt will fail and physically block PR creation and merge.
- **Low / Style issues**: Mapped to `warning` or `advisory`.
