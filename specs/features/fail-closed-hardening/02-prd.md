# Lean PRD: fail-closed-hardening

## 1. 核心目标与背景
消除 `loopx-workflow` 核心编排器 `bin/loopx-flow` 及相关脚本中存在的 6 处静默忽略错误（`|| true`）隐患，建立 Contract 契约物理 SHA256 双重锚定防偷跑机制，退役虚假 PR 守卫，对齐环境版本契约，使工作流自身达到严格、可信的工程级交付标准。

## 2. 用户旅程 (User Journey)
1. **开发者初始化/自检**: 运行 `loopx-flow doctor`。若环境缺少 LoopX 或依赖，控制台输出清晰诊断卡片与一键修复命令，返回非零状态（Fail-Closed）。
2. **特性分支安全检出**: 运行 `loopx-flow feature <name>`。若当前工作区有脏代码阻止分支检出，立即阻断并提示 `git stash`，绝不在 `main` 分支裸跑。
3. **断点 1 契约锁定与物理防偷跑**:
   - 运行 `loopx-flow approve contract <name>`，计算契约文件真实 SHA256 并强校验 LoopX 锁定结果。
   - 运行 `loopx-flow gate verify contract <name>`，不仅校验文本标记，还重新计算当前文件 SHA256 并与 LoopX 锁定的契约指纹物理比对。任何未经审批的契约修改将被一票否决。
4. **交付验收与生命周期闭环**:
   - 运行 `loopx-flow check`，缺少 LoopX 或质量收据不满足要求时严格熔断。
   - 运行 `loopx-flow merge <pr_id>`，PR 合并后原子迁移资产至 `specs/archive/`，严格核销 Goal 生命周期。

## 3. 非目标 (Non-Goals)
- 不重写整个 CLI 架构或替换 Shell 宿主，维持外科手术式最小修改。
- 不引入重型外部认证中心，在本地审批阶段基于可靠的真实环境签名进行校验。
- 不引入新的未实现的兜底层。

## 4. 承重假设与红队反驳分析 (Strategy Red-Team)
- **承重假设 1**: 全链路 Fail-Closed 不会导致开发者在常见场景下被误报卡死。
  - *反驳分析*: 若某个错误确实非阻断（如非关键的全局同步），盲目阻断会损伤可用性。
  - *防御对策*: 仅对分支创建、环境就绪、契约指纹锁定、收据验证等**关键承重路径**执行 Fail-Closed；每次阻断均输出明确的修复指令。
- **承重假设 2**: LoopX `configure-goal --progress-review-contract-revision` 能够稳定接受 SHA256 指纹。
  - *反驳分析*: 若 Goal 未初始化或 revision 参数格式不符合期望，配置命令会失败。
  - *防御对策*: 在执行配置前确保 Goal 存在，捕获配置返回值，若失败立刻告知原因并提示重新 bootstrap。
