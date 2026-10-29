# Architecture Decisions: change-quality-failclosed
- **Status**: DRAFT (Pending Human Approval)
- **Feature**: change-quality-failclosed
- **Architectural Scope**: LoopX 质量收据真实化、动态 Diff 审查与严格 Fail-Closed 阻断机制

## 1. 核心技术路线对比与权衡

### 分支 1: 保留软错误模式 (Warning-Only Mode)
- **方案**: 发现 Blocker 缺陷时仅在终端打印警告，维持退出码为 0，允许继续提交与合并。
- **缺点**: 质量门禁形同虚设，无法在 CI/CD 和本地自动化管线中建立物理防线。
- **结论**: 坚决否决。

### 分支 2: 严格物理熔断与动态 Diff 审查融合 【采纳方案】
- **实施策略**:
  1. **拔除掩耳盗铃通道**: 彻底清理 `bin/loopx-flow check` 中 `loopx change-quality verify` 命令后缀的 `|| true` 与静默重定向，恢复 UNIX 退出码传播链条。
  2. **动态语义审查降级兜底 (Diff Semantic Analysis)**:
     在未挂载外部大模型审查报告时，适配器自动调用 `git diff` 读取特性实际改动，对代码边界进行 AST 与规则扫描（检查硬编码密钥、残留调试语句、语法与类型违背等），发现 Blocker 级别缺陷真实构造 risks payload，立即以 Exit Code 1 阻断。
  3. **LoopX 原生契约无缝对接**:
     生成符合 `change_quality_agent_result_v2` 规约的标准 Payload，调用 `loopx change-quality record`，并与当前的 Git Diff SHA 严格绑定。
  4. **全链路防篡改收据**:
     将真实的检查哈希、Blocker 计数与状态原子持久化到 `05-evidence.md` 中。
- **收益**: 真正实现“零 Blocker 缺陷方可进入交付审查”，完全消除了之前的虚假全绿现象。
