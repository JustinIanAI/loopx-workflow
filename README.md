# LoopX AI-Native Coding Workflow (v2.0)

> 面向 Coding 场景的长程自主研发工作流。以 **LoopX 原生能力引擎** 为内核底座，**Feature 自包含资产胶囊** 为组织单元，配合 **场景化编排器 (`loopx-flow`)** 与 **GitHub 交付流**，提供从需求压力测试、方案设计、契约冻结、TDD 循环、质量收据融合到原子归档的端到端闭环研发管线。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![LoopX: v2.0](https://img.shields.io/badge/LoopX-2.0.0-green.svg)](https://github.com/loopx-project)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](package.json)

---

## 🌟 四大核心设计理念

1. **深度依赖 LoopX 原生能力 (Deep LoopX Native)**：
   全面下沉 LoopX 24 项生产级 Capabilities（`change-quality`, `pr-review`, `issue-fix`, `task-lease`, `integration-branch` 等），废弃本地脆弱的 Shell 胶水与正则匹配。
2. **场景化串联与极简交互 (Zero-Burden Facade)**：
   设计的初衷就是降低 LoopX 使用门槛。提供面向场景的极简门面 `loopx-flow`，严禁让用户在终端中手动拼装细碎的底层 `loopx` 命令。
3. **管线即完整场景，仅关键断点介入 (Pipelines with Clear Checkpoints)**：
   高频编码与证据链自证由 AI 自动推进，明确阶段产出物与一票否决红线。**人类只需把守两个关键断点**：
   - **【断点 1：方案与契约审批】** (`loopx-flow approve contract`)
   - **【断点 2：GitHub PR 交付审批】** (在 GitHub 页面点击 Approve 后 `loopx-flow merge`)
4. **以 Feature 为单元自包含资产胶囊 (Feature Capsule)**：
   彻底摒弃跨阶段割裂分散放置文档的旧模式。每个 Feature 的全周期文档聚合在 `specs/features/<feature>/` 独立目录中，支持一站式全景审阅与原子化退役归档（`specs/archive/`）。
5. **Code Review 深度融入质量门禁 (Seamless Review Ingestion)**：
   - 阿里 OCR 为**自闭环选配项**，用户主动启用时在技能内自动完成自检、安装与扫描；
   - 审查交付物直接作为 LoopX `change-quality` 的标准输入，生成绑定当前 Git Diff SHA 的不可篡改 Receipt 门禁，消除审查孤岛。

---

## 🏗️ 架构全景图

```
======================================================================================================
                         LoopX × GitHub 多 Agent 全生命周期 Coding Workflow
======================================================================================================

 [步骤 1: 一键开启新特性]
   │
   └─► loopx-flow feature <name>
         ├─ 自动完成 preflight 体检与环境就绪评分
         ├─ 检出分支 feature/<name>
         ├─ 初始化自包含资产包 specs/features/<name>/ (00-INDEX ~ 05-evidence)
         └─ 自动推进阶段 1~4，生成架构决策、精益 PRD、故事拆分与不可变契约
   │
 【🛑 关键断点 1：方案与契约一站式审批】
   │
   └─► 人类审阅 specs/features/<name>/00-INDEX.md 全景大盘 ➔ 执行审批:
         loopx-flow approve contract <name>
         └─ 锁定契约 SHA256 指纹至 LoopX 状态机，放行进入阶段 5
   │
 [阶段 5~7: 自动推进与质量自证]
   │
   ├─► LoopX 排他租约: loopx task-lease acquire (防多 Agent 踩踏)
   ├─► TDD 循环实现: 单测先写先红 ➔ 最小转绿 ➔ delete-first 消除幽灵代码
   ├─► 本地四大硬门禁: Typecheck, Lint, Build, Test 全绿
   ├─► 质量收据融合: 默认跨边界审查 (选配 OCR) ➔ 写入不可篡改 LoopX Quality Receipt
   ├─► 本地隔离预集成: loopx integration-branch 检验无分支冲突
   └─► 发起 GitHub PR 并在页面顶置双语 5-Block 审查报告
   │
 【🛑 关键断点 2：GitHub 交付审批与原子合入】
   │
   └─► 人类在 GitHub PR 页面核验 8 项事实无误 ➔ 点击【Approve】 ➔ 终端执行合入:
         loopx-flow merge <PR_ID>
         ├─ 调用 loopx pr-review --check-merge-readiness 物理防偷跑核验
         ├─ 原子 Squash 合入主干并删除特性分支
         ├─ 资产包整体原子移入 specs/archive/<name>/ (反熵增归档)
         └─ 调用 loopx goal-lifecycle 闭环核销 Goal
```

---

## ⚡ 极简极速上手

### 1. 存量已有项目接入 (1 分钟)
```bash
# 在项目根目录下一键接入工作流骨架
/path/to/loopx-workflow/bin/loopx-flow init

# 运行全维就绪度体检
./bin/loopx-flow doctor
```

### 2. 端到端开发一个新特性 (Feature)
```bash
# 1. 开启新特性管线 (自动建分支、初始化 specs/features/order-pay 资产包与 Goal)
./bin/loopx-flow feature order-pay

# 2. 审阅 specs/features/order-pay/00-INDEX.md 后，执行断点 1 审批
./bin/loopx-flow approve contract order-pay

# 3. 编写代码与单测，随时执行质量门禁与收据自检 (选配 OCR 加 --with-ocr)
./bin/loopx-flow check

# 4. 在 GitHub PR 页面核验并点击 Approve 后，一键原子合并并归档特性包
./bin/loopx-flow merge <PR_NUMBER>
```

### 3. GitHub Issue 缺陷自适应修复
```bash
# 自动可行性分流 (≤20行走 Fast-Path 直推；业务缺陷走 Failing Repro 标准 PR)
./bin/loopx-flow issue 1024
```

---

## 📂 Feature 资产胶囊结构与审阅看板

每个特性拥有独立、自包含的资产目录 `specs/features/<feature-name>/`：

| 资产文件 | 内容定位 | 审批人看什么 | 一票否决红线 |
|---|---|---|---|
| `00-INDEX.md` | **特性审阅总览看板** | 特性全貌、阶段流转状态、各文档直达链接 | 状态混乱、未经审批擅自开工 |
| `01-decisions.md` | **架构决策备忘录** | 3~6 个顶层方案对比与权衡分析 | 残留“视情况而定”等推诿词 |
| `02-prd.md` | **精益 PRD 与承重假设** | 核心业务旅程与承重假设反驳测试 | 范围未定义非目标 (Out of Scope) |
| `03-stories.md` | **故事拆解与排期** | Job Stories 拆解，单 PR Diff ≤ 500 行 | 任务粒度过大、边界模糊 |
| `04-contract.md` | **不可变契约规范** | 顶部 TypeScript 接口与断言不变量 | 缺失接口类型直接开始编码 |
| `05-evidence.md` | **质量凭据与门禁收据** | 四大门禁实测输出、LoopX Quality Receipt | 门禁带报错、Receipt 与 Diff 不匹配 |

合入后，该目录将整体移入 `specs/archive/<feature-name>/`，保持主工作区绝对干净。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
