# 实现取舍：sync-command

- **Status**: APPROVED
- 方案批准：kcolkcolkk 于 TRE-143 评论 `01a2170d-ce07-76b3-a02f-e8124150fe78` 明确回复“同意本方案，范围限于github #6 第4项，继续”。此记录仅表示方案共识；正式 Gate1 仍由 approve contract 写入契约锁和 user_gate。
- 追溯：REQ-FACADE-1、REQ-FACADE-2、REQ-FAILCLOSED-1；ADR-0003、ADR-0007、ADR-0009。

按 design-grill 收敛并经上述评论确认的选择：

| 决策点 | 建议与依据 | 否决方案 |
| --- | --- | --- |
| 同步所有者 | `cmd_sync` 只调用既有 `sync_global_required`，由 run_loopx 透传 registry | 复制同步算法、另建 registry 或状态机 |
| 未指定 Goal | 不从 feature 分支猜测，不传 --goal-id，让原生命令同步所选源 registry | 隐式限定到当前 feature |
| 参数 | 只支持无参数、一次 `--goal-id <gid>`、独立 `--help/-h`；缺值、空白值、重复、未知或多余参数 exit 2 | 静默吞参或开放 replace-state/dry-run |
| 失败 | 复用三次尝试和既有诊断，最终 exit 1；同步不触发 bootstrap/approve/merge/归档 | 无限重试、静默成功、失败回滚 LoopX 状态 |
| 既有流程 | feature/approve/merge 保持现状，独立入口不成为新的隐式回调 | 借机重构生命周期 |

复杂度：新增一个薄 shell 函数、usage 和路由；复用 lib/paths.sh，不改共享契约或默认行为。纯增量门面，依 ADR 准入矩阵不新立 ADR；产品命令清单及详细设计在实施时同步补齐。无旧实现待退役。

本次方案共识已获确认；只有正式 Gate1 通过后才推进实现。
