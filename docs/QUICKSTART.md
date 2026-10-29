# LoopX AI-Native 研发工作流快速上手指南 (Quick Start v2.0)

本文档帮助开发者与团队在 5 分钟内快速将本地项目或新特性接入 LoopX AI-Native 研发流水线。

---

## 一、环境先决条件 (Prerequisites)

开始前，请确保本地具备以下工具：
- **Git** (`git >= 2.30`)
- **Node.js & npm** (`node >= 18`)
- **GitHub CLI** (`gh` 且已通过 `gh auth login` 认证)
- **LoopX CLI** (`loopx >= 2.0.0`)
- *(阿里 OCR CLI 为选配项，使用时由技能内部自主检测与安装，无需手动预装)*

---

## 二、场景 A：存量已有项目接入 LoopX (1 分钟)

如果你有一个现有的代码仓库（如 TypeScript、Node、Python 等），希望引入本工作流进行场景化管线管理：

```bash
# 1. 切换到你的项目根目录
cd /path/to/your-existing-repo

# 2. 运行 loopx-flow 初始化脚手架
/path/to/loopx-workflow/bin/loopx-flow init

# 3. 执行环境哨兵体检
/path/to/loopx-workflow/bin/loopx-flow doctor
```

`loopx-flow init` 会自动完成：
- 注入规范的 Feature 资产包结构（`specs/features`、`specs/archive` 等）。
- 校验 `package.json` 中的四大硬门禁（Typecheck, Lint, Build, Test）。
- 挂载 Git pre-commit 主干防直推物理钩子。
- 在本地初始化 LoopX 状态仓库（`.loopx/registry.json`）。

---

## 三、场景 B：端到端开发一个新特性 (Feature 8 阶段场景化管线)

### 第 1 步：开启特性管线
```bash
bin/loopx-flow feature order-checkout
```
此命令会自动：
1. 创建并检出分支 `feature/order-checkout`。
2. 在 LoopX 中注册 Goal：`order-checkout-goal`。
3. 初始化完整的自包含资产包：`specs/features/order-checkout/`（包含 `00-INDEX.md` 到 `05-evidence.md`）。
4. 自动推进阶段 1~4，生成架构决策备忘录、精益 PRD 与初始契约模版。

### 第 2 步：审阅并执行断点 1 审批
打开 `specs/features/order-checkout/00-INDEX.md`，一站式审阅决策权衡、PRD承重假设与 TypeScript 契约：
```bash
# 核验无误后执行断点 1 审批放行 (锁定契约 SHA256 物理防篡改指纹)
bin/loopx-flow approve contract order-checkout
```

### 第 3 步：TDD 循环实现与质量门禁自检
1. 系统自动领用 LoopX 排他租约（`task-lease`），进行红绿单测开发。
2. 随时执行质量一体化自检（自动运行四大硬门禁、代码审查并写入 LoopX change-quality 严格收据）：
   ```bash
   # 默认语义契约审查与门禁
   bin/loopx-flow check
   
   # 若为高危并发/持久化场景，选配唤起阿里 OCR 深度审计
   bin/loopx-flow check --with-ocr
   ```

### 第 4 步：发起 PR 与交付审查
```bash
# 提交并推送到远端分支
git push -u origin feature/order-checkout

# 创建 PR
gh pr create --fill

# 触发官方交付级 5-Block 审查报告顶置
bin/loopx-flow review <PR_NUMBER>
```

### 第 5 步：GitHub PR 页面审核与断点 2 原子合并
1. 人类审批员在 GitHub PR 页面对照 [8 项事实核验表](guides/reviewer-inspection-guide.md) 核查无误后，点击 **Approve**。
2. 执行一键物理防偷跑核验、原子 Squash 合并与资产包归档：
   ```bash
   bin/loopx-flow merge <PR_NUMBER>
   ```
   该命令会自动将 `specs/features/order-checkout` 迁移至 `specs/archive/order-checkout`，并核销清算 LoopX Goal。

---

## 四、场景 C：缺陷修复双分支流转 (Issue Fix)

接收到 GitHub Issue 后，执行：
```bash
bin/loopx-flow issue <ISSUE_ID>
```

- **路径 A：Fast-Path（改动 ≤ 20 行，零外部破坏）**：
  适用于 Typo、错误日志优化、隔离配置调整。单测修复后执行 `./scripts/fast-fix-push.sh <ISSUE_ID> "fix(core): ..."`，遇到分支保护自动无缝升轨为 PR。
- **路径 B：Standard PR-Path（业务/状态缺陷）**：
  在 `tests/unit/issues/issue-<id>.test.ts` 中增加复现测试（必先 FAIL），外科手术式修复变绿，全流程闭环发 PR。
