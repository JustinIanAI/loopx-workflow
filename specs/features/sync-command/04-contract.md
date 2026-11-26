# sync-command 契约

- **Contract-Status**: DRAFT (Pending Approval)
- 引用：REQ-FACADE-1、REQ-FACADE-2、REQ-FAILCLOSED-1；ADR-0003、ADR-0007、ADR-0009。

## 拟冻结 TypeScript 签名与断言不变量

以下为 CLI 行为规格类型，实施仍为 Bash，不新增运行时 TypeScript 模块。

```ts
type SyncOptions = Readonly<{ goalId?: string }>;
type SyncExitCode = 0 | 1 | 2;
interface SyncCommandContract {
  parse(argv: readonly string[]): SyncOptions; // 参数错误映射 exit 2
  execute(options: SyncOptions): SyncExitCode;
}
```

不变量：无 goalId 时不发送 --goal-id；显式值以单个 argv 元素传递；不自行验证 Goal 存在性或重写 LoopX 结果；只同步所选 registry；最多三次同步尝试（沿用 helper 的 1 秒等待）；耗尽失败 exit 1。错误参数在任何原生调用之前退出。无新 schema、审批、Goal、租约或生命周期副作用。

## Scope / 文件清单

| 文件 | 实施时改动 |
| --- | --- |
| `bin/loopx-flow` | usage、cmd_sync、sync 路由；解析成功后检查 loopx、调用 wf_require_registry，再委托 sync_global_required；成功才打印完成 |
| `tests/unit/sync-command.test.js`（新增） | 真实入口的隔离行为测试，argv 与尝试次数断言，复用 m0-sandbox 模式 |
| `README.md` | 新入口示例、失败及重跑指引 |
| `docs/prd/loopx-workflow.md` | REQ-FACADE-1 命令表加入 sync，REQ-FAILCLOSED-1 明确新入口同等失败语义 |
| `docs/design/loopx-workflow-design.md` | 命令表、依赖、输出及失败矩阵与追溯 |
| `specs/features/sync-command/*` | 授权状态、实际证据；05-evidence 的实施结果由 ingest 生成 |

不修改 lib/paths.sh、原生 LoopX、feature/approve/merge 的现有调用，不开放 --replace-state/--dry-run，不处理 Issue #6 其他条目。共享 helper 原样复用，成功的底层输出目前被 helper 捕获，因此本入口只给完成摘要，不承诺转发原生 stdout/JSON。

## 参数与错误边界

- `sync`：同步显式/环境/本仓所选 registry 的全部 Goal，不推断当前 feature。
- `sync --goal-id <gid>`：仅接受一次分离形式；非空、非全空白、不得以 `-` 开头。其他合法字符串整体传递，存在性由 LoopX 裁决。
- 独立 `sync --help` 或 `sync -h`：exit 0，不要求 registry/loopx，不调用底层。与其他参数混用视为错误。
- 缺值、空值、重复 --goal-id、未知参数（含 --goal-id=...）、位置参数、多余参数：stderr 给原因和 usage，exit 2，不同步。
- 缺 loopx 或 registry：stderr 给失败原因及修复步骤，exit 1；不自动 bootstrap、不回指其他 worktree。
- `--registry <path>` / LOOPX_REGISTRY 遵循已有优先级，经 run_loopx 数组传递；含空格路径保持一个参数。
- 持续失败（含未知 Goal、锁或路由冲突）：helper 三次尝试后原有 FAIL-CLOSED 与最后输出，exit 1；不打印完成。保留 helper 原生修复指引，并给 `loopx-flow [--registry <path>] sync [--goal-id <gid>]` 重跑说明。不能把 source/global 文件已部分变化解释为未发生副作用，不回滚原生写入。

## AC 矩阵 / Acceptance Criteria

| Story | AC | 可观察结果 | Test |
| --- | --- | --- | --- |
| Story-1 | AC-1 | 无参仅调用 sync-global，不猜测 Goal | T1 |
| Story-1 | AC-2 | 显式 Goal 与 registry argv 精确且不拆空格 | T2 |
| Story-1 | AC-3 | 错参 exit 2，零底层调用，help exit 0 | T3 |
| Story-1 | AC-4 | 缺 CLI/registry exit 1，零同步，无隐式环境修复 | T4 |
| Story-1 | AC-5 | 首败后成功 exit 0；连续三败 exit 1，保留诊断，无成功提示 | T5 |
| Story-1 | AC-6 | 文档、usage 一致，生命周期/审批旧流程回归通过 | T6 |

## Verification Plan

- T1：隔离 Git 仓库中运行真实 bin/loopx-flow，在 feature 与普通分支分别无参执行；记录 mock loopx argv，断言无 Goal 及无额外控制命令。
- T2：指定 Goal、带空格 registry、LOOPX_REGISTRY、显式覆盖环境；逐元素比较 argv。使用 helper 的唯一临时目录并 finally 清理，隔离 HOME/global registry，验证宿主指纹未改。
- T3：缺值、空/全空白值、后接 flag、重复（相同/不同值）、未知/多余/位置参数/等号形式、help 混用的参数矩阵；独立 -h/--help 在无 registry/loopx 时通过。错误所有 mock 调用为零。
- T4：无 loopx 的受控 PATH；无 registry 普通仓库与 linked worktree；非 Git 目录。不得同步或落盘。
- T5：mock 跨进程记录尝试：首败后二次成功、第三次成功、三次全败；诊断含最后输出，最终失败无完成摘要。不把底层 exit 7 承诺为门面 exit 7，门面统一 exit 1。
- T6：既有 fail-closed-remediation / merge-compensation / workflow / path 隔离测试 + 全量 `npm run typecheck && npm run lint && npm run build && npm run test`。仅有 mock 通过不能声称真实跨 registry 验证；真实 canary 若执行须用隔离 HOME/registry 并清理，不能碰宿主全局 registry。

## Dependency Order / 任务图

人类确认 01-decisions → 提交 clean specs → TTY 正式 Gate1（锁最终契约 SHA + user_gate）→ gate verify → claim 实施 todo → T1–T5 先红 → 薄入口实现 → T1–T6 及四门禁 → check/审查/集成 → Gate2。PR #73/#76 仅存在文件重叠，实施前重核 main，无必须等待其合入的功能依赖。
