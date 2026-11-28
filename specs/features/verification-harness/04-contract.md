# Feature Contract & Tasks: verification-harness

- **Contract-Status**: FROZEN & APPROVED
- **Feature Branch**: `feat/verification-harness-w5`
- **LoopX Goal**: `verification-harness-goal`
- **Scope**: `skills/verification-harness/**`, `skills/README.md`, `scripts/preflight-check.sh`, `tests/unit/workflow.test.js`, `tests/unit/verification-harness.test.js`, `specs/features/verification-harness/**`
- **依赖顺序**: `Story-1` -> `Story-2` -> `Story-3`
- **引用**: `ADR-0011`, `REQ-EVIDENCE-1`, `ADR-0007`, `ADR-0014`

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
export type ProofStepStatus = 'passed' | 'failed' | 'verified_unreachable';
export type ProofRealVsMock = 'real' | 'real+contract_fake';
// 自动 runner 只产出 clean（全 passed）与 changed（含 verified_unreachable）；
// blocked 是人工三分类 Product Bug 的状态，不出现在自动 Proof 中（见 §5）。
export type TriageOutcome = 'clean' | 'changed';
// 自动 runner 只产出 passed（5 步全覆盖）与 partial（含 verified_unreachable）；
// failed / incomplete 一旦发生即 fail-closed（exit 1）而不写 Proof（见 §5）。
export type ProofOverallStatus = 'passed' | 'partial';

export interface ProofStepRecord {
  id:
    | 'cli-help-surface'
    | 'cli-init-and-subdir-anchor'
    | 'cli-feature-and-gate1-negative'
    | 'cli-gate1-approve-and-tamper-detect'
    | 'cli-todo-managed-canary';
  surface: string;
  status: ProofStepStatus;
  real_vs_mock: ProofRealVsMock;
  observations: string[];
}

export interface VerificationHarnessProofV1 {
  schema_version: 'loopx_verification_harness_proof_v1';
  feature_map: 'skills/verification-harness/features/cli-surface.md';
  upstream_baseline: 'cursor/plugins@fbb86c09bbb4a25e490aaed136899ced1e9140e4 (pstack@0.15.46, MIT)';
  generated_at: string;
  // ADR-0011 决策 5（内容寻址，B1）：Proof 锚定内容寻址的源码 scope 指纹与契约，dirty 工作区 fail-closed
  scope_fingerprint: string;    // SHA-256 of `git diff --no-color --binary <empty-tree>..HEAD`（pathspec 排除 proof 工件目录）。空树是固定内容寻址基线，该值只取决于当前源码 scope 内容（tree），与 HEAD 的 commit SHA / 历史 / origin/main 漂移无关 —— squash/merge 合入后源码树不变则 fingerprint 不变（不再因新 commit SHA 误判 stale）
  source_dirty: false;          // dirty workspaces never emit a Proof
  contract_revision: string | null; // SHA-256 of `specs/features/verification-harness/04-contract.md`
  // 由 steps 派生：5 步全 passed → passed；含 verified_unreachable → partial。
  // Doc Drift / Product Bug 一旦在 pass 中被观察到，断言抛出并使 Prove
  // fail-closed（exit 1）而不写 Proof，因此 failed / incomplete / blocked
  // 不会出现在自动 runner 产出的 Proof 中（见 §5 已知限制）。
  overall_status: ProofOverallStatus;
  steps: ProofStepRecord[];
  cleanup: {
    sandbox_dir: string;
    sandbox_dir_kind: 'relative_to_caller_repo' | 'sanitized_placeholder';
    sandbox_removed: true;
    proof_survived_cleanup: true;
  };
  isolation: {
    main_repo_registry_present: boolean;   // 运行前主仓 `.loopx/registry.json` 是否已存在（诚实记录，避免 null === null 空转）
    host_global_registry_present: boolean; // 运行前宿主机 `~/.loopx/registry.global.json` 是否已存在
    main_repo_registry_unchanged: true;
    host_global_registry_unchanged: true;
    caller_repo_git_status_unchanged: true;
    caller_repo_loopx_manifest_unchanged: true;
    caller_repo_loopx_file_count: number;
  };
  triage: {
    outcome: TriageOutcome;
    // doc_drift / product_bug 为人工三分类（SKILL.md / loopx-adaptation.md），
    // 自动 runner 恒为 []：这两类一旦被观察到即 fail-closed（exit 1）而不写 Proof。
    doc_drift: string[];
    harness_gap: string[];      // verified_unreachable 步骤必须在此登记
    product_bug: string[];
  };
}
```

## 2. AC 矩阵

| AC | Story | 覆盖 REQ / ADR | 验收断言 |
|---|---|---|---|
| **AC-1** | `Story-1` | `ADR-0011` | `LICENSE` 与 `upstream/pstack-r0/**` 共 7 个文件逐字节匹配 `pstack@0.15.46` SHA-256，无嵌套 `.git` 或临时缓存残留 |
| **AC-2** | `Story-2` | `ADR-0011`, `REQ-EVIDENCE-1` | `SKILL.md` 含 6 个标准章节，`loopx-adaptation.md` 覆盖五维模型与三分类，`features/cli-surface.md` 严格遵循 4 个固定 H2 顺序 |
| **AC-3** | `Story-3` | `REQ-EVIDENCE-1`, `ADR-0007` | 冷启动运行 `prove-cli-surface.js` 退出码 `0`，覆盖全部 5 个子特性，沙箱销毁后 Proof JSON/MD 留存且主仓/宿主机 Registry 零变更 |
| **AC-4** | `Story-3` | `ADR-0014` | 缺失 `--output-dir`、未知参数或 `--output-dir` 指向沙箱内部时一律非 0 Fail-Closed 且零残留；全仓 Four Gates 100% 通过 |

## 3. Verification Plan（五维验证计划）

| 维度 | 本胶囊验证方案 |
|---|---|
| **Surface** | `node skills/verification-harness/scripts/prove-cli-surface.js` + 子进程驱动真实 `bin/loopx-flow`（`scripts/preflight-check.sh` 属阶段 0 环境前置条件，由 CI/Stage 0 执行，本 Prove 不驱动） |
| **Run / Drive** | `lib/paths.js#createRunDir` 创建隔离 Git 仓库，真实子进程运行 `help`/`init`/`status --next`/`feature`/`approve`/`gate verify`/`todo claim`/`todo done` |
| **Observe** | 校验 `cli-surface-proof.{json,md}`、6 个胶囊文件、SHA-256 篡改拦截（`CONTRACT_TAMPERED`）、5 元组 claim 缓存生成与删除、`gh` 跨进程 `argv` 审计 |
| **Negative Invariant** | 非 TTY 无配置 `init` 阻断、`main` 直提 `pre-commit` 阻断、未批准 `approve`/`gate verify` 阻断、契约篡改阻断、缺 `--output-dir` / 未知参数 / `--output-dir` 落在沙箱内阻断、源码工作区 dirty 阻断 |
| **Real-vs-Mock** | `bin/loopx-flow` 与 `loopx 2.3.0` 受管 Todo 为 `real`；离线 `gh`/Gate1 控制面桩为 `real+contract_fake` |

## 4. 任务清单 (Tasks)
- [x] `t1` (`Story-1`): 稀疏提取 `pstack@0.15.46` R0 原文与 MIT `LICENSE` 并清理临时克隆缓存
- [x] `t2` (`Story-2`): 编写 `SKILL.md`、`references/loopx-adaptation.md`、`features/README.md` 与 `features/cli-surface.md`
- [x] `t3` (`Story-3`): 编写 `tests/unit/verification-harness.test.js`（先红后绿）与可执行 `scripts/prove-cli-surface.js`
- [x] `t4` (`Story-3`): 冷启动运行 `prove-cli-surface.js` 产出持久化 Proof 并跑通双 locale Four Gates

## 5. 已知限制 (Known Limitations)

- **内容寻址 scope_fingerprint（B1）**：`scope_fingerprint` = SHA-256 of `git diff --no-color --binary <empty-tree>..HEAD`（pathspec 排除 proof 工件目录）。空树是固定内容寻址基线，因此该值**不依赖 `origin/main` / commit SHA / 历史**：squash/merge 合入 `main` 产生新 commit 但源码树不变，fingerprint 不变，test 7 不再误判（B1 修复）；任何真实源码改动都会改变 fingerprint。独立 Oracle 在任意完整 git 树（含无 `origin/main` 的浅检出）上均可复算。
- **工作区解耦（P5）**：当 `specs/features/verification-harness/proofs/` **以外**存在未跟踪/已修改的本地草稿时，驱动 Prove 的 test 3 / 4 / 5 / 7 / 8 一致地明确 `skip`（附原因），整包 `npm run test` 仍 exit 0；当脏改动位于 Proof 目录**内**时，test 3 / 7 **照常执行** freshness 评估，绝不 skip，防止已提交 Proof 被篡改后静默跳过；干净树（CI）下 9/9 全量执行、0 skip。Prove 本体对真实源码脏改动（如 `bin/loopx-flow` 1 字节改动）的 fail-closed（exit ≠ 0、零 Proof、零沙箱残留）不受影响。
- **Triage 真实语义（N2）**：`prove-cli-surface.js` 的每一步只会产出 `passed` 或 `verified_unreachable`；Doc Drift / Product Bug 一旦在 pass 中被观察到，断言即抛出并使 Prove fail-closed（exit 1）**不写 Proof**。因此自动 Proof 中 `overall_status` 只会是 `passed` / `partial`，`triage.outcome` 只会是 `clean` / `changed`，`triage.doc_drift` / `triage.product_bug` 恒为 `[]`；`failed` / `incomplete` / `blocked` 与 Doc Drift / Product Bug 的分类是**人工维护三分类**（`SKILL.md` "Maintenance Loop"、`references/loopx-adaptation.md` "Stage 7"）的登记槽，不由 runner 伪造。
- **`approve contract` golden 字节耦合（N3）**：step 4 用实现之外算定的 `GOLDEN_LOCKED_CONTRACT_TEXT` / `GOLDEN_LOCKED_CONTRACT_SHA256` 作为独立 Oracle 锁定 `approve contract` 的落盘字节。若产品侧**合法变更** `approve contract` 的输出格式，该步会以 `independent Oracle mismatch` 整体 fail-closed（exit 1）且不产出 Proof —— 此时需同步更新 golden 常量后再复证。这是保留独立 Oracle（不自证）的必要代价，刻意不降级为语义校验以免放宽 fail-closed。
