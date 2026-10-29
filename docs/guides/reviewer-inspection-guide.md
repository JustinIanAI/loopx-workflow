# LoopX AI-Native 研发与交付流：关键节点质量审查与验收手册 (v2.0)
## —— 面向评审员、架构师与技术负责人的 Feature 资产胶囊审查实操指南

---

## 概述与审查哲学

在长程自主研发（Autonomous Long-Horizon Agent Workflow）中，AI Agent 负责高频、密集的代码探索与实现，而**人类决策者（评审员 / Tech Lead / 维护者）的核心价值在于关键断点（Decision & Quality Checkpoints）的把控**。

在 v2.0 规范中，所有过程文档集中于 **`specs/features/<feature-name>/` 专属资产胶囊**。评审员无需在分散目录间跳跃，只需打开 `00-INDEX.md` 即可一站式审阅所有过程交付物。

---

## 核心断点一：【断点 1】方案与契约一站式审批 (Checkpoint 1)

- **审阅阵地**：`specs/features/<feature-name>/` 目录（优先打开 `00-INDEX.md`）
- **准入时机**：编码与 TDD 实现之前。

### 1. 看什么 (Inspection Focus)
1. **架构决策权衡 (`01-decisions.md`)**：是否明确收敛了 3~6 个顶层技术路线对比（选方案 A 的原因、舍弃方案 B 的代价）。
2. **精益 PRD 与承重假设 (`02-prd.md`)**：核心用户旅程是否清晰，是否明确划定了非目标 (Out of Scope)，承重假设矩阵是否包含低成本反驳测试。
3. **不可变契约规范 (`04-contract.md`)**：顶部是否冻结了 TypeScript 接口/类型定义，是否包含断言不变量，各子任务是否有明确且无重叠的 Write Scope。

### 2. 怎么看 (How to Verify)
```bash
# 一站式查看特性全景看板
loopx-flow context <feature-name>

# 查阅契约顶部签名
head -n 40 specs/features/<feature-name>/04-contract.md
```

### 3. 一票否决红线 (Deal-Breakers)
- 决策备忘录中残留未决的“it depends”或推诿词。
- 业务范围未定义非目标，存在范围无限蔓延风险。
- 契约文件顶部未固化不可变 TypeScript 接口即试图开始编码。

### 4. 审批放行指令
核验无误后，由技术负责人或评审员在终端执行：
```bash
loopx-flow approve contract <feature-name>
```
系统将自动更新状态为 `Contract-Status: FROZEN & APPROVED`，计算契约 SHA256 并通过 LoopX 原生指令物理锁定基线，放行进入阶段 5（TDD 循环实现）。

---

## 核心断点二：本地门禁自检与质量收据核验 (Gate & Quality Receipt)

- **审阅阵地**：`specs/features/<feature-name>/05-evidence.md` 与终端输出
- **准入时机**：发起 GitHub PR 之前。

### 1. 看什么 (Inspection Focus)
1. **本地四大硬门禁全绿**：`npm run typecheck && npm run lint && npm run build && npm run test` 退出码全为 0，单测用例只增不减。
2. **LoopX 质量收据状态**：`loopx change-quality verify` 必须严格通过，绑定当前确切 Git Diff SHA，无未反驳的 Blocker 缺陷。
3. **代码反熵增治理**：核验修改是否践行 `delete-first`，彻底删除废弃变量与孤儿代码，零幽灵代码。

### 2. 怎么看 (How to Verify)
```bash
# 1. 一键执行四大硬门禁与质量收据校验
loopx-flow check

# 2. 查看特性凭证汇总
cat specs/features/<feature-name>/05-evidence.md
```

### 3. 一票否决红线 (Deal-Breakers)
- 任何一项门禁带报错，或使用 `|| true` 掩盖错误。
- 存在未修复的 High 或 Medium 级别代码缺陷。
- Receipt 签名与当前最新代码 Diff 不一致。

---

## 核心断点三：【断点 2】GitHub PR 页面交付审查与 8 项事实核验

- **阵地**：GitHub PR 页面 (Web UI) 与 `loopx-flow merge <PR_ID>`
- **准入时机**：人类审批人在 GitHub 网页点击 **Approve** 并合入主干前。

### 审批人“8 项事实”逐项核验表 (8-Point Inspection Verification)

| 序号 | 事实核验项 | 审查核心与合格标准 | 快速核验操作 |
|---|---|---|---|
| **1** | **改动范围 (Scope)** | 改动行数建议 ≤ 500 行，无多余未跟踪文件或无意义格式微调 | 网页 Files Changed，或 `gh pr diff <PR> --stat` |
| **2** | **契约稳定性** | 严格遵守 `04-contract.md` 冻结的 TypeScript 接口，无破坏性变更 | 对比契约文件顶部的类型定义与实际代码 |
| **3** | **四大门禁凭证** | 本地四大门禁全绿，且在 `05-evidence.md` 中如实填报 | 查阅 PR 描述或顶置 5-Block 报告中的门禁凭证 |
| **4** | **代码审查闭环** | 零 Actionable 缺陷，幽灵代码已彻底删除 (`delete-first`) | 查阅顶置 5-Block 报告与 `05-evidence.md` |
| **5** | **分支无漂移** | 本地已完成隔离预集成，无潜在 merge 冲突 | GitHub 页面显示 "Able to merge" |
| **6** | **机器元数据完整** | PR 正文中包含正确的 `<!-- loopx-meta: ... -->` 注释 | 检查 PR Body 中包含 Goal 与 PR 映射元数据 |
| **7** | **HEAD SHA 一致** | 当前 PR 最新的 Commit SHA 与审查时完全一致 (防偷跑提交) | `gh pr view <PR> --json headRefOid` 比对基准 SHA |
| **8** | **原子合入与归档** | 合并方式必须为 Squash & Delete Branch，资产包自动归档 | 执行 `loopx-flow merge <PR_ID>` |

---

## 总结：决策矩阵速查

```
[打开 specs/features/<feat>/00-INDEX.md] 
  │
  ├─► 核验 01-decisions.md (无 it-depends)
  ├─► 核验 02-prd.md (承重假设明确)
  ├─► 核验 04-contract.md (TS 接口固化)
  │
  ▼
[执行审批放行] ──► loopx-flow approve contract <feat> ──► 进入 TDD 编码
  │
  ▼
[编码与门禁自检] ──► loopx-flow check ──► 生成不可篡改 Quality Receipt
  │
  ▼
[发起 PR 与页面交付核验] ──► GitHub 页面核验 8 项事实 ──► 点击 Approve
  │
  ▼
[一键合并与归档] ──► loopx-flow merge <PR_ID> ──► 资产包自动移入 specs/archive/<feat>/
```
