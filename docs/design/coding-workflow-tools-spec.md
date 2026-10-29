# LoopX AI-Native 研发与交付流工具集架构设计规范 (v2.0-Production)
## —— 聚焦 Feature 自包含资产胶囊、LoopX 原生能力驱动与全生命周期断点审批

**版本**：v2.0-Production (场景化与 Feature 胶囊终版)  
**基准系统**：LoopX 2.0 控制面与原生能力引擎、Feature 资产胶囊规范、Code Review 质量融合适配器、GitHub CLI (`gh`)  
**核心场景**：Feature 8 阶段场景化管线、GitHub Issues 双分支闭环、多 Agent 并行防踩踏、GitHub PR 页面审查与原子退役归档  

---

## 一、核心设计理念与业务基线

1. **深度依赖 LoopX 原生能力 (Deep LoopX Native)**：
   - 全面拥抱 LoopX 24 项内置生产级 Capabilities。
   - 任务调度使用 `task-lease` 排他锁；代码质量使用 `change-quality` 严格凭据；分支预集成使用 `integration-branch`；交付审查使用 `pr-review` 物理就绪度校验；缺陷排查使用 `issue-fix`。
2. **场景化串联与极简交互 (Zero-Burden Facade)**：
   - 设计的初衷是大幅降低 LoopX 使用门槛。提供极简门面 `bin/loopx-flow`，严禁让用户在终端中手动拼装细碎的底层 `loopx` 命令。
3. **管线即完整场景，仅关键断点介入 (Pipelines with Clear Checkpoints)**：
   - 编码与门禁由 AI 自动推进，明确阶段产出物与质量标准。**人类只把守两个关键断点**：
     - **【断点 1：方案与契约一站式审批】** (`loopx-flow approve contract`)
     - **【断点 2：GitHub PR 交付审批】** (在 GitHub 页面点击 Approve 后 `loopx-flow merge`)
4. **以 Feature 为单元自包含组织资产 (Feature Capsule Architecture)**：
   - 彻底废除跨阶段割裂分散放置文档（`docs/decisions/`、`docs/prd/` 等）的旧模式。
   - 所有特性的过程文档聚合在 `specs/features/<feature>/` 独立目录中，支持一站式全貌审阅与原子化退役归档（`specs/archive/`）。
5. **Code Review 深度融入质量门禁 (Seamless Review Ingestion)**：
   - 阿里 OCR 为**自闭环选配能力**，用户主动启用时在技能内自动完成自检、安装与扫描；
   - 审查交付物直接作为 LoopX `change-quality` 的标准输入，生成绑定当前 Git Diff SHA 的不可篡改 Receipt 门禁，消除审查孤岛。

---

## 二、Feature 自包含资产胶囊规约

每个特性在 `specs/features/<feature-name>/` 下独立维护 6 个标准化过程资产：

```
specs/features/<feature-name>/
├── 00-INDEX.md            # 【审阅看板】特性全貌索引、阶段流转状态、审批入口与 PR 链接
├── 01-decisions.md        # 【阶段 1 研讨】架构压力测试备忘录、3~6 个顶层方案对比与权衡取舍
├── 02-prd.md              # 【阶段 2 需求】精益 PRD、用户场景旅程、承重假设与反驳矩阵
├── 03-stories.md          # 【阶段 3 拆解】Job Stories 需求拆分、工作量预估 (单 PR Diff ≤ 500行)
├── 04-contract.md         # 【阶段 4 契约】不可变 TypeScript 接口固化、断言不变量与任务图
└── 05-evidence.md         # 【阶段 5/6 凭证】四大硬门禁实测输出、LoopX Quality Receipt 与 Review 结论
```

特性合并后，该目录整体原子移动至 `specs/archive/<feature-name>/`，主工程零残留。

---

## 三、管线 A：Feature 8 阶段场景化研发流

1. **阶段 0：前置体检** ➔ `loopx-flow doctor` (调用 `preflight-check.sh` 与 `loopx doctor`)。
2. **阶段 1：方案研讨** ➔ 召唤 `design-grill` 技能，消除所有“it depends”，写入 `01-decisions.md`。
3. **阶段 2：精益 PRD** ➔ 召唤 `create-prd` 与 `strategy-red-team`，攻击承重假设，写入 `02-prd.md`。
4. **阶段 3：特性拆分** ➔ 召唤 `user-stories` 与 `prioritize-features`，拆解子任务，写入 `03-stories.md`。
5. **阶段 4：契约固化与断点 1 审批** ➔ 编写 `04-contract.md` 顶部固化 TypeScript 接口，生成 `00-INDEX.md`；人类核验后执行 `loopx-flow approve contract <feat>`，锁定契约 SHA256 物理指纹。
6. **阶段 5：TDD 循环实现与反熵增** ➔ 认领排他租约 `loopx task-lease acquire` ➔ 红绿重构（单测先写先红）➔ 依 `anti-entropy-governance` 清理退役旧逻辑 ➔ 四大门禁全绿。
7. **阶段 6：代码审查与质量收据融合** ➔ 执行 `loopx-flow check`，运行语义审查（选配 OCR）并通过适配器写入 LoopX `change-quality` 严格 Receipt，回写 `05-evidence.md`。
8. **阶段 7：预集成与交付审查 (L2)** ➔ `loopx integration-branch` 隔离预集成 ➔ `gh pr create` 发起 PR ➔ `loopx-flow review <pr_id>` 顶置双语 5-Block 审查报告至 GitHub PR 页面。
9. **阶段 8：断点 2 审批、原子合入与归档** ➔ 人类在 GitHub PR 页面核验 8 项事实后点击 Approve ➔ 运行 `loopx-flow merge <pr_id>` ➔ 严格通过 `loopx pr-review --check-merge-readiness` 物理防偷跑核验 ➔ Squash 合入主干 ➔ 资产包整包原子移动至 `specs/archive/<feature>/` ➔ 自动闭环核销 Goal。

---

## 四、管线 B：GitHub Issue 闭环修复流

针对 GitHub Issue，运行 `loopx-flow issue <id>`（底层调用 `loopx issue-fix feasibility`）自动判定分流：

- **路径 A：Fast-Path（改动 ≤ 20 行，零外部破坏）**：
  单测最小修复 ➔ 本地门禁 ➔ 尝试直推 main。若遇分支保护限制，自动平滑升轨为创建 PR。
- **路径 B：Standard PR-Path（业务/状态缺陷）**：
  检出 `fix/issue-<id>` ➔ `systematic-debugging` 七层因果追踪定位根本所有者 ➔ `tests/unit/issues/issue-<id>.test.ts` 新增 Failing Repro (必先 FAIL) ➔ 修复变绿 ➔ `loopx-flow check` 固化质量收据 ➔ 发起 PR 并在页面呈现证据，人类 Approve 后由 `loopx-flow merge` 合并核销。
