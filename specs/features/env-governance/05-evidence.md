# Environment Governance 质量凭据（阶段 5/6）

## 门禁实测

| 门禁 | 命令 | 结果 |
|------|------|------|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS |
| Build | `npm run build` | PASS |
| Test | `npm run test` | PASS（**89/89**，15 suites；新增 `env-governance.test.js` 11 个子用例已纳入门禁清单） |

## 新增测试（tests/unit/env-governance.test.js，11/11）

- `isRuntimeArtifact()`：`.codex/**`、`.loopx/**`、`*.lock`、`node_modules/**`、`.DS_Store` 判为运行时工件；
  源码/文档/配置判为非工件；反斜杠路径归一化。
- `committedScopeFiles()`：只返回 `git diff --name-only <base>...HEAD` 的已提交文件；
  不含工作区专属改动（INV-ENV-2）；非法 baseCommit 安全返回 `[]`。
- 运行时工件隔离：`.gitignore` 覆盖 `.loopx/**/*.lock`、`.loopx/goals/`、`.codex/`；
  `git ls-files` 无 `.codex/`、无 `.loopx` 锁文件（INV-ENV-3）。
- doctor 契约：`cmd_doctor_control_plane` 定义并被 `cmd_doctor` 调用；含 route 一致性、
  半迁移残留、缺 `state_file`、运行时工件跟踪四类检查；API 预算以 `core_limit / 2` 为基线；
  缺 `gh`/`loopx` 时降级 WARN（INV-ENV-4/5）。

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
