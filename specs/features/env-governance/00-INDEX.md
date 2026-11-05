# env-governance 审阅总览

- **状态**：Implemented / Verified（见 `05-evidence.md`）
- **覆盖需求**：`REQ-ENV-1`、`REQ-ENV-2`、`REQ-ENV-3`（ADR-0007）
- **一句话**：把控制面路由分裂、运行时工件污染收据、GitHub API 无基线三类环境问题，
  在阶段 0（doctor）前置暴露，并把 API 频次收敛到官方上限的 50% 安全基线。

## 变更面

| 层 | 文件 | 说明 |
|---|---|---|
| 命令 | `bin/loopx-flow` | `doctor` 增加控制面一致性 / 半迁移残留 / registry 完整性 / 运行时工件 / API 预算 4+1 段检查 |
| 脚本 | `skills/code-review/scripts/ingest-to-loopx-quality.js` | 收据 evidence refs 改取已提交 exact scope 并过滤运行时工件；导出纯函数供单测 |
| 治理 | `.gitignore` + `git rm --cached` | 运行时工件退出 Git 跟踪面（`.codex/**`、`.loopx/**/*.lock`、`.loopx/goals/**`） |
| 文档 | `docs/adr/0007-*.md`、`docs/prd/`、`docs/design/` | L1 决策 + L2 正文回写 |
| 测试 | `tests/unit/env-governance.test.js` | 纯函数、gitignore、无跟踪工件、doctor 契约 |

## 与相邻胶囊的关系

- `review-pipeline-throttle`：负责“评审侧降载机制”（幂等/upsert/节流/退避）；
  本胶囊负责“环境与预算的可观测基线”，二者共同满足 `REQ-ENV-2`。
