# TRE-143 实现验证记录

范围：GitHub Issue #6 第 4 项，独立 `loopx-flow sync [--goal-id <gid>]` 入口。基线 `main@e17200a`，实施前规格提交 `dbbb820`。按本卡最新指令交付差异与测试供查看，未创建 PR、未合并。

## 差异

- `bin/loopx-flow`：新增 `cmd_sync`、usage、路由；调用现有 `sync_global_required` → `run_loopx`，共享 helper 及 feature/approve/merge 均未改。
- 无参不传 Goal；有效 Goal 原样传递；缺值、空白、重复、未知或多余参数 exit 2 且不调用 LoopX。
- 缺环境或三次同步失败 exit 1；最后错误保留，给出带 shell 转义 registry/Goal 的门面重跑命令；仅成功时打印完成。
- `tests/unit/sync-command.test.js`：10 项真实门面子进程测试，LoopX 使用 argv 记录替身；唯一临时 Git 仓库、HOME/registry 隔离并清理，不进行宿主真实全局同步。
- README、PRD 命令与失败清单、设计映射/完整 L0 契约表同步更新。

## 实际本地验证

| 命令 | 结果 |
| --- | --- |
| `./scripts/preflight-check.sh` | 安装缺失的 LoopX skills/routes 后 exit 0，6/6 |
| `node --test tests/unit/sync-command.test.js`（实现前） | exit 1，0 pass / 10 fail；缺少 sync 路由 |
| 同一专项命令（实现后） | exit 0，10 pass / 0 fail；含 11 组非法参数、registry 含空格/优先级、缺环境、重试第 2/3 次成功、三次失败 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0，新增测试加入跟踪面后再检查亦通过 |
| `npm run build` | exit 0 |
| `npm run test` | exit 1；318 tests / 33 suites，316 pass / 2 fail / 0 skipped；约 240 秒 |
| `git diff --check` | exit 0 |

## 全量测试中的两项失败与 main 对照

两项失败位于未修改的 `tests/unit/todo-managed-execution.test.js:164` 与 `:281`，断言要求主仓 `.loopx/registry.json` 不存在，实际为存在（`true !== false`）。本任务此前通过 feature 创建了 Goal registry，故该环境条件与测试的“完全不存在”假设冲突。

为确认未由本次 sync 代码引入，导出未修改 `origin/main@e17200a` 到唯一隔离目录，仅放置一个存在的 registry 文件以复现相同条件，运行：

```bash
node --test --test-name-pattern='hard_lease claim|leaves the main repo' tests/unit/todo-managed-execution.test.js
```

baseline exit 1，2 tests / 0 pass / 2 fail，复现相同两处断言。对照未改主工作区 registry，目录已清理。未修改/跳过失败用例，未宣称全量全绿，也未为使断言通过移走真实 Goal registry。

## 实际门禁阻断

`bin/loopx-flow gate verify contract sync-command` exit 1：

```text
[-] [GATE FAIL] 阶段 4 契约未冻结或未批准: specs/features/sync-command/04-contract.md
```

上行将实际输出中的本机绝对路径缩写为仓库相对路径，其余文本相同。

`bin/loopx-flow check sync-command` exit 1，早于 Gate1 检查停止：

```text
[-] [FAIL-CLOSED] Goal 'sync-command-goal' 未启用 change-quality 资格，无法生成质量收据。
[-] 为什么阻断？资格未启用时 loopx change-quality record 会以 "qualification is disabled for this goal" 拒绝。
💡 原因：Goal 的 control_plane.change_quality_qualification.enabled 未打开，收据无法写入。
🛠️ 修复指令: loopx configure-goal --goal-id sync-command-goal --change-quality-enabled --execute
```

未为绕过检查而启用资格、改授权账号、写 FROZEN 标记或伪造质量凭据。前次正式 approve 已实测因 `lhkkk` 与配置 `JustinIanAI` 不一致被拒绝。本次仅交付本地实现与验证，不宣称 Gate1/质量 Receipt/交付门禁已通过。

LoopX 原生降级披露：仅运行 `loopx workflow-skills --install` 与 `loopx slash-commands --install` 修复当前技能安装，二者 exit 0；门面无该安装入口。未绕过任何实际检查。
