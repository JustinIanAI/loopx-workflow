# Slice PRD Mapping: verification-harness

- **Target Issue**: GitHub `#43` / Multica `TRE-91`（Part of `#37`）
- **Covered Requirements & ADRs**:
  - `ADR-0011`（证据契约、`Real-vs-Mock` 真实表面区分、独立 Oracle）
  - `REQ-EVIDENCE-1`（可复跑 Oracle 与真实产物观测）
  - `REQ-ENV-1` / `ADR-0007` / `ADR-0014`（临时工件沙箱隔离与主仓/宿主机零污染）

## 1. 切片验收边界（In Scope）
- 落地 `skills/verification-harness/LICENSE` 与 `upstream/pstack-r0/`（`pstack@0.15.46` R0 原文逐字节一致，无克隆缓存残留）。
- 落地 `skills/verification-harness/SKILL.md`、`references/loopx-adaptation.md`、`features/README.md`、`features/cli-surface.md` 及可执行冷启动验证器 `scripts/prove-cli-surface.js`。
- 执行冷启动 Prove 自证，留存 `specs/features/verification-harness/proofs/cli-surface-proof.{json,md}`，并补充 `tests/unit/verification-harness.test.js` 自动化回归单测。
- 同步登记 `skills/README.md`、`scripts/preflight-check.sh` 与 `tests/unit/workflow.test.js` 核心技能清单。

## 2. 明确不做（Out of Scope）
- 不新建任何第二状态库或替代 LoopX `change-quality` / `user_gate` 权威。
- 不修改 `bin/loopx-flow` 核心状态机命令语义（M2 Conductor 在 W7 `#45` 承接，证据六问生成器在 W6 `#44` 承接）。

## 3. 承重假设与红队反证
- **假设 H1**：沙箱 `finally` 清理删除整个 `prove-cli-surface-*` 目录后，Proof 产物不会随之丢失。
  - **验证设计**：`prove-cli-surface.js` 强制校验 `--output-dir` 位于临时沙箱目录之外（若指向沙箱内部直接 Fail-Closed `exit 2`），并在 `fs.rmSync(sandboxDir)` 后二次断言 Proof 文件存在且沙箱已不存在。
- **假设 H2**：冷启动运行真实 `loopx 2.3.x` 不会污染主仓库 `.loopx/registry.json` 或宿主机 `~/.loopx/registry.global.json`。
  - **验证设计**：显式隔离 `HOME`、`LOOPX_REGISTRY`、`LOOPX_TMP_DIR` 与 `--runtime-root`，并在运行前后比对主仓与宿主机 Registry 文件 SHA-256 指纹。
