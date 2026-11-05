# ADR-0008：Feature 状态文件的权威创建与残留隔离

- **状态**：Accepted
- **日期**：2026-11-05
- **关联**：`REQ-GOAL-1`、`REQ-FAILCLOSED-2`、ADR-0001、ADR-0007

## 背景

`loopx-flow feature <name>` 注册新 Goal 时，LoopX 2.0 `bootstrap` 只在该 `--state-file`
尚不存在时生成 canonical storage target（`loopx/bootstrap.py`：仅当
`previous_goal is None and not state_file.exists()` 才建立
`loopx_new_goal_storage_target_v1`）。若状态文件已存在且 Goal 未注册，`bootstrap`
会抛出 `canonical_authority_required` 并熔断。

旧版编排器曾在 bootstrap 前裸写 `specs/features/<feature>/ACTIVE_STATE.md`。预创建逻辑
虽已移除（issue #17 / PR #22），但已受影响环境磁盘上的残留文件不会自动消失：用户升级
编排器后重跑 `feature`，仍会命中同一故障（issue #7，`loopx-flow feature` 在真实
LoopX 上复现 `canonical_authority_required`）。

## 决策

1. **状态文件首次创建权只属于 `loopx bootstrap`**。编排器不得在注册前创建、改写或补写
   `specs/features/<feature>/ACTIVE_STATE.md`。
2. **注册前做权威归属判定**：`cmd_feature` 以项目 registry（路径支持 `LOOPX_REGISTRY`
   覆盖）判定目标 Goal 是否已注册。`未注册 && 状态文件已存在` 视为旧版残留，改名隔离为
   `<state>.stale-<UTC 时间戳>`（保留原内容），随后由 bootstrap 权威创建 canonical 状态。
3. **已注册 Goal 的状态文件不隔离、不改写**；canonical reconnect / 迁移只走 LoopX 官方命令。
4. **隔离失败非 0 退出**并给出人工修复指令；不静默跳过、不伪造 frontmatter、不引入第二套
   兜底状态。

## 否决

- 否决「检测到残留直接删除」：会丢失用户在失败现场可能仍需要核对的旧状态内容，不可审计。
- 否决「编排器补写合法 frontmatter 骗过校验」：绕过 LoopX 权威，制造第二事实源。
- 否决「只清理一次现场、不加运行时检测」：升级用户仍会复发，问题只在首次人工处理时消失。

## 修订

- **PRD**：`REQ-GOAL-1` 增加“状态文件权威创建 + 未注册残留必须隔离”的不变量。
- **设计**：第 5 节命令表 `feature` 行补充隔离职责；第 10 节失败矩阵增加“残留状态文件无法
  隔离”一行。
- **退役**：无旧说明作废；不新增平行路径。

## 不做什么

- 不迁移或修复历史 Goal 的权威状态；迁移仍只允许 `loopx migrate-local-state`。
- 不在 `feature` 内处理全局 registry 路由冲突（沿用 `bootstrap --replace-state` 官方语义）。
