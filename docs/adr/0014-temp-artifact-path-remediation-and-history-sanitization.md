# ADR-0014：临时工件与路径映射治理及历史凭据净化

- **状态**：Accepted
- **日期**：2026-11-19

## 背景

对 `loopx-workflow` 仓库与历史提交的全面静态/运行时审计暴露了四类系统性缺陷：

1. **临时工件泄漏与并发覆写**：`respond-report.js` 回落 `os.tmpdir()`；`bin/loopx-flow`、`preflight-check.sh` 存在裸 `mktemp` 与泄漏路径；`authentic-review.js` 按 PR 号写固定文件名且不清理；`issue-8.test.js` 行级白名单放行了含 `os.tmpdir`/`TMPDIR`/`mktemp` 的违规行。
2. **路径锚定与跨平台隐患**：`resolveTmpDir()` 锚定安装目录而非目标 Git 仓库根；`.loopx/reviews/` 使用 CWD 相对路径；存在 `which`、`python3`、外部 `spawnSync('sleep')`、`origin/main` 硬编码及非 POSIX `\b` 正则；`workflow-init.sh` 默认写入宿主机 `$HOME/.codex/skills` 引发多 worktree 污染。
3. **运行态与凭据入库**：受历史 Agent 自动提交影响，`.loopx/` 下运行态与飞书配置（含 `chat_id`、`base_token` 等标识）、`.codex/` 与 `qa-acceptance/` 曾进入 Git 历史；部分 `05-evidence.md` 记录了宿主机绝对路径。
4. **评审缓存边界不清**：`.loopx/reviews/` 缺少 schema 完整性与生命周期治理，缓存命中曾直接跳过 `loopx pr-review --check-result` 权威复核。

## 决策

1. **D1（Worktree 缺 registry 强制 fail-closed）**：建立 `lib/paths.sh` 与 `lib/paths.js` 作为编排层唯一路径模块，分离 `WORKFLOW_ROOT` 与 `REPO_ROOT`；仅对依赖 LoopX 状态的命令（`approve`/`gate verify contract`/`check`/`merge`/`todo`/`issue`/`integrate`）强制校验 registry，附属 worktree 缺 registry 一律 fail-closed 并仅提示主 checkout 候选，支持全局 `--registry <path>`（支持含空格路径）或 `LOOPX_REGISTRY`。
2. **D2（评审缓存降级与命中重验）**：`.loopx/reviews/` 迁移至 `$REPO_ROOT/.loopx/cache/reviews/`，缓存格式升级为 `loopx_flow_review_cache_v1`（含完整 `result_payload`）；缓存命中仅跳过模型调用，发布前仍拉取最新 packet 并重跑 `--check-result`；新增 `loopx-flow gc [--days N] [--force]` 回收过期缓存与失败运行目录（含 1 小时活跃保护窗与禁跟随符号链接护栏）；`respond-report.js` 缺缓存直接 fail-closed。
3. **流优先 + 唯一运行目录生命周期**：`cmd_respond`、`authentic-review.js` 发布/upsert、`gh pr create/edit` 全链路使用 stdin，不再落盘正文临时文件；确需跨进程文件路径的运行产物落入 `LOOPX_TMP_DIR/<prefix>-XXXXXX/`，成功即删、失败留证。
4. **D3/D4/D5（历史净化与仓库边界收敛）**：
   - `.gitignore` 收敛为单行 `.loopx/`，脱敏示例迁移至 `docs/examples/`；
   - 移除已关停远端 `old-origin`、清理旧本地分支与临时 worktree；
   - 选定 **路径 B（保留 GitHub 仓库与 PR/Issue 历史）**：由 Owner 核查关闭飞书外部公开链接权限、临时停用分支保护规则集 `mprotect`，通过 `git filter-repo` 从 `main` 历史整体清除 `.loopx/`、`.codex/`、`qa-acceptance/` 并将历史飞书标识字面量替换为 `**`，删除远端 6 个已合入旧分支，将干净 `main` 连同本次治理改动一次性强推至 `origin/main`，随后立即恢复 `mprotect`、开启 Secret scanning / Push protection 并提交 GitHub Support 工单清理 `refs/pull/*` 缓存。
   - 审计与安全时序：不在公开仓库暴露重写前的原始旧 SHA 映射表（防止 GitHub 清理缓存前被反查）；`commit-map` 由 Owner 离线保存。已归档证据保持不可变，仅对现存含宿主机绝对路径的证据文件做 `<repo-root>` / `<loopx-runtime-root>` 占位符脱敏。
5. **三层防复发守卫**：
   - `scripts/git-hooks/pre-commit`：物理拦截 staged 的 `.loopx/`、`.codex/`、`qa-acceptance/`、凭据形态与本机绝对路径；
   - `scripts/gate-lint.sh` + `tests/unit/issues/issue-8.test.js`：静态卫生扫描（零行级宽泛豁免，须显式 `# loopx-allow: <reason>`）+ Git 跟踪边界扫描 + 动态哨兵（含空格路径/子目录/master 主干/无 `which`&`python3`/空 `TMPDIR`/附属 worktree/`gc` 安全测试）。

## 否决

- **否决修改 LoopX 原生包运行态或锁机制**：严格将整改收敛在 `loopx-workflow` 编排层与仓库治理面，避免与 LoopX 后续升级冲突。
- **否决附属 worktree 自动回指主 checkout registry**：静默共享 goal/todo 租约违反显式环境原则。
- **否决仅靠删库重建（路径 A）**：保留已有 PR 审查轨迹与 Issue 上下文，以路径 B + 权限收敛 + GitHub Support 清缓存平衡彻底性与历史连续性。

## 修订

- ADR：`docs/adr/0007-environment-governance.md`（追加双根模块、D1/D2 与 opt-in 全局软链修订）；`docs/adr/0013-align-review-architecture-with-loopx-philosophy.md`（追加运行目录隔离与留证策略修订）。
- 设计：整改实施方案沉淀于 `docs/design/temp-artifact-remediation-plan.md`。
- 退役：废止 `.loopx/reviews/` 旧目录、`respond-report.js` 的 `os.tmpdir()` 兜底、`issue-8.test.js` 宽泛豁免白名单，以及 `.loopx/` 下所有受跟踪运行态文件。

## 不做什么

- 不在本批次混改 `ingest-to-loopx-quality.js` 的质量评估语义（`scanDiffForDefects` / `reviewed_final_scope` 归 ADR-0011 独立跟踪）。
- 不在本批次引入 `init --reconfigure` 授权迁移命令（保留为后续 ADR-0012 独立批次）。
