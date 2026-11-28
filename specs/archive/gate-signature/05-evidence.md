# gate-signature 门禁与质量凭据

> 本文件记录本地证据；LoopX `change-quality` 收据当前 **deferred**（Goal `gate-signature-goal` 尚未注册），
> 待 Gate1 后由 `loopx-flow check` 经 `ingest-to-loopx-quality.js` 生成并覆盖。

- **日期**：2026-11-27
- **记录 head**：本 PR 当前 head

## 四大硬门禁

| 门禁 | 命令 | 状态 | 证据 |
|---|---|---|---|
| Typecheck | `npm run typecheck` | passed | 退出 0 |
| Lint | `npm run lint` | passed | 5/5 PASS |
| Build | `npm run build` | passed | 退出 0 |
| Test | `npm run test` | passed | **355 / 355** |

## 专项

| 证据 | 状态 | 备注 |
|---|---|---|
| `node --test tests/unit/gate-github-signature.test.js` | passed | 11 / 11（含 spec_commit 不符、`--interactive` 无 TTY、`--prepare --yes`、independent 模板） |
| `node --test tests/unit/adr-0009-gate1-auth.test.js tests/unit/adr-0012-gate2.test.js` | passed | 37 / 37（既有 Gate1/Gate2 语义不回退） |

## LoopX 质量收据

| 项 | 状态 | 说明 |
|---|---|---|
| `loopx-flow check` / `change-quality record` | deferred | 需 Goal `gate-signature-goal` 注册并完成 Gate1；不伪造收据 |

## 复审要求

1. 在本 head 上重跑四门禁。
2. Gate1 可用 `--interactive`（本特性合并前），或合并后用评论路径自举。
