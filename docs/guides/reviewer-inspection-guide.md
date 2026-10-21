# LoopX AI-Native 研发与交付流：关键节点质量审查与验收手册
## —— 面向评审员、架构师与技术负责人的“看什么、怎么看”实操指南

---

## 概述与审查哲学

在长程自主研发（Autonomous Long-Horizon Agent Workflow）中，AI Agent 负责高频、密集的代码探索与实现，而**人类决策者（评审员 / Tech Lead / 维护者）的核心价值在于关键断点（Decision & Quality Checkpoints）的把控**。

本手册明确规定了研发全生命周期中 5 大核心断点的质量审查规范：
- **看什么**：明确审查的核心维度与事实凭据。
- **怎么看**：给出标准的 CLI 命令与比对路径，杜绝凭空臆断。
- **一票否决红线**：只要触发，严禁进入下一阶段。

---

## 节点一：阶段 1 架构方案研讨 (Design Grill)

- **交付物落盘位置**：`docs/decisions/<feature>-decisions.md`
- **准入时机**：PRD 编写之前、方案压力测试完毕后。

### 1. 看什么 (Inspection Focus)
1. **决策分支完备性**：是否提炼了 3~6 个顶层架构决策分支（如并发模型、持久化选型、向下兼容策略、错误边界等）。
2. **权衡与备选方案**：每个决策是否列出了至少 1 个被舍弃的备选方案及其被否决的原因（Pros & Cons）。
3. **事实代码库探查**：方案中的假设是否已被代码库探查确认（如引用具体的 existing interfaces 或 configs），杜绝凭空想象。

### 2. 怎么看 (How to Verify)
```bash
# 查阅生成的决策备忘录
cat docs/decisions/<feature>-decisions.md

# 验证决策中涉及的现有文件是否存在或接口是否匹配
rg "<关键接口名或配置项>" src/
```

### 3. 一票否决红线 (Deal-Breakers)
- 存在模糊结论（如“根据后续情况再定”、“视性能表现而定”等悬而未决的“it depends”）。
- 存在未经确认的不可逆架构改动（破坏既有数据库 Schema 或外部 API）。

---

## 节点二：阶段 2 精益 PRD 与承重假设 (Lean PRD & Red-Team)

- **交付物落盘位置**：`docs/prd/<feature>-prd.md`
- **准入时机**：方案研讨通过后、任务拆分前。

### 1. 看什么 (Inspection Focus)
1. **8 板块精益 PRD 完整性**：背景、用户故事、关键指标、功能规格、非功能要求、边界与范围、风险与缓解措施。
2. **红队攻击反驳用例**：通过 `strategy-red-team` 产出的承重假设测试用例，是否存在被红队直接击穿的核心逻辑。
3. **范围收敛度 (Scope Constraint)**：单次 PRD 拆解出的改动规模预估是否符合精益交付原则（建议单 PR Diff ≤ 500 行）。

### 2. 怎么看 (How to Verify)
```bash
# 检查 PRD 及红队对抗矩阵
head -n 100 docs/prd/<feature>-prd.md
```

### 3. 一票否决红线 (Deal-Breakers)
- 承重假设存在未解漏洞，且未在 PRD 中给出应对方案。
- 业务范围无限蔓延，未明确标注 Out of Scope。

---

## 节点三：阶段 4 契约冻结与实体对账 (Contract Freeze)

- **交付物落盘位置**：`.trae/specs/<feature>/tasks.md`
- **准入时机**：进入 TDD 编码实现前。

### 1. 看什么 (Inspection Focus)
1. **顶部契约固化 (TypeScript / Interface)**：文件顶部是否显式声明了不可变的 TypeScript 签名、数据结构与断言不变量。
2. **任务颗粒度与单测契约**：每个子任务是否对应明确的失败复现用例（Red）与通过标准（Green）。
3. **LoopX 实体一致性**：任务清单是否已全量注册至 LoopX 状态面。

### 2. 怎么看 (How to Verify)
```bash
# 检查契约文件头部签名
head -n 40 .trae/specs/<feature>/tasks.md

# 检查 LoopX 注册表中的 Todo 状态
bin/loopx-flow todo list <feature>-goal
```

### 3. 一票否决红线 (Deal-Breakers)
- 顶部未写明 TypeScript 接口即直接开始写业务代码。
- 任务拆分未指明 Write Scope，存在多个任务重叠修改同一核心文件的并发踩踏隐患。

---

## 节点四：阶段 6 本地门禁与 L1 代码级审查 (Gates & L1 Review)

- **交付物落盘位置**：`/tmp/l1-review-evidence.md`、本地终端门禁输出
- **准入时机**：提交 GitHub PR 之前。

### 1. 看什么 (Inspection Focus)
1. **本地四大门禁全绿**：`npm run typecheck && npm run lint && npm run build && npm run test` 退出码必须全为 0，单测用例只增不减。
2. **L1 契约审查结果**：默认 `code-review` 技能审查产出 `0 Actionable Defects`。
3. **高危场景 OCR 审查**：若涉及底层并发、安全边界或基础设施，`run-ocr-audit.sh` 扫描结果中必须零 High / Medium 严重度缺陷。

### 2. 怎么看 (How to Verify)
```bash
# 1. 一键执行四大硬门禁
bin/loopx-flow check

# 2. 查看 L1 审查凭证文件
cat /tmp/l1-review-evidence.md

# 3. 若为高危场景，检查阿里 OCR 扫描结果
./scripts/run-ocr-audit.sh origin/main
```

### 3. 一票否决红线 (Deal-Breakers)
- 任何一项门禁带报错或使用 `|| true` 掩盖错误。
- 存在未修复的 High 或 Medium 级别代码缺陷。

---

## 节点五：阶段 7~8 GitHub PR 页面交付审查与 8 项事实核验

- **阵地**：GitHub PR 页面 (Web UI) 与 `loopx-flow review / merge`
- **准入时机**：人类审批人在 GitHub 网页点击 **Approve** 并合入主干前。

### 审批人“8 项事实”逐项核验表 (8-Point Inspection Verification)

| 序号 | 事实核验项 | 审查核心与合格标准 | 快速核验命令 / 网页核验操作 |
|---|---|---|---|
| **1** | **改动范围 (Scope)** | 改动行数建议 ≤ 500 行，无多余未跟踪文件或无意义格式微调 | 网页查看 Files Changed，或运行：<br>`gh pr diff <PR_ID> --stat` |
| **2** | **契约稳定性** | 严格遵守阶段 4 冻结的 TypeScript 接口，无破坏性 API 变更 | 对比 `.trae/specs/<feature>/tasks.md` 顶部的类型定义与实际代码 |
| **3** | **四大门禁事实** | 本地 Typecheck, Lint, Build, Test 全绿通过凭据在位 | PR 描述中“门禁自检结果”各 Checkbox 是否全勾选 |
| **4** | **L1 审查闭环** | 零 Actionable 缺陷，代码建议项已就地处理 | 查看 PR 顶置评论中的 5-Block 报告或 `/tmp/l1-review-evidence.md` |
| **5** | **分支无漂移** | 本地已完成预集成，无潜在 merge 冲突 | 运行 `loopx integration-branch` 校验，或确认 GitHub 显示 "Able to merge" |
| **6** | **机器元数据完整** | PR 正文中包含正确的 `<!-- loopx-meta: ... -->` 注释 | 检查 PR Body 中包含：<br>`<!-- loopx-meta: {"goal_id": "...", "todo_id": "..."} -->` |
| **7** | **HEAD SHA 一致** | 当前 PR 最新的 Commit SHA 与审查时完全一致 | `gh pr view <PR_ID> --json headRefOid` 比对顶置报告基准 SHA |
| **8** | **原子合入与核销** | 合并方式必须为 Squash & Delete Branch，合入后自动触发 Goal 归档 | 执行：<br>`bin/loopx-flow merge <PR_ID>` |

---

## 总结：决策矩阵速查

```
[阶段 1 研讨] ── (核验 decisions.md 无 it-depends) ──► 通过
      │
[阶段 2 PRD]  ── (核验承重假设与反驳用例) ──► 通过
      │
[阶段 4 契约] ── (核验 tasks.md 顶部 TS 签名与 LoopX 实体) ──► 通过
      │
[阶段 6 编码] ── (四大门禁 100% 绿 + L1 审查 0 阻断) ──► 通过
      │
[阶段 8 PR]   ── (GitHub PR 页面 8 项事实逐项确认 ➔ Approve) ──► Squash 合并并核销 Goal
```
