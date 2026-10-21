# LoopX AI-Native 研发工作流快速上手指南 (Quick Start)

本文档帮助开发者与团队在 5 分钟内快速将本地项目或新特性接入 LoopX AI-Native 研发流水线。

---

## 一、环境先决条件 (Prerequisites)

开始前，请确保本地具备以下工具：
- **Git** (`git >= 2.30`)
- **Node.js & npm** (`node >= 18`)
- **GitHub CLI** (`gh` 且已通过 `gh auth login` 认证)
- **LoopX CLI** (`loopx >= 2.0.0`)
- **阿里 OCR CLI** (可选推荐，用于高危场景深度审查): `npm install -g @alibaba-group/open-code-review`

---

## 二、场景 A：存量已有项目接入 LoopX (1 分钟)

如果你有一个现有的代码仓库（如 TypeScript、Node、Python 等），希望引入本工作流进行任务管理：

```bash
# 1. 切换到你的项目根目录
cd /path/to/your-existing-repo

# 2. 运行 loopx-flow 初始化脚手架
/path/to/loopx-workflow/bin/loopx-flow init

# 3. 执行环境哨兵体检
/path/to/loopx-workflow/bin/loopx-flow doctor
```

`loopx-flow init` 会自动完成：
- 补充流水线规范目录骨架（`docs/decisions`、`docs/prd`、`.trae/specs` 等）。
- 校验 `package.json` 中的四大硬门禁（Typecheck, Lint, Build, Test）。
- 将 11 项 AI-Native Skills 软链接至全局 `~/.codex/skills`。
- 在本地初始化 LoopX 状态仓库（`.loopx/registry.json`）。

---

## 三、场景 B：端到端开发一个新特性 (Feature 8 阶段)

### 第 1 步：开启特性管线
```bash
bin/loopx-flow start order-checkout
```
此命令会自动：
1. 创建并检出分支 `feature/order-checkout`。
2. 在 LoopX 中注册 Goal：`order-checkout-goal`。
3. 生成契约声明任务模版：`.trae/specs/order-checkout/tasks.md`。

### 第 2 步：方案研讨与 PRD (阶段 1~3)
在对话中召唤相关 Skills：
- **阶段 1 方案研讨**：调用 `design-grill` 消除决策盲区，产出 `docs/decisions/order-checkout-decisions.md`。
- **阶段 2 精益 PRD**：调用 `create-prd` 与 `strategy-red-team`，攻击承重假设并产出 `docs/prd/order-checkout-prd.md`。
- **阶段 3 故事拆分**：调用 `user-stories` 拆分子任务，控制单 PR Diff ≤ 500 行。

### 第 3 步：契约冻结与实体对账 (阶段 4)
打开 `.trae/specs/order-checkout/tasks.md`，在顶部固定 TypeScript 接口与断言不变量：
```typescript
export interface CheckoutRequest {
  cartId: string;
  paymentMethod: 'alipay' | 'wechat';
}
```

### 第 4 步：TDD 循环实现与门禁自检 (阶段 5)
1. 申领排他租约：
   ```bash
   bin/loopx-flow todo claim t1 order-checkout-goal
   ```
2. 编写单测（先红后绿）。
3. 运行本地四大硬门禁：
   ```bash
   bin/loopx-flow check
   ```

### 第 5 步：L1 代码审查 (阶段 6)
调用 `code-review` 技能审查代码变更；若是底层高危模块，可升级执行 `./scripts/run-ocr-audit.sh`。确保无阻断级缺陷，产出 `/tmp/l1-review-evidence.md`。

### 第 6 步：发起 PR 与交付审查 (阶段 7)
```bash
# 提交并推送到远端分支
git push -u origin feature/order-checkout

# 创建 PR (使用内嵌模版)
gh pr create --fill

# 触发交付级 5-Block 审查报告顶置
bin/loopx-flow review <PR_NUMBER>
```

### 第 7 步：人工核验与原子合并 (阶段 8)
1. 人类审批员在 GitHub PR 页面对照 [8 项事实核验表](guides/reviewer-inspection-guide.md) 核查无误后，点击 **Approve**。
2. 执行一键原子 Squash 合并与目标归档：
   ```bash
   bin/loopx-flow merge <PR_NUMBER>
   ```

---

## 四、场景 C：缺陷修复双分支流转 (Issue Fix)

接收到 GitHub Issue 后，执行：
```bash
bin/loopx-flow issue <ISSUE_ID>
```

### 1. 路径 A：Fast-Path（改动 ≤ 20 行，零对外破坏）
适用于 Typo、错误日志优化、隔离配置调整：
```bash
# 本地修改并验证通过后执行自适应推送
./scripts/fast-fix-push.sh <ISSUE_ID> "fix(core): correct typo in error message"
```
脚本会优先尝试直推 `main` 并自动核销 Issue；若命中分支保护限制，会自动降级为创建自动化 PR 并提示合入。

### 2. 路径 B：Standard PR-Path（业务/状态缺陷）
1. 增加复现测试用例 `tests/unit/issues/issue-<id>.test.ts`，**验证必须先 FAIL**。
2. 外科手术式修复代码，验证测试变绿。
3. 全部门禁与审查全绿后发起标准 PR。

---

## 五、日常状态监控

任何时候均可查看当前 LoopX 状态面与注意力队列：
```bash
bin/loopx-flow status
```
