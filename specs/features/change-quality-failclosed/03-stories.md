# User Stories & Sizing: change-quality-failclosed
- **Feature**: `change-quality-failclosed`
- **Diff 约束**: 单 PR 变动 ≤ 500 行，无幽灵代码，严格执行 `delete-first`。

## 1. 故事拆分与工作量评估 (Job Stories)

### Story 1: 移除 loopx-flow check 中的静默逃逸通道
- **作为** 质量门禁执行器，
- **我希望** `bin/loopx-flow check` 移除末尾的 `|| true`，
- **以便于** 当 `loopx change-quality verify` 失败或未通过时，立即返回非零退出码阻断流程。
- **工作量评估**: ~15 行代码调整。

### Story 2: 重构质量适配器，接入动态 Git Diff 语义扫描与熔断
- **作为** AI Agent 与代码审查员，
- **我希望** `skills/code-review/scripts/ingest-to-loopx-quality.js` 在未显式提供外部 review json 时，自动分析本地实际 Git Diff，
- **以便于** 真实捕获高危缺陷（如硬编码密钥、残留破坏性断点、未闭合语法等）并在检测到 Blocker 时强制退出 1 阻断。
- **工作量评估**: ~70 行代码实现。

### Story 3: 严格质量收据回写与 SHA256 指纹绑定
- **作为** 审计人员与合规检查员，
- **我希望** `05-evidence.md` 记录真实的 Git Diff SHA256 指纹与审查时间戳，
- **以便于** 在 PR 交付阶段能核对当前 HEAD 是否发生漂移或篡改。
- **工作量评估**: ~25 行代码。

### Story 4: 质量熔断负向测试套件
- **作为** 测试工程师，
- **我希望** 在 `tests/unit/change-quality-failclosed.test.js` 中编写测试，
- **以便于** 证明在注入 Blocker 缺陷时，`loopx-flow check` 能够 100% 触发 Fail-Closed 熔断。
- **工作量评估**: ~60 行测试用例。
