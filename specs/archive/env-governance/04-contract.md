# Environment Governance 契约（阶段 4 · 断点 1）

- **Contract-Status**: FROZEN & APPROVED BY freecisco_yan@2026-11-05 14:54:08

## 目标

把三类环境级问题前置为可观测、可执行的检查，避免 `loopx-flow` 在 `approve` / `check` / 迁移阶段
以隐晦错误 Fail-Closed（见 ADR-0007）：

1. 控制面路由分裂（`~/.codex/loopx` legacy vs `~/.loopx` target）+ 半迁移残留；
2. 运行时工件（锁文件 / goal 私有状态）进入 Git 跟踪面并污染质量收据证据；
3. GitHub API 频次无预算基线（账号封禁风险）。

## TypeScript 契约（签名冻结）

```ts
// skills/code-review/scripts/ingest-to-loopx-quality.js —— 可被单测引用的纯函数
declare function isRuntimeArtifact(relPath: string): boolean;
// true 当路径属于 .codex/**、.loopx/**、*.lock、node_modules/**、.DS_Store 或空路径

declare function committedScopeFiles(baseCommit: string): string[];
// 仅返回 `git diff --name-only <baseCommit>...HEAD` 中、且 !isRuntimeArtifact() 的文件；
// git 失败或无 baseCommit 时返回 []（不抛异常）

// bin/loopx-flow —— 控制面体检
declare function cmd_doctor_control_plane(): number;
// 返回 0 表示无告警；非 0 表示存在告警（doctor 仅提示，不阻断）。
// 必须覆盖：route 一致性、~/.loopx 半迁移残留、registry 缺 state_file、
// 运行时工件被跟踪、GitHub API 50% 预算基线。
```

## 不变量

- INV-ENV-1: `isRuntimeArtifact()` 对 `.codex/**`、`.loopx/**`、`*.lock` 恒为 `true`；
  对普通源码/文档路径恒为 `false`。收据 evidence refs 不得包含被判定为运行时工件的路径。
- INV-ENV-2: `committedScopeFiles()` 只读取已提交范围（`...HEAD`），不得包含工作区未提交文件。
- INV-ENV-3: 仓库 `git ls-files` 中不得出现 `.codex/` 或 `.loopx/**/*.lock`。
- INV-ENV-4: `doctor` 的控制面检查缺失 `loopx` / `gh` 时必须降级为 WARN 并继续，不得因环境缺失崩溃。
- INV-ENV-6: 写 registry 的测试必须用 `LOOPX_REGISTRY` 隔离；`cmd_gate` 必须读
  `${LOOPX_REGISTRY:-<project>/.loopx/registry.json}`；真实项目 registry 中不得存在缺 `state_file`
  的 goal 记录（该状态会阻塞 `loopx migrate-local-state`）。
- INV-ENV-5: API 预算基线固定为官方上限的 50%（core 2500/h、points 450/min、
  content 40/min 与 250/h），代码中不得写死成 100%。

## 验收

- 单测：`isRuntimeArtifact` 正反例、`committedScopeFiles` 不含工作区改动、`.gitignore` 覆盖、
  `git ls-files` 无运行时工件、`bin/loopx-flow` 含 5 类检查与 50% 基线文案。
- 四门禁全绿；`bin/loopx-flow doctor` 在本机输出控制面告警与预算基线（WARN 不阻断）。
- 收据：修复后 `loopx-flow check` 的 `change-quality record` 可稳定通过（不因锁文件/反向 diff 失败）。
