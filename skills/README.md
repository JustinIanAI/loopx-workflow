# LoopX AI-Native 研发与交付流 Skills 资产库

本目录汇总并维护了 **LoopX AI-Native 研发与交付流架构**（基于 `docs/design/coding-workflow-tools-spec.md` 与 `AGENTS.md`）全生命周期所依赖的 13 项核心 AI Agent Skills 资产。

---

## 一、资产库架构与管线映射

全生命周期涵盖 **管线 A（Feature 8 阶段研发管线）** 与 **管线 B（GitHub Issue 双分支修复管线）**，所有 Skill 均与 LoopX 控制面原子能力及本地硬门禁深度绑定。

### 1.1 管线 A：Feature 8 阶段研发技能映射

| 研发阶段 | 负责 Skill / 脚本 | 核心职责 | 产出物 / 准入门禁 |
|---|---|---|---|
| **阶段 0：前置体检** | `preflight-check.sh`<br>`workflow-init.sh` | 检查 Git、CLI、认证、四大门禁与工作流目录就绪度 | 前置体检全绿凭据（未通过阻断开工） |
| **阶段 1：方案研讨** | `design-grill` | 代码库感知的架构压力测试，探查事实并收敛 3～6 个顶级决策分支 | `docs/decisions/<feature>-decisions.md` |
| **阶段 2：精益 PRD** | `create-prd`<br>`strategy-red-team` | 读取决策备忘录，生成精益 PRD；攻击承重假设并消除致命盲区 | `docs/prd/<feature>-prd.md` |
| **阶段 3：特性拆分** | `user-stories`<br>`prioritize-features` | 按 Job Story 拆解需求；评估价值/成本并控制单 PR Diff ≤ 500 行 | `docs/stories/<feature>-stories.md` |
| **阶段 4：契约冻结与实体对账** | `(LoopX CLI)` | 顶部冻结 TypeScript 签名并锁定指纹；批量创建 LoopX Goal 与 Todo 实体 | `.trae/specs/<feature>/tasks.md` 与 LoopX 注册表 |
| **阶段 5：TDD 循环实现与反熵增** | `test-driven-development`<br>`anti-entropy-governance` | 申领排他租约，严格执行红绿重构与代码退役清理 (`delete-first`)，四大门禁 100% 绿 | `npm run typecheck && lint && build && test` + 4-Slot Fresh Evidence |
| **阶段 6：代码级审查 (L1)** | **`code-review`** *(默认)*<br>**`open-code-review`** *(提升/备用)* | 默认执行跨边界语义契约审查（0 Actionable Defects）；高危并发/安全场景提升阿里 OCR 深度扫描 | `/tmp/l1-review-evidence.md` 标准凭据落盘 |
| **阶段 7：预集成与交付审查 (L2)** | `loopx-pr-review`<br>`(LoopX CLI)` | `loopx integration-branch` 预集成校验 ➔ 发起 PR 注入门禁/L1凭据与元数据 ➔ 顶置 5-Block 报告 | GitHub PR 页面 5-Block 审查报告 |
| **阶段 8：人工合并与自动归档** | `loopx-pr-merge` | 严格校验 HEAD SHA 与 GitHub Approved 决议；原子 Squash 合入；自动提取元数据归档 Goal | GitHub 主干合入，LoopX Goal 闭环核销 |
| **阶段 2：精益 PRD** | `create-prd`<br>`strategy-red-team` | 生成 8 板块精益 PRD；攻击承重假设，产出反驳测试用例 | `docs/prd/<feature>-prd.md` 承重假设矩阵 |
| **阶段 3：特性拆分** | `user-stories`<br>`prioritize-features` | 按 Job Story 语法拆解需求；评估价值/成本并控制单 PR Diff ≤ 500 行 | 优先级任务清单、清晰的 Write Scope |
| **阶段 4：契约冻结** | `(LoopX CLI)` | 在 `tasks.md` 顶部固化 TypeScript 签名与不变性断言并注册指纹 | `loopx register-authority-source` 锁定 |
| **阶段 5：TDD 循环实现与反熵增** | `test-driven-development`<br>`anti-entropy-governance` | 申领排他租约，严格执行红绿重构与代码退役清理 (`delete-first`)，四大门禁 100% 绿 | `npm run typecheck && lint && build && test` + 4-Slot Fresh Evidence |
| **阶段 6：代码级审查 (L1)** | **`code-review`** *(默认)*<br>**`open-code-review`** *(提升/备用)* | 默认执行跨边界语义契约审查（0 Actionable Defects）；高危并发/安全场景提升阿里 OCR 深度扫描 | 0 Actionable Defects / OCR 0 High-Med |
| **阶段 7：交付级审查 (L2)** | `loopx-pr-review` | 创建 GitHub PR 并生成 5-Block 交付级中英双语审查报告 | `gh pr comment` 顶置审查报告至 PR 页面 |
| **阶段 8：人工合并 (L3/L4)** | `loopx-pr-merge` | 严格校验 HEAD SHA 与 GitHub Approved 决议后执行 Squash 合并 | `gh pr merge --squash` 原子合入并归档 Goal |

---

### 1.2 管线 B：GitHub Issue 修复技能映射

| 修复路径 | 负责 Skill | 适用场景与关键机制 |
|---|---|---|
| **分类判定 (Triage)** | `loopx-issue-fix` | 运行 `loopx issue-fix feasibility`，按改动行数、接口破坏性、复现复杂度判定分流 |
| **路径 A：Fast-Path** | `loopx-issue-fix`<br>`code-review` | 改动 ≤ 20 行且 0 对外契约变动。单测定位 ➔ 最小修复 ➔ 门禁与代码审查 ➔ 尝试直推 `main`（遇保护自动降级 PR 自动合入） |
| **路径 B：Standard PR** | `loopx-issue-fix`<br>`systematic-debugging`<br>`code-review` / `open-code-review` | 业务/状态缺陷。**七层因果诊断** ➔ **Failing Repro 先行 (必先 FAIL)** ➔ 最小修复与代码退役 ➔ 全量门禁与 4-Slot 新鲜证据 ➔ PR 审查 ➔ 人类 Approve 合并 |

---

## 二、Skills 清单与详细功能规范

```
skills/
├── anti-entropy-governance/  # [阶段 5/收尾] 代码退役决策 (delete-first) 与幽灵代码治理
├── code-review/              # [L1 默认] 跨边界契约与正确性代码审查 (含 correctness/security/performance)
├── create-prd/               # [阶段 2] 8 板块精益 PRD 快速生成工具
├── design-grill/             # [阶段 1] 代码感知方案压力测试与第一性原理极简审查
├── loopx-issue-fix/          # [管线 B] Issue 分流、七层因果诊断与自适应降级修复
├── loopx-pr-merge/           # [阶段 8] GitHub PR 原子安全合并与审计归档
├── loopx-pr-review/          # [阶段 7] 5-Block 交付级准入审查报告生成器
├── open-code-review/         # [L1 提升/备用] 阿里开源 OCR CLI 深度静态与跨模型审查
├── prioritize-features/      # [阶段 3] 特性价值评估、ROI 排序与发布边界划分
├── strategy-red-team/        # [阶段 2] 承重假设对抗攻击与致命盲区消除
├── systematic-debugging/     # [管线 B / 疑难] 复杂 Bug 七层因果下钻与最小根因定位
├── test-driven-development/  # [阶段 5] 严格红绿重构与测试反模式防御
└── user-stories/             # [阶段 3] 结构化 Job Story 需求分解
```

### 1. `code-review`（L1 代码级审查 - 默认门禁）
- **定位**：团队默认的 L1 代码审查引擎。
- **核心逻辑**：
  - 聚焦跨参与者边界的**语义契约（Agreements across boundaries）**，杜绝单文件表面语法碎屑噪音。
  - 构造可行违反执行路径（Violating Execution）并执行严苛的反向反驳测试（Refutation）。
  - 支持 `correctness`（默认）、`performance`、`security` 三大维度。
- **交付标准**：零未反驳的有效缺陷（0 Actionable Defects）。

### 2. `open-code-review`（L1 代码级审查 - 备份与提升深度审计）
- **定位**：阿里开源 `ocr` CLI 深度扫描能力，作为**备用兜底**与**高危提升**手段。
- **触发场景**：
  - **提升触发**：涉及底层持久化变更、高并发竞态与死锁风险、核心安全鉴权、单 Diff > 200 行，或显式要求跨模型交叉复核。
  - **备用触发**：无交互式 Agent 环境或缺少相应模型支持时，作为命令行独立自动化审查工具。
- **阻断标准**：执行 `./scripts/run-ocr-audit.sh`，High/Medium 缺陷一票否决。

### 3. `design-grill`（阶段 1：方案研讨）
- **定位**：编码前的架构压力测试。
- **核心逻辑**：
  - **代码感知探针**：发问前必须通过代码库检索回答既有事实，严禁向人类询问代码库可知的问题。
  - 收敛 3～6 个顶级决策分支，提供推荐方案与权衡分析。
  - 最终消除所有“it depends”，输出决策备忘录。

### 4. `create-prd` 与 `strategy-red-team`（阶段 2：精益 PRD 与红队攻击）
- **`create-prd`**：生成 600～1200 字的高信息密度精益 PRD（包含问题背景、非目标、用户旅程、核心衡量指标）。
- **`strategy-red-team`**：以红队对抗视角寻找方案的致命盲区，定位所有“若假设不成立则整体失败”的承重假设，并设计极低成本的验证用例。

### 5. `user-stories` 与 `prioritize-features`（阶段 3：拆分与优先级）
- **`user-stories`**：采用 Job Story 标准语法（`When... I want to... So I can...`）定义 acceptance criteria。
- **`prioritize-features`**：基于 Impact × Confidence / Effort 评估矩阵，严格将单 Feature 限制在 500 行 Diff 内。

### 6. `test-driven-development`（阶段 5：TDD 循环实现）
- **定位**：Red-Green-Refactor 驱动开发。
- **核心逻辑**：测试用例先写且**验证必须先红（FAIL）** ➔ 最小化代码实现转绿（PASS） ➔ 消除坏味道重构。
- **门禁要求**：必须保证本地四大门禁（Typecheck, Lint, Build, Test）100% 全绿通过。

### 7. `loopx-pr-review` 与 `loopx-pr-merge`（阶段 7~8：交付审查与原子合入）
- **`loopx-pr-review`**：
  - 针对指定 `<PR_NUMBER>@<HEAD_OID>` 执行全量交付审查。
  - 输出 5-Block 标准结构报告（变动身份、契约符合性、门禁凭据、爆炸半径、回滚预案等），通过 `gh pr comment` 推送至 GitHub PR 页面。
- **`loopx-pr-merge`**：
  - 校验 GitHub PR 官方状态：核实当前 HEAD OID 严格与审查 OID 一致（防偷跑提交），且 Review Decision 必须为 `APPROVED`。
  - 执行 `gh pr merge --squash --delete-branch`，并调用 LoopX 归档 Goal。

### 8. `loopx-issue-fix`（管线 B：GitHub Issue 双分支自适应修复）
- **定位**：GitHub Issue 闭环全自动化驱动器。
- **分流机制**：
  - **Fast-Path**：≤ 20 行极简修改，单测验证后调用 `./scripts/fast-fix-push.sh`。若主干有保护限制，自动降级为创建 PR 并自动合并。
  - **Standard PR-Path**：复杂缺陷必须新增 `tests/unit/issues/issue-<id>.test.ts` 复现用例（先红后绿），走完整 PR 页面审查与合入流程。

---

### 9. `systematic-debugging`（管线 B / 疑难修复：七层根因因果诊断）
- **定位**：Aegis 核心诊断方法论资产，解决 Agent 表层打补丁、治标不治本的核心痛点。
- **核心逻辑**：
  - **七层因果下钻**：从 L1 症状层持续下探至 L2 逻辑 ➔ L3 系统 ➔ L4 架构 ➔ L5 跨系统契约 ➔ L6 平台 ➔ L7 规格缺口。
  - **定位 Canonical Owner**：对比预期行为与坏值传递路径，锁定真正的根本所有者，严禁在消费侧加防御式 if-else 掩盖缺陷。
  - 驱动编写直击根本所有者的 Failing Repro 测试用例。

### 10. `anti-entropy-governance`（阶段 5 / 收尾：反熵增与代码退役治理）
- **定位**：Aegis 核心治理资产，解决 Agent 频繁留下废弃变量、废弃分支、过度适配等“幽灵代码（Ghost Code）”问题。
- **核心逻辑**：
  - **`delete-first` 原则**：替换内部逻辑时优先彻底删除旧路径与废弃所有者，不保留单次使用的冗余分支。
  - **`compat-exception` 原则**：仅在外部无法协同升级的分布式契约 Seam 处才允许保留兼容性退役过渡期。
  - 在完成交付前，强制清理所有由本次修改所产生的多余抽象与孤儿代码。

---

## 三、本地部署与软链接指南

为便于 Codex、Claude Code 或本地 Agent 直接加载，建议将本目录各技能软链接至用户级全局 skills 目录：

```bash
# 示例：将本项目的 skills 挂载到 ~/.codex/skills/
PROJECT_SKILLS_DIR="$(pwd)/skills"
TARGET_CODEX_DIR="$HOME/.codex/skills"

mkdir -p "$TARGET_CODEX_DIR"

for skill in "$PROJECT_SKILLS_DIR"/*; do
  if [ -d "$skill" ]; then
    name="$(basename "$skill")"
    ln -sfn "$skill" "$TARGET_CODEX_DIR/$name"
    echo "[✓] 已挂载技能: $name -> $TARGET_CODEX_DIR/$name"
  fi
done
```

---

## 四、外部工具链依赖核验

本资产库中的技能在执行时依赖以下外部 CLI 环境，请确保在本机就绪：

1. **LoopX CLI (`loopx`)**：控制面调度、租约锁管理、证据对账与集成分支检测。
2. **GitHub CLI (`gh`)**：PR 创建、PR 状态检索、PR 评论发布与自动合并。
3. **Alibaba Open Code Review (`ocr`)**：全局安装用于 L1 提升与备用扫描：
   ```bash
   npm install -g @alibaba-group/open-code-review
   ```
4. **Node.js / Python 3**：门禁运行与自动化报告解析脚本。
