# ADR-0004：check 的 Goal 身份与契约门禁

- **状态**：Accepted
- **日期**：2026-11-04

## 背景

`cmd_check` 在无法解析 feature 时跳过 `loopx change-quality verify`，四门禁通过后仍打印成功。`ingest-to-loopx-quality.js` 在无 feature 时回退到 `specs/features` 的第一个目录，可能把证据写进无关胶囊。`check` 也不会自动运行 `gate verify contract`，契约漂移只能在别处发现。

## 决策

- `check` 必须解析出 feature（`feature/<name>` 分支或显式参数）或显式 `--goal-id`；两者都没有时非 0，并提示在特性分支执行或传 `--goal-id`。
- 当 `specs/features/<feature>/04-contract.md`（或已归档副本）存在时，先运行 `gate verify contract`；无胶囊的 docs/治理交付可用 `--goal-id` 跳过契约门禁，但仍必须通过 `change-quality verify`。
- `ingest` 去掉 `entries[0]` 回退：没有 feature 且没有 `--goal-id` 时非 0，不写任何 `05-evidence.md`。
- 成功文案只在四门禁全绿且收据 `ok === true` 后打印。

## 否决

- **保留跳过**：这是假通过。
- **用第一个 feature 兜底**：会写错胶囊。
- **只打印警告**：交付阶段必须阻断。

## 修订

- PRD：新增 `REQ-CHECK-IDENTITY-1`；修改 `REQ-FAILCLOSED-1`；删除「明确不在本基线里的行为」中 check 行与 7.4 的“未决 check”。
- 设计：第 3 节命令表、第 5 节契约门禁、第 10 节失败矩阵。
- 退役：无。

## 不做什么

- 不为 docs/治理交付强制创建 feature 胶囊。
- 不自动运行 `gate verify decisions`（本 ADR 只加 contract 门禁）。
- 不改 `change-quality` 自身的判定。
