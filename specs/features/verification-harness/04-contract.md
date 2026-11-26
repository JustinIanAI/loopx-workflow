# Feature Contract & Tasks: verification-harness

- **Contract-Status**: DRAFT (Pending Approval)
- **Feature Branch**: `feat/verification-harness-w5`
- **LoopX Goal**: `verification-harness-goal`
- **Scope**: `skills/verification-harness/**`, `skills/README.md`, `scripts/preflight-check.sh`, `tests/unit/workflow.test.js`, `tests/unit/verification-harness.test.js`, `specs/features/verification-harness/**`
- **依赖顺序**: `Story-1` -> `Story-2` -> `Story-3`
- **引用**: `ADR-0011`, `REQ-EVIDENCE-1`, `ADR-0007`, `ADR-0014`

## 1. 契约冻结 (TypeScript Interfaces & Invariants)

```typescript
export type ProofStepStatus = 'passed' | 'failed' | 'verified_unreachable';
export type ProofRealVsMock = 'real' | 'real+contract_fake';
export type TriageOutcome = 'clean' | 'changed' | 'blocked';
export type ProofOverallStatus = 'passed' | 'partial' | 'incomplete' | 'failed';

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
  // ADR-0011 决策 5：Proof 必须锚定精确源码与契约，dirty 工作区 fail-closed
  source_head: string;          // 最近一个触及 proof 工件目录以外任意路径的提交（`git rev-list -1 HEAD -- . ':(exclude)specs/features/verification-harness/proofs'`）
  source_dirty: false;          // dirty workspaces never emit a Proof
  diff_fingerprint: string;     // SHA-256 of `git diff <base>..HEAD`（同一 pathspec 排除 proof 工件目录）
  contract_revision: string | null; // SHA-256 of `specs/features/verification-harness/04-contract.md`
  // 由 steps 派生：全部 passed → passed；含 verified_unreachable → partial；
  // 含 failed → failed（incomplete 保留为未来子特性不足时的降级态，当前 runner 恒产出 5 步）
  overall_status: ProofOverallStatus;
  steps: ProofStepRecord[];
  cleanup: {
    sandbox_dir: string;
    sandbox_dir_kind: 'relative_to_caller_repo' | 'sanitized_placeholder';
    sandbox_removed: true;
    proof_survived_cleanup: true;
  };
  isolation: {
    main_repo_registry_unchanged: true;
    host_global_registry_unchanged: true;
    caller_repo_git_status_unchanged: true;
    caller_repo_loopx_manifest_unchanged: true;
    caller_repo_loopx_file_count: number;
  };
  triage: {
    outcome: TriageOutcome;
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
