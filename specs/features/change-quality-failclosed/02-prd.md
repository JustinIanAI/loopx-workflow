# Lean PRD: change-quality-failclosed
- **Feature**: `change-quality-failclosed`
- **Goal ID**: `change-quality-failclosed-goal`

## 1. 核心目标与问题陈述
* **核心目标**: 消除代码审查与 LoopX 质量门禁中的静默逃逸，实现真实的 Git Diff 语义扫描与绝对 Fail-Closed 熔断阻断。
* **用户场景旅程**:
  1. 开发者/Agent 运行 `loopx-flow check <feature>` 时，首先必须四大硬门禁 100% 全绿。
  2. 随后执行代码质量审查，若外部未提供 JSON 报告，自动触发轻量语义扫描，检查实际变更中的未声明变量、破坏性契约篡改与危险调试代码。
  3. 若存在任何 Blocker 级缺陷，进程必须立即以 Exit Code 1 阻断，严禁放行。
  4. 只有当零 Blocker 且所有验证全绿时，才通过 `loopx change-quality record` 生成收据，回写 `05-evidence.md` 并放行至下一阶段。

## 2. 承重假设与反驳矩阵 (Assumption Refutation Matrix)

| 假设编号 | 承重假设描述 | 潜在风险 / 证伪场景 | 缓解与反驳方案 |
|---|---|---|---|
| **A1** | 移除 `\|\| true` 后若遇到本地未安装 LoopX 的环境会直接崩溃 | 开发者在裸环境中无法运行 `loopx-flow check` | 在执行 loopx 命令前使用 `command -v loopx` 检测，并在已安装且 Goal 配置有效时强行实施严格校验，未安装时给出带 Exit 1 保护的明确提示。 |
| **A2** | 动态 Diff 扫描能精准发现阻断缺陷而不会产生大量误报 | 误将普通注释或测试代码判定为 Blocker 导致卡死 | 建立精确的规则分类（区分 security/blocker 与 advisory/warning），仅将高危安全漏洞、未解决的断点契约违背作为 Blocker。 |
| **A3** | 质量收据与当前 Git Diff SHA 严格指纹绑定可防止代码偷跑 | 开发者在审查后又修改了代码但未重跑门禁 | LoopX `change-quality verify` 会自动计算当前 repo diff 的 fingerprint，若与收据记录不一致会自动判定失效阻断。 |
