# 精益 PRD：CLI 与脚本硬熔断守卫体系 (Hard Enforcement Guard)

- **特性代号**：`hard-guard`
- **对应架构决策**：`docs/decisions/hard-guard-decisions.md`
- **当前状态**：`Status: READY FOR HUMAN REVIEW`

---

## 1. 背景与核心痛点 (Problem & Context)
- **痛点**：当前长程任务中，AI Agent 容易在强指令（如“实施此计划”）下跳过人类审批断点，直接修改代码并自行合入 `main`。
- **根因**：CLI 缺少物理级 Fail-Closed 熔断；`bin/loopx-flow merge` 对未 Approve 的 PR 仅打 Warning 依然执行 `gh pr merge`；没有阻止向 `main` 分支直接执行 `git commit` 的钩子。
- **目标**：建立“物理级拦截”体系，把“软约定”升级为“代码级硬门禁”，任何未经人类显式签署的阶段流转与合并操作必须被强制 `exit 1` 中断。

---

## 2. 用户故事 (User Stories)
- **US-1 (审批人安全合入)**：作为技术负责人，我要求当 GitHub PR 未获得人类 Approve 时，无论是 AI 还是脚本调用 `loopx-flow merge`，都必须被直接抛错阻断并退出，绝不允许合入。
- **US-2 (流程合规保障)**：作为架构师，我要求在开始写业务代码或执行构建前，系统自动校验是否存在经过人类审批的决策文件（`decisions.md`）与契约定义（`tasks.md`），缺失签名则阻断后续执行。
- **US-3 (主干防污染)**：作为仓库管理员，我要求即便 AI 试图在本地终端直接调用 `git commit` 向 `main` 提交代码，也能被 Git 钩子直接拦截，必须切到特性分支走 PR。

---

## 3. 核心指标与交付标准 (Metrics & Acceptance)
- **合入拦截率**：PR 未处于 `APPROVED` 状态时，`loopx-flow merge` 拦截率 100%（退出码非 0）。
- **主干直接 Commit 拦截率**：在 `main` 分支执行原生 `git commit` 拦截率 100%。
- **阶段签名校验漏检率**：0 遗漏。

---

## 4. 功能规格定义 (Functional Specifications)

### 4.1 合入硬阻断 (Merge Fail-Closed Gate)
修改 `bin/loopx-flow` 中的 `cmd_merge`：
```bash
if [[ "$decision" != "APPROVED" ]]; then
    # 若非离线显式指定参数，直接抛出阻断性错误并 exit 1
    if [[ "$offline_bypass" != "true" ]]; then
        echo "[-] 致命错误: PR 未获得人类 Approval 决议，严禁合入！" >&2
        exit 1
    fi
fi
```

### 4.2 阶段守卫检查器 (`loopx-flow gate verify <stage>`)
- `loopx-flow gate verify decisions <feature>`：检查 `docs/decisions/<feature>-decisions.md` 是否存在且包含 `Status: APPROVED BY HUMAN`。
- `loopx-flow gate verify contract <feature>`：检查 `.trae/specs/<feature>/tasks.md` 是否包含 `Contract-Status: FROZEN & APPROVED`。
- `loopx-flow gate verify pr <pr_id>`：检查 PR reviewDecision 是否为 `APPROVED`。

### 4.3 Git 主干防直推钩子 (`scripts/git-hooks/pre-commit`)
- 挂载至 `.git/hooks/pre-commit`。
- 逻辑：若当前分支为 `main`（或 `master`），输出告警并 `exit 1`。

---

## 5. 范围约束 (Boundaries & Scope)
- **In Scope**：
  - 改造 `bin/loopx-flow merge` 与新增 `bin/loopx-flow gate`。
  - 编写 `scripts/git-hooks/pre-commit` 并在 `workflow-init.sh` 中自动部署。
  - 新增单元测试 `tests/unit/guard.test.js`。
- **Out of Scope**：
  - 不接入第三方企业微信/飞书机器人鉴权，保持极简本地/GitHub 生态。
  - 总改动行数严格控制在 ≤ 250 行。

---

## 6. 红队对抗测试矩阵 (Red-Team Attack Matrix)

| 攻击场景 (AI 或误操作绕过手段) | 预期防护行为 (Fail-Closed) | 反驳测试用例 (Counter-Test) |
|---|---|---|
| **攻击 1**：PR 处于 `CHANGES_REQUESTED` 或 `COMMENTED`，Agent 调用 `loopx-flow merge <pr>` | 脚本检测到非 `APPROVED`，立即输出致命错误并 `exit 1`，绝不调用 `gh pr merge` | 单测 mock PR 状态为 COMMENTED，断言退出码为 1 |
| **攻击 2**：跳过阶段 1 研讨，直接调用 `loopx-flow start` 并进入阶段 5 编码 | `loopx-flow gate verify decisions` 发现无 APPROVED 签名，阻断构建和测试 | 单测检查无签名文件时断言验证失败 |
| **攻击 3**：在 `main` 分支直接执行 `git commit -m "hack"` 绕过 PR | Git `pre-commit` 钩子拦截，提示必须检出 feature 分支并拒绝提交 | 在临时 repo 的 main 分支尝试 commit，断言失败 |
