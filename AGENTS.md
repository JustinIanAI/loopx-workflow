# AGENTS.md: LoopX AI-Native 研发与交付协议

本项目遵循 **LoopX 控制面 + GitHub 交付流 + 默认 Code Review Skills (OCR 备用与提升深度审计)** 的端到端标准化研发管线。所有在此仓库工作的 Agent 必须严格遵守以下工程规范。

---

## 核心工作铁律 (Core Axioms)

0. **前置环境哨兵先行 (Pre-flight Sentinel First)**：
   - 任何 Agent 在开始编码或进入管线前，必须首先执行 `./scripts/preflight-check.sh`。
   - 确保 Git 仓库、Remote、CLI（`gh`/`loopx`/`ocr`）、四大门禁脚本及工作流目录骨架 100% 就绪；未就绪时执行 `./scripts/preflight-check.sh --fix` 自动补齐，严禁在未就绪环境中裸跑。
1. **先思考后写代码 (Think Before Coding)**：
   - 严禁隐瞒模糊需求。进入编码前必须通过 `design-grill` 消除所有“it depends”。
   - 严禁向用户询问可通过读代码库（`rg`/`read`）解答的事实性问题。
2. **契约冻结先行 (Freeze Contract First)**：
   - 在 `.trae/specs/<feature>/tasks.md` 顶部必须先冻结 TypeScript 接口签名、类型定义与断言不变量，并使用 `loopx register-authority-source` 锁定指纹。
3. **多 Agent 任务排他锁与反熵增 (Multi-Agent Concurrency & Anti-Entropy)**：
   - 并行工作时，必须先调用 `loopx task-lease acquire --goal-id <gid> --todo-id <tid> --holder <agent_id>` 锁定租约，严禁争抢同一任务。
   - 多特性分支开发时，合并前必须通过 `loopx integration-branch` 在本地工作区提前探测并解决冲突。
   - **反熵增与代码退役 (anti-entropy-governance)**：替换旧逻辑时严格执行 `delete-first`，彻底清理废弃变量、旧分支与孤儿代码，严禁堆砌无意义的第 4 套兜底层。
4. **状态双重对账 (Dual Reconciliation)**：
   - 任务完成必须同时满足：`tasks.md` 标记 `[x] 【✅】` 与 LoopX 注册表写入通过 `loopx todo complete`。
5. **本地四大硬门禁与新鲜证据链 (Verifiable Gates & Fresh Evidence)**：
   - 任何交付前，本地四大门禁必须 100% 全绿，用例只增不减：
     ```bash
     npm run typecheck && npm run lint && npm run build && npm run test
     ```
   - **4 维新鲜证据槽规范 (Verification-Before-Completion)**：
     在声明任务完成、调用 `loopx todo complete` 或输出 L1 审查凭据时，严禁使用陈旧日志，必须显式提供以下 4 项新鲜证据事实：
     - `Fresh Check Action`: 最新执行的具体门禁命令或验证动作
     - `Result & Exit Status`: 实际退出码与执行输出摘要
     - `Covered Scope`: 本次改动直接覆盖的模块与用例集合
     - `Uncovered Scope & Residual Risk`: 未被覆盖的边界、假设限制与残余风险
6. **L1 代码级审查门禁 (默认 code-review 技能，OCR 备用与提升深度审计)**：
   - 提交 PR 前必须默认通过 `code-review` 技能审查（0 Actionable Defects 阻断）。
   - 涉及高危并发、底层持久化、安全边界或显式 cross-model 审计要求时，提升执行 `./scripts/run-ocr-audit.sh`，存在任何 High/Medium 缺陷一票否决并就地修复；在无独立 Agent 审查环境时 OCR 作为备份兜底。

---

## 管线 A: Feature 研发管线 (8 阶段)

- **阶段 0：前置体检** ➔ 运行 `./scripts/preflight-check.sh` 确保 Git、CLI、认证、四大门禁与目录就绪。
- **阶段 1：方案研讨** ➔ 调用 `design-grill` 排除事实疑问，收敛核心决策分支，产出 `docs/decisions/<feature>-decisions.md`。
- **阶段 2：精益 PRD** ➔ `create-prd` 显式读取决策备忘录 + `strategy-red-team` 攻击承重假设，产出 `docs/prd/<feature>-prd.md`。
- **阶段 3：特性拆分** ➔ `user-stories` / `prioritize-features`，控制单 Feature Diff ≤ 500 行，持久化落盘 `docs/stories/<feature>-stories.md`。
- **阶段 4：契约冻结与实体对账** ➔ 编写 `tasks.md` 顶部固化 TypeScript 签名；执行 `loopx register-authority-source` 锁定；批量创建 LoopX Goal 与 Todo 实体（命名空间 `<feature>-t<idx>`）。
- **阶段 5：TDD 循环实现与反熵增** ➔ 认领排他租约 `loopx task-lease acquire` ➔ 红绿重构（单测先写先红）➔ 依 `anti-entropy-governance` 清理退役旧逻辑 ➔ 四大门禁全绿 ➔ 依 4 维新鲜证据槽规范 `loopx todo complete` 回写证据。
- **阶段 6：代码级审查 (L1)** ➔ 默认运行 `code-review` 技能（高危提升 `./scripts/run-ocr-audit.sh`），必须 0 阻断项，标准化落盘证据 `/tmp/l1-review-evidence.md`。
- **阶段 7：集成网关与交付审查 (L2)** ➔ `loopx integration-branch` 本地预集成 ➔ `gh pr create` 自动注入门禁与 L1 证据，注入机器元数据 `<!-- loopx-meta: ... -->` ➔ `loopx-pr-review` 顶置 5-Block 审查报告至 GitHub PR 页面。
- **阶段 8：人工合并与自动归档 (L3/L4)** ➔ 人类在 GitHub PR 页面核验 8 项事实后点击 Approve ➔ 调用 `loopx-pr-merge` 核验 HEAD SHA 并原子 Squash 合入 ➔ 自动提取元数据中的 `goal_id` 执行 Goal 归档核销。

---

## 管线 B: GitHub Issue 修复管线 (双分支决策)

针对接收到的 GitHub Issue，必须先运行 `loopx issue-fix feasibility` 判定分流：

### 路径 A：Fast-Path（极简微闭环）
- **准入标准**：改动 ≤ 20 行；纯 Typo / 错误日志 / 文档 / 隔离配置 / 单测补充；0 对外接口或持久化模型变动。
- **执行命令**：
  1. 定位并补充单测验证。
  2. 外科手术式最小修复（不碰邻近无关代码）。
  3. 四大门禁全绿 + 本地 `code-review` 审查通过（高危可选 OCR 增强）。
  4. 执行自适应提交：
     ```bash
     ./scripts/fast-fix-push.sh <ISSUE_ID> "fix(<scope>): <summary>"
     ```
     （若主干未设保护则直推合入；若遇分支保护拦截，脚本自动降级为创建 PR 并自动合并）。

### 路径 B：Standard PR-Path（标准 PR 流程）
- **准入标准**：涉及业务逻辑、状态变更、算法调整、高危并发或任何不符合 Fast-Path 的缺陷。
- **执行命令**：
  1. 调用 `loopx issue-fix workflow-plan` 规划分支，检出 `fix/issue-<id>`。
  2. **七层根因因果诊断 (`systematic-debugging`)**：
     - 在动手前自下而上或自顶向下穿透观察层级：`L1 症状 ➔ L2 逻辑 ➔ L3 系统 ➔ L4 架构 ➔ L5 跨系统契约 ➔ L6 平台 ➔ L7 规格缺口`。
     - 定位真正的 **Canonical Owner (根本所有者)**，严禁仅在表层调用侧包裹防御性判断。
  3. **Failing Repro 先行**：在 `tests/unit/issues/` 下新增针对根本所有者的复现用例，**验证必须先 FAIL**。
  4. 实施外科手术修复与代码退役（`delete-first` 清除旧废弃路径），验证用例变绿。
  5. 全量回归门禁 + 4 维新鲜证据采录 + `code-review` 审查（高危提升 `./scripts/run-ocr-audit.sh` 扫描）。
  6. 创建 GitHub PR（正文注明 `Fixes #<id>` 并附带 4 维新鲜证据与复现日志）。
  7. 运行 `loopx-pr-review` 生成报告，人类在 GitHub PR 页面 Approve 后调用 `loopx-pr-merge` 合并核销。
