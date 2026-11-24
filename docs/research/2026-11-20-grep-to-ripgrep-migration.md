---
title: "ripgrep 替换 grep：收益实测与 loopx-workflow 落地方案"
date: 2026-11-20
type: research
status: final
method: "同机 A/B 复跑（9 次取中位数）+ 历史 891 次 grep 调用分类 + rtk hook 源码级行为核验"
related: "2026-11-20-session-grep-tgrep-eval.md"
---

# 结论先行

1. **不能笼统说「快 N 倍」——收益完全取决于场景**。本仓实测：默认递归搜索 `grep -rn .` 是 550 ms、`rg -n .` 是 7 ms，看似 **70–81×**；但这 550 ms 里约 580 ms 花在扫 `node_modules`（420 ms）和 `.loopx`（160 ms）等忽略目录上。**同等排除口径下只有 1.4–1.6×**，这才是引擎的真实差距。
2. **最硬的收益不是速度，是精度**：`grep` 默认 BRE（Basic Regular Expression，基础正则），`+ | ( ) \d \s` 全部当字面量——5 类常见正则在 grep 下**静默返回 0 命中**，rg 全部正确。Agent 拿到 0 命中会误判"代码里没有"，比慢 1 ms 危险得多。
3. **历史 891 次 grep 中 63.7% 是管道过滤**（`cmd | grep x`），这类 rg 反而慢约 75%（1.75 ms vs 3.05 ms，绝对差 1.3 ms）。递归搜索只占 15.2%——**一刀切替换的收益面比想象小，但精度收益覆盖全部场景**。
4. **本项目已有确定性替换通道，无需装任何东西**：`rtk hook` 已在 Claude Code 的 `PreToolUse/Bash` 上拦截所有命令。它把 `grep` 改写成 `rtk grep`（底层仍是 BSD grep），把 `rg` 改写成 `rtk rg`（底层是 rg）。**只要 Agent 写出 `rg`，就自动拿到 rg 引擎 + token 压缩**。所以问题不是"怎么把 ripgrep 装进来"，而是"怎么让 Agent 稳定写出 rg"。
5. **提示词层已证明无效**：`AGENTS.md` 第 18 行已写"读代码库用 `rg`/`read`"，但历史仍是 grep 891 次、rg 约 40 次。必须在 **hook 改写层**做确定性拦截，提示词只作辅助。

---

## 一、收益实测（2026-11-20，本仓 247 源文件 / 33 MB node_modules）

环境：macOS arm64，BSD grep 2.6.0（`/usr/bin/grep`）、rg（`/opt/homebrew/bin/rg`）。每类 9 次弃首取 8 次中位数。脚本：`.loopx/tmp/bench_grep_vs_rg.py`。

### 1.1 默认调用（Agent 真实写法）

| 查询 | `grep -rn … .` | `rg -n … .` | 倍率 | 备注 |
|---|---:|---:|---:|---|
| 固定串 `REQ-TRACE-2` | 552.41 ms | 7.74 ms | **71.4×** | grep 14 命中 / rg 11（多出的在 `.loopx` 沙箱） |
| 固定串 `ADR-0013` | 554.29 ms | 7.51 ms | **73.8×** | |
| 正则 `REQ-[A-Z0-9-]+` | 518.74 ms | 6.82 ms | 76.1× | grep 0 命中（BRE 语法坑） |
| 无匹配 | 543.53 ms | 6.71 ms | 81.0× | |

**慢在哪（拆分实测）**：

| 目录 | `grep -rn REQ-TRACE-2 <dir>` 耗时 |
|---|---:|
| `node_modules`（33 MB / 671 文件） | 0.42 s |
| `.loopx`（沙箱，44 文件） | 0.16 s |
| `.git`（36 文件） | 0.06 s |
| `docs` / `specs` / `skills` / `bin`（真实源码） | 0.01 s / 0.01 s / 0.00 s / 0.00 s |

> rg 默认读 `.gitignore`，自动跳过 `node_modules` / `.git` / `.loopx`。**70× 里绝大部分是"不扫垃圾目录"，不是正则引擎更快**。

### 1.2 等价口径（都排除忽略目录）

| 查询 | grep | rg | 倍率 |
|---|---:|---:|---:|
| 固定串 `REQ-TRACE-2` | 11.13 ms | 7.03 ms | 1.58× |
| 固定串 `ADR-0013` | 10.59 ms | 7.34 ms | 1.44× |
| 正则 `REQ-[A-Z0-9-]+` | 10.58 ms | 6.61 ms | 1.60× |
| 无匹配 | 10.50 ms | 6.72 ms | 1.56× |

**引擎真实差距 ≈ 1.5×**（rg 的并行遍历 + SIMD + 字面量优化）。

### 1.3 管道过滤（历史主力场景：63.7%）

84 KB 输入，`cmd | grep loopx` vs `cmd | rg loopx`：

| 工具 | 耗时 |
|---|---:|
| grep | 1.75 ms |
| rg | 3.05 ms |

**rg 慢 75%（绝对差 1.3 ms）**——管道的 stdin 没有目录可跳过，rg 的启动/线程开销反而成为负担，grep 的轻量优势显现。

### 1.4 精度（最关键的隐性收益）

| 模式 | Agent 想表达 | `grep`（默认 BRE） | `grep -E` | `rg` |
|---|---|---:|---:|---:|
| `REQ-[A-Z0-9-]+` | 量词 `+` | **0** | 200 | 200 |
| `REQ-(TRACE\|TRACE2)` | 分组/或 | **0** | 16 | 16 |
| `REQ-\d+` | 数字类 | **0** | 1 | 1 |
| `^\s*##\s+` | 空白类 | **0** | 612 | 563（差值是 rg 跳过忽略目录） |
| `TODO\|FIXME` | 或 | **0** | 3 | 2 |

> Agent 写正则时几乎不会主动加 `-E`。grep 把 `+` 当字面量 → 0 命中 → Agent 得出"没有相关代码"的错误结论。**这一项足以支撑替换，与速度无关**。

### 1.5 参数映射等价性（替换后命令怎么写）

| grep | rg | 验证 |
|---|---|---|
| `grep -rn 'p' .` | `rg -n 'p' .` | ⚠ 命中数可能不同：rg 跳过忽略目录（这是期望行为） |
| `grep -rn 'p' file/` | `rg -n 'p' file/` | ✓ 265/265 |
| `grep -rni 'p'` | `rg -ni 'p'` | ✓ 48/48 |
| `grep -rnE 'p'` | `rg -n 'p'` | ✓ 162/162（rg 默认扩展正则，无需 -E） |
| `grep -rln 'p'` | `rg -ln 'p'` | ✓ 1/1 |
| `grep -rn -A2 -B1 'p'` | `rg -n -A2 -B1 'p'` | ✓ 164/164 |
| `grep --include='*.md'` | `rg -g '*.md'` | ✓ 265/265 |

> **注意**：`grep -r` 在 rg 里是冗余的——rg 默认递归。映射时直接去掉 `-r`，否则 rg 会报 `Unexpected argument`。

---

## 二、历史 grep 构成（决定替换策略）

对三端 891 次 grep 调用按参数特征分类（脚本 `.loopx/tmp/grep_flavor.py`）：

| 类型 | 次数 | 占比 | 换成 rg 的收益 |
|---|---:|---:|---|
| 管道过滤（`cmd \| grep`） | 568 | 63.7% | 精度一致；速度略降 1.3 ms |
| 单文件 / 其他 | 188 | 21.1% | 精度为主 |
| 递归搜索（`-r` / `-R`） | 135 | 15.2% | **速度 + 精度双收益** |

**判读**：替换的主价值是"精度一致性"和"递归搜索提速"，不是把所有 grep 都换掉。但因为 rtk 对 grep 和 rg **都做 token 压缩**（见下），统一写 rg 不会损失 token 收益，语法负担也更小。

---

## 三、本项目替换方案（三层，按确定性递增）

### 现状：替换通道已经存在

`~/.claude/settings.json` 已配置：

```json
"PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "rtk hook claude" }] }]
```

`rtk hook` 的改写行为（实测 `rtk hook check` / `rtk hook claude`）：

| Agent 写的命令 | hook 改写为 | 底层引擎 |
|---|---|---|
| `grep -rn 'p' .` | `rtk grep -rn 'p' .` | BSD grep + rtk 压缩 |
| `rg -n 'p' .` | `rtk rg -n 'p' .` | **ripgrep** + rtk 压缩 |

> 即：**只要 Agent 写出 `rg`，整条链路自动走 ripgrep，且 token 压缩不丢**。Codex 侧 `rtk hook codex` 同样支持（RTK.md 已存在于 `~/.codex/`）。DSH 的 rtk hook 不支持（`rtk hook --help` 无 dsh 子命令）。

### 方案 A：提示词铁律（最轻，但已证明不够）

在 `AGENTS.md` 核心铁律区加一条硬规则 + 映射表，示例：

```markdown
N. **搜索命令统一用 ripgrep (rg)**：
   - 禁止在 Bash 中使用 `grep` 递归搜索代码；一律用 `rg`。
   - 映射：`grep -rn P .` → `rg -n P .`；`grep -rnE P` → `rg -n P`；
     `grep --include='*.md'` → `rg -g '*.md'`。rg 默认递归且遵守 .gitignore，不要加 `-r`。
   - 仅当对其他命令输出做管道过滤且命令极短时，可保留 `| grep`；其余一律 `| rg`。
   - 原因：grep 默认 BRE 会把 `+ | \d \s` 当字面量，静默返回 0 命中，导致误判代码不存在。
```

- ✅ 零依赖、三端通用（AGENTS.md / CLAUDE.md 都被读取）
- ❌ 历史证明弱约束：AGENTS.md 已写"用 rg"，890 次 grep 照发

**适用**：作为方案 B 的辅助，不单独使用。

### 方案 B：hook 改写层（推荐，确定性）

在 `rtk hook` 之前插入一层改写：把 Bash 命令里的 `grep` 命令替换为 `rg`，再把结果交给 rtk。实现为一个脚本，替换现有的 hook command：

```json
"command": "python3 /path/to/force-rg.py | rtk hook claude"
```

`force-rg.py` 的职责：
1. 从 stdin 读 Claude Code 的 hook JSON（`tool_input.command`）
2. 用命令位置正则识别 `grep` / `grep -r` / `egrep` 等，**跳过 heredoc / 文档正文 / issue body**
3. 按 §1.5 映射表改写：`-r` 去掉、`-E` 去掉、`--include` → `-g`
4. 输出改写后的 hook JSON 给 rtk，`updatedInput.command` 设为 rg 版本
5. **管道过滤场景**（`| grep`）按策略选择：保留（快 1.3 ms）或统一改 rg（语法一致）

- ✅ 确定性：Agent 写什么都会被改写，不依赖模型遵守
- ✅ 与 rtk 压缩叠加：改写后 rtk 看到 `rg` → `rtk rg`
- ⚠ 需要精确的命令位置识别，避免改到 heredoc 里的文档文字（历史统计就栽在这上面，见主报告 §2.1）
- ⚠ 改的是全局 `~/.claude/settings.json`，影响所有项目；或改项目级 `.claude/settings.local.json` 只影响本仓

### 方案 C：环境层 alias / PATH shim（不推荐）

在非交互式 bash 里 alias 不生效（`bash -c` 不读 `.zshrc`）；且当前环境 `grep` 已被 WorkBuddy 的 brokered-bin shim 拦截（`which grep` 指向 shim 而非 `/usr/bin/grep`）。PATH shim 会与 rtk hook 和沙箱 shim 双重冲突。**不建议**。

### 三端覆盖矩阵

| 端 | AGENTS.md 提示 | rtk hook | 推荐组合 |
|---|---|---|---|
| Claude Code / Desktop（magpie） | ✓ 读取 | ✓ `rtk hook claude` 已启用 | **A + B**（项目级 settings.local.json） |
| Codex | ✓ `model_instructions_file` 已指向 agy-neutral-instructions.md，但项目 AGENTS.md 也会读 | ✓ `rtk hook codex` 支持，当前未在 config.toml 启用 | **A + B**（需先在 config.toml 启用 hook） |
| DSH | ✓ 项目 AGENTS.md | ✗ 无 dsh 子命令 | **仅 A**（依赖提示词，或改 DSH skill 规则） |

---

## 四、建议实施顺序

1. **先做方案 A**：在 `AGENTS.md` 加"搜索统一用 rg"铁律 + 映射表。零风险，立即生效，覆盖三端。
2. **观察 1–2 周**：用主报告的 `unified_stats.py` 复跑，看 rg 占比是否从 4% 上升。若上升说明提示词够用，不必上 hook。
3. **若无效再上方案 B**：写 `force-rg.py`，先挂项目级 `.claude/settings.local.json` 试运行（只影响本仓），验证 1 周无副作用后再考虑提升到全局。
4. **不要做方案 C**。

---

## 五、风险与边界

- **速度收益被高估**：默认调用的 70× 里绝大部分来自跳过 `node_modules`。若代码库本身干净（无忽略目录），真实收益只有 1.5×。
- **管道替换可能负收益**：63.7% 的历史调用是管道过滤，rg 在那里慢 75%。统一替换后这批调用绝对多花约 1.3 ms × 568 次 ≈ 0.7 s（分散在三周，无感）。
- **hook 改写的假阳性**：heredoc / issue body 里的 `| grep` 不能被改（主报告 §2.1 有 7 次 rg 假阳性的教训）。`force-rg.py` 必须有命令位置锚定 + heredoc 检测。
- **rtk 归属**：`rtk grep` / `rtk rg` 的 token 压缩数据来自 magpie 的 Claude Code 插件 hook，样本只有 11-19 两个会话，不能当作三端通用收益（主报告 §2.2）。

---

## 六、可复跑脚本

存于 `.loopx/tmp/`（工作沙箱，非交付物）：

- `bench_grep_vs_rg.py` — §1 默认/等价/管道三口径 A/B 实测
- `probe_precision.py` — §1.4 grep(BRE) vs rg 正则语义差异
- `verify_mapping.py` — §1.5 参数映射等价性
- `grep_flavor.py` — §2 历史 891 次 grep 调用分类

## 术语表

| 词 | 释义 |
|---|---|
| BRE | Basic Regular Expression，基础正则；`+ \| ( )` 需转义才有特殊含义，grep 默认模式 |
| ERE | Extended Regular Expression，扩展正则；grep `-E` / rg 默认模式 |
| ripgrep / rg | Rust 写的递归搜索工具，默认读 `.gitignore`，并行 + SIMD |
| rtk | 命令输出压缩代理，经 `PreToolUse` hook 改写命令为 `rtk <cmd>` |
| hook | Claude Code / Codex 的命令拦截机制，可在命令执行前改写 |
| PreToolUse | 工具调用执行前的 hook 事件点 |
| 管道过滤 | `cmd \| grep x` 形式，对上游命令输出做筛选，非文件搜索 |
