# User Stories & Sizing: fail-closed-hardening

## 1. 特性规模预估 (Sizing)
- 预期变更代码行数: ~180 行（受控在 <= 500 行上限以内）。
- 涉及主要模块: `bin/loopx-flow`, `scripts/preflight-check.sh`, `package.json`, `README.md`, `tests/unit/fail-closed-hardening.test.js`。

## 2. 故事拆分与验收准则 (User Stories)

### Story 1: 全链路核心命令 Fail-Closed 改造与诊断引导
- **作为**: 使用工作流的开发者或 Agent
- **我想要**: 在环境缺失、分支创建失败或目标注册失败时立即获知阻断原因及修复命令
- **以便于**: 避免在损坏或非隔离的分支环境中继续裸跑产生脏数据
- **验收准则**:
  1. `git checkout -b` 失败时立即 `exit 1` 并输出清晰引导。
  2. `loopx bootstrap` 失败时阻断并提示原因。
  3. `loopx doctor` 发现错误时正确传递非零退出码。

### Story 2: 契约冻结与 Contract Gate 双重锚定
- **作为**: 质量把关者与人类决策者
- **我想要**: 审批合同时将当前契约文件的 SHA256 物理写入 LoopX，并在门禁时实时比对
- **以便于**: 防止 Agent 或外部修改跳过审批私自篡改已冻结契约（物理防偷跑）
- **验收准则**:
  1. `cmd_approve` 执行 `loopx configure-goal` 失败时立即报错阻断，不打印虚假成功。
  2. `cmd_gate contract` 校验文件内文本标记的同时，验证当前文件 SHA256 与已锁定的契约指纹一致。

### Story 3: 退役虚假能力与 Usage 净化 (Anti-Entropy)
- **作为**: 开发者
- **我想要**: CLI Usage 声明的能力 100% 具备真实实现
- **以便于**: 不被虚假参数误导
- **验收准则**:
  1. 移除 `usage` 中 `gate verify (decisions | contract | pr)` 的 `pr` 选项。
  2. 未知阶段报错信息对齐为 `可选: decisions, contract`。

### Story 4: 版本矩阵与文档规范对齐
- **作为**: 开源协作者
- **我想要**: `package.json`、`README.md` 与实际运行时的 Node / LoopX 要求保持一致
- **以便于**: 安装与协作时不出现环境版本分歧
- **验收准则**:
  1. `package.json` 升级至 `2.0.0`。
  2. README 徽章及环境要求更新为 `Node >=22.22.3` 与 `LoopX 2.x`。

### Story 5: 单元测试先行与门禁覆盖 (TDD)
- **作为**: 架构维护者
- **我想要**: 为上述所有阻断与双重锚定场景建立自动化单元测试
- **以便于**: 确保未来修改不发生回归
- **验收准则**:
  1. 在 `tests/unit/fail-closed-hardening.test.js` 新增针对分支阻断、契约 SHA 比对与 doctor 阻断的测试用例。
  2. 本地四大门禁 100% 全绿。
