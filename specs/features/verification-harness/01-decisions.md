# Architecture Decisions: verification-harness

- **Status**: APPROVED (Aligned with Approved Implementation Plan Decision 4 & ADR-0011)
- **Feature**: `verification-harness`
- **Linked ADRs**: [ADR-0007](../../../docs/adr/0007-environment-governance.md), [ADR-0008](../../../docs/adr/0008-application-orchestration-layer.md), [ADR-0011](../../../docs/adr/0011-evidence-traceability-and-quality.md), [ADR-0014](../../../docs/adr/0014-temp-artifact-path-remediation-and-history-sanitization.md)

## 1. 本胶囊实现取舍

1. **上游原文稀疏复用与许可证保留（实施计划决策 4）**：
   - 从 `cursor/plugins@fbb86c09bbb4a25e490aaed136899ced1e9140e4`（`pstack@0.15.46`）稀疏检出验证技能核心三件套（`create-verification-skill` 含 `references/feature-map-example/*`、`maintain-verification-skill`、`principle-prove-it-works`）及 `pstack/LICENSE`（MIT License, Copyright (c) 2026 Lauren Tan）。
   - 原封不动保留在 `skills/verification-harness/upstream/pstack-r0/` 与 `skills/verification-harness/LICENSE`（由单测按精确 SHA-256 守卫防篡改），临时克隆目录在提取后立即销毁，仓库与临时目录零缓存残留。
2. **LoopX-Workflow 沙箱与权威边界适配**：
   - 上游 Pstack 默认生成在 `.cursor/skills/` 并使用 `/tmp/...-$RUN_ID`。本仓库 `.cursor/` 已 gitignore 且生产脚本禁裸写 `/tmp` 或 `os.tmpdir()`（`ADR-0007` / `ADR-0014`），因此统一落位 `skills/verification-harness/`，所有运行态沙箱统一通过 `lib/paths.js#createRunDir('prove-cli-surface')` 在 `LOOPX_TMP_DIR` 下分配并在 `finally` 销毁。
   - Proof 产物输出至显式 `--output-dir`（沙箱外部，如 `specs/features/verification-harness/proofs/`），确保清理沙箱后 Proof 完整留存，且仅作为 `05-evidence.md` 输入证据，绝不构成第二权威状态或自动跨越 Gate 1 / Gate 2。
3. **本地真 CLI 与外部边界契约桩分层**：
   - 对 `bin/loopx-flow`、`scripts/workflow-init.sh`、`scripts/preflight-check.sh` 走真实子进程调用；
   - 对受管任务闭环（`todo claim` / `todo done`）在本机存在 `loopx 2.3.x` 时直连真实 `loopx` + 独立 `--registry` / `--runtime-root`；在无 `loopx` 的极简 CI 容器中忠实记录 `verified_unreachable`（写明缺失二进制前置条件，绝不伪造 `passed`）；
   - 对 GitHub 网络边界（`gh`）与离线 Gate 1 控制面采用记录并校验 `argv` 的 Contract Fake CLI。
