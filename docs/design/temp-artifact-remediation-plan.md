# 临时工件 / 路径映射整改方案评估与优化（草案 v3）

> 状态：Draft v3，供评审。依据：对 `main@0510d7c` 的静态核查 + 已安装 LoopX 包源码（`loopx/paths.py`、`bootstrap.py`、`domain_state.py`）+ Git 全历史 / 远端 / Worktree 扫描。
>
> v3 变更：围绕 D1 / D2 / D3 细化可执行契约（全命令矩阵与全局 `--registry` 参数解析、缓存 v1 Schema 支持重跑 `--check-result`、`-F body=@-` 参数拆分、`gc` 并发安全、PR 0 与 `old-origin` / `v1.0.0` / `commit-map` 安全时序、`pre-commit` 防复发拦截），并补充第三轮深度遗漏反思（§8 R12–R20）。
>
> 边界铁律：**不动 LoopX 原生控制面及其自身临时文件/锁管理逻辑**，全部整改严格收敛在 `loopx-workflow` 编排层与仓库治理面，避免与 LoopX 后续版本升级冲突。

## 0. 已拍板决策（2026-11-19）

| # | 问题 | 决策 | 落点 |
|---|---|---|---|
| D1 | Worktree 缺 LoopX registry | **fail-closed**：报错退出并提示，不自动回指主 checkout | §3.1 |
| D2 | `.loopx/reviews/` 定位 | **降级为可丢弃缓存**，任何门禁不得以其为准 | §2.3、§3.2 |
| D3 | 泄露的 `base_token` / `chat_id` | **重写 Git 历史彻底抹除** | §6 PR 0、§7 |
| D4 | 飞书多维表格处置 | **不影响本机使用**：本机 `.loopx/` 保留原配置不入库，云端确认关闭公开链接权限；Git 历史与示例全部脱敏为 `**` | §7.2 |
| D5 | `old-origin` 与 `qa-acceptance/` | `JustinIan-AI/loopx-workflow` 已关停，移除本地 `old-origin` remote；彻底清除 `qa-acceptance/` 及本地孤儿分支 | §7.1、§7.2 |

## 1. 原调研核实结论

| 调研项 | 结论 | 备注 |
|---|---|---|
| `respond-report.js:222` 回落 `os.tmpdir()`，`cmd_respond` 不传 `--output-file`；POST 失败漏删 `report_file` | ✅ 属实 | `bin/loopx-flow:1478-1482` |
| 裸 `mktemp`：`loopx-flow:1461/2881/2898`、`preflight-check.sh:29-30`（无 trap）、`find-polluter.sh:38` | ✅ 属实 | `find-polluter.sh` 为通用 debugging 技能，带 trap |
| `issue-8.test.js` 放行含 `os.tmpdir`/`TMPDIR`/`mktemp` 的行 | ✅ 属实 | 行级正则守卫本身是根因 |
| `authentic-review.js` 按 PR 号固定命名且不清理 | ✅ 属实 | `:161 :173 :1587 :1591 :1629 :1657`；`.loopx/tmp` 现存 14 个残留 |
| `.loopx/` 9 个文件被 Git 跟踪 | ✅ 属实，**且比调研更严重** | 4 个含真实飞书 `chat_id` 与多维表格 `base_token`；见 §8 历史范围 |
| `workflow-init.sh` 默认写 `$HOME/.codex/skills` | ✅ 属实 | `:24-31` |
| `which` / 外部 `sleep` / `python3` 隐式依赖 | ✅ 属实 | `preflight-check.sh`、`run-ocr.sh`、`ingest-to-loopx-quality.js:603`、`authentic-review.js:144,956`、`run-ocr-audit.sh:37` |
| 6 个单测写 `.tmp-mock-bin*` 到仓库 | ✅ 属实 | 当前工作区残留 `.tmp-mock-bin-review-lock` |
| **调研遗漏**：`REVIEW_RESULT_DIR = '.loopx/reviews'` 是 **CWD 相对路径** | ⚠️ 新增 | `authentic-review.js:68`；在子目录运行会另起一份；已累积 103 个文件、无保留策略 |
| **调研遗漏**：`resolveTmpDir()` 用 `__dirname/../../..` 锚定 | ⚠️ 新增 | 锚的是 *工作流安装目录* 而非 *被操作仓库* |
| **调研遗漏**：`authentic-review.js:191` 的 `-F body=@${postedFile}` 拼成单参数 | ⚠️ 新增 | `spawnSync` 传给 `gh api` 会带前导空格；改 stdin 时须拆成 `['-F', 'body=@-']` |
| **调研遗漏**：本地存在第二远端 `old-origin`（`JustinIan-AI/loopx-workflow`）及 `.codex/` 历史提交 | ✅ 已确认 | `old-origin` 仓库已关停，仅需 `git remote remove old-origin`；`.codex/` 历史随重写一并清除 |

## 2. 对原方案的主要修正

### 2.1 能不落盘就不落盘（删除比收口更好）

- `gh pr comment --body-file -`、`gh api -F body=@-` 均支持 stdin。`cmd_respond` 改为
  `node respond-report.js --print | (cat; printf '\n\n%s' "$marker") | gh pr comment --body-file -`，`report_file` / `posted_file` 消失；`respond-report.js` 的 `os.tmpdir()` 回落分支直接删除（只保留 `--print` 与显式 `--output-file`）。
- `authentic-review.js` 发布 / upsert / `gh pr edit`：`spawnSync('gh', [..., '--body-file', '-'], { input: body })`；PATCH upsert 同步修正参数拆分 `['-X', 'PATCH', endpoint, '-F', 'body=@-']`（修复原 `#L191` 单参数拼接 Bug），彻底删除 `authentic-review-report-*.md`、`authentic-body-*.md`。
- `cmd_todo_lease` 的 `inspect_file` / `acquire_log`、`preflight-check.sh` 的 `doctor_out/err`：改为变量捕获。

原则（与 ADR-0013 一致）：**流优先，文件只在需要被另一个进程按路径读取时才产生**（`loopx pr-review --packet/--check-result`、`change-quality record --result-json`）。

### 2.2 "每次调用一个运行目录"代替 "trap 栈"

```bash
# lib/paths.sh（loopx-flow 与 scripts/* 共享）
_WF_CLEANUP_FILES=()
wf_run_dir() {          # 惰性创建，整个进程只建一次
  [[ -n "${WF_RUN_DIR:-}" ]] && return
  mkdir -p "$LOOPX_TMP_DIR"
  WF_RUN_DIR="$(mktemp -d "$LOOPX_TMP_DIR/${WF_CMD:-flow}.XXXXXX")"
  wf_install_cleanup_trap
}
wf_register_temp_file() {  # 供 approve 原位原子写回等不能进 .loopx/tmp 的文件注册
  _WF_CLEANUP_FILES+=("$1")
  wf_install_cleanup_trap
}
wf_install_cleanup_trap() {
  [[ -n "${_WF_TRAP_INSTALLED:-}" ]] && return
  _WF_TRAP_INSTALLED=1
  trap 'rc=$?; wf_cleanup "$rc"; exit "$rc"' EXIT
  trap 'wf_cleanup 130; exit 130' INT
  trap 'wf_cleanup 143; exit 143' TERM
}
wf_cleanup() {          # 成功即删；失败保留并打印路径供取证
  local rc="${1:-0}" f
  for f in "${_WF_CLEANUP_FILES[@]:-}"; do [[ -n "$f" ]] && rm -f -- "$f"; done
  [[ -z "${WF_RUN_DIR:-}" ]] && return
  if [[ "$rc" == 0 && "${LOOPX_KEEP_TMP:-0}" != 1 ]]; then rm -rf -- "$WF_RUN_DIR"
  else echo "[i] 运行工件保留于: $WF_RUN_DIR" >&2; fi
}
```

Node 侧对应 `fs.mkdtempSync` + `process.on('exit', code => ...)`（以及 `SIGINT`/`SIGTERM` 转发退出码）。一个 trap、一次 `rm -rf`；目录名自带唯一性，内部用可读固定名（`packet.json`、`result.json`、`prompt.md`）；**失败保留**兼顾 ADR-0013 "沙箱留证"与"零残留"。`cmd_approve` 的原位原子临时文件（`04-contract.md.tmp.$$`，为保证同挂载点原子 `mv` 留在原目录）通过 `wf_register_temp_file` 接入统一清理，成功后从数组注销，避免多个 `trap` 互相覆盖。

失败保留的目录由 `loopx-flow gc`（§3.2）按天数回收，避免"失败目录"再次累积。

### 2.3 按所有权分层，而不是"一切进 `.loopx/tmp`"

| 类别 | 所有者 | 位置 | 生命周期 |
|---|---|---|---|
| 权威状态 / 收据（change-quality receipt、todo lease、goal state） | **LoopX** | LoopX `runtime_root`（由 registry 解析，工作流不得自行写） | LoopX 管理 |
| 交付证据（审查报告、AC 证据） | 工作流 | `specs/features/<f>/05-evidence.md` → `specs/archive/` | 进 Git |
| 幂等缓存（`<pr>@<head>.json`） | 工作流 | `$REPO_ROOT/.loopx/cache/reviews/`（D2） | 可丢弃，`gc` 清理 |
| 进程临时工件 | 工作流 | `$LOOPX_TMP_DIR/<cmd>.XXXXXX/` | 成功即删，失败保留至 `gc` |

## 3. 双根路径锚定

新增唯一路径模块 `lib/paths.sh` + `lib/paths.js`，其他文件禁止自行推导：

| 名称 | 含义 | 求值 |
|---|---|---|
| `WORKFLOW_ROOT` | 工作流代码/技能资产所在 | 脚本自身位置（`pwd -P` 规范化） |
| `REPO_ROOT` | 被操作的目标仓库（当前 worktree） | 惰性求值：`git -C "$PWD" rev-parse --show-toplevel`；非 Git 仓时返回空，由命令按需调用 `require_repo_root` fail-closed（避免误伤 `help` 与 `preflight-check.sh --fix` 的首次 `git init`） |
| `LOOPX_REGISTRY` | LoopX 项目注册表 | 全局 `--registry <path>` > `LOOPX_REGISTRY` env > `$REPO_ROOT/.loopx/registry.json` > LoopX 自报的运行时 registry（`loopx --format json status` 的 `registry`，仅非附属 worktree；[ADR-0024](../adr/0024-resolve-runtime-registry-from-loopx.md)）；按命令矩阵在入口 fail-closed（D1） |
| `LOOPX_TMP_DIR` | 临时沙箱 | env > `$REPO_ROOT/.loopx/tmp`（每个 worktree 各自一份，天然隔离；非 Git 仓的 `preflight` 等场景安全回退到 `$WORKFLOW_ROOT/.loopx/tmp` 或变量捕获） |

资产读取用 `WORKFLOW_ROOT`；一切数据读写（`.loopx/*`、`specs/*`、git 操作、`--repo-path`、`npm --prefix` / `cd "$REPO_ROOT"`）用 `REPO_ROOT`。`bin/loopx-flow` 中 85 处 `PROJECT_ROOT` 逐一归类；CWD 相对路径一律改为基于 `REPO_ROOT`。

- **补齐全局 `--registry <path>` 解析**：当前 `bin/loopx-flow:3028` 只做 `ACTION="${1:-help}"`，尚不支持全局 `--registry` 参数。PR 2 在命令路由前新增全局选项前置解析（支持 `loopx-flow --registry <path> <cmd> ...`），使 D1 提示语与实际 CLI 完全一致。
- **数组传参支持空格路径**：所有 `loopx` 调用统一经 `REGISTRY_ARGS=(--registry "$LOOPX_REGISTRY")` 数组传参（`"${REGISTRY_ARGS[@]}"`），彻底替代不加引号的 `$REGISTRY_FLAG` 字符串展开。

### 3.1 Worktree 缺 registry：fail-closed（D1）

- **全量命令分类矩阵**（明确入口校验策略，消除歧义）：
  - **强制 fail-closed（缺 registry 直接退出）**：`approve`、`gate verify contract`、`check`、`merge`、`todo`（`list`/`claim`/`done`）、`issue`、`integrate`。
  - **诊断 WARN（只读告警，不强停）**：`doctor`、`status`、`status --next`。
  - **纯本地 / 初始化路径（不要求已有 registry）**：`help`、`gc`、`init`（负责 `loopx bootstrap` 生成 registry）、`feature`、`context`、`archive`、`pr`、`review`、`respond`、`release-approve`、`gate verify decisions`。
- **附属 Worktree 判定与主 checkout 候选推导**：
  - 使用规范绝对路径比较：`git_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-dir)"` 与 `common_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"`（兼容旧版 Git 可回退 `cd ... && pwd -P`）；两者不等即为附属 worktree。
  - 仅当 `$(git -C "$REPO_ROOT" rev-parse --is-bare-repository)` 为 `false` 且 `"$(dirname "$common_dir")/.loopx/registry.json"` 真实存在时，才打印主 checkout 候选路径（只提示、绝不自动回指）：
  ```
  [-] [FAIL-CLOSED] 当前 worktree 无 LoopX registry: <REPO_ROOT>/.loopx/registry.json
      可选：(1) 在本 worktree 执行 loopx bootstrap
            (2) 显式指定 --registry <主 checkout>/.loopx/registry.json 或导出 LOOPX_REGISTRY
  ```
- 理由：自动回指会让两个 worktree 共享 goal/todo 租约而操作者不知情，违反 ADR-0007 "显式环境"原则。

### 3.2 `.loopx/reviews/` 降级为缓存（D2）

- **目录迁移与同步改造**：`.loopx/reviews/` → `$REPO_ROOT/.loopx/cache/reviews/`；同步更新 `authentic-review.js`（含 `listReviewArtifactsForPr` 的 T3 节流）、`bin/loopx-flow` `cmd_respond` 的 `--review-dir`、`respond-report.js` 默认路径及相关单测。首次运行若发现旧目录 `.loopx/reviews/`，打印迁移提示并直接忽略（不迁移数据，缓存可重建）。
- **缓存 Schema 升级（支撑命中重验，堵住架构缺口）**：
  - 现有 `loopx_flow_review_artifact_v0`（`authentic-review.js:1181-1192`）**未保存 `evidence` 与 `review_policy_revision`**，无法直接拼出 `loopx pr-review --check-result` 所需的 `pull_request_review_result_v1`。
  - 升级为 `loopx_flow_review_cache_v1`：完整落盘 `result_payload`（含 `evidence`、`review_policy_revision`、`target_exact_head`、`findings`、`verdict`、`review_body`、`reviewer`）；旧 `v0` 文件自动视为 cache miss 触发重跑。
- **缓存命中不得跳过权威校验**：`authentic-review.js:1301` 的 head-oid 幂等改为——命中仅跳过**模型调用**，发布前仍须拉取最新 packet 并对缓存的 `result_payload` 重跑 `loopx pr-review --check-result`，`ok !== true`（或 `review_policy_revision` 已升级）则作废缓存并重新审查，彻底防止本地缓存被篡改或策略过期后绕过核验（ADR-0008：门禁只认 LoopX 实时结果）。
- **缓存缺失时 `respond` fail-closed**：`respond-report.js` 依赖缓存中的 findings；缺失时报错退出并提示先重跑 `loopx-flow review <pr>`（或传 `--result-file`），不得生成空汇报。
- **并发安全的 `loopx-flow gc [--days N] [--force]`**（默认 `N=14`）：
  - 清理 `$REPO_ROOT/.loopx/cache/reviews/` 过期项与 `$REPO_ROOT/.loopx/tmp/` 中保留的失败运行目录；
  - 安全护栏：① 真实路径（`realpath`）前缀校验，且禁止跟随符号链接；② 跳过 mtime 不足 1 小时的目录（除非显式 `--force`），防止误删并行 Agent 正在使用的活跃运行目录。

## 4. 回归守卫：静态白名单 + 动态哨兵 + 提交拦截

1. **静态守卫（同时接入 `scripts/gate-lint.sh` 与 `issue-8.test.js`）**：在 `bin/ scripts/ skills/ lib/` 中禁止 `os.tmpdir(`、`tmpdir()`、不带模板的 `mktemp`、`\bwhich\b`、`python3`、外部 `spawnSync('sleep'`、CWD 相对 `'.loopx/`、字面量 `/Users/` `/home/` `C:\\`；例外须同行标注 `# loopx-allow: <reason>`。删除 `issue-8.test.js:59-64` 的整行放行。
2. **动态哨兵 + 异构环境冒烟**：测试中将仓库复制到**含空格临时路径**并在**子目录**与**附属 worktree**下运行主路径，将 `TMPDIR` 指向空哨兵目录、`LOOPX_TMP_DIR` 指向另一空目录、移除 PATH 中的 `which`/`python3`、使用 `master` 主干分支；断言哨兵 `TMPDIR` 为空、成功路径 `LOOPX_TMP_DIR` 为空、失败路径恰好剩一个运行目录、`$HOME/.codex/skills` 未被改动。
3. **入库守卫 + `pre-commit` 防复发拦截（新增）**：
   - 单测与 `gate-lint.sh` 断言 `git ls-files .loopx .codex qa-acceptance` 为空，并对受跟踪文件扫描飞书凭据形态（`base_token`、`app_secret`、`oc_[0-9a-f]{32}`、`ou_[0-9a-f]{32}`、`cli_[0-9a-f]{16}`）及 `/Users/` `/home/` 绝对路径；
   - 在 `scripts/git-hooks/pre-commit` 增加 staged 内容检查，物理拦截任何暂存 `.loopx/`、`.codex/`、`qa-acceptance/` 或凭据形态的提交（防止 Agent 的 `git add -A` 自动提交复发 R3）；同时审查 `scripts/fast-fix-push.sh:85` 与 `scripts/workflow-init.sh:42` 的 `git add -A` 范围。

## 5. 其他项的调整意见

- **`.loopx/` 入库**：`.gitignore` 收敛为单行 `.loopx/`（LoopX `bootstrap` 的 `private_boundary_note` 原文建议）；示例改放 `docs/examples/` 并用占位符。历史清除见 §6 PR 0。
- **`workflow-init.sh` 全局软链**：改为显式 `--link-global-skills`，目标 `${CODEX_HOME:-$HOME/.codex}/skills`，源路径 `pwd -P`；ADR-0007 追加修订。
- **跨平台与主干兼容性**：
  - `which` → `command -v`；Node `findOnPath()` / `resolveLoopxExecutable()` 统一放入 `lib/paths.js`（替换 `ingest-to-loopx-quality.js:603` 与 `authentic-review.js:956`）；`authentic-review.js:144` 用已有 `sleepSync()`；`run-ocr-audit.sh` 改 `node -e` 去 `python3`；
  - `bin/loopx-flow:157` 优先尊重 `CODEX_HOME` 而非硬编码 `.codex`；`bin/loopx-flow:621-622` 将非 POSIX `\bScope\b` / `\bVerification\b` 改为与 `#L620` 一致的 POSIX ERE 边界；
  - `authentic-review.js:677,1266`、`run-ocr-audit.sh:19`、`run-ocr.sh:11` 统一复用 `discoverBaseRef(repoRoot)`，移除 `origin/main` 硬编码（兼容 `master` 仓库）。
- **`init --reconfigure` / 身份错配**：拆为独立 PR 4（属 ADR-0012 授权语义）。
- **测试隔离**：`tests/helpers/sandbox.js`（`mkdtempSync` 生成 mock-bin、`LOOPX_TMP_DIR`、`cwd`，`after()` 清理），6 个测试迁移；完成后删除 `.tmp-mock-bin*` ignore 规则。
- **证据中的本机绝对路径**：`specs/archive/env-governance/05-evidence.md`、`specs/features/review-pipeline-throttle/05-evidence.md` 曾含 `/Users/<user>/...`。今后证据写入统一用占位符（`<loopx-runtime-root>`，与 LoopX `worker_bridge.LOOPX_RUNTIME_ROOT_PLACEHOLDER` 一致；`<repo-root>`），由写入证据的脚本替换；存量在 PR 2 中一并脱敏（非凭据，不需重写历史）。
- **非目标 / 后续独立跟踪**：`ingest-to-loopx-quality.js` 中 `scanDiffForDefects()` 与硬编码 `reviewed_final_scope: true` 的"质量收据模板化"问题属质量评估语义（ADR-0011），不在本路径/临时工件专项中混改，单开 Issue 独立推进。

## 6. 建议批次（单 PR ≤ 500 行）

| PR | 内容 | ADR |
|---|---|---|
| **维护窗口 0a：历史清除（先于一切，非 PR）** | 见 §7 完整步骤：凭据失效 → 冻结 & 处置 `old-origin` → `git filter-repo` 重写全部分支与 tag → Owner 临时豁免强推 → 核查 `v1.0.0` Release & 申请 GitHub 清缓存 → 销毁旧本地克隆与 worktree 后重新克隆 | 无（纯维护操作，产出本地 `commit-map`） |
| **PR 0b（可并入 PR 1）：ADR-0014 + 卫生止血** | 提交 ADR-0014（记录豁免窗口与重写审计，**不公开裸旧 SHA 列表直至 GitHub 确认缓存清除**）；`.gitignore` → `.loopx/`；`pre-commit` 增加 staged 敏感/运行态拦截；示例脱敏到 `docs/examples/`；`workflow-init.sh` 改 opt-in；入库守卫接入 `gate-lint.sh` 与单测（§4.3） | 新增 ADR-0014 + ADR-0007 修订 |
| **PR 2a（Shell 底座）** | `lib/paths.sh` 双根 + 全局 `--registry` 解析 + `REGISTRY_ARGS` 数组 + worktree registry fail-closed 矩阵；`wf_run_dir` + 信号清理；`cmd_respond` stdin 化；变量捕获替换裸 `mktemp`；`gc`（并发安全）；`preflight`/`ocr`/`loopx-flow` 跨平台与 `discoverBaseRef`、`CODEX_HOME`、POSIX ERE 修复 | ADR-0007 修订（运行目录 + 所有权分层 + worktree registry） |
| **PR 2b（Node 审查底座 + 守卫）** | `lib/paths.js`；`respond-report.js` 去 `os.tmpdir()`；`authentic-review.js` 运行目录 + stdin 发布（含 `-F` 拆分修复）+ `cache/reviews` v1 Schema 命中重验 + `discoverBaseRef` + `sleepSync`；`ingest-to-loopx-quality.js` 复用 `lib/paths.js`；证据路径占位符脱敏；静态白名单接入 `gate-lint.sh` + 动态/异构环境冒烟测试 | ADR-0013 注明 prompt 留证改为"失败保留" |
| **PR 3 测试隔离** | `tests/helpers/sandbox.js` + 6 个测试迁移，删除 `.tmp-mock-bin*` ignore 规则 | 无 |
| **PR 4 身份迁移（独立）** | `doctor` 身份错配 WARN；`init --reconfigure`（TTY、人类执行） | ADR-0012 修订 |

维护窗口 0a 执行后原先的 `git rm --cached` 步骤不再需要（文件已从所有历史中移除）。PR 2 已预先按 Shell / Node 拆为 2a / 2b，保证单 PR ≤ 500 行。

## 7. PR 0：历史重写执行步骤（D3）

> [!CAUTION]
> 仓库为 **PUBLIC**，已有 **1 个 fork**（`amamibamihong/loopx-workflow`）。重写历史**无法收回已公开的内容**：fork、GitHub 的 `refs/pull/*`、缓存视图、任何已克隆副本都可能仍保留旧提交。因此**凭据失效（步骤 1）是必须项，重写历史只是第二道措施**。

### 7.1 清除范围（比 9 个现存文件大）

历史扫描结果：

- `.loopx/` 下历史上出现过 17 个路径，除 4 个配置文件外还有 `registry.json`、`goals/*/ACTIVE_GOAL_STATE.md`、**`inbox/e2e-pipeline-demo/om_*.json`（飞书消息原文，可能含成员信息）**、各类 `.lock`。
- `.codex/` 下历史上曾被跟踪过 `.codex/goals/hard-guard-feature/ACTIVE_GOAL_STATE.md` 与 `.lock`（提交 `b64bdd7` 之前）。
- 同一 `base_token` / `chat_id` 还出现在 `qa-acceptance/.loopx-baseline-before/` 下（提交 `6ac8afc` "chore(agent): uncommitted changes from task"，位于分支 `agent/qa-verifier/tre-41`，24 个文件 2323 行，是 Agent 自动提交把本地运行态一并扫入的）。
- 泄露字面量不止 `base_token` 与 `chat_id`，还包括飞书 `bot_app_id`/`sender_profile`（`cli_*`）、用户 `sender_id`（`ou_*`）、多维表格 `table_id`（`tbl*`）与 `view_id`（`vew*`）、消息 ID（`om_*`）。
- **远端真实盘点（`git ls-remote origin` 实测）**：
  - `old-origin`（`JustinIan-AI/loopx-workflow`）已彻底关停，只需在本地执行 `git remote remove old-origin`。
  - `origin`（`JustinIanAI/loopx-workflow`）实际仅有 **7 个分支、0 个 tag**（`main` + 6 个已合入/过期的 `feature/*`、`fix/*`、`task/*` 分支）；此前看到的 25 个分支大部分仅在本地与已关停的 `old-origin`；`agent/qa-verifier/tre-41`（含 `qa-acceptance/`）与 `v1.0.0` tag **均未推送到 `origin`**。
  - `origin` 当前有 2 个 Star、1 个 fork（`amamibamihong/loopx-workflow`）、1 个 open PR（#23）、2 个 open Issue（#6、#21）。
- 结论：本地按**路径整体清除** `.loopx/`、`.codex/` 与 `qa-acceptance/`，再用 `--replace-text` 将全部飞书标识字面量替换为 `**`，删除除 `main` 外全部旧分支。

### 7.2 步骤

1. **权限核查（人类执行，不改本地配置、不影响继续使用）**：
   - 多维表格：保持本机 `.loopx/lark-kanban.json` 原样不变（不入库，继续正常同步）；在飞书多维表格中确认已关闭“互联网获得链接的人可访问”，仅协作者/组织内可见。
   - 群聊与机器人：确认 `chat_id` 群与机器人权限范围仅限组织内部；若有 `app_secret` 曾暴露则重置。
2. **本地净化（两种线上策略共用）**：
   - 本机另建干净备份目录（单独备份你本机要保留的 `.loopx/` 运行态配置如 `lark-kanban.json`、`registry.json`），在独立克隆中执行：
   ```bash
   # replacements.txt 仅在本机仓外生成、用完销毁，每行形如 <泄露字面量>==>**
   # 覆盖：base_token / chat_id / bot_app_id(cli_*) / sender_id(ou_*) / table_id / view_id / om_*
   git filter-repo --refs refs/heads/main \
     --invert-paths --path .loopx/ --path .codex/ --path qa-acceptance/ \
     --replace-text /path/outside/repo/replacements.txt
   ```
   - 验证：`git log --all -S <敏感字面量>` 为空、`git log --all -- .loopx .codex qa-acceptance` 为空；移除旧本地分支、旧 worktree（`feature/review-evidence-graph-r2`）与 `old-origin` remote。
3. **线上重置（二选一，均只推送干净的 `main` 单分支）**：
   - **路径 A（暴力删库重建 — 最彻底、免工单）**：
     - 备份 Issue #6、#21 文本 → GitHub 删除并重建同名仓库 `JustinIanAI/loopx-workflow`（`refs/pull/*` 与旧 commit 缓存物理清零，无需等 GitHub Support）→ 推送干净 `main` → 运行 `scripts/setup-branch-protection.sh --apply` 重建分支保护 → 开启 Secret scanning + Push protection → 重建 Issue #6。
     - 代价：丢失历史 36 个 PR 讨论记录与 2 个 Star；现有 1 个公开 fork 会自动脱离成为独立仓库（fork 内旧历史需靠步骤 1 权限兜底）。
   - **路径 B（保留仓库、原地删 6 旧支 + 强推 `main` — 保留全部 PR/Issue）**：
     - Owner 临时停用规则集 `mprotect` → 删除远端 6 个已合入旧分支 → `git push --force origin main` → 立即恢复 `mprotect` → 提 GitHub Support 工单清除 `refs/pull/*` 缓存 → 开启 Secret scanning + Push protection。
     - 代价：需等 GitHub Support 处理 `refs/pull/*` 缓存；优点：完整保留全部 Issue / PR 审查轨迹与规则集。
4. **本地收尾**：
   - 删除旧克隆与旧 worktree，从新 `origin` 重新 `git clone`；
   - 恢复本机私有 `.loopx/`（已被 `.gitignore` 忽略，不影响飞书继续使用），或执行 `loopx bootstrap`；
   - 在新 `main` 上走正常 PR 0b / PR 1 提交 ADR-0014、`.gitignore` 单行 `.loopx/` 与 `pre-commit` 防复发拦截。

### 7.3 重写的连带影响

- **所有提交 SHA 改变**。受影响：
  - `specs/archive/*` 中证据与 Gate 授权记录锁定的 SHA、PR head；
  - `.loopx/cache/reviews/<pr>@<head>.json`（D2 后本就可丢弃，直接清空）；
  - LoopX `runtime_root` 下按 head/diff 键控的 change-quality 收据与 PR readiness 观察。
- 处置（安全时序修正）：在 GitHub Support 确认清除缓存前，旧 SHA 仍可通过 `/commit/<old_sha>` 访问，因此 **不将原始 `commit-map` 直接公开入库**；由 Owner 离线保存 `commit-map`，仅在 GitHub 确认缓存清除后再决定是否入库为 `docs/adr/0014-commit-map.txt`（或仅在 ADR-0014 中记录维护窗口、受影响范围与新基线 SHA）。不回改归档证据（保持证据不可变性）。
- 已合并 PR 页面上的 commit 链接会失效，属可接受代价，写入 ADR-0014。

## 8. 遗漏反思（第二轮 + 第三轮深度核查）

| # | 遗漏 | 影响 | 处置 |
|---|---|---|---|
| R1 | 仓库是公开的且已被 fork，单靠重写历史抹不掉 | 凭据实际已公开 | §7 步骤 1：凭据失效优先，重写为辅 |
| R2 | 泄露面不止 `.loopx/` 4 个文件：还有 `qa-acceptance/` 基线副本、飞书消息原文 `inbox/om_*.json` | 只清 4 个文件仍有残留 | §7.1 按路径整体清除 + 字面量替换兜底 |
| R3 | **根因是 Agent 自动提交**（`chore(agent): uncommitted changes from task`）把运行态扫进了 Git | 不修就会复发 | `.gitignore` 收敛为 `.loopx/`；入库守卫测试；开启 Push protection；排查产生该提交的 Agent/工具配置，改为禁止 `git add -A` 式自动提交 |
| R4 | 规则集 `mprotect` 禁止强推，重写需要 Owner 临时停用保护 | 流程上与 Gate 体系冲突 | 只由 Owner 手工操作，ADR-0014 记录豁免窗口 |
| R5 | 重写后 SHA 全变，归档证据、Gate 授权记录、LoopX 收据失去对应 | 审计链断裂 | §7.3 保存 `commit-map` + ADR 说明，不回改证据 |
| R6 | 缓存命中会跳过审查直接发布 | 降级为缓存后可能被绕过 | §3.2 命中仍须重跑 `--check-result` |
| R7 | `respond` 依赖缓存中的 findings | `gc` 后静默产出空汇报 | §3.2 缺失即 fail-closed |
| R8 | 失败保留的运行目录同样会累积 | 新的泄漏点 | `gc` 一并回收 |
| R9 | 证据文件中写入了本机绝对路径 `/Users/<user>/...`；`goal-channel.json` 的 `config_path` 也是绝对路径 | 公开仓库泄露本机用户名；第三方无法复用 | 证据写入改用占位符，存量脱敏（§5）；静态守卫禁止 `/Users/`、`/home/` 字面量 |
| R10 | registry fail-closed 若对所有命令生效会误伤 `help`/`gc` | 可用性下降 | §3.1 给出全量命令分类矩阵，只对需要 LoopX 状态的命令校验 |
| R11 | 本地环境缺 `git-filter-repo` | PR 0 无法直接执行 | 执行前 `brew install git-filter-repo` 或 `pipx install git-filter-repo` |
| R12 | **存在第二远端 `old-origin`（`JustinIan-AI/loopx-workflow`，19 分支）** | 只强推 `origin` 仍留整套公开泄露历史 | §7.1/§7.2 纳入 `old-origin` 删除/私有化或同步重写 |
| R13 | **泄露面还含 `.codex/` 历史提交及 `cli_*`/`ou_*`/`tbl*`/`vew*`/`om_*` 标识** | 只替换 2 个字面量会留残余标识 | §7.1/§7.2 补齐 `--path .codex/` 与全量飞书标识替换 |
| R14 | **提前公开 `commit-map` 会暴露可反查的旧 SHA**（GitHub 清缓存前 `/commit/<old>` 仍可读） | 等于给外界递上旧泄露提交索引 | §7.3 改为 Owner 离线保存，待 GitHub Support 确认清缓存后再决定是否公开 |
| R15 | **D1 提示语写了 `--registry <path>`，但 `bin/loopx-flow` 尚未解析全局 `--registry` 参数** | 报错给的修复命令跑不通 | §3 明确在路由前实现全局 `--registry` 解析；并保留 `preflight --fix` 非 Git 仓冷启动 |
| R16 | **D2 要求缓存命中重跑 `--check-result`，但现行缓存 `v0` 没存 `evidence` 和 `review_policy_revision`** | 实施时无法组装 `pull_request_review_result_v1` | §3.2 升级缓存为 `v1` 保存 `result_payload`，旧 `v0` 自动 miss |
| R17 | **`authentic-review.js:191` 的 `-F body=@...` 单参数拼接 Bug** | PATCH upsert 静默失败回落重复 POST | §2.1 改为 stdin 时拆成 `['-F', 'body=@-']` |
| R18 | **`gc --days 0` 可能误删并行 Agent 活跃运行目录或跟随符号链接** | 多 Agent 并发冲突/越界删除 | §3.2 增加 1 小时活跃保护窗（除非 `--force`）与 `realpath`/禁跟随符号链接 |
| R19 | **非 `main` 仓库（`master`）在 `authentic-review.js` / OCR 脚本仍有 `origin/main` 硬编码；`bin/loopx-flow` 含非 POSIX `\b` 与写死 `.codex`** | 第三方 `master` 仓、Alpine/BusyBox、自定义 `CODEX_HOME` 失效 | §5 统一迁至 `discoverBaseRef()`、POSIX ERE 与 `${CODEX_HOME:-$HOME/.codex}` |
| R20 | **防复发未落到 `pre-commit` Hook 与 `gate-lint.sh`** | Agent `git add -A` 仍可能在单测前把敏感/运行态提交进本地历史 | §4 补齐 `scripts/git-hooks/pre-commit` staged 拦截与 `gate-lint.sh` 静态守卫 |

## 9. 仍待确认

1. **线上清理选路径 A 还是路径 B**（§7.2 步骤 3）：
   - **路径 A（删库重建）**：最彻底（物理清零 `refs/pull/*`、免 Support 工单），代价是丢 36 个历史 PR 讨论和 2 个 Star；
   - **路径 B（保留仓库，删 6 旧分支 + 强推 `main`）**：保留全部 PR/Issue 讨论，同样只需推 1 个分支，代价是需提 GitHub Support 工单清 `refs/pull/*` 缓存。
2. 选定路径 A 或 B 后，由 Owner 确认执行时间窗口（若选 B 需临时停用 `mprotect`；若选 A 需在 GitHub 页面删库重建并恢复分支保护）。
