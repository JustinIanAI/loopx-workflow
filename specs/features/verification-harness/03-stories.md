# User Stories & Sizing: verification-harness

- **Story-1 (`VH-UPSTREAM-R0`)**: 作为维护者，我希望在 `skills/verification-harness/` 中保留逐字节可校验的 `pstack@0.15.46` R0 原文与 MIT `LICENSE` 且无临时克隆残留，以便满足开源合规并建立可审计的上游对照基线。
  - AC: `AC-1`
- **Story-2 (`VH-SKILL-AND-MAP`)**: 作为研发/审查 Agent，我希望拥有对齐 `ADR-0011` 的 `SKILL.md`、`references/loopx-adaptation.md` 与 4-H2 结构的 `features/cli-surface.md`，以便按 `Surface/Run/Drive/Observe/Isolate` 五维模型驱动真实入口并按 `Doc Drift / Harness Gap / Product Bug` 分类偏差。
  - AC: `AC-2`
- **Story-3 (`VH-COLD-START-PROVE`)**: 作为研发/QA Agent，我希望通过单条可执行命令完成 `features/cli-surface.md` 冷启动 Prove，并在沙箱彻底销毁后仍保有完整 Proof 工件且宿主机零残留，以便提供真实的 L1 表面验证证据。
  - AC: `AC-3`, `AC-4`
