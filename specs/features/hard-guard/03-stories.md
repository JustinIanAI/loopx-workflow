# 特性拆解与故事清单：硬熔断守卫体系 (hard-guard)

- **所属 PRD**：`docs/prd/hard-guard-prd.md`
- **预估改动行数**：~200 行 (严格限制 ≤ 300 行)
- **分支命名**：`feature/hard-enforcement-guard`

---

## 故事拆解与 Write Scope

### 故事 1：PR 合入硬阻断守卫 (US-1: Merge Fail-Closed Guard)
- **目标**：在 `bin/loopx-flow merge <pr>` 中，若 `reviewDecision !== "APPROVED"`，直接阻断退出（`exit 1`），严禁静默调用 `gh pr merge`。
- **Write Scope**：`bin/loopx-flow`
- **验收标准**：未通过 GitHub Approve 的 PR 执行合并必定失败并给出明确报错。

### 故事 2：阶段流转签名检查器 (US-2: Stage Signature Gate)
- **目标**：在 `bin/loopx-flow` 中新增 `gate` 子命令，提供：
  - `loopx-flow gate verify decisions <feature>`：核验 `decisions.md` 是否包含人类批准标记。
  - `loopx-flow gate verify contract <feature>`：核验 `tasks.md` 是否包含契约冻结标记。
- **Write Scope**：`bin/loopx-flow`
- **验收标准**：文档缺失签名时返回状态码 1 并阻断后续阶段。

### 故事 3：Git 主干直接提交拦截钩子 (US-3: Main Branch Pre-Commit Hook)
- **目标**：编写 `scripts/git-hooks/pre-commit`，在当前分支为 `main` 时拦截 `git commit`。并在 `scripts/workflow-init.sh` 中增加自动部署逻辑。
- **Write Scope**：`scripts/git-hooks/pre-commit`, `scripts/workflow-init.sh`
- **验收标准**：在 `main` 分支尝试执行 `git commit` 被直接拦截退出。

### 故事 4：红队攻击回归测试套件 (US-4: Guard Test Suite)
- **目标**：在 `tests/unit/guard.test.js` 中编写覆盖全部攻击矩阵的单测用例。
- **Write Scope**：`tests/unit/guard.test.js`
- **验收标准**：4 大门禁与新增单测 100% 通过。
