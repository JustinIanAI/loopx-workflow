# gate-signature 切片验收

- **Goal**：`gate-signature-goal`
- **追溯**：`REQ-GATE-SIGNATURE-1`、`REQ-CHECKPOINT-1`、`REQ-CHECKPOINT-2`、ADR-0019

## 切片

1. `approve contract <feature> --prepare`：打印 `contract_sha` / `spec_commit` 与 Gate1 评论模板，零写入。
2. `single_owner` 的 Gate1：校验 PR 上 `accepted_by` 的 `gate=1` 评论后，无 TTY 完成授权。
3. `release-approve <pr> --prepare`：打印 `head` / `contract_sha` 与 Gate2 评论模板，零写入。
4. 已有合法 `gate=2` 评论时，`release-approve` 不重复写并成功返回。
5. 负向：作者不符、SHA/`spec_commit` 不符、无评论且未加 `--interactive` → 非 0 且不留授权。
6. `--interactive` 保留 TTY；`--yes` 继续拒绝。

## 验收

- [x] `--prepare` 零写入（不写标记、不写评论、不调 configure-goal）。
- [x] 有效评论路径可无 TTY 完成 Gate1 / Gate2。
- [x] 作者/SHA/`spec_commit`/mode 任一不符即拒绝。
- [x] `--interactive` 仍要求 TTY，`--yes` 仍非 0。
- [x] 四门禁全绿（355 用例）。
