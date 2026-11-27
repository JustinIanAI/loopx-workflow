# capability-probe 门禁与质量凭据

> 本文件按 AGENTS.md 六状态口径记录本地证据。LoopX `change-quality` 收据当前 **deferred**（原因见末节），
> 待 Goal 注册后由 `skills/code-review/scripts/ingest-to-loopx-quality.js` 重新生成并覆盖本文件。

- **日期**：2026-11-27
- **基线**：`origin/main@491440c`（PR #80 合并后）
- **记录 head**：代码 head `1476960`（规格补齐 + 合并 `main@491440c` 之后）；本文件随后的文档回填不改变代码与用例数

## 四大硬门禁

| 门禁 | 命令 | 状态 | 证据 |
|---|---|---|---|
| Typecheck | `npm run typecheck` | passed | `tsc --noEmit` 退出 0 |
| Lint | `npm run lint` | passed | 5/5 静态核验 PASS |
| Build | `npm run build` | passed | 退出 0 |
| Test | `npm run test` | passed | **344 / 344**，0 fail（合并 #80 后新增 14 个审查管线用例） |

## 专项证据

| 证据 | 状态 | 备注 |
|---|---|---|
| `node --test tests/unit/capability-probe.test.js tests/unit/capability-gate-dispatch.test.js` | passed | 18 / 18 |
| bash 5.3 变量展开回归（`（scope=${cap_scope}）`） | passed | 修复前该 P0 用例在 macOS + Homebrew bash 5.3 下必红 |
| 真实 `loopx 2.3.0` 金丝雀 | passed | 本机 `loopx 2.3.0` 可用时执行；不可用时按 skip |
| 成功路径 stdout 静默（`require_success_is_quiet`） | passed | `--format quiet` |

## 逐条 AC 对照

| AC | 状态 | 证据 |
|---|---|---|
| AC-1 缺 Flag / 子命令 → BLOCK | passed | `capability-probe.test.js` T2 系列 |
| AC-2 未知 / 缺失 schema → 非 0 | passed | `capability-probe.test.js` T3 系列 |
| AC-3 版本漂移仅 WARN | passed | `capability-probe.test.js` T5 |
| AC-4 矩阵输出且恒 exit 0 | passed | `formatMatrix` + doctor 用例 |
| AC-5 6 个 L0 命令前置非 0 | passed | `capability-gate-dispatch.test.js` |
| AC-6 成功门 stdout 干净 | passed | `require_success_is_quiet` |
| AC-7 check / pr 无参用法 | passed | dispatch 无参用例 |
| AC-8 UNKNOWN 诊断卡含 `scope=` | passed | P0 用例 + bash 5.3 回归 |
| AC-9 真实 CLI 金丝雀 | passed | `todo-managed-execution.test.js` |

## LoopX 质量收据

| 项 | 状态 | 说明 |
|---|---|---|
| `loopx-flow check` / `change-quality record` | **deferred** | Goal `loopx-capability-probe-goal` 未在 `.loopx/registry.json` 注册；`loopx configure-goal` 返回 `goal_id not found`，无法 `change-quality prepare`。不伪造收据。 |
| `loopx integration-branch` | **deferred** | 本环境无工作区 integration registry；分支基于 `origin/main@491440c`，GitHub `mergeStateStatus` 由平台判定。 |

## 复审要求

1. 在本 head 上重跑：`npm run typecheck && npm run lint && npm run build && npm run test`。
2. Gate1 由人类 TTY 执行：`./bin/loopx-flow approve contract capability-probe`。
3. 复审若发现新缺陷，回填本文件并把对应 AC 改为 `failed`，不得保留 `passed`。
