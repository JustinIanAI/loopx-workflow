# ADR-0024：本地 registry 缺失时向 LoopX 解析运行时 registry

- **状态**：Proposed（机制与单测已落地；置 `Accepted` 需人类 Maintainer 在 PR 的 Gate2 签批）
- **日期**：2026-11-28
- **关联**：[ADR-0007](0007-environment-governance.md)（双根唯一真相模块、D1 worktree fail-closed、「不做第二套 registry 兜底」）、[ADR-0012](0012-delivery-authorization-and-recovery.md)（Gate2 交付授权）、`REQ-FAILCLOSED-1`

## 背景

ADR-0007 规定「所有运行态目录与默认 registry 统一锚定 `REPO_ROOT`」，于是 `lib/paths.sh` 把默认 registry 写成 `<repo>/.loopx/registry.json`。完成 D1 迁移后，权威 registry 实际位于 LoopX 的 `runtime_root`（本机 `~/.loopx/registry.global.json`），项目本地不再有该文件。

2026-11-28 本机实测的三个事实：

1. `loopx --format json status` 在不传 `--registry` 时自报 `"registry":"/Users/<user>/.loopx/registry.global.json"`、`"runtime_root":"/Users/<user>/.loopx"`——LoopX 自己的默认解析就是全局 registry。
2. 本仓库没有 `.loopx/registry.json`。
3. 因此 `bin/loopx-flow` 的 D1 命令矩阵（`approve|check|merge|issue|integrate|todo`，`bin/loopx-flow` 入口 case）与 `gate verify contract` 全部 fail-closed：`todo list` 直接报「本地 LoopX registry 缺失」。

后果不是「少一个便利」，而是**交付链路整体不可执行**：人类在 GitHub 留下 `gate=1`/`gate=2` 评论之后，`approve`/`check`/`merge` 仍然拒绝运行。这直接违反 `REQ-FAILCLOSED-1` 的意图——fail-closed 应拦截「无法核验」，而不是拦住「权威状态在别处且可核验」。

## 决策

1. **编排器不猜路径，向 LoopX 索取。** 新增 `lib/paths.sh#wf_loopx_default_registry`：调用 `loopx --format json status`，取返回的 `registry` 字段；只有该路径真实存在时才采用。不硬编码 `~/.loopx/registry.global.json`，因为 `--runtime-root`、`HOME` 与自定义安装都可能改变真实位置。
   - 判据是**输出能否解析**，不是退出码：本机实测 `loopx --format json status` 在 `ok:false`（registry 内存在既有契约错误）时仍打印含 `registry` 的合法 JSON，退出码为 1。若把非 0 当失败，解析器会在最需要它的机器上失效。
2. **触发条件严格限定。** 仅在「未显式指定 `--registry` / `LOOPX_REGISTRY`」**且**「非附属 worktree」**且**「`<repo>/.loopx/registry.json` 不存在」时生效。本地文件存在时，行为与今天逐字节一致（不多跑一次 `loopx status`，仍以本地为准）。
3. **不放宽 fail-closed。** 解析失败（`loopx` 缺失、输出不可解析、返回路径不存在）一律落到原有阻断分支，报错文案与今天一致。语义从「文件不存在即阻断」收紧为「文件不存在**且**无法解析权威位置才阻断」。
4. **附属 worktree 不参与解析。** ADR-0007 D1 的隔离语义不变：worktree 缺 registry 直接 fail-closed，只提示主 checkout 候选路径，绝不自动回指，也不调用 `loopx status`。
5. **显式路径错误单独诊断。** `--registry`/`LOOPX_REGISTRY` 指向不存在的文件时报「显式指定的 LoopX registry 不存在」，与「本地缺失」区分开，避免人按错误提示去 `loopx bootstrap` 覆盖自己写错的路径。
6. **不创建、不复制、不迁移任何 registry 文件。** 编排器只读 LoopX 的自报结果。

## 否决

- **硬编码 `$HOME/.loopx/registry.global.json`**：忽略 `--runtime-root` 与自定义 `HOME`，在 CI/容器里会指向错误位置，且把安装布局烧进编排层。
- **缺失即放行（不传 `--registry`）**：`gate verify contract` 需要读取 registry 做 `contract_revision` 物理锁核验，拿不到文件就只能跳过核验——那是真正的放宽。
- **自动执行 `loopx bootstrap` 补齐本地 registry**：写控制面副作用，且会制造第二份 registry（ADR-0007 明确禁止）。
- **在 worktree 内回落全局 registry**：破坏 D1 隔离，多 worktree 并行时会互相污染 state 面。

## 影响与修订

- `lib/paths.sh`：新增 `wf_loopx_default_registry`；`wf_require_registry` 在 worktree 分支之后插入解析分支，并新增显式路径错误文案。
- `tests/unit/registry-default-resolution.test.js`：本地存在（不探询）/ 本地缺失可解析（放行并透传路径）/ 本地缺失不可解析（仍阻断）/ 显式路径不存在（阻断且不探询）四组用例。
- `docs/design/temp-artifact-remediation-plan.md` 的 `LOOPX_REGISTRY` 求值顺序补第 4 级。
- `tests/unit/issues/issue-8.test.js` 的 worktree 用例同时是「worktree 不探询」的回归锚点（该用例断言 fail-closed 时零 `loopx` 调用）。
- 与 ADR-0007 的关系：ADR-0007 的「不做第二套 registry 兜底」指不新建/不复制 registry 文件，本 ADR 不创建任何文件，只修正默认值在 D1 迁移后的指向。

## 不做什么

- 不改变 Gate1/Gate2 的授权模型与人类授权动作。
- 不改变 `LOOPX_TMP_DIR`、`.loopx/cache/` 等其它路径锚定。
- 不为多 project 场景引入 registry 选择器或路由表。
