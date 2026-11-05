# Quality & Verification Evidence: env-governance

## 1. LoopX 质量凭据 (Change Quality Receipt)
- **Status**: `PASSING (Strict Mode Verified)`
- **Review Engine**: `Default Semantic Review`
- **Diff SHA256 (scan scope)**: `abcbe37bf359fa61ae128105d2d47b0687f5c4f0a596d84cf7549daf05975c44`
- **Receipt Chain**: `Fail-Closed (prepare -> record -> verify, gate re-verified in check [3/3])`
- **LoopX Scope Fingerprint**: `e2b5b3f6740394e2c704ba7a032159aef3b1c6508687342ad691b3f6cf8566d7`

## 2. 代码审查结论 (Code Review Insights)
- **Reviewer**: `Default Semantic Review`
- **Blocker 缺陷数**: `0`
- **Warnings / Advisory**: `0`
- **反熵增治理**: 执行 `delete-first`，彻底消除旧逻辑与废弃变量，零幽灵代码。

## 3. 本地四大硬门禁实测 (4-Slot Fresh Evidence)
| 门禁动作 | 退出码 | 覆盖说明 | 残余风险与假设 |
|---|---|---|---|
| `npm run typecheck` | 0 | 覆盖核心类型与接口定义 | 无 |
| `npm run lint` | 0 | 语法与格式校验通过 | 无 |
| `npm run build` | 0 | 产物构建成功 | 无 |
| `npm run test` | 0 | 单测套件 100% PASS | 依赖本地环境 |

---

## B 阶段：控制面迁移到 ~/.loopx（已执行）

- 预演 plan_id：`3f1aff52a97c3f84cff627673a44f36ab8dbba11dbca2d129ca6685676a88909`
- 执行结果：`status: migrated`，source `~/.codex/loopx` → target `~/.loopx`，
  projects=3、Goal directories=17，备份 `~/.codex/loopx-local-state-backups/3f1aff52a97c3f84`
- 迁移前一次性修复（均已备份，记录于 `/tmp/registry.project.*.json`、`/tmp/registry.global.*.json`）：
  1. 移除 `~/.loopx` 半迁移残留（备份至 `~/.loopx-backup-20261105-145953`）
  2. 清理项目 registry 中 9 条 stale goal 登记（state_file 已随胶囊归档/删除）
  3. 清理全局 registry 中对应 9 条登记（`retire-global-goal` 因 live state_file 拒绝，改为备份后移除）
  4. 归档 `e2e-pipeline-demo-goal` 运行时目录（`loopx archive-runtime --allow-registered --execute`）
- 迁移后校验：
  - `loopx status` → `runtime_root: /Users/freecisco_yan/.loopx`
  - 项目 `.loopx/registry.json` → `common_runtime_root: /Users/freecisco_yan/.loopx`
  - `loopx-flow doctor` 控制面段 **三绿无告警**
  - `loopx-flow gate verify contract env-governance` 重新审批后通过
  - `loopx-flow check env-governance` 3/3 收据 `ok=true`，收据文件落在 `~/.loopx/goals/...`

## INV-ENV-6：测试不再污染真实 registry

- 根因：`tests/unit/guard.test.js` 直接写真实 `.loopx/registry.json` 并造出无 `state_file` 的
  `hard-guard-goal`，该 orphan 记录使 `loopx migrate-local-state` 以
  `goal hard-guard-goal has no state_file` 失败。
- 修复：`cmd_gate` 读取 `${LOOPX_REGISTRY:-<project>/.loopx/registry.json}`；guard 测试改为写
  临时 registry（`mkdtemp` + `LOOPX_REGISTRY`），并附带 `state_file`。
- 回归：新增 `env-governance.test.js` 用例「项目 registry 中不存在缺 state_file 的 goal」；
  实测跑完 guard 测试后 `.loopx/registry.json` 的 md5 不变。
- 一次性清理：删除历史 orphan `hard-guard-goal` 条目（备份于 `/tmp/registry.json.bak-*`）。

## doctor 实跑结果（本机，2026-11-05）

```
==> [2/3] 控制面一致性检查 (runtime route / registry / 运行时工件)...
[✓] runtime root 路由一致: /Users/freecisco_yan/.codex/loopx
[WARN] ~/.loopx 存在半迁移残留（1 项，无 registry.global.json）→ 会阻塞 loopx migrate-local-state
[WARN] registry 存在缺 state_file 的 goal（会阻塞迁移/审批）: .loopx/registry.json#hard-guard-goal
[✓] 运行时工件未被 Git 跟踪

==> [3/3] GitHub API 预算基线检查 (官方上限 50% 安全基线)...
    core REST: limit=5000/h  remaining=4991  → 50% 安全基线=2500/h
    secondary: ≤ 900 points/min（GET=1, POST/PATCH=5）、≤ 80 content/min、≤ 500 content/h
    → 安全基线建议: 2500 req/h、450 points/min、40 content/min、250 content/h
[✓] 当前额度高于 50% 安全基线
```

两个 WARN 与最初 `approve`/`check` 的真实阻断一一对应，证明前置检查有效定位了环境问题
（阶段 0 暴露，而不是留到交付门禁炸）。

## GitHub API 频次基线（REQ-ENV-2）

官方口径来源：[REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、
[secondary rate limit 细则](https://raw.githubusercontent.com/github/docs/main/data/reusables/rest-api/secondary-rate-limit-rest-graphql.md)。

| 桶 | 官方上限 | 50% 安全基线 |
|---|---|---|
| core REST（认证用户） | 5000 req/h | **2500 req/h** |
| secondary points | 900 points/min（GET=1、POST/PATCH=5） | **450 points/min** |
| content-generating | 80/min、500/h | **40/min、250/h** |

评审侧单次调用画像（`review-pipeline-throttle` 落地后）：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 同一 head 重复评审 | `gh pr view`×2 + `gh pr diff` + `loopx pr-review`（内部再 2×view + 2×paginated api）+ 评论 POST ≈ **9 次调用 / 1 次内容生成 / 1 次模型执行** | `gh pr view`×1 + 评论 GET（命中则 PATCH，否则 POST）≈ **2–3 次调用**，模型 0 次，评论不堆叠 |
| 新 head 首次评审 | ≈ 9 次调用 | ≈ 9 次调用（不可省，属必要成本） |

按 2500 req/h 基线：同一 PR 每小时 ≤ 6 次完整评审链、≤ 20 次内容生成操作仍留有近 10 倍余量。

## 改动文件

- `bin/loopx-flow`：`cmd_doctor_control_plane` + doctor 3 段检查
- `skills/code-review/scripts/ingest-to-loopx-quality.js`：`isRuntimeArtifact` / `committedScopeFiles`，证据 refs 收紧
- `.gitignore`：`.loopx/**/*.lock`、`.loopx/goals/`
- `git rm --cached`：`.codex/**`、`.loopx` 锁文件与 goal 私有状态退出跟踪
- `docs/adr/0007-environment-governance.md`、`docs/prd/loopx-workflow.md`（`REQ-ENV-1..3`）、
  `docs/design/loopx-workflow-design.md`（命令表 + §3.1）
- `tests/unit/env-governance.test.js`、`package.json`（门禁清单）
- `specs/features/env-governance/*`
