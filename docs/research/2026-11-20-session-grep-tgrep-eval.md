---
title: "loopx-workflow 开发 session 的 grep 动作统计与 tgrep / ripgrep 效率实测"
date: 2026-11-20
type: research
status: final
method: "本地 session 文件全量解析 + 同机 A/B 复跑"
---

# 结论先行

1. **三端合计 201 个 loopx-workflow 开发 session，约 930 次 grep 系命令**（Codex 214、DSH 636、Claude Desktop 87）。其中 **rg 约 40 次、传统 grep 约 890 次、tgrep 0 次**。rg 是**零星穿插**在 grep 里的，集中在 11-05～11-19，不是常态工具。
2. **在本仓库规模（约 10k 行）tgrep 反而更慢**：本次复跑 6 类查询几何均值 **0.86×（慢 14%）**，与 11-18 首测 0.83× 一致。跨过临界点后翻转：35 万行 cargo 仓 rare-symbol 查询 **4.03×**、无匹配 **5.68×**。
3. **判断挂在查询次数与语料厚度上，不挂在工具名上**。本仓库历史节奏是「低频、分散、以传统 grep 为主」，不满足索引回本条件；**继续用 ripgrep**，tgrep 只在「单仓 ≥ 10 万行 + 同一批符号反复搜」时才值。
4. **Token 证据要分清来源**。`rtk grep` 的 token 节省数据来自 **magpie（Claude Code）的 rtk 插件 hook**，且数据库里全部 24 条记录都属于 11-19 当天两个 Claude 会话，**不是三端历史 session 的统计对象**，只能作机制参考、不能当横向结论。tgrep 的 `-c` 计数模式把输出砍到 1/11～1/30，与索引无关，rg 同样有。

---

## 一、统计口径

| 项 | 定义 |
|---|---|
| session 归属 | Codex 用 `session_meta.cwd==loopx-workflow` 且按 `session_id` 去重；DSH 用目录名 `--Users-…-loopx-workflow--`；Claude Desktop 用 `.claude/projects/-…-trae-projects-loopx-workflow` |
| grep 动作 | 工具调用参数里出现在**命令位置**的 `grep`/`rg`/`tgrep`/`egrep`/`fgrep`/`zgrep` 等（正则锚定命令起始或 `; \| && $()` 之后） |
| 两个计数 | **调用数**=含至少一次 grep 的工具调用；**调用内命令数**=一条复合命令里可能出现多次 grep（如 `env \| grep … ; … \| grep …`） |
| 排除 | `Write`/`Edit` 工具正文里出现的 grep 字样；系统提示词里的工具说明；**heredoc / `gh issue create --body` / python docstring 里作为文档正文出现的 `\| rg`（初版 46 次 rg 中有 7 次属此类假阳性，已剔除）** |
| rtk 数据边界 | `rtk gain` 的 24 条记录来自 `history.db`，全部归属 11-19 的 Claude session `b18590ca` / `a3383937`，是 **magpie 经 `rtk hook claude` 的插件行为**，不计入下面三端历史统计 |

数据源路径：

- Codex：`~/.codex/sessions/`（481 文件）+ `~/.codex/archived_sessions/`（6 文件）
- DSH：`~/.dsh/sessions/--Users-freecisco_yan-Documents-trae_projects-loopx-workflow--/`（24 session）
- Claude Desktop：`~/.claude/projects/-Users-freecisco-yan-Documents-trae-projects-loopx-workflow/`（12 session）

## 二、session 与 grep 动作统计

| 端 | session 数 | 含 grep 的 session | 含 grep 的工具调用 | grep/rg 命令数 | 明细 |
|---|---:|---:|---:|---:|---|
| Codex | 165 | 33（20.0%） | 176 | 214 | grep 176 / rg 38（剔除 7 次文档正文假阳性后 **rg 约 31 次**） |
| DSH | 24 | 22（91.7%） | 469 | 636 | grep 628 / rg 8 |
| Claude Desktop | 12 | 3（25.0%） | 33 | 87 | grep 87 / rg 0；内置 Grep 工具 0 次 |
| **合计** | **201** | **58** | **678** | **937（含假阳性）** | **grep 890 / rg 约 40（去假阳性）/ tgrep 0** |

> 口径修正：初版把 heredoc / `gh issue create --body` / python docstring 里的 `\| rg` 当成命令，rg 虚高到 46。逐条剔除 7 次（Codex：10-21 SKILL.md heredoc、10-21 软链接说明、10-28 AGENTS.md heredoc、11-04 三次 issue body；另有 10-21 一次 `spec_content` docstring）后，真实 rg 约 40 次。grep 侧同类假阳性未逐条剔除，故表中标注「约」。

补充口径（同一批文件，不同判据，用于交叉核对）：

- Codex 按 cwd 命中不按 session_id 去重为 179 个 rollout 文件；按「正文提及 loopx-workflow」为 192 个。去重后 165。
- DSH 目录 26 个，其中 24 个有 `session.v4.jsonl.zstd`，全部属于本仓库。
- Claude Desktop 的 12 个 session 里，grep 集中在 3 个长 session（其余为一次性短问答）。

**每 session 搜索强度**：Codex 含 grep 的 session 平均 6.5 次，DSH 28.9 次，Claude Desktop 29.0 次。DSH/Claude 的高频来自 `run_code`/`Bash` 复合命令里连续 grep 索引代码（如 `grep -n '^cmd_' bin/loopx-flow`、`grep -rn 'R[1-4]' specs/archive`），不是分散的单次查询。

**查找精度**：所有调用里没有 tgrep 参与，因此「tgrep vs ripgrep 精度」只能来自下面的受控实测，不能从历史 session 反推。

### 2.1 ripgrep 到底在什么时候用的（逐条溯源）

对 46 个 rg 候选逐条带时间戳核验，**7 次是文档正文假阳性**（heredoc 写 SKILL.md / AGENTS.md、`gh issue create --body`、python `spec_content` docstring 里出现的 `| rg`），**真实调用约 40 次**，时间分布：

| 时段 | 端 | session | 次数 | 用途 |
|---|---|---|---:|---|
| 11-05 18:02–18:03 | DSH | `session-e46aea` | 8 | 搜 loopx 包源码：`rg -n "canonical_authority"`、`rg -rn "def bootstrap_project" $LX` |
| 11-12 10:17 | Codex | `01a1cf31` | 1 | `rg -n "14" .loopx/` |
| 11-13 07:01–07:04 | Codex | `01a1cf31` | 6 | 搜 review 脚本与 loopx 包：`buildValidationMatrix`、`VALIDATION_FAILURE_ATTRIBUTION` 等 |
| 11-16 03:40–03:49 | Codex | `01a1e26f` | 9 | 定位 loopx 安装路径与配置：`which -a loopx`、`ls … \| rg loopx`、`loopx-flow doctor \| rg …` |
| 11-17 01:54 | Codex | `01a1e735` | 1 | `git show origin/main:bin/loopx-flow \| rg -n "ACTIVE_STATE\|task-lease"` |
| 11-18 02:58–09:25 | Codex | `01a1e7ad` | 6 | 搜 TMPDIR、review 模型配置、claim 幂等键 |
| 11-19 06:16–09:23 | Codex | `01a1f26e` | 9 | 搜硬编码路径、临时文件规范、createRunDir |

**关键判读**：

- rg 的用法 90% 是**给别的命令输出做过滤**（`ls … | rg loopx`、`doctor | rg …`、`git show | rg …`、`sed … && rg -n …`），不是纯代码仓全文搜索；
- 时间上从 11-05 才首次出现，此前（10-21～11-04）全是传统 grep；DSH 的 8 次集中在同一个 session 的一分钟内；
- 结论：**ripgrep 在本仓库是「偶尔换手」的过滤工具，主力一直是传统 grep**——这反过来解释了为什么换 tgrep 没有现实收益：连 ripgrep 都没成为默认习惯。

### 2.2 rtk grep 的归属（重要口径澄清）

初版把 `rtk gain` 的「10 次 rtk grep 省 2.1K token（30.4%）」写成本仓库已验证的 token 杠杆，**归因错误**。查 `~/Library/Application Support/rtk/history.db` 得到硬证据：

| 证据 | 结果 |
|---|---|
| `commands` 表总记录 | 24 条，最早 2026-11-19 08:43，最晚 11-20 09:23 |
| `hook_decisions` 的 session_id | 仅两个：`b18590ca`（22 次）、`a3383937`（2 次）——都是 11-19 的 Claude Desktop 会话 |
| 触发机制 | `~/.claude/settings.json` 的 `PreToolUse/Bash` hook → `rtk hook claude`，即 **magpie 模型侧经 Claude Code 插件改写命令** |
| `engine_attribution` 表 | 0 行——rtk 尚未区分 hook / proxy 收益来源 |
| 11-20 的 2 次 `rg`/`grep` 探测 | `rtk bypass` / 直接调用，saved=0，是本次分析自测，非历史产物 |

因此：**rtk grep 不是 Codex / DSH 的行为，也不在 201 个历史 session 的 grep 统计里**；它是 magpie 在 Claude Code 里经插件 hook 产生的 token 压缩，且样本只有 11-19 一天。它的 30.4% 只能说明「rtk 这类输出压缩机制有潜力」，不能作为三端横向比较的证据。

## 三、tgrep vs ripgrep 同机实测（2026-11-20 复跑）

环境：macOS arm64，tgrep 二进制 `/tmp/tgrep-repo/target/release/tgrep`（2026-11-18 构建），rg `/opt/homebrew/bin/rg`。方法：每类查询跑 8 次，弃首取后 7 次中位数，再取几何均值；两组口径不同，不混算。索引写在 `.loopx/tmp/`，不污染仓库。

### 3.1 小语料：loopx-workflow（247 源文件，约 1 万行）

| 查询 | tgrep | rg | 倍率 | 命中一致性 |
|---|---:|---:|---:|---|
| C1 `REQ-TRACE-2` | 11.78 ms | 10.54 ms | 0.89× | 10/10 ✓ |
| C2 `ADR-0013` | 12.01 ms | 10.49 ms | 0.87× | 33/33 ✓ |
| C3 `loopx-flow approve` | 11.29 ms | 9.99 ms | 0.89× | 29/29 ✓ |
| C4 `REQ-[A-Z0-9-]+` | 10.63 ms | 10.22 ms | 0.96× | 199/199 ✓ |
| C5 无匹配 | 11.40 ms | 10.03 ms | 0.88× | 0/0 ✓ |
| C6 `-g *.md` | 10.46 ms | 7.12 ms | 0.68× | 3/3 ✓ |
| **几何均值** | — | — | **0.86×** | **6/6 一致** |

> 11-18 首测同仓库为 0.83×，两次结论一致：小仓索引回不了本。

### 3.2 大语料：cargo 仓（1385 个 .rs，351,905 行）

| 查询 | tgrep | rg | 倍率 |
|---|---:|---:|---:|
| rare symbol `serde_json::from_str` | 7.30 ms | 29.38 ms | **4.03×** |
| 正则 `pub fn [a-z_]+\(` | 23.64 ms | 29.41 ms | 1.24× |
| 无匹配 | 5.22 ms | 29.65 ms | **5.68×** |

> 11-18 首测该仓 8 类查询几何均值 3.93×（tgrep 5.4 ms vs rg 21.3 ms），本次抽样方向一致。

### 3.3 多文件小文档语料：5100 个 md

0.45×（更慢）。每篇中位 40 行，rg 全盘扫描本来就快。**文件数 ≠ 语料厚度**，临界点看总行数和单文件大小。首测曾因同名覆盖只剩 1830 个文件，修正保留目录结构后复测结论不变。

### 3.4 索引成本与新鲜度

| 项 | 实测 |
|---|---|
| 建索引（本仓） | 0.1 s，峰值内存 22.3 MiB，索引目录 3.5 MiB |
| 索引可见性 | 默认 published 视图，watcher 漏通知靠每小时对账修复，最坏延后 4 小时；`--no-index` 直读当前文件 |
| 官方口径 | BENCHMARKS.md 六仓 macOS 几何均值 8.61×，Chromium 15.8×、Gecko 51.9×——大仓数字，不能搬到本地小仓 |
| 运维约束 | `.tgrep/` 必须进 `.gitignore`；CI 一次性搜索用 rg；跨仓检索用 Zoekt |

## 四、四个统计维度

| 维度 | tgrep | ripgrep | 判定 |
|---|---|---|---|
| **Token 降低** | `-c` 计数模式输出 285 B vs 默认 3196 B（11×）；正则查询 2083 B vs 62561 B（30×）。这是**输出模式**收益，非索引收益，rg 同样有 `-c` | 同左 | **平手**；`-c` 是查询参数层的收益，与换引擎无关。`rtk grep` 的 30.4% 来自 magpie 插件 hook（见 §2.2），属另一条链路，不构成本维度比较证据 |
| **Agent 执行效率** | 小仓 0.86×，每次查询多等约 1.5 ms；改完立刻搜可能拿到旧视图（4 h 对账窗口），Agent 会基于旧代码决策 | 小仓 10 ms 级直读，无新鲜度风险 | **ripgrep 胜**（本仓库）；需 `--no-index` 才能持平 |
| **查找精度** | 6 类查询命中数与 rg 逐条一致；仅验证数量，正则语义/忽略规则/排序截断未逐项验 | 同为基线 | **平手（有限验证）**；tgrep 额外承担索引新鲜度风险 |
| **时间** | 小仓 11–12 ms；35 万行仓 5–24 ms；建库一次性 0.1 s/22.3 MiB | 小仓 7–10 ms；35 万行仓约 29 ms；零运维 | **看规模**：< 10 万行 rg 胜；≥ 10 万行且查询密集 tgrep 胜 |
| **生态与成本** | Microsoft 维护，3513★/144 fork，MIT/Rust，已进 Copilot CLI；需常驻 server + 索引同步 | 零依赖，已随环境安装 | tgrep 能力更强但引入运维面 |

## 五、决策建议

```
收益 = (省下的重复扫描时间) × (查询次数) − (建库 + 同步 + 内存)
```

按本仓库实测代入：rg 单次约 10 ms，tgrep 约 11.5 ms，**分子为负**；201 个 session 仅 58 个含 grep，且散落在 3 周内，不是「同一批符号一天搜几百次」的形态。结论：

1. **继续用 ripgrep**，不引入 tgrep。省下的 1.5 ms/次不足以覆盖索引同步与新鲜度风险。
2. **真正该做的是压缩输出**：在 Bash/grep 调用上默认加 `-c` / `--count-matches`，输出可砍到 1/11～1/30（本次实测）。`rtk grep` 是 magpie 侧 Claude Code 插件的压缩能力（`rtk hook claude`），若当前会话跑在 magpie/Claude Code 上会经 hook 自动改写，可作为补充机制；但它的节省数据只来自 11-19 两个会话，不要当成三端通用收益来引用。
3. **触发重估的条件**（满足两条再上 tgrep）：单仓稳定超过 10 万行；同一批符号每天查询 > 100 次；能接受 `--no-index` 或 4 小时新鲜度窗口。
4. **不要信宣传倍率**：FlashGrep 的 36.1× 用其公开 14 条查询表复算为算术 20.5×/几何 13.4×/总耗时 8.2×，算不出 36.1；tgrep 官方 8.61× 有明确口径但来自大仓。任何倍率先问口径。

## 六、可复跑脚本

统计与实测脚本存于 `.loopx/tmp/`（本次工作沙箱，非交付物）：

- `unified_stats.py` — 三端 session 归属判定与 grep 动作统一计数
- `trace_rg_strict.py` — rg 逐条带时间戳溯源，剔除 heredoc/docstring 假阳性（§2.1）
- `bench_fresh.py` — loopx-workflow 6 类查询 A/B 复跑
- `bench_cargo.py` — 35 万行语料交叉验证

rtk 归属核验来源：`~/Library/Application Support/rtk/history.db`（`commands` / `hook_decisions` / `engine_attribution` 三表）与 `~/.claude/settings.json` 的 `PreToolUse/Bash → rtk hook claude`。

`tgrep` 当前未安装到 PATH，只有 11-18 构建的二进制在 `/tmp/tgrep-repo/target/release/tgrep`；要用需先 `tgrep index` + `tgrep serve`，且 `.tgrep/` 必须 gitignore。
