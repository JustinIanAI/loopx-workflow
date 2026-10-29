# AGENTS.md: LoopX AI-Native 场景化研发与交付协议 (v2.0)

本项目遵循 **LoopX 原生能力引擎 + Feature 自包含资产胶囊 + 场景化双管线 + 质量门禁收据融合** 的端到端标准化研发管线。所有在此仓库工作的 Agent 必须严格遵守以下工程规范。

---

## 核心工作铁律 (Core Axioms)

0. **前置环境哨兵先行 (Pre-flight Sentinel First)**：
   - 任何 Agent 在开始编码或进入管线前，必须首先执行 `./scripts/preflight-check.sh` 或 `loopx-flow doctor`。
   - 确保 Git 仓库、Remote、CLI（`gh`/`node`/`npm`/`loopx`）、四大门禁脚本及工作流目录骨架 100% 就绪；未就绪时执行 `./scripts/preflight-check.sh --fix` 自动补齐，严禁在未就绪环境中裸跑。
1. **先思考后写代码 (Think Before Coding)**：
   - 严禁隐瞒模糊需求。进入编码前必须通过 `design-grill` 消除所有“it depends”。
   - 严禁向用户询问可通过读代码库（`rg`/`read`）解答的事实性问题。
2. **以 Feature 为单元自包含组织资产 (Feature Capsule First)**：
   - 彻底摒弃跨阶段割裂分散放置文档的旧模式。所有特性的决策、PRD、故事、契约与验证凭证，统一自包含在 `specs/features/<feature>/` 目录下：
     - `00-INDEX.md`（审阅总览看板）
     - `01-decisions.md`（阶段 1 架构决策备忘录）
     - `02-prd.md`（阶段 2 精益 PRD 与承重假设）
     - `03-stories.md`（阶段 3 故事拆分与排期）
     - `04-contract.md`（阶段 4 TypeScript 契约与任务图）
     - `05-evidence.md`（阶段 5/6 门禁实测与 LoopX 质量凭据）
3. **断点 1 契约冻结与审批先行 (Contract Freeze & Checkpoint 1 Approval)**：
   - 在 `specs/features/<feature>/04-contract.md` 顶部必须冻结不可变 TypeScript 接口签名与断言不变量。
   - 必须通过 `loopx-flow approve contract <feature>` 由人类决策者执行审批放行，系统自动将状态标记为 `Contract-Status: FROZEN & APPROVED` 并通过 `loopx configure-goal --progress-review-contract-revision <sha256>` 物理锁定契约指纹后，方可进入编码实现。
4. **多 Agent 任务排他锁与反熵增 (Multi-Agent Concurrency & Anti-Entropy)**：
   - 并行工作时，必须先调用 `loopx task-lease acquire --goal-id <gid> --todo-id <tid>` 锁定租约，严禁争抢同一任务。
   - 多特性分支开发时，合并前必须通过 `loopx integration-branch` 在本地隔离 worktree 提前探测并解决冲突。
   - **反熵增与代码退役 (anti-entropy-governance)**：替换旧逻辑时严格执行 `delete-first`，彻底清理废弃变量、旧分支与孤儿代码，严禁堆砌无意义的第 4 套兜底层。
5. **本地四大硬门禁与新鲜证据链 (Verifiable Gates & Fresh Evidence)**：
   - 任何交付前，本地四大门禁必须 100% 全绿，用例只增不减：
     ```bash
     npm run typecheck && npm run lint && npm run build && npm run test
     ```
6. **Code Review 深度融入 LoopX 质量门禁 (Receipt Binding & Optional OCR)**：
   - 阿里 OCR 为**选配能力**，仅在用户显式要求时在 `open-code-review` 技能内部进行自检、安装与扫描，不作为默认阻塞。
   - 默认执行基于跨边界语义契约的 `code-review` 技能。
   - 审查交付物严禁割裂存放在 `/tmp/`：必须通过 `skills/code-review/scripts/ingest-to-loopx-quality.js` 统一编译为 LoopX `change_quality_agent_result_v2`，写入带有确切 Git Diff SHA 签名的不可篡改 Receipt，并同步沉淀在 `specs/features/<feature>/05-evidence.md`。
   - `loopx change-quality verify` 严格检验：若存在未解决的 Blocker 缺陷或代码偷跑篡改，一票否决阻断交付。

---

## 管线 A: Feature 研发管线 (8 阶段场景化闭环)

- **阶段 0：前置体检** ➔ 运行 `loopx-flow doctor` 确保 Git、CLI、认证、四大门禁与目录就绪。
- **阶段 1：方案研讨** ➔ 调用 `design-grill` 排除事实疑问，收敛核心决策分支，产出 `specs/features/<feature>/01-decisions.md`。
- **阶段 2：精益 PRD** ➔ `create-prd` 显式读取决策备忘录 + `strategy-red-team` 攻击承重假设，产出 `specs/features/<feature>/02-prd.md`。
- **阶段 3：特性拆分** ➔ `user-stories` / `prioritize-features`，控制单 Feature Diff ≤ 500 行，产出 `specs/features/<feature>/03-stories.md`。
- **阶段 4：契约冻结与断点 1 审批** ➔ 编写 `specs/features/<feature>/04-contract.md` 顶部固化 TypeScript 签名；生成 `00-INDEX.md` 全景大盘；人类执行 `loopx-flow approve contract <feature>` 锁定契约指纹并放行。
- **阶段 5：TDD 循环实现与反熵增** ➔ 认领排他租约 `loopx task-lease acquire` ➔ 红绿重构（单测先写先红）➔ 依 `anti-entropy-governance` 清理退役旧逻辑 ➔ 四大门禁全绿。
- **阶段 6：代码审查与质量收据融合** ➔ 执行 `loopx-flow check`，运行语义审查（选配 OCR）并通过适配器写入 LoopX `change-quality` 严格 Receipt，回写 `specs/features/<feature>/05-evidence.md`。
- **阶段 7：预集成与交付审查 (L2)** ➔ `loopx integration-branch` 本地预集成 ➔ `gh pr create` 发起 PR ➔ `loopx-flow review <pr_id>` 顶置双语 5-Block 审查报告至 GitHub PR 页面。
- **阶段 8：断点 2 审批、原子合入与归档** ➔ 人类在 GitHub PR 页面核验 8 项事实后点击 Approve ➔ 运行 `loopx-flow merge <pr_id>` ➔ 严格通过 `loopx pr-review --check-merge-readiness` 物理防偷跑核验 ➔ Squash 合入主干 ➔ 资产包整包原子移动至 `specs/archive/<feature>/` ➔ 自动闭环核销 Goal。

---

## 管线 B: GitHub Issue 修复管线 (双分支决策)

针对接收到的 GitHub Issue，运行 `loopx-flow issue <id>`（底层调用 `loopx issue-fix feasibility`）自动判定分流：

### 路径 A：Fast-Path（极简微闭环）
- **准入标准**：改动 ≤ 20 行；纯 Typo / 错误日志 / 文档 / 隔离配置 / 单测补充；0 对外接口或持久化模型变动。
- **执行命令**：
  1. 定位并补充单测验证。
  2. 外科手术式最小修复（不碰邻近无关代码）。
  3. 四大门禁全绿 + `loopx-flow check` 质量收据通过。
  4. 执行自适应提交：`./scripts/fast-fix-push.sh <ISSUE_ID> "fix(<scope>): <summary>"`
     （若主干未设保护则直推合入；若遇分支保护拦截，脚本自动降级为创建 PR 并自动合并）。

### 路径 B：Standard PR-Path（标准 PR 流程）
- **准入标准**：涉及业务逻辑、状态变更、算法调整、高危并发或任何不符合 Fast-Path 的缺陷。
- **执行命令**：
  1. 调用 `loopx issue-fix caller-repo-branch` 检出 `fix/issue-<id>`。
  2. **七层根因因果诊断 (`systematic-debugging`)**：从 L1 症状持续下探至 L7 规格缺口，定位根本所有者 (Canonical Owner)。
  3. **Failing Repro 先行**：在 `tests/unit/issues/issue-<id>.test.ts` 下新增针对根本所有者的复现用例，**验证必须先 FAIL**。
  4. 实施外科手术修复与代码退役（`delete-first`），验证用例变绿。
  5. 运行 `loopx-flow check` 固化质量收据。
  6. 创建 GitHub PR 并在页面呈现修复对比证据，人类 Approve 后由 `loopx-flow merge <pr_id>` 合并核销。
