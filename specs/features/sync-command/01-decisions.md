# 实现取舍：sync-command

- **Status**: DRAFT (Pending Human Approval)
- 追溯：REQ-FACADE-1、REQ-FACADE-2、REQ-FAILCLOSED-1；ADR-0003、ADR-0007、ADR-0009。

按 design-grill 收敛后的待批选择：

| 决策点 | 建议与依据 | 否决方案 |
| --- | --- | --- |
| 同步所有者 | `cmd_sync` 只调用既有 `sync_global_required`，由 run_loopx 透传 registry | 复制同步算法、另建 registry 或状态机 |
| 未指定 Goal | 不从 feature 分支猜测，不传 --goal-id，让原生命令同步所选源 registry | 隐式限定到当前 feature |
| 参数 | 只支持无参数、一次 `--goal-id <gid>`、独立 `--help/-h`；缺值、空白值、重复、未知或多余参数 exit 2 | 静默吞参或开放 replace-state/dry-run |
| 失败 | 复用三次尝试和既有诊断，最终 exit 1；同步不触发 bootstrap/approve/merge/归档 | 无限重试、静默成功、失败回滚 LoopX 状态 |
| 既有流程 | feature/approve/merge 保持现状，独立入口不成为新的隐式回调 | 借机重构生命周期 |

复杂度：新增一个薄 shell 函数、usage 和路由；复用 lib/paths.sh，不改共享契约或默认行为。纯增量门面，依 ADR 准入矩阵不新立 ADR；产品命令清单及详细设计在实施时同步补齐。无旧实现待退役。

上述选择供本次人类审批一并确认；没有把 DRAFT 当作 design-grill 已获共识，也未推进实现。
