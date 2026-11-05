# ADR-0007：控制面路由统一、运行时工件隔离与 GitHub API 预算基线

- **状态**：Accepted
- **日期**：2026-11-05
- **关联**：`REQ-ENV-1`、`REQ-ENV-2`、`REQ-ENV-3`、`REQ-QUALITY-2`、ADR-0003、ADR-0004

## 背景

一次真实的交付阻塞暴露了三类环境级问题，它们不改变业务逻辑，却能让 `loopx-flow` 在
`approve` / `check` / 迁移阶段以隐晦错误 Fail-Closed：

1. **控制面路由分裂**：LoopX 的目标 runtime root 是 `~/.loopx`（`paths.py: DEFAULT_RUNTIME_ROOT`），
   遗留路由是 `~/.codex/loopx`（`LEGACY_RUNTIME_ROOT`）。本项目首次 bootstrap 时把
   `common_runtime_root` 固化为遗留路由；随后一次中断的迁移在 `~/.loopx` 留下
   `registry.global.json.lock` 残留，使官方 `loopx migrate-local-state` 直接失败
   （`target runtime root already exists`）。修复残留后又暴露项目 `registry.json` 中
   `hard-guard-goal` 缺 `state_file` 的畸形记录，迁移校验再次失败。
2. **运行时工件进入 Git 跟踪面与质量收据**：`.loopx/registry.json.lock`、`.codex/goals/**`、
   `.loopx/goals/**` 等私有运行时状态被跟踪；`ingest-to-loopx-quality.js` 用
   `git diff <base_commit>`（含工作区改动）提取收据证据 refs，于是把运行时锁文件与
   “分支落后于迁移提交”的反向 `AGENTS.md` diff 写进 `reuse.evidence_refs`，
   `loopx change-quality record` 以 `reuse references unknown evidence: path:AGENTS.md` 拒绝。
3. **GitHub API 滥用阈值缺乏基线**：评审管线在同一 head 反复执行 `gh pr view/diff`、
   `loopx pr-review` 与新增评论，叠加 push→评审热循环，触发账号封禁。
   官方 primary limit（认证用户 5000 req/h）与 secondary limits（≤ 900 points/min、
   ≤ 80 content-generating/min、≤ 500 content-generating/h）此前没有任何前置预算检查。

## 决策

### 1. 控制面路由统一原则（`REQ-ENV-1`）

- **唯一目标路由是 `~/.loopx`**；`~/.codex/loopx` 仅作为迁移过渡期的遗留路由，不得作为新项目基线。
- 路由收敛由官方命令完成：`loopx migrate-local-state`（预演 → `plan_id` → `--execute`），
  **禁止手改 `registry.global.json` / `common_runtime_root`**。
- 迁移前必须先修复两类前置状态：目标目录残留、registry 中缺 `state_file` 的 goal；
  迁移后必须确认 `loopx status` 的 `runtime_root == ~/.loopx` 且四大门禁与 `check` 复跑通过。
- `loopx-flow doctor` 增加控制面一致性前置检查（阶段 0 暴露，而非在 `approve`/`check` 时炸）。

### 2. 运行时工件与 Git / 收据隔离（`REQ-ENV-3`）

- `.codex/**`、`.loopx/**/*.lock`、`.loopx/goals/**` 一律不入 Git（`git rm --cached` + `.gitignore`）。
- **测试不得污染真实控制面**：任何写 registry 的测试必须通过 `LOOPX_REGISTRY` 指向临时 registry；
  `cmd_gate` 的指纹核验读取 `${LOOPX_REGISTRY:-<project>/.loopx/registry.json}`。
  否则测试会造出缺 `state_file` 的 orphan goal，直接阻塞 `loopx migrate-local-state`（本项目实际发生过）。
- 收据 `reuse` / `simplification` 的 `evidence_refs` 只允许取
  **已提交 exact scope**（`git diff --name-only <base>...HEAD`）并过滤运行时工件；
  缺陷扫描仍保留工作区 diff（`REQ-QUALITY-2` 不变），二者职责分离。
- 收据写入失败时，`05-evidence.md` 不得保留 ingest 的乐观 “PASSING” 文案，必须回写实测口径。

### 3. GitHub API 预算基线（`REQ-ENV-2`）

- 采用**官方上限 50% 作为安全基线**：

  | 桶 | 官方上限 | 50% 安全基线 |
  |---|---|---|
  | core REST（认证用户） | 5000 req/h | 2500 req/h |
  | secondary points | 900 points/min（GET=1、POST/PATCH=5） | 450 points/min |
  | content-generating | 80/min、500/h | 40/min、250/h |

- `loopx-flow doctor` 通过 `gh api rate_limit` 前置展示当前额度与基线；低于基线时告警并给出降频指令。
- 评审侧硬约束（由 `review-pipeline-throttle` 胶囊实现）：
  head-oid 幂等（同 head 不重跑模型/不重取 diff）、comment upsert（评论不堆叠）、
  `REVIEW_DEBOUNCE_SECONDS` 合流窗口、429/503 指数退避。
- 单 PR 交付节奏建议：同一 PR 每小时 ≤ 6 次完整评审链、≤ 20 次内容生成操作（评论/编辑）。

## 后果

- **正向**：环境问题在阶段 0 以“原因/影响/修复指令”形式暴露；收据不再被运行时工件污染；
  API 频次有可核对基线，降低再次封禁风险。
- **成本**：`doctor` 增加 3 个检查段（约 120 行 bash），并在缺少 `gh`/`loopx` 时降级为 WARN；
  迁移仍是一次性人工确认操作，不由自动流程执行。
- **不做**：不引入第二套 registry 兜底、不在 `doctor` 里自动删除或自动迁移用户 HOME 状态。
